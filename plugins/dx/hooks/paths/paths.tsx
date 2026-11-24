import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, TurnStartInput } from 'claude-code'

import type { PathsFound } from '../../types'
import { heldSettings, userConfigFolder } from '../settings/settings'
import { errorText } from '../shared/format'
import { envValues, homeFolder, isWindows, systemFolder } from '../shared/system'
import { absolutePath } from '../shared/windows-path'
import { isLinksPluginListed, LINKS_PLUGIN, listLinksCommand } from './herdr-model'
import { dxOpenUrl, findPaths, isClaudeSettingsFile, isHyperlinkForcedOff, isOpenable, isTooBroad, linkPaths, showsHyperlinks, VARIABLES, withVariable } from './paths-model'
import type { Found } from './paths-model'
import { withTimeout } from './timeout'

// Clickable paths (ADR 0009): on Windows, inside herdr, the paths an
// assistant reply writes, in plain text or inline code, made links to
// `dx-open:` URLs in the text the engine draws, when they lead to a file or a
// folder, herdr's `imsike.links` plugin is installed and Claude Code shows
// hyperlinks. A ctrl+click on one reaches that plugin, which opens it as the
// person chose there: dx opens nothing itself. Anywhere else, replies are
// left as they are.

// What the settings pane says of the paths' requirements: null outside herdr
// or off Windows, where the pane offers nothing of them. Read by the replies'
// drawings too, so that they are drawn again once herdr's plugin is found.
const pathsFound = atom({ plugin: 'dx', key: 'paths' } as const, null as PathsFound | null, { shape: 'paths-1' })

// The longest reply text whose paths are made links, in characters and in
// lines, its links made: a longer one is drawn as written. Past 1,000 lines
// (or about 100,000 characters), Claude Code draws a reply in windows, its
// links as `label (url)`, no hyperlink: as read in Claude Code 2.1.330 (not
// documented).
const MAX_TEXT = 100_000
const MAX_LINES = 1000

// What dx found of the session as it started: whether it runs inside herdr
// on Windows (`HERDR_PANE_ID`); there, the system's folder herdr is run from,
// herdr's program as herdr names it (`HERDR_BIN_PATH`), the home folder (`~`
// in a reply), Claude Code's configuration folder (its settings files, never
// linked) and where it lands (`configReal`, asked once, not waited for by the
// start), the environment variables a path may start with (`variables`, `%TEMP%\x`:
// VARIABLES, read once, not waited for by the start), whether Claude Code
// draws links as hyperlinks there, and whether `FORCE_HYPERLINK` is what
// turns them off.
type Herdr = {
  inHerdr: true
  systemRoot: string | undefined
  herdrBin: string | undefined
  home: string | undefined
  configDir: string | undefined
  configReal: Promise<string | undefined>
  variables: Promise<ReadonlyMap<string, string | undefined>>
  hyperlinks: boolean
  isForcedOff: boolean
}
type System = Herdr | { inHerdr: false }
const OUTSIDE: System = { inHerdr: false }
let system: Promise<System> | undefined

// Whether herdr's plugin was found: looked for as the session starts (asked
// a second time when herdr fails), never waited for by it.
let plugin: PathsFound['plugin'] = 'checking'
// The session's start the look for it belongs to: a later start runs another.
let generation = 0

// How long herdr's list of its plugins may take before it is given up, each
// time it is asked, and how many times it is asked, at most.
const LIST_TIMEOUT_MS = 3000
const LIST_ATTEMPTS = 2

// What each absolute path leads to, a file or a folder, nothing (`absent`),
// or none dx may link (`none`), as last asked, and when. A path that leads
// to no file or folder is asked again sooner, as a reply may name a file
// before it is written. At most MAX_KNOWN paths, then forgotten all at once.
// A check under way (`pending`) is never asked again before it answers: the
// API bounds no file system call, and a dead network drive may never answer.
// One a drawing found late (`overdue`) is waited for by no later drawing,
// and has the replies drawn again as it answers.
type Kind = 'file' | 'dir' | 'absent' | 'none'
const known = new Map<string, { kind: Kind; at: number }>()
const pending = new Map<string, Promise<Kind>>()
const overdue = new Set<string>()
const KNOWN_MS = 5 * 60_000
const UNKNOWN_MS = 10_000
const MAX_KNOWN = 2000
// How long the check of where Claude Code's configuration folder lands may
// take before it is given up.
const STAT_TIMEOUT_MS = 10_000
// How long a reply's drawing waits for the checks of its paths on disk, one
// wait for the whole drawing: a path whose check is late is not linked in
// that drawing; its answer, cached as it comes, has it drawn again.
const STAT_WAIT_MS = 300

// The paths found in the last texts drawn, the latest last: a reply is drawn
// again as it is repainted, scrolled or resized, its text the same. At most
// MAX_SEARCHED texts, the one drawn least recently dropped first.
const searched = new Map<string, Found[]>()
const MAX_SEARCHED = 16

function pathsIn(text: string): Found[] {
  const found = searched.get(text) ?? findPaths(text)
  searched.delete(text)
  if (searched.size >= MAX_SEARCHED) {
    const oldest = searched.keys().next()
    if (oldest.done !== true) searched.delete(oldest.value)
  }
  searched.set(text, found)
  return found
}

// Called by ../register as the session starts: reads the environment, then,
// inside herdr, looks for herdr's plugin without waiting for it.
export async function startPaths($: EngineInterface): Promise<void> {
  generation += 1
  const started = generation
  plugin = 'checking'
  system = findSystem($).catch(() => OUTSIDE)
  const found = await system
  await showFound($).catch(() => undefined)
  if (!found.inHerdr) return
  $.ui.log(`dx : chemins cliquables, hyperliens ${found.hyperlinks ? 'oui' : found.isForcedOff ? 'non (FORCE_HYPERLINK les désactive)' : 'non (FORCE_HYPERLINK=1 les active)'}`, { to: 'debug' })
  void lookForPlugin($, found, started)
}

// Called by ../register as a turn starts: a `/clear` empties dx's state with
// no session start; written back from what the start found. A subagent's
// turn leaves it.
export async function startPathsTurn($: EngineInterface, e: TurnStartInput): Promise<void> {
  if (e.agentId !== undefined || system === undefined) return
  await showFound($).catch(() => undefined)
}

// Writes what the session found to the state, unless the state holds it
// already: one write after the other.
let showing: Promise<void> = Promise.resolve()
function showFound($: EngineInterface): Promise<void> {
  const shown = showing.then(() => writeFound($))
  showing = shown.catch(() => undefined)
  return shown
}

async function writeFound($: EngineInterface): Promise<void> {
  const found = (await system) ?? OUTSIDE
  const value: PathsFound | null = found.inHerdr ? { plugin, hyperlinks: found.hyperlinks, isForcedOff: found.isForcedOff } : null
  const shown = await read($, pathsFound)
  if (shown?.plugin === value?.plugin && shown?.hyperlinks === value?.hyperlinks && shown?.isForcedOff === value?.isForcedOff) return
  await update($, pathsFound, () => value)
}

// Windows and herdr (`HERDR_PANE_ID`), then what the links need.
async function findSystem($: EngineInterface): Promise<System> {
  if (!(await isWindows($))) return OUTSIDE
  const [pane] = await envValues([$.env.get('HERDR_PANE_ID')])
  if (pane === undefined) return OUTSIDE
  const [values, systemRoot, home, configDir] = await Promise.all([
    envValues([
      $.env.get('FORCE_HYPERLINK'),
      $.env.get('WT_SESSION'),
      $.env.get('TMUX'),
      $.env.get('TERM_PROGRAM'),
      $.env.get('TERM_PROGRAM_VERSION'),
      $.env.get('TERMINAL_EMULATOR'),
      $.env.get('LC_TERMINAL'),
      $.env.get('TERM'),
      $.env.get('HERDR_BIN_PATH'),
    ]),
    systemFolder($),
    homeFolder($),
    userConfigFolder($),
  ])
  const [forceHyperlink, wtSession, tmux, termProgram, termProgramVersion, terminalEmulator, lcTerminal, term, herdrBin] = values
  const env = { forceHyperlink, wtSession, tmux, termProgram, termProgramVersion, terminalEmulator, lcTerminal, term }
  return {
    inHerdr: true,
    systemRoot,
    herdrBin,
    home,
    configDir,
    configReal: configDir === undefined ? Promise.resolve(undefined) : realFolder($, configDir),
    variables: readVariables($),
    hyperlinks: showsHyperlinks(env),
    isForcedOff: isHyperlinkForcedOff(env),
  }
}

// The environment variables a path may start with, VARIABLES, by their
// names in capitals: each read by its name as Windows spells it, in the same
// order.
async function readVariables($: EngineInterface): Promise<ReadonlyMap<string, string | undefined>> {
  const values = await envValues([
    $.env.get('USERPROFILE'),
    $.env.get('LOCALAPPDATA'),
    $.env.get('APPDATA'),
    $.env.get('TEMP'),
    $.env.get('TMP'),
    $.env.get('ProgramFiles'),
    $.env.get('ProgramFiles(x86)'),
    $.env.get('ProgramData'),
    $.env.get('SystemRoot'),
    $.env.get('windir'),
    $.env.get('PUBLIC'),
  ])
  return new Map(VARIABLES.map((name, index) => [name, values[index]]))
}

// Where Claude Code's configuration folder lands (`CLAUDE_CONFIG_DIR`, else
// `.claude` in the home folder): its `realPath`, through a junction, a
// short 8.3 name or the `\\?\` prefix; none when the engine does not say it,
// or does not answer within STAT_TIMEOUT_MS.
function realFolder($: EngineInterface, folder: string): Promise<string | undefined> {
  return withTimeout(
    $,
    $.fs.stat(folder, { resolve: true }).then(found => found.realPath),
    STAT_TIMEOUT_MS,
    undefined,
  )
}

// herdr's list of its plugins, read as the session starts: herdr run from
// the system's folder, by the path herdr gives its panes (`HERDR_BIN_PATH`,
// absolute) or else by its name, so that no `herdr.exe` of the session's
// working directory runs in its place. A list herdr fails to give (missing,
// an exit in error, late) is asked once more; failing again, the plugin is
// not known (`failed`), told from a list that does not hold it (`missing`).
// Without the system's folder, herdr is not run (`unchecked`).
async function lookForPlugin($: EngineInterface, found: Herdr, started: number): Promise<void> {
  let result: PathsFound['plugin'] = 'failed'
  if (found.systemRoot === undefined) {
    $.ui.log('dx : dossier du système inconnu (SystemRoot, windir), liste des plugins herdr non lue', { to: 'debug' })
    result = 'unchecked'
  } else {
    for (let attempt = 1; attempt <= LIST_ATTEMPTS && result === 'failed'; attempt++) {
      result = await listPlugin($, found.systemRoot, found.herdrBin, attempt)
    }
  }
  if (started !== generation) return
  plugin = result
  await showFound($).catch(() => undefined)
}

// One reading of herdr's list: whether it holds the plugin, or failed.
async function listPlugin($: EngineInterface, systemRoot: string, herdrBin: string | undefined, attempt: number): Promise<PathsFound['plugin']> {
  try {
    const listed = await $.process.run(listLinksCommand(herdrBin), { cwd: systemRoot, timeoutMs: LIST_TIMEOUT_MS })
    if (listed.exitCode !== 0) {
      $.ui.log(`dx : liste des plugins herdr en échec, essai ${attempt} (code ${listed.exitCode})`, { to: 'debug' })
      return 'failed'
    }
    if (isLinksPluginListed(listed.stdout)) return 'listed'
    $.ui.log(`dx : plugin herdr ${LINKS_PLUGIN} absent ou désactivé`, { to: 'debug' })
    return 'missing'
  } catch (error) {
    $.ui.log(`dx : liste des plugins herdr illisible, essai ${attempt} (${errorText(error)})`, { to: 'debug' })
    return 'failed'
  }
}

// Claude Code's configuration folder, as `isClaudeSettingsFile` takes it.
type ConfigFolder = { configDir: string | undefined; configReal: Promise<string | undefined> | undefined }

// What an absolute path leads to at `now` (the drawing's time), from the
// cache while it holds, else asked; 'late' when the answer outlasts `late`,
// the drawing's wait, or a drawing already found it late.
async function kindAt($: EngineInterface, abs: string, folder: ConfigFolder, now: number, late: () => Promise<'late'>): Promise<Kind | 'late'> {
  const cached = known.get(abs)
  if (cached !== undefined && now - cached.at < (cached.kind === 'absent' ? UNKNOWN_MS : KNOWN_MS)) return cached.kind
  if (overdue.has(abs)) return 'late'
  const kind = await Promise.race([pending.get(abs) ?? ask($, abs, folder), late()])
  if (kind === 'late' && pending.has(abs)) overdue.add(abs)
  return kind
}

// Asks the file system whether `abs` leads to a file or a folder, and which,
// through a symbolic link too, the answer cached as it comes, with the time
// it came, the replies drawn again when a drawing found it late: `absent`
// when the file system says there is no such file (`ENOENT`); `none` when
// where it lands (`realPath`) is a path dx does not link (`isOpenable`) or one
// of Claude Code's settings files, or is not said (a hook withheld it: the
// path, or a folder above it, may be a link to anywhere), or when it fails
// otherwise.
function ask($: EngineInterface, abs: string, { configDir, configReal }: ConfigFolder): Promise<Kind> {
  const asking = Promise.all([$.fs.stat(abs, { resolve: true }), configReal])
    .then(
      ([found, real]): Kind =>
        found.kind !== 'other' && found.realPath !== undefined && isOpenable(found.realPath) && !isClaudeSettingsFile(found.realPath, configDir, real) ? found.kind : 'none',
      (error): Kind => (/\bENOENT\b/.test(errorText(error)) ? 'absent' : 'none'),
    )
    .then(async kind => {
      const at = await $.clock.now()
      if (known.size >= MAX_KNOWN) known.clear()
      known.set(abs, { kind, at })
      return kind
    })
    .finally(() => {
      pending.delete(abs)
      if (overdue.delete(abs)) $.ui.invalidate('ui.render')
    })
  pending.set(abs, asking)
  return asking
}

// The reply's text as dx has the engine draw it; none when it is left as it
// is. Inside herdr alone, herdr's plugin found, hyperlinks shown and the
// setting on, in a reply short enough (MAX_TEXT, MAX_LINES), each path found
// that leads to a file or a folder made a link: placed (a variable replaced
// by its value, a relative path in the working directory), one dx may link
// (`isOpenable`), not one of Claude Code's settings files, and not too broad
// to be meant (`isTooBroad`). The checks on disk are waited for
// STAT_WAIT_MS at most, one wait for the whole drawing; a late one has the
// reply drawn again as it answers.
async function shownReply($: EngineInterface, text: string): Promise<string | undefined> {
  const found = await system
  if (found === undefined || !found.inHerdr) return undefined
  // Read for the drawing to be drawn again as herdr's plugin is found, or the
  // setting changes.
  const [, { clickablePaths }] = await Promise.all([read($, pathsFound), heldSettings($)])
  if (!clickablePaths || plugin !== 'listed' || !found.hyperlinks || text.length > MAX_TEXT || hasLinesPast(text, MAX_LINES)) return undefined
  const items = pathsIn(text)
  if (items.length === 0) return undefined
  const { home, configDir } = found
  const folder: ConfigFolder = { configDir, configReal: found.configReal }
  const [cwd, now, variables] = await Promise.all([$.session.cwd(), $.clock.now(), found.variables])
  const waiting = new AbortController()
  // The drawing's one wait, started by the first check not cached.
  let deadline: Promise<'late'> | undefined
  const late = () => (deadline ??= $.clock.sleep(STAT_WAIT_MS, { signal: waiting.signal }).then(
    () => 'late' as const,
    () => 'late' as const,
  ))
  const hrefOf = async (item: Found): Promise<string | undefined> => {
    const withValue = withVariable(item.path, variables)
    const abs = withValue === undefined ? undefined : absolutePath(withValue, cwd, home)
    if (abs === undefined || !isOpenable(abs) || isClaudeSettingsFile(abs, configDir) || isTooBroad(abs, cwd, home)) return undefined
    const kind = await kindAt($, abs, folder, now, late)
    return kind === 'file' || kind === 'dir' ? dxOpenUrl(abs, item.place) : undefined
  }
  let hrefs: (string | undefined)[]
  try {
    hrefs = await Promise.all(items.map(hrefOf))
  } finally {
    waiting.abort()
  }
  const byItem = new Map(items.map((item, index) => [item, hrefs[index]]))
  const linked = linkPaths(text, items, item => byItem.get(item))
  return linked === text || linked.length > MAX_TEXT ? undefined : linked
}

// Whether `text` holds more than `max` lines, each ending at `\n`, `\r\n` or
// a `\r` alone.
function hasLinesPast(text: string, max: number): boolean {
  let lines = 1
  for (let at = 0; at < text.length; at++) {
    const sign = text.charCodeAt(at)
    if (sign !== 10 && sign !== 13) continue
    if (sign === 13 && text.charCodeAt(at + 1) === 10) at++
    lines += 1
    if (lines > max) return true
  }
  return false
}

// What the settings pane says of the paths' requirements: null outside herdr
// or off Windows.
export async function clickablePathsFound($: EngineInterface): Promise<PathsFound | null> {
  return read($, pathsFound)
}

export function registerPaths(on: On): void {
  // Every reply's block the terminal draws, a summary's too: the engine draws
  // it, its text rewritten when dx has links to make.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const text = await shownReply($, e.props.text)
    return next(text === undefined ? e : { ...e, props: { ...e.props, text } })
  })
}
