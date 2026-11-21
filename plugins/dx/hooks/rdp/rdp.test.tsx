import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On, ProcessRunResult } from 'claude-code'

import { click, engine, NOTES_PANE, NOW, showSettings } from '../shared/testing'
import { expectedInput, RDP_COMMAND } from './rewrite'

const SYSTEM_ROOT = String.raw`C:\Windows`
const POWERSHELL = String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`

const answer = (stdout: string, exitCode = 0): ProcessRunResult => ({ exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })

type Ran = { argv: string[]; cwd?: string; stdin?: string }
type Setup = {
  windows?: boolean
  on?: boolean
  copyOnSelect?: boolean
  script?: () => string
  stored?: Record<string, unknown>
  copy?: string
  refused?: ReadonlySet<string>
}

// The engine on Windows (unless told otherwise), the setting on (unless told
// otherwise), Claude Code copying on selection (unless told otherwise); the
// person's selection as `selection.text` holds it; the programs run, by their
// argv, working directory and standard input, PowerShell answering `script`;
// `/copy` answering `copy`, or no text (as the engine's does); the selection's reads
// counted. The store's settings read refused while `refused` holds
// `store.get settings`.
async function start(
  $: Engine,
  on: On,
  {
    windows = true,
    on: isOn = true,
    copyOnSelect = true,
    script = () => 'rewritten 3',
    stored = {},
    copy = 'Copied to clipboard',
    refused = new Set<string>(),
  }: Setup = {},
) {
  const clock = mock.clock(on, { now: NOW })
  // Registered before the engine, whose `store.get` answers every read.
  on('store.get', { key: 'settings' }, (_, e, next) => (refused.has('store.get settings') ? { deny: 'store locked' } : next(e)))
  const ran: Ran[] = []
  const selection: { text?: string } = {}
  const registered: string[] = []
  const logged: string[] = []
  const reads = { count: 0 }
  engine(on, {
    stored: { settings: { rdpClipboard: isOn }, ...stored },
    env: windows ? { OS: 'Windows_NT', SystemRoot: SYSTEM_ROOT } : {},
    run: (argv, init) => {
      ran.push({ argv: [...argv], ...(init?.cwd === undefined ? {} : { cwd: init.cwd }), ...(init?.stdin === undefined ? {} : { stdin: init.stdin }) })
      return argv[0] === POWERSHELL ? answer(script()) : undefined
    },
  })
  on('ui.log', (_, e) => {
    logged.push(e.text)
    return { value: undefined }
  })
  on('ui.selection', () => {
    reads.count++
    return { value: selection.text === undefined ? undefined : { text: selection.text } }
  })
  on('config.list', () => ({ value: [{ key: 'copyOnSelect', label: 'Copy on select', kind: 'boolean', value: copyOnSelect, provider: { kind: 'engine' }, isLocked: false }] as never }))
  on('command.register', (_, e) => {
    registered.push(e.name)
    return { value: {} as never }
  })
  // The engine's own commands and copies, beneath dx.
  on('command.run', { command: 'copy' }, () => (copy === '' ? {} : { text: copy }))
  on('ui.copy', () => ({ value: { isCopied: true } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // The first read of the selection: what stands then is not a copy.
  await clock.advance(500)
  return { clock, ran, selection, registered, logged, reads }
}

// A command typed at the prompt, in the fullscreen terminal.
function typed($: Engine, command: string) {
  return $.command.run({ command, args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
}

// A selection made, and the next read of it.
async function select(clock: MockClock, selection: { text?: string }, text: string) {
  selection.text = text
  await clock.advance(500)
}

test('a selection is followed, a second later, by one rewrite of the clipboard, if it holds that text', async ($, on) => {
  const { clock, ran, selection } = await start($, on)
  await select(clock, selection, 'abc  \r\n')
  await clock.advance(999)
  expect(ran).toEqual([])
  await clock.advance(1)
  expect(ran).toEqual([{ argv: expect.arrayContaining([POWERSHELL, '-EncodedCommand']), cwd: SYSTEM_ROOT, stdin: expectedInput('abc') }])
  // The same selection read again: no copy, nothing more.
  await clock.advance(5000)
  expect(ran).toHaveLength(1)
})

test('a selection still being made puts the rewrite off; the last one alone is rewritten', async ($, on) => {
  const { clock, ran, selection } = await start($, on)
  await select(clock, selection, 'a')
  await select(clock, selection, 'ab')
  await select(clock, selection, 'abc')
  await clock.advance(1000)
  expect(ran.map(item => item.stdin)).toEqual([expectedInput('abc')])
})

test('a clipboard that does not hold the selection yet is tried once more, then left', async ($, on) => {
  const { clock, ran, selection } = await start($, on, { script: () => 'skip changed|CF_UNICODETEXT' })
  await select(clock, selection, 'abc')
  await clock.advance(1000)
  expect(ran).toHaveLength(1)
  await clock.advance(2000)
  expect(ran).toHaveLength(2)
  await clock.advance(10_000)
  expect(ran).toHaveLength(2)
})

test('the setting off, nothing is rewritten: neither after a selection, /copy nor a copy', async ($, on) => {
  const { clock, ran, selection } = await start($, on, { on: false })
  await select(clock, selection, 'abc')
  await typed($, 'copy')
  await clock.advance(10_000)
  expect(ran).toEqual([])
})

test('Claude Code not copying on selection, a selection rewrites nothing', async ($, on) => {
  const { clock, ran, selection } = await start($, on, { copyOnSelect: false })
  await select(clock, selection, 'abc')
  await clock.advance(10_000)
  expect(ran).toEqual([])
})

test('the setting off, the selection is not read; turned on, it is; turned off, no longer', async ($, on) => {
  const { clock, reads } = await start($, on, { on: false })
  await clock.advance(5000)
  expect(reads.count).toBe(0)
  const pane = await showSettings($, 'functions')
  await click(pane, 'settings:rdp-clipboard')
  await clock.advance(1000)
  expect(reads.count).toBe(2)
  await click(pane, 'settings:rdp-clipboard')
  await clock.advance(5000)
  expect(reads.count).toBe(2)
})

test('the setting on as the session starts, the selection is read from the start', async ($, on) => {
  const { reads } = await start($, on)
  expect(reads.count).toBe(1)
})

// The settings unread as the session starts, the setting reads as off; read
// as a later turn starts, it is on, and the selection is read from then on.
test('the settings unread as the session starts, the selection is read once a turn reads them', async ($, on) => {
  const refused = new Set(['store.get settings'])
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  const { clock, reads } = await start($, on, { refused })
  await clock.advance(5000)
  expect(reads.count).toBe(0)
  refused.clear()
  await $.turn.start({ text: 'go', turnId: 't1' })
  await clock.advance(1000)
  expect(reads.count).toBe(2)
})

// The engine's /copy answers with no text, its copy made (a maintainer's
// debug log, 2026-11-21): the rewrite follows all the same.
test('/copy answering with no text, as the engine does, is followed by a rewrite', async ($, on) => {
  const { clock, ran, logged } = await start($, on, { copy: '' })
  await typed($, 'copy')
  await clock.advance(1000)
  expect(ran.map(item => item.stdin)).toEqual([''])
  expect(logged).toContain('dx : commande /copy, presse-papiers réécrit (3 caractères)')
})

test('a skip is logged with every format the clipboard held', async ($, on) => {
  const { clock, logged } = await start($, on, { script: () => 'skip formats HTML Format|CF_UNICODETEXT,HTML Format' })
  await typed($, 'copy')
  await clock.advance(1000)
  expect(logged).toContain(
    'dx : commande /copy, presse-papiers laissé tel quel : il ne contient pas que du texte (HTML Format) [formats : CF_UNICODETEXT,HTML Format]',
  )
})

test('/copy is followed by a rewrite of whatever text the clipboard holds, its answer passed on', async ($, on) => {
  const { clock, ran } = await start($, on)
  const result = await typed($, 'copy')
  expect(result.text).toBe('Copied to clipboard')
  await clock.advance(1000)
  expect(ran.map(item => item.stdin)).toEqual([''])
})

// A plugin's $.ui.copy, as dx's notes copy a selection as soon as it is made.
test("a plugin's copy is followed by a rewrite, if the clipboard holds its text", async ($, on) => {
  const { clock, ran, logged } = await start($, on, { stored: { 'notes.global': { text: 'pain lait', updatedAt: NOW } } })
  const pane = await $.ui.mount(NOTES_PANE)
  const at = { in: 'note-global-s1' }
  await pane.pointer({ type: 'down', x: 0, y: 0, button: 'left', ...at })
  await pane.pointer({ type: 'move', x: 4, y: 0, button: 'left', ...at })
  await pane.pointer({ type: 'up', x: 4, y: 0, button: 'left', ...at })
  await clock.advance(1000)
  expect(ran.map(item => item.stdin)).toEqual([expectedInput('pain')])
  expect(logged).toContain('dx : copie par un plugin, presse-papiers réécrit (3 caractères)')
  await pane.unmount()
})

test('/dx-tse rewrites at once and says what it did, for the person alone', async ($, on) => {
  const { ran, registered } = await start($, on, { on: false })
  expect(registered).toEqual([RDP_COMMAND])
  const result = await typed($, RDP_COMMAND)
  expect(result).toEqual({ text: 'dx : presse-papiers réécrit (3 caractères)', isTextDisplayOnly: true })
  expect(ran.map(item => item.stdin)).toEqual([''])
})

test('a failed rewrite is said by /dx-tse, never thrown', async ($, on) => {
  const { clock, ran, selection } = await start($, on, { script: () => 'garbled' })
  const result = await typed($, RDP_COMMAND)
  expect(result.text).toContain('presse-papiers non réécrit')
  await select(clock, selection, 'abc')
  await clock.advance(1000)
  expect(ran).toHaveLength(2)
})

test('off Windows, nothing: no command, no rewrite, no setting', async ($, on) => {
  const { clock, ran, selection, registered } = await start($, on, { windows: false })
  expect(registered).toEqual([])
  await select(clock, selection, 'abc')
  await typed($, 'copy')
  await clock.advance(10_000)
  expect(ran).toEqual([])
  const pane = await showSettings($, 'functions')
  expect(await pane.find({ key: 'settings:rdp-clipboard' })).toBeUndefined()
})

test('on Windows the setting is offered, off by default, and turns the rewrites on', async ($, on) => {
  const { clock, ran, selection } = await start($, on, { on: false })
  const pane = await showSettings($, 'functions')
  expect(await pane.find({ key: 'settings:rdp-clipboard' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /\/dx-tse le fait à la demande/ })).toBeDefined()
  await click(pane, 'settings:rdp-clipboard')
  // The selection standing as the setting is turned on is not a copy.
  await clock.advance(500)
  await select(clock, selection, 'abc')
  await clock.advance(1000)
  expect(ran.map(item => item.stdin)).toEqual([expectedInput('abc')])
})
