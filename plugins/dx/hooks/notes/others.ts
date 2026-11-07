import type { Note, Notes } from '../../types'

// The list of the other sessions' notes under the session tab of ./notes.

// The other sessions' notes, latest first.
export function othersOf(value: Notes): [string, Note][] {
  return Object.entries(value.sessions)
    .filter(([id]) => id !== value.session)
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
}

// The first of `count` notes listed, `shown` rows at a time from `at`: kept
// within the list, its last row at the window's last.
export function othersStart(at: number, count: number, shown: number): number {
  return Math.max(0, Math.min(at, count - shown))
}
