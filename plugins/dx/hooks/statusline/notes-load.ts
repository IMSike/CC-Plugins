import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Note, Notes, NotesView } from '../../types'

// The notes as ./notes draws them, loaded from `$.store` when the session
// starts, and again when their pane is shown, a note is written or a prompt
// sent while they are not loaded, or loaded for another session id: a `/clear`
// may empty dx's state, and goes on under a new id with no `session.start`.
const notes = atom({ plugin: 'dx', key: 'notes' } as const, null as Notes | null, { shape: 'notes-2' })
// Why the last load failed, shown in the pane in place of the notes.
const notesError = atom({ plugin: 'dx', key: 'notesError' } as const, null as string | null, { shape: 'notes-error-1' })
// The tab shown, which a `/clear` empties too: shown again after it.
const notesView = atom({ plugin: 'dx', key: 'notesView' } as const, { tab: 'global' } as NotesView, { shape: 'notes-view-1' })

export const GLOBAL_KEY = 'notes.global'
export const PROJECT_PREFIX = 'notes.project.'
export const SESSION_PREFIX = 'notes.session.'
// A session id a `/clear` gave, to the session it goes on: its note's key.
const LINK_PREFIX = 'notes.link.'
// The session a `/clear` ended, when, and the tab it left, for the next load.
const CLEARED_KEY = 'notes.cleared'
// How far the session's new start may be from the `/clear` it follows.
const CLEAR_MS = 10_000

type Cleared = { from: string; at: number; view?: NotesView }

function isView(value: unknown): value is NotesView {
  const view = value as Partial<NotesView> | undefined
  return (view?.tab === 'global' || view?.tab === 'project' || view?.tab === 'session') && (view.other === undefined || typeof view.other === 'string')
}

export function noteOf(stored: unknown): Note | null {
  const value = stored as Partial<Note> | undefined
  return typeof value?.text === 'string' && value.text !== '' && typeof value.updatedAt === 'number'
    ? { text: value.text, updatedAt: value.updatedAt }
    : null
}

// The `/clear` the engine's session `id` follows: one that ended another
// session as this one's clock started over, which tells this process's from
// another session started meanwhile.
async function clearedFor($: EngineInterface, id: string): Promise<Cleared | undefined> {
  const cleared = (await $.store.get(CLEARED_KEY).catch(() => undefined)) as Partial<Cleared> | undefined
  if (typeof cleared?.from !== 'string' || typeof cleared.at !== 'number' || cleared.from === id) return undefined
  const startedAt = await $.session.usage().then(usage => usage.startedAt, () => undefined)
  if (startedAt === undefined || Math.abs(startedAt - cleared.at) > CLEAR_MS) return undefined
  return { from: cleared.from, at: cleared.at, view: isView(cleared.view) ? cleared.view : undefined }
}

// The session whose note the engine's session `id` shows: the one a `/clear`
// went on from, linked at the first load after it, which shows again the tab
// the `/clear` left. Unkept, the link is made by the next load.
async function sessionOf($: EngineInterface, id: string, keep: boolean): Promise<string> {
  const linked = await $.store.get(LINK_PREFIX + id).catch(() => undefined)
  if (typeof linked === 'string') return linked
  const cleared = await clearedFor($, id)
  if (cleared === undefined) return id
  if (!keep) return cleared.from
  if (cleared.view !== undefined) await update($, notesView, () => cleared.view as NotesView)
  await $.store.set(LINK_PREFIX + id, cleared.from).catch(() => undefined)
  await $.store.delete(CLEARED_KEY).catch(() => undefined)
  return cleared.from
}

// The tab a `/clear` left, while the session it went on from is not linked:
// a render, which may not write, draws it in place of the emptied one.
export async function clearedView($: EngineInterface): Promise<NotesView | undefined> {
  const id = await $.session.id().catch(() => undefined)
  if (id === undefined || typeof (await $.store.get(LINK_PREFIX + id).catch(() => undefined)) === 'string') return undefined
  return (await clearedFor($, id))?.view
}

// Every note, this session's included when the session is a resumed one.
// `keep`: the link a `/clear` makes kept, which a render may not write.
export async function readNotes($: EngineInterface, keep = true): Promise<Notes> {
  const [root, id, keys] = await Promise.all([
    $.session.root(),
    $.session.id(),
    $.store.keys().catch(() => [] as string[]),
  ])
  const session = await sessionOf($, id, keep)
  const get = (key: string) => $.store.get(key).then(noteOf).catch(() => null)
  const sessions: Record<string, Note> = {}
  for (const key of keys.filter(one => one.startsWith(SESSION_PREFIX))) {
    const note = await get(key)
    if (note !== null) sessions[key.slice(SESSION_PREFIX.length)] = note
  }
  return { global: await get(GLOBAL_KEY), project: await get(PROJECT_PREFIX + root), sessions, root, session, id }
}

// Loads the notes. A failure is kept for the pane to show and written to the
// debug log, never thrown: the pane loads them again when shown.
export async function tryNotes($: EngineInterface): Promise<void> {
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
  if (value === null) {
    if (retry || (await read($, notesError)) === null) await tryNotes($)
    return
  }
  const id = await $.session.id().catch(() => value.id)
  if (id !== value.id) await tryNotes($)
}

// At a `/clear`, the session it ends and the tab shown, for the next load to
// go on with them.
export async function noteClear($: EngineInterface, ending: string): Promise<void> {
  const value = await read($, notes).catch(() => null)
  // Not loaded since an earlier `/clear`: the session that one went on from,
  // its marker still found, the ending session's clock not started over yet.
  const from = value?.id === ending ? value.session : await sessionOf($, ending, false)
  const view = await read($, notesView).catch(() => undefined)
  const at = await $.clock.now()
  await $.store.set(CLEARED_KEY, { from, at, view } satisfies Cleared).catch(() => undefined)
}
