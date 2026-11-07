import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Note, Notes } from '../../types'

// The notes as ./notes draws them, loaded from `$.store` when the session
// starts, and again when their pane is shown after a failed load: ./panes
// asks for that before it shows them, with no `ui.open` on a switch.
const notes = atom({ plugin: 'dx', key: 'notes' } as const, null as Notes | null, { shape: 'notes-1' })
// Why the last load failed, shown in the pane in place of the notes.
const notesError = atom({ plugin: 'dx', key: 'notesError' } as const, null as string | null, { shape: 'notes-error-1' })

export const GLOBAL_KEY = 'notes.global'
export const PROJECT_PREFIX = 'notes.project.'
export const SESSION_PREFIX = 'notes.session.'

export function noteOf(stored: unknown): Note | null {
  const value = stored as Partial<Note> | undefined
  return typeof value?.text === 'string' && value.text !== '' && typeof value.updatedAt === 'number'
    ? { text: value.text, updatedAt: value.updatedAt }
    : null
}

// Every note, this session's included when the session is a resumed one.
async function readNotes($: EngineInterface): Promise<Notes> {
  const [root, session, keys] = await Promise.all([
    $.session.root(),
    $.session.id(),
    $.store.keys().catch(() => [] as string[]),
  ])
  const get = (key: string) => $.store.get(key).then(noteOf).catch(() => null)
  const sessions: Record<string, Note> = {}
  for (const key of keys.filter(one => one.startsWith(SESSION_PREFIX))) {
    const note = await get(key)
    if (note !== null) sessions[key.slice(SESSION_PREFIX.length)] = note
  }
  return { global: await get(GLOBAL_KEY), project: await get(PROJECT_PREFIX + root), sessions, root, session }
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

// The notes loaded again when they are not, before their pane is shown.
export async function ensureNotes($: EngineInterface): Promise<void> {
  if ((await read($, notes)) === null) await tryNotes($)
}
