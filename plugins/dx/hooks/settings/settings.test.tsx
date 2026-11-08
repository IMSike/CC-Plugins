import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { BAND, click, engine, frameColors, NOTES_PANE, NOW, SETTINGS_PANE, shell, showSettings } from '../shared/testing'

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

// Empties dx's settings as the engine may at a `/clear`, from the call it
// returns on: each read as absent while it stands at the version it had,
// until written.
const EMPTIED_KEYS = ['settings', 'settingsUnsaved', 'settingsUnreadable']
function emptySettings(on: On): () => void {
  let isEmpty = false
  const emptied = new Map<string, number>()
  on('state.get', async (_, e, next) => {
    const read = await next(e)
    if (!isEmpty || e.plugin !== 'dx' || !EMPTIED_KEYS.includes(e.key) || !('value' in read) || read.value === undefined) return read
    if (!emptied.has(e.key)) emptied.set(e.key, read.value.version)

    return read.value.version === emptied.get(e.key) ? { value: { ...read.value, value: undefined } } : read
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
