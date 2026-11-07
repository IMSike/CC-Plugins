import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Note, Notes, NoteTab, NotesView } from '../../types'
import { forgetStoreSize } from './store-size'

// The notes as ./notes draws them, loaded from `$.store` when the session
// starts, and again when their pane is shown, a note is written or a prompt
// sent while they are not loaded, or loaded for another session id: a `/clear`
// may empty dx's state, and goes on under a new id with no `session.start`.
const notes = atom({ plugin: 'dx', key: 'notes' } as const, null as Notes | null, { shape: 'notes-2' })
// Why the last load failed, shown in the pane in place of the notes.
const notesError = atom({ plugin: 'dx', key: 'notesError' } as const, null as string | null, { shape: 'notes-error-1' })
// The tab shown, which a `/clear` empties too: shown again after it.
const notesView = atom({ plugin: 'dx', key: 'notesView' } as const, { tab: 'global' } as NotesView, { shape: 'notes-view-1' })

const GLOBAL_KEY = 'notes.global'
const PROJECT_PREFIX = 'notes.project.'
const SESSION_PREFIX = 'notes.session.'
// A session id a `/clear` gave, to the session it goes on: its note's key.
const LINK_PREFIX = 'notes.link.'
// The `/clear` this process went through, until the next load links the new
// session id: the session it ended, the one whose note it goes on with, and
// the tab it left. Kept in the hooks module's memory, which a `/clear` leaves
// (the process goes on, no `session.start` fires), never in the store, which
// every session reads: one launched meanwhile would take it for its own.
type Cleared = { ending: string; from: string; view?: NotesView }
let cleared: Cleared | undefined

export function noteOf(stored: unknown): Note | null {
  const value = stored as Partial<Note> | undefined
  return typeof value?.text === 'string' && value.text !== '' && typeof value.updatedAt === 'number'
    ? { text: value.text, updatedAt: value.updatedAt }
    : null
}

// Where a note is kept.
export function keyOf(value: Notes, tab: NoteTab, session: string): string {
  return tab === 'global' ? GLOBAL_KEY : tab === 'project' ? PROJECT_PREFIX + value.root : SESSION_PREFIX + session
}

// The note `view` shows: the session whose note the session tab holds (another
// one's, or this one's), and the note's key.
export function shownNote(value: Notes, view: NotesView): { session: string; key: string } {
  const session = (view.tab === 'session' ? view.other : undefined) ?? value.session
  return { session, key: keyOf(value, view.tab, session) }
}

// Whether the notes are to be read again: not loaded (after a failed load,
// only on a `retry`), or loaded for another session id than the engine's `id`.
export function needsLoad(value: Notes | null, error: string | null, id: string | undefined, retry: boolean): boolean {
  return value === null ? retry || error === null : id !== value.id
}

// The `/clear` the engine's session `id` follows: this process's last one,
// when it ended another session.
function clearedFor(id: string): Cleared | undefined {
  return cleared?.ending === id ? undefined : cleared
}

// A `session.start`: a fresh load of the plugin, never a `/clear`, so nothing
// remembered goes on into it.
export function forgetClear(): void {
  cleared = undefined
}

// The session whose note the engine's session `id` shows: the one a `/clear`
// went on from, linked at the first load after it, which shows again the tab
// the `/clear` left. Unkept, the link is made by the next load.
async function sessionOf($: EngineInterface, id: string, keep: boolean): Promise<string> {
  const linked = await $.store.get(LINK_PREFIX + id).catch(() => undefined)
  if (typeof linked === 'string') return linked
  const last = clearedFor(id)
  if (last === undefined) return id
  if (!keep) return last.from
  if (last.view !== undefined) await update($, notesView, () => last.view as NotesView)
  await $.store.set(LINK_PREFIX + id, last.from).catch(() => undefined)
  if (cleared === last) cleared = undefined
  return last.from
}

// The tab a `/clear` left, while the session it went on from is not linked:
// a render, which may not write, draws it in place of the emptied one.
export async function clearedView($: EngineInterface): Promise<NotesView | undefined> {
  const id = await $.session.id().catch(() => undefined)
  if (id === undefined || typeof (await $.store.get(LINK_PREFIX + id).catch(() => undefined)) === 'string') return undefined
  return clearedFor(id)?.view
}

// Every note: the global one, the project's, and every session's.
// `keep`: the link a `/clear` makes kept, which a render may not write.
export async function readNotes($: EngineInterface, keep = true): Promise<Notes> {
  const [root, id, keys] = await Promise.all([
    $.session.root(),
    $.session.id(),
    $.store.keys().catch(() => [] as string[]),
  ])
  const session = await sessionOf($, id, keep)
  const get = (key: string) => $.store.get(key).then(noteOf).catch(() => null)
  const sessionKeys = keys.filter(one => one.startsWith(SESSION_PREFIX))
  // Every key at once: one store round trip's wait, not one per note.
  const [global, project, sessionNotes] = await Promise.all([
    get(GLOBAL_KEY),
    get(PROJECT_PREFIX + root),
    Promise.all(sessionKeys.map(get)),
  ])
  const sessions: Record<string, Note> = {}
  sessionKeys.forEach((key, index) => {
    const note = sessionNotes[index]
    if (note !== undefined && note !== null) sessions[key.slice(SESSION_PREFIX.length)] = note
  })
  return { global, project, sessions, root, session, id }
}

// Loads the notes. A failure is kept for the pane to show and written to the
// debug log, never thrown: the pane loads them again when shown.
export async function tryNotes($: EngineInterface): Promise<void> {
  // Other sessions wrote meanwhile: the store's size measured again.
  forgetStoreSize()
  try {
    const value = await readNotes($)
    await update($, notes, () => value)
    await update($, notesError, () => null)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    $.ui.log(`dx : notes non chargées (${reason})`, { to: 'debug' })
    await update($, notesError, () => reason).catch(() => undefined)
  }
}

// The notes loaded again when they are not, or were for another session id:
// `retry`, after a failed load too, else only when the pane's retry asks.
export async function ensureNotes($: EngineInterface, retry = true): Promise<void> {
  const value = await read($, notes)
  const error = value === null && !retry ? await read($, notesError) : null
  const id = value === null ? undefined : await $.session.id().catch(() => value.id)
  if (needsLoad(value, error, id, retry)) await tryNotes($)
}

// At a `/clear`, the session it ends and the tab shown, for the next load to
// go on with them.
export async function noteClear($: EngineInterface, ending: string): Promise<void> {
  const value = await read($, notes).catch(() => null)
  // Not loaded since an earlier `/clear`: the session that one went on from.
  const from = value?.id === ending ? value.session : await sessionOf($, ending, false)
  const view = await read($, notesView).catch(() => undefined)
  cleared = { ending, from, view }
}
