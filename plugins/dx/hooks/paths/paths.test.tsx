import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On, ProcessRunInit, ProcessRunResult } from 'claude-code'

import { click, engine, NOW, SETTINGS_PANE, showSettings, windowsPath } from '../shared/testing'

// The working directory is `C:\Users\dev\repo\app` (../shared/testing): files
// and folders in it, among them Claude Code's settings files.
const FILES = {
  'repo/app/src/app.ts': 'export {}\n',
  'repo/app/docs/guide.md': '# Guide\n',
  'repo/app/docs,x/y.txt': '',
  'repo/app/.claude/settings.json': '{}',
  'repo/app/.claude/commands/x.md': '',
  'repo/app/_build/out_': '',
  'repo/app/chemins test/dossier (é)/fichier é (1).txt': 'a\nb\n',
  'repo/app/cfg/settings.json': '{}',
}
// A file of the user's temporary folder (`TEMP`, ../shared/testing).
const TEMP = { 'AppData/Local/Temp/log.txt': '' }
const SYSTEM_ROOT = String.raw`C:\Windows`
const LISTED = JSON.stringify({
  id: 'cli:plugin',
  result: { plugins: [{ plugin_id: 'imsike.links', enabled: true, link_handlers: [{ action: 'open', id: 'dx-open', pattern: '^dx-open:' }] }], type: 'plugin_list' },
})
const NOT_LISTED = JSON.stringify({ id: 'cli:plugin', result: { plugins: [], type: 'plugin_list' } })

const OK: ProcessRunResult = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

// A reply's block, drawn in the terminal.
function reply(text: string, { surface = 'terminal' }: { surface?: 'terminal' | 'desktop' } = {}) {
  return {
    plugin: 'dx',
    component: 'AssistantMessage',
    surface,
    requestId: 'm1',
    props: { text, isFirstOfReply: true },
  } as const
}

type Setup = {
  // Inside a herdr pane (`HERDR_PANE_ID`), on Windows, with hyperlinks forced.
  herdr?: boolean
  windows?: boolean
  hyperlinks?: boolean
  // What herdr's list of its plugins answers: listed, not, a failure.
  listing?: 'listed' | 'missing' | 'fails' | ((clock: MockClock) => Promise<ProcessRunResult | undefined>)
  stored?: Record<string, unknown>
  clock?: MockClock
  env?: Record<string, string>
  // The files on disk: FILES and TEMP by default.
  files?: Record<string, string>
}
type Ran = { argv: string[]; init?: ProcessRunInit }

// The engine, the session started; the programs run.
async function start($: Engine, on: On, { herdr = true, windows = true, hyperlinks = true, listing = 'listed', stored = {}, clock, env = {}, files = { ...FILES, ...TEMP } }: Setup = {}) {
  const time = clock ?? mock.clock(on, { now: NOW })
  const ran: Ran[] = []
  engine(on, {
    files,
    stored,
    env: {
      ...(windows ? { OS: 'Windows_NT', SystemRoot: SYSTEM_ROOT } : {}),
      ...(herdr ? { HERDR_PANE_ID: 'w1:p1', TERM_PROGRAM: 'herdr' } : {}),
      ...(hyperlinks ? { FORCE_HYPERLINK: '1' } : {}),
      ...env,
    },
    run: (argv, init) => {
      ran.push({ argv: [...argv], ...(init === undefined ? {} : { init }) })
      // herdr by its name, or by its path (`HERDR_BIN_PATH`).
      if (!/(?:^|\\)herdr(?:\.exe)?$/.test(argv[0] ?? '')) return undefined
      if (typeof listing === 'function') return listing(time)
      if (listing === 'fails') return { ...OK, exitCode: 1, stderr: 'herdr: server not running' }
      return { ...OK, stdout: listing === 'listed' ? LISTED : NOT_LISTED }
    },
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  return ran
}

// The text the engine is handed to draw each reply, beneath dx.
function engineDrawn(on: On): string[] {
  const drawn: string[] = []
  on('ui.render', { component: 'AssistantMessage' }, (_, e) => {
    drawn.push(e.props.text)
    return { type: 'Text', props: {}, children: ['engine'] } as never
  })
  return drawn
}

// What the engine is handed for one reply, mounted and unmounted.
async function drawnText($: Engine, drawn: string[], text: string): Promise<string | undefined> {
  const ui = await $.ui.mount(reply(text))
  await ui.unmount()
  return drawn.at(-1)
}

const APP = 'dx-open:///C:/Users/dev/repo/app/src/app.ts'
const DOCS = 'dx-open:///C:/Users/dev/repo/app/docs'

test('inside herdr, with its links plugin and hyperlinks, each path that exists is made a dx-open link the engine draws', async ($, on) => {
  const drawn = engineDrawn(on)
  await start($, on)
  expect(await drawnText($, drawn, 'Voir src/app.ts:12, le dossier `docs/` et src/absent.ts, ou https://x.dev/src/app.ts.')).toBe(
    `Voir [src/app.ts:12](${APP}#L12), le dossier [\`docs/\`](${DOCS}) et src/absent.ts, ou https://x.dev/src/app.ts.`,
  )
})

test("herdr's list is read once, by herdr's name, from the system's folder, within 10 s", async ($, on) => {
  const drawn = engineDrawn(on)
  const ran = await start($, on)
  await drawnText($, drawn, 'Voir src/app.ts.')
  await drawnText($, drawn, 'Voir docs/guide.md.')
  expect(ran).toEqual([{ argv: ['herdr', 'plugin', 'list', '--plugin', 'imsike.links', '--json'], init: { cwd: SYSTEM_ROOT, timeoutMs: 10_000 } }])
})

test('a path with spaces is linked in quotes or code, never in plain text; an accent, parentheses, a range, a Git Bash drive, emphasis', async ($, on) => {
  const drawn = engineDrawn(on)
  await start($, on)
  const file = String.raw`C:\Users\dev\repo\app\chemins test\dossier (é)\fichier é (1).txt`
  const href = 'dx-open:///C:/Users/dev/repo/app/chemins%20test/dossier%20%28%C3%A9%29/fichier%20%C3%A9%20%281%29.txt'
  expect(await drawnText($, drawn, `Voir "${file}:1-2" et \`${file}\`.`)).toBe(`Voir "[${file}:1-2](${href}#L1-L2)" et [\`${file}\`](${href}).`)
  expect(await drawnText($, drawn, `Voir ${file}.`)).toBe(`Voir ${file}.`)
  expect(await drawnText($, drawn, 'Voir /c/Users/dev/repo/app/src/app.ts et _src/app.ts_.')).toBe(
    `Voir [/c/Users/dev/repo/app/src/app.ts](${APP}) et _[src/app.ts](${APP})_.`,
  )
  // Between the same marks, a word is read as markdown draws it, without
  // them: `_build/out_` is `build/out`, drawn in italics; a mark on one side
  // alone is the name's.
  expect(await drawnText($, drawn, '_build/out_ et _voir src/app.ts_.')).toBe('_build/out_ et _voir src/app.ts_.')
})

// The paths matching `path` asked of the disk, as the engine is asked them.
function statsAsked(on: On, path: RegExp): string[] {
  const asked: string[] = []
  on('fs.stat', { path }, (_, e, next) => {
    asked.push(windowsPath(e.path))
    return next(e)
  })
  return asked
}

test("Claude Code's own settings files, paths herdr's plugin would not take whole, and the folders too broad are not linked", async ($, on) => {
  const drawn = engineDrawn(on)
  await start($, on)
  const text = 'Voir .claude/settings.json, .claude/commands/x.md, docs,x/y.txt, `C:\\Users\\dev\\repo\\app` et `C:\\Users\\dev`.'
  expect(await drawnText($, drawn, text)).toBe(
    'Voir .claude/settings.json, [.claude/commands/x.md](dx-open:///C:/Users/dev/repo/app/.claude/commands/x.md), docs,x/y.txt, `C:\\Users\\dev\\repo\\app` et `C:\\Users\\dev`.',
  )
})

test("the model's own links, their text and target, dx-open ones too, and fenced code are left as written", async ($, on) => {
  const drawn = engineDrawn(on)
  await start($, on)
  const fence = '```\n[x](dx-open:///C:/x/evil.exe) src/app.ts\n```'
  const own = String.raw`Voir [le guide](docs/guide.md#L3), [src/app.ts](src/app.ts), [README.md](dx-open:///C:/x/evil.exe), [b](dx\-open:///C:/x/b.exe) et <dx-open:///C:/x/c.exe>`
  expect(await drawnText($, drawn, `${own} puis src/app.ts.\n${fence}`)).toBe(`${own} puis [src/app.ts](${APP}).\n${fence}`)
})

test("outside herdr, nothing runs and the reply is left as it is", async ($, on) => {
  const drawn = engineDrawn(on)
  const ran = await start($, on, { herdr: false })
  const text = 'Voir src/app.ts et [x](dx-open:///C:/x/evil.exe).'
  expect(await drawnText($, drawn, text)).toBe(text)
  expect(ran).toEqual([])
})

test('off Windows, nothing runs and the reply is left as it is', async ($, on) => {
  const drawn = engineDrawn(on)
  const ran = await start($, on, { windows: false })
  expect(await drawnText($, drawn, 'Voir src/app.ts.')).toBe('Voir src/app.ts.')
  expect(ran).toEqual([])
})

test('on the desktop the reply is left as it is', async ($, on) => {
  const drawn = engineDrawn(on)
  await start($, on)
  const ui = await $.ui.mount(reply('Voir src/app.ts.', { surface: 'desktop' }))
  await ui.unmount()
  expect(drawn).toEqual(['Voir src/app.ts.'])
})

for (const [why, setup] of [
  ['without its plugin', { listing: 'missing' }],
  ["when herdr's list fails", { listing: 'fails' }],
  ['without hyperlinks', { hyperlinks: false }],
  ['with the setting off', { stored: { settings: { clickablePaths: false } } }],
] as const) {
  test(`inside herdr ${why}, the reply is left as it is`, async ($, on) => {
    const drawn = engineDrawn(on)
    await start($, on, setup)
    expect(await drawnText($, drawn, 'Voir src/app.ts.')).toBe('Voir src/app.ts.')
  })
}

test("herdr's list missing never fails the session's start", async ($, on) => {
  const drawn = engineDrawn(on)
  // herdr not on the PATH: the run refused.
  engine(on, { env: { OS: 'Windows_NT', SystemRoot: SYSTEM_ROOT, HERDR_PANE_ID: 'w1:p1', FORCE_HYPERLINK: '1' } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(await drawnText($, drawn, 'Voir src/app.ts.')).toBe('Voir src/app.ts.')
})

test("the session's start does not wait for herdr's list; the replies are linked once it answers", async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const drawn = engineDrawn(on)
  await start($, on, {
    clock,
    listing: async time => {
      await time.sleep(2000)
      return { ...OK, stdout: LISTED }
    },
  })
  const ui = await $.ui.mount(reply('Voir src/app.ts.'))
  expect(drawn.at(-1)).toBe('Voir src/app.ts.')
  await clock.advance(2000)
  expect(drawn.at(-1)).toBe(`Voir [src/app.ts](${APP}).`)
  await ui.unmount()
})

test('a path whose check on disk is late is not linked in that drawing; its answer has the reply drawn again', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const drawn = engineDrawn(on)
  // A slow drive: guide.md's check answers 5 s late.
  on('fs.stat', { path: /guide\.md$/ }, async (_, e, next) => {
    await clock.sleep(5000)
    return next(e)
  })
  await start($, on, { clock })
  const text = 'Voir docs/guide.md et src/app.ts.'
  const mounting = $.ui.mount(reply(text))
  await clock.advance(300)
  const ui = await mounting
  expect(drawn.at(-1)).toBe(`Voir docs/guide.md et [src/app.ts](${APP}).`)
  await clock.advance(5000)
  expect(drawn.at(-1)).toBe(`Voir [docs/guide.md](${DOCS}/guide.md) et [src/app.ts](${APP}).`)
  await ui.unmount()
})

test('%ProgramFiles(x86)% is read whatever its case; a name holding a percent sign is not linked', async ($, on) => {
  const drawn = engineDrawn(on)
  const env = { 'ProgramFiles(x86)': String.raw`C:\Program Files (x86)` }
  await start($, on, { env, files: { ...FILES, ...TEMP, 'C:/Program Files (x86)/a.txt': '', 'repo/app/100%.txt': '' } })
  const url = 'dx-open:///C:/Program%20Files%20%28x86%29/a.txt'
  expect(await drawnText($, drawn, String.raw`Voir %ProgramFiles(x86)%\a.txt et %PROGRAMFILES(X86)%\a.txt.`)).toBe(
    String.raw`Voir [%ProgramFiles(x86)%\a.txt](${url}) et [%PROGRAMFILES(X86)%\a.txt](${url}).`,
  )
  const code = String.raw`%ProgramFiles(x86)%\a.txt`
  expect(await drawnText($, drawn, `Voir \`${code}\`.`)).toBe(`Voir [\`${code}\`](${url}).`)
  // A percent sign past a variable is no path's.
  expect(await drawnText($, drawn, 'Voir 100%.txt et `100%.txt`.')).toBe('Voir 100%.txt et `100%.txt`.')
})

test('a path from a variable is linked where the variable leads, its label as written', async ($, on) => {
  const drawn = engineDrawn(on)
  const env = { LOCALAPPDATA: String.raw`C:\Users\dev\AppData\Local`, APPDATA: 'AppData' }
  await start($, on, { env, files: { ...FILES, ...TEMP, '.claude/settings.json': '{}' } })
  const log = 'dx-open:///C:/Users/dev/AppData/Local/Temp/log.txt'
  expect(await drawnText($, drawn, String.raw`Voir %LOCALAPPDATA%\Temp\log.txt et %temp%/log.txt.`)).toBe(
    String.raw`Voir [%LOCALAPPDATA%\Temp\log.txt](${log}) et [%temp%/log.txt](${log}).`,
  )
  // Unset, not a drive path, unknown: not linked; nor a settings file.
  for (const text of [String.raw`%ProgramData%\log.txt`, String.raw`%APPDATA%\Local\Temp\log.txt`, String.raw`%HOME%\AppData\Local\Temp\log.txt`, String.raw`%USERPROFILE%\.claude\settings.json`]) {
    expect(await drawnText($, drawn, `Voir ${text}.`)).toBe(`Voir ${text}.`)
  }
})

test('a path naming a short name is never linked', async ($, on) => {
  const drawn = engineDrawn(on)
  await start($, on, { files: { ...FILES, ...TEMP, 'C:/PROGRA~1/x.txt': '' } })
  expect(await drawnText($, drawn, String.raw`Voir C:\PROGRA~1\x.txt.`)).toBe(String.raw`Voir C:\PROGRA~1\x.txt.`)
})

test('a path written again and again is asked once, each writing linked', async ($, on) => {
  const drawn = engineDrawn(on)
  const asked = statsAsked(on, /app\.ts$/)
  await start($, on)
  expect(await drawnText($, drawn, 'Voir src/app.ts, src/app.ts:2, `src/app.ts` et src/app.ts.')).toBe(
    `Voir [src/app.ts](${APP}), [src/app.ts:2](${APP}#L2), [\`src/app.ts\`](${APP}) et [src/app.ts](${APP}).`,
  )
  expect(asked).toEqual([String.raw`C:\Users\dev\repo\app\src\app.ts`])
})

test('inside herdr, the settings show a « Chemins » section, its toggle, and what is missing', async ($, on) => {
  await start($, on, { listing: 'missing', hyperlinks: false })
  const pane = await showSettings($, 'functions')
  expect(await pane.find({ type: 'Text', text: 'Chemins' })).toBeDefined()
  expect(await pane.find({ key: 'settings:clickable-paths' })).toBeDefined()
  expect(
    await pane.find({ type: 'Text', text: 'plugin herdr imsike.links introuvable : herdr plugin install IMSike/Herdr-Plugins/links ; FORCE_HYPERLINK=1 manquant dans env de settings.json' }),
  ).toBeDefined()
  await pane.unmount()
})

test('the toggle turns the links off and on again', async ($, on) => {
  const drawn = engineDrawn(on)
  await start($, on)
  const pane = await showSettings($, 'functions')
  expect(await pane.find({ type: 'Text', text: "ctrl+clic sur un chemin des réponses pour l'ouvrir" })).toBeDefined()
  await click(pane, 'settings:clickable-paths')
  expect(await pane.find({ type: 'Text', text: 'désactivés' })).toBeDefined()
  expect(await drawnText($, drawn, 'Voir src/app.ts.')).toBe('Voir src/app.ts.')
  await click(pane, 'settings:clickable-paths')
  expect(await drawnText($, drawn, 'Voir docs/guide.md.')).toBe(`Voir [docs/guide.md](${DOCS}/guide.md).`)
  await pane.unmount()
})

test('outside herdr, the settings offer no « Chemins » section', async ($, on) => {
  await start($, on, { herdr: false })
  const pane = await showSettings($, 'functions')
  expect(await pane.find({ type: 'Text', text: 'Chemins' })).toBeUndefined()
  await pane.unmount()
})

test('after a /clear empties the state, the turn writes back what the paths need', async ($, on) => {
  // dx's paths read as absent from the `/clear` on, until written again.
  const cleared = { value: false }
  // The start's last write: herdr's plugin found.
  let written = () => {}
  const isWritten = new Promise<void>(resolve => (written = resolve))
  on('state.get', { plugin: 'dx', key: 'paths' }, (_, e, next) => (cleared.value ? { value: { value: undefined, version: 0 } } : next(e)))
  on('state.set', { plugin: 'dx', key: 'paths' }, (_, e, next) => {
    cleared.value = false
    const shown = JSON.stringify(e)
    if (shown.includes('"listed"')) written()
    return next(e)
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await start($, on)
  await isWritten
  cleared.value = true
  let pane = await showSettings($, 'functions')
  expect(await pane.find({ type: 'Text', text: 'Chemins' })).toBeUndefined()
  await pane.unmount()
  await $.turn.start({ text: 'go', turnId: 't1' })
  pane = await $.ui.mount(SETTINGS_PANE)
  expect(await pane.find({ type: 'Text', text: 'Chemins' })).toBeDefined()
  await pane.unmount()
})

test('herdr failing is asked again after pauses of 5 s, 30 s, 1 min and 2 min, each within 10 % either way; failing every time, the settings say herdr does not answer', { timeoutMs: 30_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const ran = await start($, on, { clock, listing: 'fails' })
  await clock.settle()
  expect(ran).toHaveLength(1)
  // Each attempt comes after the pauses before it, all at their shortest,
  // and before them all at their longest.
  let shortest = 0
  let longest = 0
  for (const pause of [5000, 30_000, 60_000, 120_000]) {
    const asked = ran.length
    shortest += pause * 0.9
    longest += pause * 1.1
    await clock.set(NOW + shortest - 1)
    expect(ran).toHaveLength(asked)
    await clock.set(NOW + longest + 1)
    expect(ran).toHaveLength(asked + 1)
  }
  expect(ran.map(item => item.argv[0])).toEqual(['herdr', 'herdr', 'herdr', 'herdr', 'herdr'])
  const pane = await showSettings($, 'functions')
  expect(await pane.find({ type: 'Text', text: 'herdr ne répond pas : plugin imsike.links non vérifié (à la prochaine session)' })).toBeDefined()
  await pane.unmount()
})

test('herdr failing once, then listing the plugin, the paths are linked', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const drawn = engineDrawn(on)
  let calls = 0
  const ran = await start($, on, {
    clock,
    listing: async () => {
      calls += 1
      return calls === 1 ? { ...OK, exitCode: 1 } : { ...OK, stdout: LISTED }
    },
  })
  await clock.advance(5500)
  expect(ran).toHaveLength(2)
  expect(await drawnText($, drawn, 'Voir src/app.ts.')).toBe(`Voir [src/app.ts](${APP}).`)
})

test("a later session start ends the look herdr's failures left waiting", async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const ran = await start($, on, { clock, listing: 'fails' })
  await clock.settle()
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(ran).toHaveLength(2)
  // Both looks wake from their first pause: the first one's ended.
  await clock.advance(5500)
  expect(ran).toHaveLength(3)
})

test("a symbolic link landing on one of Claude Code's settings files is not linked; one landing elsewhere is", async ($, on) => {
  const drawn = engineDrawn(on)
  const lands = { 'lien.json': String.raw`C:\Users\dev\repo\app\.claude\settings.json`, 'autre.json': String.raw`C:\Users\dev\repo\app\docs\guide.md` }
  on('fs.stat', { path: /(?:lien|autre)\.json$/ }, (_, e) => {
    const name = e.path.endsWith('lien.json') ? 'lien.json' : 'autre.json'
    return { value: { kind: 'file', size: 2, mtimeMs: 0, isLink: true, ...(e.resolve ? { realPath: lands[name] } : {}) } as const }
  })
  await start($, on)
  expect(await drawnText($, drawn, 'Voir lien.json et autre.json.')).toBe('Voir lien.json et [autre.json](dx-open:///C:/Users/dev/repo/app/autre.json).')
})

test("herdr is run by the absolute path herdr gives its panes, from the system's folder", async ($, on) => {
  const ran = await start($, on, { env: { HERDR_BIN_PATH: String.raw`C:\Users\dev\.herdr\bin\herdr.exe` } })
  expect(ran.map(item => [item.argv[0], item.init?.cwd])).toEqual([[String.raw`C:\Users\dev\.herdr\bin\herdr.exe`, SYSTEM_ROOT]])
})

test('a path whose landing is not said is not linked, a link or not: a folder above it may be one', async ($, on) => {
  const drawn = engineDrawn(on)
  on('fs.stat', { path: /guide\.md$/ }, () => ({ value: { kind: 'file', size: 2, mtimeMs: 0, isLink: true } as const }))
  on('fs.stat', { path: /app\.ts$/ }, () => ({ value: { kind: 'file', size: 2, mtimeMs: 0, isLink: false } as const }))
  await start($, on)
  expect(await drawnText($, drawn, 'Voir docs/guide.md et src/app.ts.')).toBe('Voir docs/guide.md et src/app.ts.')
})

test('a check on disk that does not answer is never asked again before it answers: checks hung on a dead drive do not pile up', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const drawn = engineDrawn(on)
  let asked = 0
  on('fs.stat', { path: /guide\.md$/ }, async () => {
    asked += 1
    await clock.sleep(20_000)
    return { deny: 'ENOENT' }
  })
  await start($, on, { clock })
  const text = 'Voir docs/guide.md.'
  const draw = async () => {
    const mounting = $.ui.mount(reply(text))
    await clock.advance(300)
    await (await mounting).unmount()
  }
  await draw()
  // Each later drawing goes on at once without it, the path not linked.
  for (const wait of [5000, 5000, 5000]) {
    await clock.advance(wait)
    expect(await drawnText($, drawn, text)).toBe(text)
    expect(asked).toBe(1)
  }
  // Its answer at last (no such file), kept 10 s, then asked anew.
  await clock.advance(5000)
  await draw()
  expect(asked).toBe(1)
  await clock.advance(10_000)
  await draw()
  expect(asked).toBe(2)
})

test("without the system's folder, herdr is not run and the settings say its plugin is not checked", async ($, on) => {
  const ran = await start($, on, { windows: false, env: { OS: 'Windows_NT' } })
  expect(ran).toEqual([])
  const pane = await showSettings($, 'functions')
  expect(await pane.find({ type: 'Text', text: 'dossier du système inconnu (SystemRoot, windir) : plugin imsike.links non vérifié' })).toBeDefined()
  await pane.unmount()
})

for (const configDir of ['cfg', String.raw`~\repo\app\cfg`, 'C:/Users/dev/repo/app/./cfg']) {
  test(`CLAUDE_CONFIG_DIR written ${configDir} is placed as Claude Code places it: its settings files are not linked`, async ($, on) => {
    const drawn = engineDrawn(on)
    await start($, on, { env: { CLAUDE_CONFIG_DIR: configDir } })
    expect(await drawnText($, drawn, 'Voir cfg/settings.json.')).toBe('Voir cfg/settings.json.')
  })
}

test('without CLAUDE_CONFIG_DIR, a settings.json elsewhere is linked', async ($, on) => {
  const drawn = engineDrawn(on)
  await start($, on)
  expect(await drawnText($, drawn, 'Voir cfg/settings.json.')).toBe('Voir [cfg/settings.json](dx-open:///C:/Users/dev/repo/app/cfg/settings.json).')
})

for (const [why, env, folder] of [
  ['through a junction', {}, /\\Users\\dev\\\.claude$/],
  ['by a short 8.3 name in CLAUDE_CONFIG_DIR', { CLAUDE_CONFIG_DIR: String.raw`C:\Users\dev\repo\app\CFG~1` }, /\\CFG~1$/],
] as const) {
  test(`Claude Code's configuration folder reached ${why}: the settings files where it lands are not linked`, async ($, on) => {
    const drawn = engineDrawn(on)
    on('fs.stat', { path: folder }, (_, e) => ({
      value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: true, ...(e.resolve ? { realPath: String.raw`\\?\C:\Users\dev\repo\app\CFG` } : {}) } as const,
    }))
    await start($, on, { env })
    expect(await drawnText($, drawn, 'Voir cfg/settings.json et docs/guide.md.')).toBe(`Voir cfg/settings.json et [docs/guide.md](${DOCS}/guide.md).`)
  })
}

test("the configuration folder's landing not known, its settings files are told as before", async ($, on) => {
  const drawn = engineDrawn(on)
  on('fs.stat', { path: /\\Users\\dev\\\.claude$/ }, () => ({ deny: 'ENOENT' }))
  await start($, on)
  expect(await drawnText($, drawn, 'Voir cfg/settings.json et .claude/settings.json.')).toBe(
    'Voir [cfg/settings.json](dx-open:///C:/Users/dev/repo/app/cfg/settings.json) et .claude/settings.json.',
  )
})

test('a reply past 1000 lines or 100,000 signs links no path', async ($, on) => {
  const drawn = engineDrawn(on)
  await start($, on)
  const lines = (count: number) => `Voir src/app.ts.\n${'x\n'.repeat(count - 2)}y`
  expect(await drawnText($, drawn, lines(1000))).toBe(`Voir [src/app.ts](${APP}).\n${'x\n'.repeat(998)}y`)
  expect(await drawnText($, drawn, lines(1001))).toBe(lines(1001))
  const signs = (count: number) => `Voir src/app.ts.\n${'x'.repeat(count - 17)}`
  expect(await drawnText($, drawn, signs(99_000))).toBe(`Voir [src/app.ts](${APP}).\n${'x'.repeat(99_000 - 17)}`)
  // Its links made, the text past 100,000 signs: left as it is too.
  expect(await drawnText($, drawn, signs(99_990))).toBe(signs(99_990))
  expect(await drawnText($, drawn, signs(100_001))).toBe(signs(100_001))
  // A line ends at \r\n, or at \r alone.
  const ended = (count: number, end: string) => `Voir src/app.ts.${end}${`x${end}`.repeat(count - 2)}y`
  expect(await drawnText($, drawn, ended(1000, '\r\n'))).toBe(`Voir [src/app.ts](${APP}).\r\n${'x\r\n'.repeat(998)}y`)
  expect(await drawnText($, drawn, ended(1001, '\r'))).toBe(ended(1001, '\r'))
})

test('FORCE_HYPERLINK set to turn hyperlinks off is said apart from it missing', async ($, on) => {
  await start($, on, { hyperlinks: false, env: { FORCE_HYPERLINK: '0' } })
  const pane = await showSettings($, 'functions')
  expect(await pane.find({ type: 'Text', text: 'FORCE_HYPERLINK désactive les hyperliens : le mettre à 1 dans env de settings.json' })).toBeDefined()
  await pane.unmount()
})

test('a turn writes what the paths need only when the state does not hold it already', async ($, on) => {
  let writes = 0
  on('state.set', { plugin: 'dx', key: 'paths' }, (_, e, next) => {
    writes += 1
    return next(e)
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await start($, on)
  const before = writes
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.turn.start({ text: 'go', turnId: 't2' })
  expect(writes).toBe(before)
})
