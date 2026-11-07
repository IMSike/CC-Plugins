import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { BAND, click, engine, NOTES_PANE, NOW, shell, showSettings } from '../shared/testing'
import { entryBytes, STORE_MAX_BYTES } from './store-size'

test('the notes open on the last tab shown, or on the one set', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on, { stored: { notesTab: 'session' } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount(NOTES_PANE)
  expect((await pane.find({ type: 'Text', text: /^ Session $/, in: 'notes:tab-session' }))?.props.inverse).toBe(true)
  await pane.unmount()
})

test('the notes open on the tab set when the last one is not taken up', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on, { stored: { notesTab: 'session', settings: { notesTab: 'project', resumeNotesTab: false } } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount(NOTES_PANE)
  expect((await pane.find({ type: 'Text', text: /^ Projet $/, in: 'notes:tab-project' }))?.props.inverse).toBe(true)
  await pane.unmount()
})

test('notes are kept per tab, out of the conversation', async ($, on) => {
  mock.clock(on, { now: NOW })
  const store = engine(on, { stored: { 'notes.session.old': { text: 'ancienne piste\nsuite', updatedAt: NOW - 86400_000 } } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  // Every change is kept at once; Enter types a new line, and the text stays shown.
  const pane = await $.ui.mount(NOTES_PANE)
  await pane.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'note-global-s1' })
  await pane.key({ key: 'pain', in: 'note-global-s1' })
  await pane.key({ key: 'return', in: 'note-global-s1' })
  await pane.key({ key: 'lait', in: 'note-global-s1' })
  expect(store.get('notes.global')).toEqual({ text: 'pain\nlait', updatedAt: NOW })
  expect(await pane.find({ type: 'Text', text: /lait/, in: 'note-global-s1' })).toBeDefined()
  await click(pane, 'notes:tab-project')
  await pane.post({ tab: 'project', session: 's1', text: 'migrer la base' }, { in: 'note-project-s1' })
  expect(store.get(String.raw`notes.project.C:\Users\dev\repo\app`)).toEqual({ text: 'migrer la base', updatedAt: NOW })
  await click(pane, 'notes:tab-global')
  expect(await pane.find({ type: 'Text', text: /pain/, in: 'note-global-s1' })).toBeDefined()

  // The session tab lists the other sessions' notes: one opened, then deleted.
  await click(pane, 'notes:tab-session')
  await click(pane, 'notes:session-old')
  expect(await pane.find({ type: 'Text', text: /ancienne piste/, in: 'note-session-old' })).toBeDefined()
  await click(pane, 'notes:delete')
  expect(store.get('notes.session.old')).toBeUndefined()
  expect(await pane.find({ key: 'notes:session-old' })).toBeUndefined()
  await pane.unmount()
})

test('a note another session changes is shown in the open pane, and kept from there', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const store = engine(on, { stored: { 'notes.global': { text: 'liste', updatedAt: NOW - 1000 } } })
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount(BAND)
  await click(band, 'notes')
  await band.unmount()
  const pane = await $.ui.mount(NOTES_PANE)
  expect(await pane.find({ type: 'Text', text: /liste/, in: 'note-global-s1' })).toBeDefined()

  // Another session writes the note: shown here within a poll, no tab changed.
  store.set('notes.global', { text: 'liste\npain', updatedAt: NOW + 500 })
  await clock.advance(1000)
  expect(await pane.find({ type: 'Text', text: /pain/, in: 'note-global-s1' })).toBeDefined()

  // Written on from here: the other session's line stays.
  await pane.pointer({ type: 'down', x: 20, y: 5, button: 'left', in: 'note-global-s1' })
  await pane.key({ key: 'end', in: 'note-global-s1' })
  await pane.key({ key: ' lait', in: 'note-global-s1' })
  expect((store.get('notes.global') as { text: string }).text).toBe('liste\npain lait')
  await pane.unmount()
})

test('notes that failed to load at the start load when the panel opens on them', async ($, on) => {
  mock.clock(on, { now: NOW })
  const refused = new Set(['session.id'])
  engine(on, { stored: { 'notes.global': { text: 'pain', updatedAt: NOW - 1000 } }, refused })
  const panes = shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  refused.clear()

  const band = await $.ui.mount(BAND)
  await click(band, 'notes')
  await band.unmount()
  expect(panes).toEqual(['dx-panel'])
  const pane = await $.ui.mount(NOTES_PANE)
  expect((await pane.find({ type: 'Text', text: /^ Global $/, in: 'notes:tab-global' }))?.props.inverse).toBe(true)
  expect(await pane.find({ type: 'Text', text: /pain/, in: 'note-global-s1' })).toBeDefined()
  await pane.unmount()
})

test('notes that failed to load load when the open panel goes from the settings to them', async ($, on) => {
  mock.clock(on, { now: NOW })
  const refused = new Set(['session.root'])
  engine(on, { refused })
  const panes = shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  refused.clear()

  // The panel stays open: the notes are shown with no new open.
  const settings = await showSettings($)
  await click(settings, 'pane-notes')
  await settings.unmount()
  expect(panes).toEqual(['dx-panel'])
  const pane = await $.ui.mount(NOTES_PANE)
  expect(await pane.find({ key: 'sheet' })).toBeDefined()
  await pane.unmount()
})

test('notes that cannot load say so in the panel, with a retry', async ($, on) => {
  mock.clock(on, { now: NOW })
  const refused = new Set(['session.id'])
  engine(on, { refused })
  shell(on)
  const logged: { text: string; to?: string }[] = []
  on('ui.log', (_, e) => {
    logged.push(e)

    return { value: undefined }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // Not silent: the debug log says why.
  expect(logged.some(line => line.to === 'debug' && /notes non chargées.*session not ready/.test(line.text))).toBe(true)

  const band = await $.ui.mount(BAND)
  await click(band, 'notes')
  await band.unmount()
  const pane = await $.ui.mount(NOTES_PANE)
  // Never a blank panel: its tabs, what failed, and a retry.
  expect(await pane.find({ key: 'pane-settings' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Notes indisponibles/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /session not ready/ })).toBeDefined()
  expect(await pane.find({ key: 'sheet' })).toBeUndefined()
  refused.clear()
  await click(pane, 'notes:retry')
  expect(await pane.find({ type: 'Text', text: /Notes indisponibles/ })).toBeUndefined()
  expect(await pane.find({ key: 'sheet' })).toBeDefined()
  await pane.unmount()
})

// Empties dx's notes and their tab as the engine does at a `/clear`, from the
// call it returns on: each read as absent while it stands at the version it
// had, until written.
const EMPTIED_KEYS = ['notes', 'notesView']
function emptyNotes(on: On): () => void {
  let isEmpty = false
  const emptied = new Map<string, number>()
  on('state.get', async (_, e, next) => {
    const read = await next(e)
    if (!isEmpty || e.plugin !== 'dx' || !EMPTIED_KEYS.includes(e.key) || !('value' in read) || read.value === undefined) return read
    if (!emptied.has(e.key)) emptied.set(e.key, read.value.version)

    // A call's hook answers { value }: here the read, `{ value, version }`.
    return read.value.version === emptied.get(e.key) ? { value: { ...read.value, value: undefined } } : read
  })

  return () => {
    isEmpty = true
  }
}

// A session with a note, then a `/clear`: the engine goes on under `s2`, its
// clock started over, dx's notes emptied when `empty`; `session`, the
// engine's, which a test changes again, and `refused`, the calls it refuses.
async function clearSession(
  $: Engine,
  on: On,
  empty: boolean,
  session: { id: string; startedAt?: number } = { id: 's1' },
  refused: ReadonlySet<string> = new Set(),
) {
  mock.clock(on, { now: NOW })
  const store = engine(on, { stored: { notesTab: 'session' }, refused, session })
  shell(on)
  const emptied = emptyNotes(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const before = await $.ui.mount(NOTES_PANE)
  await before.post({ tab: 'session', session: 's1', text: 'piste s1' }, { in: 'note-session-s1' })
  // The tab shown at the `/clear`, which the stored one is not.
  await click(before, 'notes:tab-global')
  await click(before, 'notes:tab-session')
  store.set('notesTab', 'project')
  await before.unmount()
  expect(store.get('notes.session.s1')).toEqual({ text: 'piste s1', updatedAt: NOW })
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  session.id = 's2'
  session.startedAt = NOW
  if (empty) emptied()

  return store
}

// A `/clear` empties the conversation, not the session: the session tab keeps
// its note under the new id, which is linked to the session it goes on.
test('a /clear keeps the session note, the state kept', async ($, on) => {
  const store = await clearSession($, on, false)
  const band = await $.ui.mount(BAND)
  await click(band, 'notes')
  await band.unmount()
  const pane = await $.ui.mount(NOTES_PANE)
  expect(await pane.find({ type: 'Text', text: /piste s1/, in: 'note-session-s1' })).toBeDefined()
  expect(await pane.find({ key: 'notes:session-s1' })).toBeUndefined()
  expect(store.get('notes.link.s2')).toBe('s1')
  await pane.post({ tab: 'session', session: 's1', text: 'piste s1, suite' }, { in: 'note-session-s1' })
  expect(store.get('notes.session.s1')).toEqual({ text: 'piste s1, suite', updatedAt: NOW })
  expect(store.get('notes.session.s2')).toBeUndefined()
  await pane.unmount()
})

// The engine may empty dx's state at a `/clear`: the pane, left open, draws
// the notes again on its own, never « Notes indisponibles ».
test('a /clear keeps the session note, the state emptied with the pane open', async ($, on) => {
  const store = await clearSession($, on, true)
  const pane = await $.ui.mount(NOTES_PANE)
  expect(await pane.find({ type: 'Text', text: /Notes indisponibles/ })).toBeUndefined()
  expect((await pane.find({ type: 'Text', text: /^ Session $/, in: 'notes:tab-session' }))?.props.inverse).toBe(true)
  expect(await pane.find({ type: 'Text', text: /piste s1/, in: 'note-session-s1' })).toBeDefined()
  expect(await pane.find({ key: 'notes:session-s1' })).toBeUndefined()
  // Drawn without a write; kept, and linked, by the first change.
  expect(store.get('notes.link.s2')).toBeUndefined()
  await pane.post({ tab: 'session', session: 's1', text: 'piste s1, suite' }, { in: 'note-session-s1' })
  expect(store.get('notes.link.s2')).toBe('s1')
  expect(store.get('notes.session.s1')).toEqual({ text: 'piste s1, suite', updatedAt: NOW })
  expect(store.get('notes.session.s2')).toBeUndefined()
  await click(pane, 'notes:tab-global')
  expect((await pane.find({ type: 'Text', text: /^ Global $/, in: 'notes:tab-global' }))?.props.inverse).toBe(true)
  await pane.unmount()
})

// A tab chosen right after the `/clear`, before anything kept the notes.
test('a tab chosen right after a /clear is shown', async ($, on) => {
  await clearSession($, on, true)
  const pane = await $.ui.mount(NOTES_PANE)
  await click(pane, 'notes:tab-project')
  expect((await pane.find({ type: 'Text', text: /^ Projet $/, in: 'notes:tab-project' }))?.props.inverse).toBe(true)
  await pane.unmount()
})

// A session launched right after another one's `/clear`, the marker an earlier
// dx kept in the store still there: it keeps its own note.
test('a session launched right after a /clear elsewhere keeps its own note', async ($, on) => {
  mock.clock(on, { now: NOW })
  const session = { id: 'b1', startedAt: NOW - 2000 }
  const store = engine(on, {
    stored: {
      notesTab: 'session',
      'notes.session.a1': { text: 'note de A', updatedAt: NOW - 5000 },
      'notes.cleared': { from: 'a1', at: NOW - 3000, view: { tab: 'session' } },
    },
    session,
  })
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(store.get('notes.link.b1')).toBeUndefined()
  const pane = await $.ui.mount(NOTES_PANE)
  expect(await pane.find({ key: 'note-session-b1' })).toBeDefined()
  expect(await pane.find({ key: 'notes:session-a1' })).toBeDefined()
  await pane.unmount()
})

// A `/clear` seen, then a fresh load of the plugin (its own `session.start`)
// under another id: nothing of the `/clear` goes on into it.
test('a session started after a /clear takes nothing of it', async ($, on) => {
  const session: { id: string; startedAt?: number } = { id: 's1' }
  const store = await clearSession($, on, true, session)
  session.id = 'b1'
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount(NOTES_PANE)
  await click(pane, 'notes:tab-session')
  expect(await pane.find({ key: 'note-session-b1' })).toBeDefined()
  expect(await pane.find({ key: 'notes:session-s1' })).toBeDefined()
  expect(store.get('notes.link.b1')).toBeUndefined()
  await pane.unmount()
})

// A `/clear`, then a `/resume` within the process before anything loaded the
// notes: the session resumed keeps its own note, never linked to the cleared one.
test('a session resumed right after a /clear takes nothing of it', async ($, on) => {
  const session: { id: string; startedAt?: number } = { id: 's1' }
  const store = await clearSession($, on, false, session)
  await $.session.end({ reason: 'resume', sessionId: 's2', resume: { id: 'r1' } })
  session.id = 'r1'
  const pane = await $.ui.mount(NOTES_PANE)
  expect(await pane.find({ key: 'note-session-r1' })).toBeDefined()
  await pane.post({ tab: 'session', session: 'r1', text: 'piste r1' }, { in: 'note-session-r1' })
  expect(store.get('notes.link.r1')).toBeUndefined()
  expect(store.get('notes.session.r1')).toEqual({ text: 'piste r1', updatedAt: NOW })
  expect(store.get('notes.session.s1')).toEqual({ text: 'piste s1', updatedAt: NOW })
  await pane.unmount()
})

// Two changes posted one after the other, the first one's save held up until
// the second is posted: the engine runs both at once, the last one stays.
test('a note keeps the last change posted, an earlier save slower', async ($, on) => {
  mock.clock(on, { now: NOW })
  let hold: Promise<void> | undefined
  let release = () => {}
  on('state.get', async (_, e, next) => {
    if (e.plugin === 'dx' && e.key === 'notes' && hold !== undefined) {
      const held = hold
      hold = undefined
      await held
    }

    return next(e)
  })
  const store = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount(NOTES_PANE)
  hold = new Promise(resolve => {
    release = resolve
  })
  await pane.post({ tab: 'global', session: 's1', text: 'pain' }, { in: 'note-global-s1' })
  await pane.post({ tab: 'global', session: 's1', text: 'pain, lait' }, { in: 'note-global-s1' })
  release()
  // Both saves done, in real time: the hooks' runs outlive the posts.
  const { setTimeout } = globalThis as unknown as { setTimeout: (done: () => void, ms: number) => void }
  await new Promise<void>(resolve => setTimeout(resolve, 100))
  expect(store.get('notes.global')).toEqual({ text: 'pain, lait', updatedAt: NOW })
  await pane.unmount()
})

// Two `/clear`s in a row, nothing loading the notes between them: the note
// goes on from the first session still.
test('two /clears in a row keep the session note', async ($, on) => {
  const session: { id: string; startedAt?: number } = { id: 's1' }
  const store = await clearSession($, on, false, session)
  await $.session.end({ reason: 'clear', sessionId: 's2', resume: { id: 's2' } })
  session.id = 's3'
  const pane = await $.ui.mount(NOTES_PANE)
  expect(await pane.find({ type: 'Text', text: /piste s1/, in: 'note-session-s1' })).toBeDefined()
  await pane.post({ tab: 'session', session: 's1', text: 'piste s1, suite' }, { in: 'note-session-s1' })
  expect(store.get('notes.link.s3')).toBe('s1')
  expect(store.get('notes.session.s1')).toEqual({ text: 'piste s1, suite', updatedAt: NOW })
  await pane.unmount()
})

// A save the store refuses is never silent: the pane says so until one succeeds.
test('a note the store refuses says so in the pane, until a save succeeds', async ($, on) => {
  mock.clock(on, { now: NOW })
  const refused = new Set<string>()
  const store = engine(on, { refused })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount(NOTES_PANE)
  await pane.post({ tab: 'global', session: 's1', text: 'pain' }, { in: 'note-global-s1' })
  expect(await pane.find({ type: 'Text', text: /✓/ })).toBeDefined()

  refused.add('store.set')
  await pane.post({ tab: 'global', session: 's1', text: 'pain, lait' }, { in: 'note-global-s1' })
  expect(store.get('notes.global')).toEqual({ text: 'pain', updatedAt: NOW })
  expect((await pane.find({ type: 'Text', text: '⚠ non enregistré' }))?.props.color).toBe('error')
  expect(await pane.find({ type: 'Text', text: /store over 4 MiB/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /✓/ })).toBeUndefined()

  refused.clear()
  await pane.post({ tab: 'global', session: 's1', text: 'pain, lait, œufs' }, { in: 'note-global-s1' })
  expect(store.get('notes.global')).toEqual({ text: 'pain, lait, œufs', updatedAt: NOW })
  expect(await pane.find({ type: 'Text', text: /non enregistré/ })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /✓/ })).toBeDefined()
  await pane.unmount()
})

// The notes emptied by a `/clear`, then their load failing as a change is
// posted: the change is not kept, and the pane says so once they load again.
test('a note posted while the notes cannot load says it was not saved', async ($, on) => {
  const refused = new Set<string>()
  const store = await clearSession($, on, true, { id: 's1' }, refused)
  const pane = await $.ui.mount(NOTES_PANE)
  refused.add('session.root')
  await pane.post({ tab: 'session', session: 's1', text: 'piste s1, perdue' }, { in: 'note-session-s1' })
  expect(store.get('notes.session.s1')).toEqual({ text: 'piste s1', updatedAt: NOW })
  expect(await pane.find({ type: 'Text', text: /Notes indisponibles/ })).toBeDefined()
  refused.clear()
  await click(pane, 'notes:retry')
  expect((await pane.find({ type: 'Text', text: '⚠ non enregistré' }))?.props.color).toBe('error')
  expect(await pane.find({ type: 'Text', text: /^notes non chargées : .*session not ready$/ })).toBeDefined()
  await pane.unmount()
})

// The store near its limit, a change posted past what the editor allows (as
// when another session fills the store meanwhile): dx refuses the save before
// the engine would.
test('a note that would fill the store is refused, the store left as it was', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const big = { text: 'x'.repeat(3.8 * 1024 * 1024 - 200), updatedAt: NOW - 1000 }
  const store = engine(on, { stored: { 'notes.session.old': big } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount(NOTES_PANE)
  await pane.post({ tab: 'global', session: 's1', text: 'court' }, { in: 'note-global-s1' })
  expect(store.get('notes.global')).toEqual({ text: 'court', updatedAt: NOW })
  await pane.post({ tab: 'global', session: 's1', text: 'y'.repeat(500) }, { in: 'note-global-s1' })
  expect(store.get('notes.global')).toEqual({ text: 'court', updatedAt: NOW })
  expect(await pane.find({ type: 'Text', text: /store presque plein : supprimez d'anciennes notes/ })).toBeDefined()

  // Room made elsewhere (another session deleted its note): a refusal stands
  // on the last measurement for a second, then the store is measured again.
  store.delete('notes.session.old')
  await pane.post({ tab: 'global', session: 's1', text: 'y'.repeat(501) }, { in: 'note-global-s1' })
  expect(store.get('notes.global')).toEqual({ text: 'court', updatedAt: NOW })
  await clock.advance(1000)
  await pane.post({ tab: 'global', session: 's1', text: 'y'.repeat(500) }, { in: 'note-global-s1' })
  expect((store.get('notes.global') as { text: string }).text).toHaveLength(500)
  expect(await pane.find({ type: 'Text', text: /non enregistré/ })).toBeUndefined()
  await pane.unmount()
})

// Every other session's note is reachable: as many listed as set, the list
// scrolled by its arrows or the wheel over it, a press still opening one.
test("the other sessions' notes scroll, as many listed as set", async ($, on) => {
  mock.clock(on, { now: NOW })
  const stored: Record<string, unknown> = { notesTab: 'session', settings: { notesOthers: 3 } }
  for (const [index, id] of ['a', 'b', 'c', 'd', 'e'].entries()) {
    stored[`notes.session.${id}`] = { text: `note ${id}`, updatedAt: NOW - (index + 1) * 60_000 }
  }
  engine(on, { stored })
  // The pane's window, beneath dx: the moves dx passes on.
  const moved: number[] = []
  on('ui.scroll', (_, e) => {
    moved.push(e.by)

    return {}
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount(NOTES_PANE)
  const listed = async () => {
    const shown: string[] = []
    for (const id of ['a', 'b', 'c', 'd', 'e']) if (await pane.find({ key: `notes:session-${id}` })) shown.push(id)
    return shown.join('')
  }
  expect(await listed()).toBe('abc')
  expect(await pane.find({ type: 'Text', text: '1–3 / 5 ' })).toBeDefined()

  // A page down, kept within the list; a page up.
  await click(pane, 'notes:others-down')
  expect(await listed()).toBe('cde')
  expect(await pane.find({ type: 'Text', text: '3–5 / 5 ' })).toBeDefined()
  await click(pane, 'notes:others-up')
  expect(await listed()).toBe('abc')

  // The wheel over the list moves it a row; over the editor, not.
  const wheel = (row: number, by: number) => $.ui.scroll({
    component: 'Pane', requestId: 'dx-panel', offset: 0, by, bodyRows: 20, contentRows: 20,
    origin: { kind: 'person' }, pointer: { column: 2, row },
  })
  await wheel(19, 1)
  expect(await listed()).toBe('bcd')
  await wheel(6, 1)
  expect(await listed()).toBe('bcd')
  await wheel(18, -5)
  expect(await listed()).toBe('abc')
  await wheel(18, 1)
  expect(moved).toEqual([1])
  // The list at its end that way: the wheel moves the pane's window.
  await wheel(18, 5)
  expect(await listed()).toBe('cde')
  await wheel(18, 1)
  expect(moved).toEqual([1, 1])
  await wheel(18, -5)
  await wheel(18, -1)
  expect(await listed()).toBe('abc')
  expect(moved).toEqual([1, 1, -1])
  await wheel(18, 1)
  expect(await listed()).toBe('bcd')

  // A press opens the note still.
  await click(pane, 'notes:session-d')
  expect(await pane.find({ type: 'Text', text: /note d/, in: 'note-session-d' })).toBeDefined()
  await pane.unmount()
})

// The links a `/clear` made to another session go with its note; the current
// session's own note emptied keeps its links.
test("deleting another session's note deletes the links to it", async ($, on) => {
  mock.clock(on, { now: NOW })
  const store = engine(on, {
    stored: {
      notesTab: 'session',
      'notes.session.old': { text: 'ancienne piste', updatedAt: NOW - 86400_000 },
      'notes.link.old2': 'old',
      'notes.link.old3': 'old',
      'notes.link.x2': 'x1',
      'notes.link.s1': 's0',
      'notes.session.s0': { text: 'piste s0', updatedAt: NOW - 1000 },
    },
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount(NOTES_PANE)
  // This session goes on from s0: its note emptied, its link stays.
  await pane.post({ tab: 'session', session: 's0', text: '' }, { in: 'note-session-s0' })
  expect(store.get('notes.session.s0')).toBeUndefined()
  expect(store.get('notes.link.s1')).toBe('s0')

  await click(pane, 'notes:session-old')
  await click(pane, 'notes:delete')
  expect(store.get('notes.session.old')).toBeUndefined()
  expect(store.get('notes.link.old2')).toBeUndefined()
  expect(store.get('notes.link.old3')).toBeUndefined()
  expect(store.get('notes.link.x2')).toBe('x1')
  expect(store.get('notes.link.s1')).toBe('s0')
  await pane.unmount()
})

// The editor applies no edit past 95,000 characters: a paste is refused whole.
test('a paste past the longest note is refused whole, and the pane says why', async ($, on) => {
  mock.clock(on, { now: NOW })
  const store = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount(NOTES_PANE)
  await pane.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'note-global-s1' })
  await pane.key({ key: 'pain', in: 'note-global-s1' })
  await pane.key({ key: 'x'.repeat(95_000), in: 'note-global-s1' })
  expect(store.get('notes.global')).toEqual({ text: 'pain', updatedAt: NOW })
  expect(await pane.find({ type: 'Text', text: /pain/, in: 'note-global-s1' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /note trop longue \(95 000 caractères au plus\)/ })).toBeDefined()
  // Within the limit again: saved, the warning gone.
  await pane.key({ key: ' lait', in: 'note-global-s1' })
  expect(store.get('notes.global')).toEqual({ text: 'pain lait', updatedAt: NOW })
  expect(await pane.find({ type: 'Text', text: /non enregistré/ })).toBeUndefined()
  await pane.unmount()
})

// Other sessions' notes, of 90,000 characters at most as the editor writes
// them, leaving between 600 and 660 bytes of room in the store; `old0`, the
// latest, listed first.
function nearlyFull(): Record<string, unknown> {
  const stored: Record<string, unknown> = {}
  // The store's braces, two bytes.
  let left = STORE_MAX_BYTES - 600 - 2
  for (let index = 0; ; index++) {
    const key = `notes.session.old${index}`
    const updatedAt = NOW - 1000 - index
    const overhead = entryBytes(key, { text: '', updatedAt })
    if (left <= overhead) return stored
    const note = { text: 'x'.repeat(Math.min(90_000, left - overhead)), updatedAt }
    stored[key] = note
    left -= entryBytes(key, note)
  }
}

// The store near its limit: the editor refuses, as it is typed, what the room
// left may not hold, and says why; a shortening always passes.
test('typing past the store room is refused as typed, until room is made', async ($, on) => {
  mock.clock(on, { now: NOW })
  const store = engine(on, { stored: nearlyFull() })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount(NOTES_PANE)
  await pane.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'note-global-s1' })
  await pane.key({ key: 'pain', in: 'note-global-s1' })
  expect(store.get('notes.global')).toEqual({ text: 'pain', updatedAt: NOW })

  // 600 bytes, less the note's own, hold some 80 characters: 100 refused whole.
  await pane.key({ key: 'y'.repeat(100), in: 'note-global-s1' })
  expect(store.get('notes.global')).toEqual({ text: 'pain', updatedAt: NOW })
  expect(await pane.find({ type: 'Text', text: /yyy/, in: 'note-global-s1' })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: "store presque plein : supprimez d'anciennes notes" })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /note trop longue/ })).toBeUndefined()

  // Said with that note alone.
  await click(pane, 'notes:tab-project')
  expect(await pane.find({ type: 'Text', text: /non enregistré/ })).toBeUndefined()
  await click(pane, 'notes:tab-global')
  expect(await pane.find({ type: 'Text', text: '⚠ non enregistré' })).toBeDefined()

  // A shortening passes, and clears the warning.
  await pane.pointer({ type: 'down', x: 4, y: 0, button: 'left', in: 'note-global-s1' })
  await pane.key({ key: 'backspace', in: 'note-global-s1' })
  expect(store.get('notes.global')).toEqual({ text: 'pai', updatedAt: NOW })
  expect(await pane.find({ type: 'Text', text: /non enregistré/ })).toBeUndefined()

  // Another note deleted from here: typing passes again.
  await click(pane, 'notes:tab-session')
  await click(pane, 'notes:session-old0')
  await click(pane, 'notes:delete')
  expect(store.get('notes.session.old0')).toBeUndefined()
  await click(pane, 'notes:tab-global')
  await pane.pointer({ type: 'down', x: 3, y: 0, button: 'left', in: 'note-global-s1' })
  await pane.key({ key: 'y'.repeat(100), in: 'note-global-s1' })
  expect(store.get('notes.global')).toEqual({ text: `pai${'y'.repeat(100)}`, updatedAt: NOW })
  expect(await pane.find({ type: 'Text', text: /non enregistré/ })).toBeUndefined()
  await pane.unmount()
})

// Room made by another session: seen within a poll of the open pane, the
// editor left open taking the new limit.
test('room another session makes lets typing go on, the editor left open', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const store = engine(on, { stored: nearlyFull() })
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount(BAND)
  await click(band, 'notes')
  await band.unmount()
  const pane = await $.ui.mount(NOTES_PANE)
  await pane.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'note-global-s1' })
  await pane.key({ key: 'y'.repeat(100), in: 'note-global-s1' })
  expect(store.get('notes.global')).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /store presque plein/ })).toBeDefined()

  store.delete('notes.session.old0')
  await clock.advance(1000)
  await pane.key({ key: 'y'.repeat(100), in: 'note-global-s1' })
  expect(store.get('notes.global')).toEqual({ text: 'y'.repeat(100), updatedAt: NOW + 1000 })
  expect(await pane.find({ type: 'Text', text: /non enregistré/ })).toBeUndefined()
  await pane.unmount()
})

// A save refused at the last guard says so with its note alone, and another
// note's save leaves the warning.
test("a refused save is said with its note, another note's save leaving it", async ($, on) => {
  mock.clock(on, { now: NOW })
  const refused = new Set<string>()
  engine(on, { refused })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount(NOTES_PANE)
  refused.add('store.set')
  await pane.post({ tab: 'global', session: 's1', text: 'pain' }, { in: 'note-global-s1' })
  expect(await pane.find({ type: 'Text', text: '⚠ non enregistré' })).toBeDefined()
  refused.clear()
  await click(pane, 'notes:tab-project')
  expect(await pane.find({ type: 'Text', text: /non enregistré/ })).toBeUndefined()
  await pane.post({ tab: 'project', session: 's1', text: 'migrer' }, { in: 'note-project-s1' })
  await click(pane, 'notes:tab-global')
  expect(await pane.find({ type: 'Text', text: '⚠ non enregistré' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /store over 4 MiB/ })).toBeDefined()
  await pane.unmount()
})

// A note longer than a Client takes, written before notes had a limit or by
// another copy of dx: the pane still draws, its row in the list cut to the
// pane, the note kept as stored with a message in place of the editor, and
// another session's note still deleted from there.
test('a note too long for the editor keeps the pane drawn, and is kept as stored', async ($, on) => {
  mock.clock(on, { now: NOW })
  const long = { text: 'z'.repeat(150_000), updatedAt: NOW - 1000 }
  const store = engine(on, { stored: { notesTab: 'session', 'notes.session.old': long, 'notes.global': long } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount(NOTES_PANE)
  const row = await pane.find({ key: 'notes:session-old' })
  expect(JSON.stringify(row).length).toBeLessThan(1000)

  await click(pane, 'notes:session-old')
  expect(await pane.find({ key: 'note-session-old' })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /Note trop longue pour être modifiée ici \(150 000 caractères\)/ })).toBeDefined()
  expect(store.get('notes.session.old')).toEqual(long)
  await click(pane, 'notes:delete')
  expect(store.get('notes.session.old')).toBeUndefined()

  await click(pane, 'notes:tab-global')
  expect(await pane.find({ key: 'note-global-s1' })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /Note trop longue/ })).toBeDefined()
  expect(store.get('notes.global')).toEqual(long)
  await pane.unmount()
})
