import { expect, mock, test } from 'claude-code/testing'
import type { On, ProcessRunResult, StateRead } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { DEFAULT_SETTINGS } from '../shared/options'
import { encodeCommand } from '../shared/system'
import { BAND, click, engine, frameColors, NOTES_PANE, NOW, SETTINGS_PANE, shell, showSettings } from '../shared/testing'
import { WINDOWS_OPEN_FOLDER } from './open-folder'

test('a setting changed in its pane is kept and redraws the band', async ($, on) => {
  mock.clock(on, { now: NOW })
  const store = engine(on)
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await showSettings($)
  await click(pane, 'settings:show-total')
  await click(pane, 'settings:frame-color-58a6ff')
  await pane.unmount()

  const stored = store.get('settings') as { show: { total: boolean }; frameColor: string }
  expect(stored.show.total).toBe(false)
  expect(stored.frameColor).toBe('#58a6ff')
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /total/, in: 'frame-br' })).toBeUndefined()
  expect(await frameColors(ui)).toContain('#58a6ff')
  await ui.unmount()
})

// A change the store refuses is never silent: the pane says so until one saves.
test('a setting the store refuses says so in the pane, until a change saves', async ($, on) => {
  mock.clock(on, { now: NOW })
  const refused = new Set<string>()
  const store = engine(on, { refused })
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await showSettings($)
  refused.add('store.set settings')
  await click(pane, 'settings:show-total')
  expect(store.get('settings')).toBeUndefined()
  expect((await pane.find({ type: 'Text', text: /^⚠ réglages non enregistrés : .*disk full$/ }))?.props.color).toBe('error')

  refused.clear()
  await click(pane, 'settings:frame-color-58a6ff')
  expect(store.get('settings')).toMatchObject({ frameColor: '#58a6ff' })
  expect(await pane.find({ type: 'Text', text: /non enregistrés/ })).toBeUndefined()
  await pane.unmount()
})

// An unsaved change is never dropped: neither the next change nor the `⚙`
// icon's reload starts from a store that lacks it.
test('an unsaved setting is kept until a later change saves it', async ($, on) => {
  mock.clock(on, { now: NOW })
  const refused = new Set<string>()
  const store = engine(on, { refused })
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await showSettings($)
  refused.add('store.set settings')
  await click(pane, 'settings:show-total')
  await click(pane, 'settings:frame-color-58a6ff')
  await pane.unmount()
  expect(store.get('settings')).toBeUndefined()

  // The `⚙` icon closes the panel then shows it again, reloading the settings.
  const band = await $.ui.mount(BAND)
  await click(band, 'settings')
  await click(band, 'settings')
  expect(await band.find({ type: 'Text', text: /total/, in: 'frame-br' })).toBeUndefined()
  expect(await frameColors(band)).toContain('#58a6ff')
  await band.unmount()

  refused.clear()
  const again = await $.ui.mount(SETTINGS_PANE)
  expect(await again.find({ type: 'Text', text: /non enregistrés/ })).toBeDefined()
  await click(again, 'settings:show-branch')
  await again.unmount()
  expect(store.get('settings')).toMatchObject({ show: { total: false, branch: false }, frameColor: '#58a6ff' })
})

// The `⚙` icon, a change unsaved, saves it again rather than reading the
// store: once the store takes it, the warning goes.
test('the settings icon saves an unsaved setting again', async ($, on) => {
  mock.clock(on, { now: NOW })
  const refused = new Set<string>()
  const store = engine(on, { refused })
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await showSettings($)
  refused.add('store.set settings')
  await click(pane, 'settings:show-total')
  await pane.unmount()

  refused.clear()
  const band = await $.ui.mount(BAND)
  await click(band, 'settings')
  await click(band, 'settings')
  await band.unmount()
  expect(store.get('settings')).toMatchObject({ show: { total: false } })
  const again = await $.ui.mount(SETTINGS_PANE)
  expect(await again.find({ type: 'Text', text: /non enregistrés/ })).toBeUndefined()
  await again.unmount()
})

// A fresh load of dx (`session.start` again, its state kept) keeps an unsaved
// change rather than reading over it the store, which lacks it.
test('an unsaved setting outlasts a reload of the plugin', async ($, on) => {
  mock.clock(on, { now: NOW })
  const refused = new Set<string>()
  const store = engine(on, { refused })
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await showSettings($)
  refused.add('store.set settings')
  await click(pane, 'settings:show-total')
  await pane.unmount()
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /total/, in: 'frame-br' })).toBeUndefined()
  refused.clear()
  await click(band, 'settings')
  await band.unmount()
  expect(store.get('settings')).toMatchObject({ show: { total: false } })
})

// A turn's start never waits on a save under way, however slow.
test("a turn starts while a setting's save is under way", async ($, on) => {
  mock.clock(on, { now: NOW })
  let saving = () => {}
  const isSaving = new Promise<void>(resolve => {
    saving = resolve
  })
  let release = () => {}
  const released = new Promise<void>(resolve => {
    release = resolve
  })
  on('store.set', { key: 'settings' }, async (_, e, next) => {
    saving()
    await released
    return next(e)
  })
  const store = engine(on)
  shell(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await showSettings($)
  const clicked = click(pane, 'settings:show-total')
  await isSaving
  await $.turn.start({ text: 'go', turnId: 't1' })
  expect(store.get('settings')).toBeUndefined()
  release()
  await clicked
  await pane.unmount()
  expect(store.get('settings')).toMatchObject({ show: { total: false } })
})

// A typed color that is none is never silent: said in red under its field,
// until its text changes or it applies a color.
test('a hex color that is none says so under its field', async ($, on) => {
  mock.clock(on, { now: NOW })
  const store = engine(on)
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await showSettings($)
  const warning = /^⚠ couleur non appliquée : il faut une couleur hex à six chiffres, comme #d4a72c$/
  await pane.input({ key: 'frame-color-hex', text: 'bleu' })
  expect((await pane.find({ type: 'Text', text: warning }))?.props.color).toBe('error')
  expect(store.get('settings')).toBeUndefined()
  await pane.input({ key: 'frame-color-hex', text: 'ble', kind: 'change' })
  expect(await pane.find({ type: 'Text', text: warning })).toBeUndefined()

  await pane.input({ key: 'frame-color-hex', text: 'bleu' })
  await pane.input({ key: 'frame-color-hex', text: '#58a6ff' })
  expect(await pane.find({ type: 'Text', text: warning })).toBeUndefined()
  expect(store.get('settings')).toMatchObject({ frameColor: '#58a6ff' })
  await pane.unmount()
})

// Nor does it outlive its field: it goes once a color is picked for it, or
// once the pane is shown again, by the `⚙` icon or by its tab.
test('a hex color warning goes with a color picked or the pane shown again', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on)
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const warning = /^⚠ couleur non appliquée/

  const pane = await showSettings($)
  await pane.input({ key: 'frame-color-hex', text: 'bleu' })
  await click(pane, 'settings:frame-color-58a6ff')
  expect(await pane.find({ type: 'Text', text: warning })).toBeUndefined()

  await pane.input({ key: 'frame-color-hex', text: 'bleu' })
  await pane.unmount()
  const band = await $.ui.mount(BAND)
  await click(band, 'settings')
  await click(band, 'settings')
  await band.unmount()
  const again = await $.ui.mount(SETTINGS_PANE)
  expect(await again.find({ type: 'Text', text: warning })).toBeUndefined()

  await again.input({ key: 'frame-color-hex', text: 'bleu' })
  await again.unmount()
  const notesBand = await $.ui.mount(BAND)
  await click(notesBand, 'notes')
  await notesBand.unmount()
  const notes = await $.ui.mount(NOTES_PANE)
  await click(notes, 'pane-settings')
  await notes.unmount()
  const shown = await $.ui.mount(SETTINGS_PANE)
  expect(await shown.find({ type: 'Text', text: warning })).toBeUndefined()
  await shown.unmount()
})

// The reset applies a color to every element: no hex field's warning stays.
test('a hex color warning goes with the reset', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on)
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await showSettings($)
  await pane.input({ key: 'gauge-color-hex', text: 'bleu' })
  await click(pane, 'settings:reset')
  expect(await pane.find({ type: 'Text', text: /^⚠ couleur non appliquée/ })).toBeUndefined()
  await pane.unmount()
})

// Its text changed while a submit with no color is said: the warning goes
// all the same, never kept by a read made before it was written.
test('a hex color warning goes with a change of text made meanwhile', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on)
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await showSettings($)
  const submitted = pane.input({ key: 'frame-color-hex', text: 'bleu' })
  const changed = pane.input({ key: 'frame-color-hex', text: 'ble', kind: 'change' })
  await submitted
  await changed
  expect(await pane.find({ type: 'Text', text: /^⚠ couleur non appliquée/ })).toBeUndefined()
  await pane.unmount()
})

// A keystroke in a hex field writes the warning's state, which redraws the
// pane, only when the warning goes.
test('typing in a hex field writes the warning only when it changes', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on)
  shell(on)
  let writes = 0
  on('state.set', { plugin: 'dx', key: 'settingsBadHex' }, (_, e, next) => {
    writes += 1
    return next(e)
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await showSettings($)
  const shown = writes
  for (const text of ['#', '#5', '#58']) await pane.input({ key: 'frame-color-hex', text, kind: 'change' })
  expect(writes).toBe(shown)
  await pane.input({ key: 'frame-color-hex', text: 'bleu' })
  await pane.input({ key: 'effort-color-hex', text: 'b', kind: 'change' })
  expect(writes).toBe(shown + 1)
  await pane.input({ key: 'frame-color-hex', text: 'ble', kind: 'change' })
  await pane.input({ key: 'frame-color-hex', text: 'bl', kind: 'change' })
  expect(writes).toBe(shown + 2)
  expect(await pane.find({ type: 'Text', text: /^⚠ couleur non appliquée/ })).toBeUndefined()
  await pane.unmount()
})

// The warning's write refused: the typed text is left as it stands, nothing
// rejected unhandled. No `expect`: a rejection nothing handled fails the file.
test('a hex warning the state refuses leaves the field as it stands', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on)
  shell(on)
  let isRefused = false
  on('state.set', { plugin: 'dx', key: 'settingsBadHex' }, (_, e, next) => (isRefused ? { deny: 'state refused' } : next(e)))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await showSettings($)
  isRefused = true
  await pane.input({ key: 'frame-color-hex', text: 'bleu' })
  await pane.input({ key: 'frame-color-hex', text: 'ble', kind: 'change' })
  await pane.unmount()
})

test('a stepper sets its number from clicks drawn on its own thread', async ($, on) => {
  mock.clock(on, { now: NOW })
  const store = engine(on)
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await showSettings($)
  // Its last cells are the step up: 50 % then 55 %, red still above.
  await pane.pointer({ type: 'down', x: 11, y: 0, button: 'left', in: 'heat-orange-stepper' })
  expect(store.get('settings')).toMatchObject({ heatOrange: 55, heatRed: 75 })
  // Orange up to red: red pushed a step above.
  await pane.post({ setting: 'heat-orange', value: 75 }, { in: 'heat-orange-stepper' })
  expect(store.get('settings')).toMatchObject({ heatOrange: 75, heatRed: 80 })
  // Subagents and terminals are counted apart.
  await pane.post({ setting: 'max-task-icons', value: 2 }, { in: 'max-task-icons-stepper' })
  expect(store.get('settings')).toMatchObject({ maxAgentIcons: 5, maxTaskIcons: 2 })
  await pane.unmount()
})

test('a note or a setting written by another session is taken up, not overwritten', async ($, on) => {
  mock.clock(on, { now: NOW })
  const store = engine(on)
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  // Written elsewhere since this session started.
  store.set('notes.global', { text: 'écrit ailleurs', updatedAt: NOW - 1000 })
  store.set('settings', { show: { branch: false } })
  const notes = await $.ui.mount(NOTES_PANE)
  expect(await notes.find({ type: 'Text', text: /écrit ailleurs/, in: 'note-global-s1' })).toBeDefined()
  await notes.unmount()

  const pane = await showSettings($)
  await click(pane, 'settings:show-total')
  await pane.unmount()
  expect(store.get('settings')).toMatchObject({ show: { branch: false, total: false } })
})

test('the crew animation setting turns the working one on with it', async ($, on) => {
  mock.clock(on, { now: NOW })
  const store = engine(on, { stored: { settings: { animateWithCrew: false } } })
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await showSettings($)
  await click(pane, 'settings:animate-with-crew')
  expect(store.get('settings')).toMatchObject({ animateOnlyWorking: true, animateWithCrew: true })
  await click(pane, 'settings:animate-with-crew')
  expect(store.get('settings')).toMatchObject({ animateOnlyWorking: true, animateWithCrew: false })
  await pane.unmount()
})

// The store's settings read refused, as by a store not there yet, while
// `refused` holds `store.get settings`. Registered before the engine, whose
// `store.get` answers every read.
function refuseSettingsRead(on: On, refused: ReadonlySet<string>): void {
  on('store.get', { key: 'settings' }, (_, e, next) => (refused.has('store.get settings') ? { deny: 'store locked' } : next(e)))
}

// A read that fails never takes the settings for the defaults: the next
// change would write those over the stored ones.
test('a settings read the store refuses keeps the settings', async ($, on) => {
  mock.clock(on, { now: NOW })
  const refused = new Set<string>()
  refuseSettingsRead(on, refused)
  const store = engine(on, { stored: { settings: { frameColor: '#58a6ff' } } })
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  refused.add('store.get settings')
  const pane = await showSettings($)
  await click(pane, 'settings:show-total')
  await pane.unmount()
  expect(store.get('settings')).toMatchObject({ frameColor: '#58a6ff', show: { total: false } })
  const band = await $.ui.mount(BAND)
  expect(await frameColors(band)).toContain('#58a6ff')
  await band.unmount()
})

// Never read since the session started, the settings it holds are the
// defaults: a change is not applied over the store's, and the pane says why
// until a change reads them.
test('a change with the settings never read is not saved over the stored ones', async ($, on) => {
  mock.clock(on, { now: NOW })
  const refused = new Set(['store.get settings'])
  refuseSettingsRead(on, refused)
  const store = engine(on, { stored: { settings: { frameColor: '#58a6ff' } } })
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await showSettings($)
  await click(pane, 'settings:show-total')
  expect(store.get('settings')).toEqual({ frameColor: '#58a6ff' })
  const warning = await pane.find({ type: 'Text', text: /^⚠ réglages illisibles : .*store locked \(changement non appliqué\)$/ })
  expect(warning?.props.color).toBe('error')

  refused.clear()
  await click(pane, 'settings:show-total')
  expect(await pane.find({ type: 'Text', text: /illisibles/ })).toBeUndefined()
  await pane.unmount()
  expect(store.get('settings')).toMatchObject({ frameColor: '#58a6ff', show: { total: false } })
})

// The hex warning's clearing refused as well at the start: the debug log still
// says why the settings were not read.
test("a start's unread settings are logged over a refused hex warning's end", async ($, on) => {
  mock.clock(on, { now: NOW })
  // The read refused once the clearing was: its failure comes second.
  let clearingRefused = () => {}
  const isClearingRefused = new Promise<void>(resolve => {
    clearingRefused = resolve
  })
  on('store.get', { key: 'settings' }, async () => {
    await isClearingRefused
    return { deny: 'store locked' }
  })
  engine(on, { stored: { settings: { frameColor: '#58a6ff' } } })
  on('state.set', { plugin: 'dx', key: 'settingsBadHex' }, () => {
    clearingRefused()
    return { deny: 'state refused' }
  })
  const debug: string[] = []
  on('ui.log', (_, e) => {
    if (e.to === 'debug') debug.push(e.text)

    return { value: undefined }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(debug.some(text => /^dx : démarrage échoué, réglages \(.*store locked\)$/.test(text))).toBe(true)
})

// The settings unreadable as the session starts are never silent: the pane says
// the defaults are shown, the debug log why, and each main turn reads them
// again until the store answers.
test('settings unreadable at the start say so, and are read again at each turn', async ($, on) => {
  mock.clock(on, { now: NOW })
  const refused = new Set(['store.get settings'])
  refuseSettingsRead(on, refused)
  engine(on, { stored: { settings: { frameColor: '#58a6ff' } } })
  shell(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  const logged: { text: string; to?: string }[] = []
  on('ui.log', (_, e) => {
    logged.push(e)

    return { value: undefined }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(logged.some(line => line.to === 'debug' && /^dx : démarrage échoué, réglages \(.*store locked\)$/.test(line.text))).toBe(true)
  // Shown from the notes' tab, which does not read the settings as `⚙` does.
  const band = await $.ui.mount(BAND)
  await click(band, 'notes')
  await band.unmount()
  const notes = await $.ui.mount(NOTES_PANE)
  await click(notes, 'pane-settings')
  await notes.unmount()
  const pane = await $.ui.mount(SETTINGS_PANE)
  const warning = /^⚠ réglages illisibles : .*store locked \(réglages par défaut affichés\)$/
  expect((await pane.find({ type: 'Text', text: warning }))?.props.color).toBe('error')
  await $.turn.start({ text: 'go', turnId: 't1' })
  expect(await pane.find({ type: 'Text', text: warning })).toBeDefined()

  refused.clear()
  await $.turn.start({ text: 'again', turnId: 't2' })
  expect(await pane.find({ type: 'Text', text: /illisibles/ })).toBeUndefined()
  await pane.unmount()
  const after = await $.ui.mount(BAND)
  expect(await frameColors(after)).toContain('#58a6ff')
  await after.unmount()
})

// dx's state unreadable as its settings are taken up: it holds nothing, and
// the store is read as at a first start.
test('a state that cannot be read leaves the settings read from the store', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on, { stored: { settings: { frameColor: '#58a6ff' } } })
  let isFirst = true
  on('state.get', { plugin: 'dx', key: 'settings' }, (_, e, next) => {
    if (!isFirst) return next(e)
    isFirst = false
    return { deny: 'state unreadable' }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const band = await $.ui.mount(BAND)
  expect(await frameColors(band)).toContain('#58a6ff')
  await band.unmount()
})

// The `⚙` icon reads the settings again: once the store answers, the warning
// goes, with the stored settings shown.
test('the settings icon clears the unreadable warning once the store is read', async ($, on) => {
  mock.clock(on, { now: NOW })
  const refused = new Set(['store.get settings'])
  refuseSettingsRead(on, refused)
  engine(on, { stored: { settings: { frameColor: '#58a6ff' } } })
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await showSettings($)
  await click(pane, 'settings:show-total')
  expect(await pane.find({ type: 'Text', text: /illisibles/ })).toBeDefined()
  await pane.unmount()

  refused.clear()
  const band = await $.ui.mount(BAND)
  await click(band, 'settings')
  await click(band, 'settings')
  expect(await frameColors(band)).toContain('#58a6ff')
  await band.unmount()
  const again = await $.ui.mount(SETTINGS_PANE)
  expect(await again.find({ type: 'Text', text: /illisibles/ })).toBeUndefined()
  await again.unmount()
})

// Every read of one dispatch answers one moment: `last`, dx's settings as
// last read; `frozen`, set from it, what a dispatch begun then reads.
type SettingsMoment = { last?: StateRead; frozen?: StateRead }

// Empties dx's settings as the engine may at a `/clear`, from the call it
// returns on: read as absent while they stand at the version they had, until
// written. With `moment`, they read as its `frozen` holds them while it is
// set.
function emptySettings(on: On, moment?: SettingsMoment): () => void {
  let isEmpty = false
  let emptied: number | undefined
  on('state.get', { plugin: 'dx', key: 'settings' }, async (_, e, next) => {
    const read = await next(e)
    if (!('value' in read) || read.value === undefined) return read
    if (isEmpty && emptied === undefined) emptied = read.value.version
    if (moment?.frozen !== undefined) return { value: moment.frozen }
    const shown = isEmpty && read.value.version === emptied ? { ...read.value, value: undefined } : read.value
    if (moment !== undefined) moment.last = shown

    return { value: shown }
  })

  return () => {
    isEmpty = true
  }
}

// A `/clear` may empty dx's state, not the hooks module's memory: an unsaved
// change and its warning stand, drawn by the pane at once, by the band from
// the next turn, and saved by the next change.
test('an unsaved setting and its warning outlast a /clear that empties the state', async ($, on) => {
  mock.clock(on, { now: NOW })
  const refused = new Set<string>()
  const session = { id: 's1' }
  const store = engine(on, { refused, session })
  shell(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  const emptied = emptySettings(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await showSettings($)
  refused.add('store.set settings')
  await click(pane, 'settings:show-total')
  await pane.unmount()
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  session.id = 's2'
  emptied()

  const after = await $.ui.mount(SETTINGS_PANE)
  expect(await after.find({ type: 'Text', text: /^⚠ réglages non enregistrés : .*disk full$/ })).toBeDefined()
  await after.unmount()
  await $.turn.start({ text: 'go', turnId: 't1' })
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /total/, in: 'frame-br' })).toBeUndefined()
  await band.unmount()

  refused.clear()
  const again = await $.ui.mount(SETTINGS_PANE)
  await click(again, 'settings:show-branch')
  expect(await again.find({ type: 'Text', text: /non enregistrés/ })).toBeUndefined()
  await again.unmount()
  expect(store.get('settings')).toMatchObject({ show: { total: false, branch: false } })
})

// Saved settings outlast a `/clear` that empties the state too: the band draws
// them again from the next turn, not the defaults.
test('saved settings outlast a /clear that empties the state', async ($, on) => {
  mock.clock(on, { now: NOW })
  const session = { id: 's1' }
  engine(on, { session, stored: { settings: { frameColor: '#58a6ff' } } })
  shell(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  const emptied = emptySettings(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  session.id = 's2'
  emptied()
  await $.turn.start({ text: 'go', turnId: 't1' })
  const band = await $.ui.mount(BAND)
  expect(await frameColors(band)).toContain('#58a6ff')
  await band.unmount()
})

// Before the next turn too, the panel's tabs follow the settings a `/clear`
// emptied from the state, not the defaults.
test("the panel's tabs keep the settings through a /clear that empties the state", async ($, on) => {
  mock.clock(on, { now: NOW })
  const session = { id: 's1' }
  engine(on, { session, stored: { settings: { notesIcon: '✎' } } })
  shell(on)
  const emptied = emptySettings(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  session.id = 's2'
  emptied()
  const band = await $.ui.mount(BAND)
  await click(band, 'notes')
  await band.unmount()
  const notes = await $.ui.mount(NOTES_PANE)
  expect(await notes.find({ type: 'Text', text: /^ ✎ Notes $/, in: 'pane-notes' })).toBeDefined()
  await notes.unmount()
})

// After a `/clear` that empties the state, a change the store cannot be read
// for starts from this session's settings, never from the defaults it would
// write over the stored ones.
test('a change after a /clear, the store unreadable, keeps the stored settings', async ($, on) => {
  mock.clock(on, { now: NOW })
  const refused = new Set<string>()
  refuseSettingsRead(on, refused)
  const session = { id: 's1' }
  const store = engine(on, { session, stored: { settings: { frameColor: '#58a6ff' } } })
  shell(on)
  const emptied = emptySettings(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const pane = await showSettings($)
  await pane.unmount()

  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  session.id = 's2'
  emptied()
  refused.add('store.get settings')
  const after = await $.ui.mount(SETTINGS_PANE)
  await click(after, 'settings:show-total')
  await after.unmount()
  expect(store.get('settings')).toMatchObject({ frameColor: '#58a6ff', show: { total: false } })
})

// A change whose save outlasts a `/clear` that empties the state writes its
// settings back whatever its reads, from before the `/clear`, say.
test("a change's save across a /clear that empties the state writes the settings back", async ($, on) => {
  mock.clock(on, { now: NOW })
  let saving = () => {}
  const isSaving = new Promise<void>(resolve => {
    saving = resolve
  })
  let release = () => {}
  const released = new Promise<void>(resolve => {
    release = resolve
  })
  on('store.set', { key: 'settings' }, async (_, e, next) => {
    saving()
    await released
    return next(e)
  })
  const session = { id: 's1' }
  engine(on, { session })
  shell(on)
  const moment: SettingsMoment = {}
  const emptied = emptySettings(on, moment)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await showSettings($)
  const clicked = click(pane, 'settings:show-total')
  await isSaving
  const before = await $.ui.mount(BAND)
  expect(await before.find({ type: 'Text', text: /total/, in: 'frame-br' })).toBeUndefined()
  await before.unmount()
  // The change's reads answer the moment before the `/clear`.
  moment.frozen = moment.last
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  session.id = 's2'
  emptied()
  release()
  await clicked
  await pane.unmount()
  moment.frozen = undefined

  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /total/, in: 'frame-br' })).toBeUndefined()
  await band.unmount()
})

// A reload of dx while a change's save is under way waits for it: should the
// save fail, the change is kept unsaved, never the settings read before it.
test("a reload during a setting's save keeps the change", async ($, on) => {
  mock.clock(on, { now: NOW })
  const refused = new Set<string>()
  let saving = () => {}
  const isSaving = new Promise<void>(resolve => {
    saving = resolve
  })
  let release = () => {}
  const released = new Promise<void>(resolve => {
    release = resolve
  })
  on('store.set', { key: 'settings' }, async (_, e, next) => {
    saving()
    await released
    return next(e)
  })
  const store = engine(on, { refused })
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await showSettings($)
  const clicked = click(pane, 'settings:show-total')
  await isSaving
  const reloaded = $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  refused.add('store.set settings')
  release()
  await clicked
  await reloaded
  await pane.unmount()

  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /total/, in: 'frame-br' })).toBeUndefined()
  refused.clear()
  await click(band, 'settings')
  await band.unmount()
  expect(store.get('settings')).toMatchObject({ show: { total: false } })
})

// A reload of dx after a `/clear` emptied the state keeps an unsaved change
// from dx's memory, the store lacking it.
test('an unsaved setting outlasts a /clear then a reload', async ($, on) => {
  mock.clock(on, { now: NOW })
  const refused = new Set<string>()
  const session = { id: 's1' }
  const store = engine(on, { refused, session })
  shell(on)
  const emptied = emptySettings(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await showSettings($)
  refused.add('store.set settings')
  await click(pane, 'settings:show-total')
  await pane.unmount()
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  session.id = 's2'
  emptied()
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /total/, in: 'frame-br' })).toBeUndefined()
  refused.clear()
  await click(band, 'settings')
  await band.unmount()
  expect(store.get('settings')).toMatchObject({ show: { total: false } })
})

// dx's state as an earlier load of its code left it, this one's memory fresh:
// each value of `left`, by its key, read so until written.
function leaveState(on: On, left: Record<string, unknown>): void {
  const unwritten = new Set(Object.keys(left))
  on('state.set', (_, e, next) => {
    if (e.plugin === 'dx') unwritten.delete(e.key)
    return next(e)
  })
  on('state.get', (_, e, next) => (e.plugin === 'dx' && unwritten.has(e.key) ? { value: { value: left[e.key], version: 0 } } : next(e)))
}

// What dx's state holds of the settings: as this session holds them.
function leftSettings(value: Record<string, unknown>, warnings: Record<string, unknown> = {}) {
  return { shape: 'settings-13', value: { value: { ...DEFAULT_SETTINGS, ...value }, unsaved: null, unreadable: null, ...warnings } }
}

// dx's code loaded anew, after an update that changed the settings' shape: an
// unsaved change left in the state, in the atoms an earlier dx wrote, is
// neither taken up nor saved; nor the defaults over the stored settings.
test('an unsaved setting left by settings of another shape is not taken up', async ($, on) => {
  mock.clock(on, { now: NOW })
  const store = engine(on, { stored: { settings: { frameColor: '#58a6ff' } } })
  shell(on)
  leaveState(on, {
    settings: { shape: 'settings-3', value: { ...DEFAULT_SETTINGS, frameColor: '#123456' } },
    settingsUnsaved: { shape: 'settings-unsaved-1', value: 'disk full' },
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await showSettings($)
  expect(await pane.find({ type: 'Text', text: /non enregistrés/ })).toBeUndefined()
  await click(pane, 'settings:show-total')
  await pane.unmount()
  expect(store.get('settings')).toMatchObject({ frameColor: '#58a6ff', show: { total: false } })
})

// dx's code loaded anew, a turn starting while the start takes up an unsaved
// change from the state: the turn never writes the defaults over it first.
test('a turn during a fresh load leaves the unsaved setting to the start', async ($, on) => {
  mock.clock(on, { now: NOW })
  let reading = () => {}
  const isReading = new Promise<void>(resolve => {
    reading = resolve
  })
  let release = () => {}
  const released = new Promise<void>(resolve => {
    release = resolve
  })
  let isFirst = true
  on('state.get', { plugin: 'dx', key: 'settings' }, async (_, e, next) => {
    if (isFirst) {
      isFirst = false
      reading()
      await released
    }
    return next(e)
  })
  engine(on, { stored: { settings: { frameColor: '#58a6ff' } } })
  shell(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  leaveState(on, { settings: leftSettings({ frameColor: '#123456' }, { unsaved: 'disk full' }) })

  const started = $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await isReading
  await $.turn.start({ text: 'go', turnId: 't1' })
  release()
  await started
  const band = await $.ui.mount(BAND)
  expect(await frameColors(band)).toContain('#123456')
  await band.unmount()
})

// dx's code loaded anew, a change made before the settings' start: it builds
// on the unsaved change the state holds, never on the defaults or the store.
test('a change before a fresh load starts the settings keeps the unsaved setting', async ($, on) => {
  mock.clock(on, { now: NOW })
  let starting = () => {}
  const isStarting = new Promise<void>(resolve => {
    starting = resolve
  })
  let release = () => {}
  const released = new Promise<void>(resolve => {
    release = resolve
  })
  const beforeStart = async () => {
    starting()
    await released
  }
  const store = engine(on, { stored: { settings: { frameColor: '#58a6ff' } }, beforeStart })
  shell(on)
  leaveState(on, {
    panel: { shape: 'panel-1', value: 'settings' },
    settings: leftSettings({ frameColor: '#123456' }, { unsaved: 'disk full' }),
  })

  const started = $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await isStarting
  const pane = await $.ui.mount(SETTINGS_PANE)
  await click(pane, 'settings:show-total')
  await pane.unmount()
  release()
  await started
  expect(store.get('settings')).toMatchObject({ frameColor: '#123456', show: { total: false } })
})

// dx's code loaded anew, the store unreadable: the settings the state holds,
// shown before as the session's own, are shown rather than the defaults, but no
// change is applied over the store's until a read succeeds.
test('a fresh load that cannot read the store shows the settings of the state, changes refused', async ($, on) => {
  mock.clock(on, { now: NOW })
  const refused = new Set(['store.get settings'])
  refuseSettingsRead(on, refused)
  const store = engine(on, { stored: { settings: { frameColor: '#58a6ff' } } })
  shell(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  leaveState(on, { settings: leftSettings({ frameColor: '#123456' }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const band = await $.ui.mount(BAND)
  expect(await frameColors(band)).toContain('#123456')
  await band.unmount()
  const pane = await showSettings($)
  const warning = /^⚠ réglages illisibles : .*store locked \(changement refusé tant qu'ils ne sont pas relus\)$/
  expect((await pane.find({ type: 'Text', text: warning }))?.props.color).toBe('error')
  await click(pane, 'settings:show-total')
  expect(store.get('settings')).toEqual({ frameColor: '#58a6ff' })
  expect(await pane.find({ type: 'Text', text: /^⚠ réglages illisibles : .*store locked \(changement non appliqué\)$/ })).toBeDefined()

  refused.clear()
  await $.turn.start({ text: 'go', turnId: 't1' })
  expect(await pane.find({ type: 'Text', text: /illisibles/ })).toBeUndefined()
  await pane.unmount()
  const after = await $.ui.mount(BAND)
  expect(await frameColors(after)).toContain('#58a6ff')
  await after.unmount()
})

// Loaded anew again, the store still unreadable: the settings an earlier such
// load showed as the session's own are shown still, changes still refused.
test('a fresh load after another that could not read the store shows the same settings', async ($, on) => {
  mock.clock(on, { now: NOW })
  refuseSettingsRead(on, new Set(['store.get settings']))
  const store = engine(on, { stored: { settings: { frameColor: '#58a6ff' } } })
  shell(on)
  const unreadable = { reason: 'store locked', isChangeRefused: true, isSessionShown: true }
  leaveState(on, { settings: leftSettings({ frameColor: '#123456' }, { unreadable }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const band = await $.ui.mount(BAND)
  expect(await frameColors(band)).toContain('#123456')
  await band.unmount()
  const pane = await showSettings($)
  expect(await pane.find({ type: 'Text', text: /\(changement refusé tant qu'ils ne sont pas relus\)$/ })).toBeDefined()
  await click(pane, 'settings:show-total')
  await pane.unmount()
  expect(store.get('settings')).toEqual({ frameColor: '#58a6ff' })
})

// dx's code loaded anew, a hex field's warning left in the state: the text it
// was about is gone, and so is the warning, never left for no keystroke or
// color to clear.
test('a fresh load ends the hex color warning', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on)
  shell(on)
  leaveState(on, {
    panel: { shape: 'panel-1', value: 'settings' },
    settingsBadHex: { shape: 'settings-bad-hex-1', value: 'frame-color' },
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await $.ui.mount(SETTINGS_PANE)
  expect(await pane.find({ type: 'Text', text: /^⚠ couleur non appliquée/ })).toBeUndefined()
  await pane.unmount()
})

// Settings the state holds with the warning that they were never read are the
// defaults an earlier start wrote: shown and said as such.
test('a fresh load that cannot read the store shows the defaults over settings never read', async ($, on) => {
  mock.clock(on, { now: NOW })
  refuseSettingsRead(on, new Set(['store.get settings']))
  engine(on, { stored: { settings: { frameColor: '#58a6ff' } } })
  shell(on)
  const unreadable = { reason: 'store locked', isChangeRefused: false, isSessionShown: false }
  leaveState(on, { settings: leftSettings({ frameColor: '#123456' }, { unreadable }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await showSettings($)
  expect(await pane.find({ type: 'Text', text: /\(réglages par défaut affichés\)$/ })).toBeDefined()
  await pane.unmount()
  const band = await $.ui.mount(BAND)
  expect(await frameColors(band)).not.toContain('#123456')
  await band.unmount()
})

// A reload of dx whose read of the store fails keeps the settings read
// earlier, silently, and a change still builds on them.
test('a reload that cannot read the store keeps the settings read before', async ($, on) => {
  mock.clock(on, { now: NOW })
  const refused = new Set<string>()
  refuseSettingsRead(on, refused)
  const store = engine(on, { stored: { settings: { frameColor: '#58a6ff' } } })
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  refused.add('store.get settings')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount(BAND)
  expect(await frameColors(band)).toContain('#58a6ff')
  await band.unmount()
  const pane = await showSettings($)
  expect(await pane.find({ type: 'Text', text: /illisibles/ })).toBeUndefined()
  await click(pane, 'settings:show-total')
  await pane.unmount()
  expect(store.get('settings')).toMatchObject({ frameColor: '#58a6ff', show: { total: false } })
})

// The pane's two tabs: the band's looks, then what dx does, one at a time.
test('the settings pane shows its appearance tab, then its functions tab', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on)
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await showSettings($)
  for (const title of ['Affichage', 'Bordure du bas', 'Animations', 'Couleurs', 'Seuils des jauges', 'Icônes']) {
    expect(await pane.find({ type: 'Text', text: title })).toBeDefined()
  }
  expect(await pane.find({ key: 'settings:animate-only-working' })).toBeDefined()
  expect(await pane.find({ key: 'settings:animate-with-crew' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: "Barre d'état" })).toBeUndefined()
  expect(await pane.find({ key: 'settings:resume-notes-tab' })).toBeUndefined()

  await click(pane, 'settings:tab-functions')
  for (const title of ['Notes', "Barre d'état"]) {
    expect(await pane.find({ type: 'Text', text: title })).toBeDefined()
  }
  for (const key of ['refresh-fast', 'hide-idle-five-hour', 'context-to-compact', 'resume-notes-tab']) {
    expect(await pane.find({ key: `settings:${key}` })).toBeDefined()
  }
  expect(await pane.find({ type: 'Text', text: 'Comportement' })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: 'Affichage' })).toBeUndefined()
  expect(await pane.find({ key: 'settings:animate-only-working' })).toBeUndefined()
  expect(await pane.find({ key: 'settings:reset' })).toBeDefined()

  await click(pane, 'settings:tab-appearance')
  expect(await pane.find({ type: 'Text', text: 'Affichage' })).toBeDefined()
  await pane.unmount()
})

// The last tab shown is the one the pane opens on: closed and opened again,
// and in a later session, from the store.
test('the settings pane opens on the last tab shown', async ($, on) => {
  mock.clock(on, { now: NOW })
  const store = engine(on)
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await showSettings($, 'functions')
  await pane.unmount()
  expect(store.get('settingsTab')).toBe('functions')
  const band = await $.ui.mount(BAND)
  await click(band, 'settings')
  await band.unmount()
  const again = await showSettings($)
  expect(await again.find({ key: 'settings:resume-notes-tab' })).toBeDefined()
  await again.unmount()

  // Another session put the appearance tab in front; dx loaded anew reads it.
  store.set('settingsTab', 'appearance')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const reloaded = await $.ui.mount(SETTINGS_PANE)
  expect(await reloaded.find({ key: 'settings:show-total' })).toBeDefined()
  await reloaded.unmount()
})

test('a stored tab that is none opens the pane on the appearance tab', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on, { stored: { settingsTab: 'colors' } })
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await showSettings($)
  expect(await pane.find({ key: 'settings:show-total' })).toBeDefined()
  await pane.unmount()
})

// A `/clear` that empties the state keeps the tab in front.
test('the settings tab outlasts a /clear that empties the state', async ($, on) => {
  mock.clock(on, { now: NOW })
  const session = { id: 's1' }
  engine(on, { session })
  shell(on)
  // dx's tab read as absent from the `/clear` on.
  const cleared = { value: false }
  on('state.get', { plugin: 'dx', key: 'settingsTab' }, (_, e, next) => (cleared.value ? { value: { value: undefined, version: 0 } } : next(e)))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const pane = await showSettings($, 'functions')
  await pane.unmount()

  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  session.id = 's2'
  cleared.value = true
  const after = await $.ui.mount(SETTINGS_PANE)
  expect(await after.find({ key: 'settings:resume-notes-tab' })).toBeDefined()
  await after.unmount()
})

// The reset, on either tab, resets every setting, the other tab's too.
test("the reset on the functions tab resets the appearance tab's settings too", async ($, on) => {
  mock.clock(on, { now: NOW })
  const store = engine(on, { stored: { settings: { frameColor: '#58a6ff', hideIdleFiveHour: false } } })
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await showSettings($, 'functions')
  await click(pane, 'settings:reset')
  await pane.unmount()
  expect(store.get('settings')).toEqual(DEFAULT_SETTINGS)
})

// Turned to its other tab, the pane drops the hex field it held, and its warning.
test('a hex color warning goes with a switch of tab', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on)
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await showSettings($)
  await pane.input({ key: 'frame-color-hex', text: 'bleu' })
  await click(pane, 'settings:tab-functions')
  await click(pane, 'settings:tab-appearance')
  expect(await pane.find({ type: 'Text', text: /^⚠ couleur non appliquée/ })).toBeUndefined()
  await pane.unmount()
})

// Claude Code's configuration folder, opened from the pane's footer: on
// Windows (`windows`), the folder there unless `missing`, holding
// `settings.json`, in `configDir` when set; Windows PowerShell failing to
// open it while `openFails` holds and, when `slow` is given, answering once
// it resolves, `started` called as it starts. What ran, the folders opened in
// a window shown (`opened`) or hidden (`hidden`), and the files written.
type ConfigFolderOptions = {
  windows?: boolean
  missing?: boolean
  configDir?: string
  openFails?: { value: boolean }
  slow?: Promise<void>
  started?: () => void
}
const SYSTEM_ROOT = String.raw`C:\Windows`
const FILE_EXPLORER = String.raw`C:\Windows\explorer.exe`
const POWERSHELL = String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`
const OPEN_COMMAND = encodeCommand(WINDOWS_OPEN_FOLDER)
const CONFIG_FOLDER = String.raw`C:\Users\dev\.claude`
const DONE: ProcessRunResult = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

async function startConfigFolder($: Engine, on: On, options: ConfigFolderOptions = {}) {
  const { windows = true, missing = false, configDir, openFails = { value: false }, slow, started } = options
  mock.clock(on, { now: NOW })
  const ran: { argv: string[]; cwd?: string }[] = []
  const opened: string[] = []
  const hidden: string[] = []
  const writes: string[] = []
  on('fs.write', (_, e, next) => {
    writes.push(e.path)
    return next(e)
  })
  const folder = configDir === undefined || configDir === '' ? 'Users/dev/.claude' : configDir.split(/[\\/]/).filter(Boolean).pop()
  engine(on, {
    files: missing ? {} : { [`${folder}/settings.json`]: '{}' },
    env: {
      ...(windows ? { OS: 'Windows_NT', SystemRoot: SYSTEM_ROOT } : {}),
      ...(configDir === undefined ? {} : { CLAUDE_CONFIG_DIR: configDir }),
    },
    run: async (argv, init) => {
      ran.push({ argv: [...argv], ...(init?.cwd === undefined ? {} : { cwd: init.cwd }) })
      // Claude Code starts a plugin's programs with their window hidden: the
      // File Explorer run directly opens the folder in a hidden window, and
      // exits with 1 on success too.
      if (argv[0] === FILE_EXPLORER) {
        hidden.push(...argv.slice(1))
        return { ...DONE, exitCode: 1 }
      }
      if (argv[0] !== POWERSHELL || argv.at(-1) !== OPEN_COMMAND) return DONE
      started?.()
      await slow
      if (openFails.value) return { ...DONE, exitCode: 1, stderr: 'Invoke-Item : Accès refusé\r\n' }
      opened.push(init?.env?.DX_OPEN_FOLDER ?? '')
      return DONE
    },
  })
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  return { ran, opened, hidden, writes }
}

// The folder alone is named, never its settings.json, which Claude Code
// refuses a run to name (its rule, in ../shared/testing).
test("the configuration folder button opens Claude Code's folder in the File Explorer, never naming its settings.json", async ($, on) => {
  const { ran, opened, writes } = await startConfigFolder($, on)
  const pane = await showSettings($)
  expect(await pane.find({ type: 'Text', text: '[ 📁 dossier .claude ]', in: 'settings:open-config-folder' })).toBeDefined()
  await click(pane, 'settings:open-config-folder')
  expect(ran).toEqual([{ argv: [POWERSHELL, '-NoProfile', '-NonInteractive', '-EncodedCommand', OPEN_COMMAND], cwd: SYSTEM_ROOT }])
  expect(opened).toEqual([CONFIG_FOLDER])
  expect(writes).toEqual([])
  expect(await pane.find({ type: 'Text', text: /dossier (introuvable|non ouvert)/ })).toBeUndefined()
  // On the other tab too.
  await click(pane, 'settings:tab-functions')
  expect(await pane.find({ key: 'settings:open-config-folder' })).toBeDefined()
  await pane.unmount()
})

test('the button opens the folder of CLAUDE_CONFIG_DIR when set, named by it', async ($, on) => {
  const { opened } = await startConfigFolder($, on, { configDir: String.raw`D:\claude-config` })
  const pane = await showSettings($)
  expect(await pane.find({ type: 'Text', text: '[ 📁 dossier claude-config ]', in: 'settings:open-config-folder' })).toBeDefined()
  await click(pane, 'settings:open-config-folder')
  expect(opened).toEqual([String.raw`D:\claude-config`])
  await pane.unmount()
})

test('a CLAUDE_CONFIG_DIR written with slashes opens its folder all the same', async ($, on) => {
  const { opened } = await startConfigFolder($, on, { configDir: 'C:/claude-config/' })
  const pane = await showSettings($)
  await click(pane, 'settings:open-config-folder')
  expect(opened).toEqual([String.raw`C:\claude-config`])
  expect(await pane.find({ type: 'Text', text: /dossier (introuvable|non ouvert)/ })).toBeUndefined()
  await pane.unmount()
})

// Set empty, it is unset, as Claude Code reads it.
test('an empty CLAUDE_CONFIG_DIR opens .claude in the home folder', async ($, on) => {
  const { opened } = await startConfigFolder($, on, { configDir: '' })
  const pane = await showSettings($)
  await click(pane, 'settings:open-config-folder')
  expect(opened).toEqual([CONFIG_FOLDER])
  await pane.unmount()
})

test('a configuration folder that is not there says so in the pane, until the pane is shown anew', async ($, on) => {
  const { ran } = await startConfigFolder($, on, { missing: true })
  const pane = await showSettings($)
  await click(pane, 'settings:open-config-folder')
  expect(ran).toEqual([])
  const warning = await pane.find({ type: 'Text', text: `⚠ dossier introuvable : ${CONFIG_FOLDER}` })
  expect(warning?.props.color).toBe('error')
  await pane.unmount()

  const band = await $.ui.mount(BAND)
  await click(band, 'settings')
  await click(band, 'settings')
  await band.unmount()
  const again = await $.ui.mount(SETTINGS_PANE)
  expect(await again.find({ type: 'Text', text: /dossier introuvable/ })).toBeUndefined()
  await again.unmount()
})

test('a configuration folder Windows cannot open says why in the pane, until it opens', async ($, on) => {
  const openFails = { value: true }
  await startConfigFolder($, on, { openFails })
  const pane = await showSettings($)
  await click(pane, 'settings:open-config-folder')
  expect((await pane.find({ type: 'Text', text: '⚠ dossier non ouvert : Invoke-Item : Accès refusé' }))?.props.color).toBe('error')
  openFails.value = false
  await click(pane, 'settings:open-config-folder')
  expect(await pane.find({ type: 'Text', text: /dossier non ouvert/ })).toBeUndefined()
  await pane.unmount()
})

// Run directly, the File Explorer would open it in a hidden window: nothing
// seen, nothing said.
test('the configuration folder opens in a window shown, never by the File Explorer run directly, whose window Claude Code hides', async ($, on) => {
  const { ran, opened, hidden } = await startConfigFolder($, on)
  const pane = await showSettings($)
  await click(pane, 'settings:open-config-folder')
  expect(hidden).toEqual([])
  expect(ran.map(item => item.argv[0])).not.toContain(FILE_EXPLORER)
  expect(opened).toEqual([CONFIG_FOLDER])
  await pane.unmount()
})

// Handed over by the environment, the folder needs no quoting: a comma or a
// semicolon in it, at which the File Explorer's command line is split,
// changes nothing.
test('a configuration folder holding a comma or a semicolon opens all the same', async ($, on) => {
  const { opened } = await startConfigFolder($, on, { configDir: String.raw`D:\claude,config;x` })
  const pane = await showSettings($)
  await click(pane, 'settings:open-config-folder')
  expect(opened).toEqual([String.raw`D:\claude,config;x`])
  expect(await pane.find({ type: 'Text', text: /dossier (introuvable|non ouvert)/ })).toBeUndefined()
  await pane.unmount()
})

// Nor does it look for the folder: `CLAUDE_CONFIG_DIR` is never read.
test('off Windows, the settings pane draws no configuration folder button', async ($, on) => {
  const reads = { count: 0 }
  on('env.get', { name: 'CLAUDE_CONFIG_DIR' }, (_, e, next) => {
    reads.count++
    return next(e)
  })
  await startConfigFolder($, on, { windows: false })
  const pane = await showSettings($)
  expect(await pane.find({ key: 'settings:open-config-folder' })).toBeUndefined()
  expect(await pane.find({ key: 'settings:reset' })).toBeDefined()
  await pane.unmount()
  expect(reads.count).toBe(0)
})

// An open that fails once the pane was shown anew says nothing there; a press
// while one is under way runs nothing more.
test('a slow configuration folder open neither runs twice nor says its failure after the pane is shown anew', async ($, on) => {
  let finish = () => {}
  const slow = new Promise<void>(resolve => {
    finish = resolve
  })
  let started = () => {}
  const isStarted = new Promise<void>(resolve => {
    started = resolve
  })
  const { ran } = await startConfigFolder($, on, { slow, started, openFails: { value: true } })
  const pane = await showSettings($)
  const opening = click(pane, 'settings:open-config-folder')
  await isStarted
  await click(pane, 'settings:open-config-folder')
  await pane.unmount()

  const band = await $.ui.mount(BAND)
  await click(band, 'settings')
  await click(band, 'settings')
  await band.unmount()
  finish()
  await opening
  expect(ran).toHaveLength(1)
  const again = await $.ui.mount(SETTINGS_PANE)
  expect(await again.find({ type: 'Text', text: /dossier non ouvert/ })).toBeUndefined()
  await again.unmount()
})
