import type { NotesUnsaved, NoteTab } from '../../types'
import { NOTE_TABS } from '../shared/options'

// What ./notes reads without the engine: the tabs it knows, and which note a
// failed save is said with.

// Whether `value` names one of the notes' tabs (NOTE_TABS).
export function isTab(value: unknown): value is NoteTab {
  return NOTE_TABS.some(([tab]) => tab === value)
}

// Why the note under `key` is not saved, from `notesUnsaved`, or null: a
// reason kept for an unknown key (null) stands for any note.
export function unsavedFor(value: NotesUnsaved | null, key: string): string | null {
  return value !== null && (value.key === key || value.key === null) ? value.reason : null
}
