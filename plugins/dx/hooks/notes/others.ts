import type { Note, Notes } from '../../types'

// The list of the other sessions' notes under the session tab of ./notes.

// The other sessions' notes, latest first.
export function othersOf(value: Notes): [string, Note][] {
  return Object.entries(value.sessions)
    .filter(([id]) => id !== value.session)
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
}

// The widest a row's label may be, whatever width the engine reports: wider
// than any terminal, far under the 100,000 characters a Client's props take.
const LABEL_MAX = 1000

// What a row of the list shows of a note: its first line, cut to `columns`
// characters, more than the row can show (each takes a column or more). The
// label is a Client's prop, which a whole line could take past its limit.
export function firstLine(text: string, columns: number): string {
  const end = text.indexOf('\n')
  const line = end < 0 ? text : text.slice(0, end)
  const width = Math.max(0, Math.min(Math.floor(columns), LABEL_MAX))
  // A character is one or two UTF-16 units: cut first, then counted, so that
  // a pair is never split.
  return Array.from(line.slice(0, width * 2)).slice(0, width).join('')
}

// The first of `count` notes listed, `shown` rows at a time from `at`: kept
// within the list, its last row at the window's last.
export function othersStart(at: number, count: number, shown: number): number {
  return Math.max(0, Math.min(at, count - shown))
}
