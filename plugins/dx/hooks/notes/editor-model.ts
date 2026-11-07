// The notes editor's model: a text, a cursor in it, and the first visual row
// shown. Lines wrap at the editor's width; the cursor moves over the visual
// rows, as in a plain notepad. Last, how ./editor takes in the text the hooks
// draw again.

export type Editor = { text: string; cursor: number; top: number }

// The longest note: the editor's props, the text and a few fields, stay
// under the 100,000 characters a Client's props may take, and so do its
// posts to the hooks module, as long as few of its characters are escaped
// once serialized (a line break or a quote counts two: see fitsEditor).
export const NOTE_MAX_CHARS = 95_000
// The most a Client's props may take, serialized as JSON.
const CLIENT_PROPS_MAX = 100_000

// A count as the pane writes it, its thousands set apart by a space.
export function thousands(count: number): string {
  return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}
export const NOTE_MAX_SHOWN = thousands(NOTE_MAX_CHARS)

// Whether the editor can take `props`: a note longer than NOTE_MAX_CHARS
// (stored before notes had a limit, or by another copy of dx), or one whose
// line breaks and quotes take it past the limit once serialized, cannot.
export function fitsEditor(props: unknown): boolean {
  return JSON.stringify(props).length <= CLIENT_PROPS_MAX
}

// Why an edit is not applied: the note past NOTE_MAX_CHARS, or past what the
// store's room left holds (`max`, which the hooks module gives).
export type Refusal = 'too-long' | 'store-full'

// Why going from `before` to `after` is refused, or undefined: past `max`
// characters, NOTE_MAX_CHARS at the most, an edit that lengthens the note is
// not applied, a paste whole rather than cut. A note already longer may still
// be shortened. Past NOTE_MAX_CHARS, the note is too long whatever the room.
export function refusalOf(before: string, after: string, max: number): Refusal | undefined {
  if (after.length <= before.length) return undefined
  if (after.length > NOTE_MAX_CHARS) return 'too-long'
  return after.length > max ? 'store-full' : undefined
}

// A visual row: `text.slice(start, end)`, its line's newline left out.
type Row = { start: number; end: number }

// Key names the terminal gives for keys that type nothing here (the others
// are handled below); a function key is `f1`, `f2`...
const NAMED = new Set([
  'up', 'down', 'left', 'right', 'return', 'enter', 'tab', 'backspace', 'delete',
  'pageup', 'pagedown', 'home', 'end', 'escape', 'insert', 'clear',
  'wheelup', 'wheeldown', 'capslock', 'numlock', 'scrolllock', 'printscreen', 'pause', 'menu',
])
const FUNCTION_KEY = /^f\d{1,2}$/
// A letter or digit held with ctrl or alt is a shortcut; another character
// is typed (AltGr's `@` or `€` may come with them).
const SHORTCUT = /^[a-z0-9]$/i

type Key = { key: string; ctrl?: true; shift?: true; meta?: true }

// What a key types, or undefined for a name or a shortcut.
function typed(event: Key): string | undefined {
  const { key } = event
  if (key === 'space') return ' '
  if (key === '' || NAMED.has(key) || FUNCTION_KEY.test(key)) return undefined
  if ((event.ctrl || event.meta) && SHORTCUT.test(key)) return undefined
  // Some terminals report a shifted letter in lower case, with shift.
  if (event.shift && /^[a-z]$/.test(key)) return key.toUpperCase()
  return key.replace(/\r\n?/g, '\n')
}

// What a character is to a move by words: a word's letter, digit or `_`, a
// space, a line break, or punctuation, a word of its own.
type CharClass = 'word' | 'space' | 'line' | 'mark'
const WORD_CHAR = /[\p{L}\p{N}_]/u

function classOf(char: string): CharClass {
  if (char === '\n') return 'line'
  if (/\s/.test(char)) return 'space'
  return WORD_CHAR.test(char) ? 'word' : 'mark'
}

// Where ctrl+left lands from `cursor`, as in a text editor: over the spaces,
// then to the start of the word; a line break stops it, at the line's start,
// or, right after it, at the end of the line above.
function wordLeft(text: string, cursor: number): number {
  let at = cursor
  while (at > 0 && classOf(text.charAt(at - 1)) === 'space') at--
  if (at === 0) return 0
  const kind = classOf(text.charAt(at - 1))
  if (kind === 'line') return at === cursor ? at - 1 : at
  while (at > 0 && classOf(text.charAt(at - 1)) === kind) at--
  return at
}

// Where ctrl+right lands from `cursor`: over the spaces, then to the end of
// the word; a line break stops it, as for wordLeft.
function wordRight(text: string, cursor: number): number {
  let at = cursor
  while (at < text.length && classOf(text.charAt(at)) === 'space') at++
  if (at === text.length) return at
  const kind = classOf(text.charAt(at))
  if (kind === 'line') return at === cursor ? at + 1 : at
  while (at < text.length && classOf(text.charAt(at)) === kind) at++
  return at
}

// The text's visual rows at `width`. A line exactly as long as a multiple of
// the width gets an empty row after it, where its end's cursor stands.
export function rowsOf(text: string, width: number): Row[] {
  const cells = Math.max(1, Math.floor(width))
  const rows: Row[] = []
  let start = 0
  for (const line of text.split('\n')) {
    for (let at = 0; at < line.length; at += cells) {
      rows.push({ start: start + at, end: start + Math.min(at + cells, line.length) })
    }
    if (line.length % cells === 0) rows.push({ start: start + line.length, end: start + line.length })
    start += line.length + 1
  }
  return rows
}

// The row the cursor stands on: the last that starts at or before it.
export function rowOf(rows: readonly Row[], cursor: number): number {
  let found = 0
  rows.forEach((row, index) => {
    if (row.start <= cursor) found = index
  })
  return found
}

// `top` moved so that the cursor's row is among the `height` rows shown.
function scrolled(editor: Editor, width: number, height: number): Editor {
  const row = rowOf(rowsOf(editor.text, width), editor.cursor)
  const shown = Math.max(1, height)
  const top = row < editor.top ? row : row >= editor.top + shown ? row - shown + 1 : editor.top
  return top === editor.top ? editor : { ...editor, top }
}

function insert(editor: Editor, typed: string): Editor {
  const { text, cursor } = editor
  return { ...editor, text: text.slice(0, cursor) + typed + text.slice(cursor), cursor: cursor + typed.length }
}

// The cursor on row `target`, at the column it had on its own row.
function toRow(editor: Editor, rows: readonly Row[], target: number): Editor {
  const from = rows[rowOf(rows, editor.cursor)]
  const to = rows[Math.max(0, Math.min(rows.length - 1, target))]
  if (from === undefined || to === undefined) return editor
  return { ...editor, cursor: Math.min(to.start + (editor.cursor - from.start), to.end) }
}

// The editor after one key; the same object when the key changes nothing.
export function keyed(
  editor: Editor,
  event: Key,
  width: number,
  height: number,
): Editor {
  const { text, cursor } = editor
  const rows = rowsOf(text, width)
  const row = rows[rowOf(rows, cursor)] ?? { start: 0, end: 0 }
  // A word at a time: with ctrl.
  const byWord = event.ctrl === true
  let next: Editor
  if (event.key === 'backspace' && byWord) {
    const from = wordLeft(text, cursor)
    next = { ...editor, text: text.slice(0, from) + text.slice(cursor), cursor: from }
    return next.text === text ? editor : scrolled(next, width, height)
  }
  switch (event.key) {
    case 'return':
    case 'enter':
      next = insert(editor, '\n')
      break
    case 'tab':
      next = insert(editor, '  ')
      break
    case 'backspace':
      next = cursor === 0 ? editor : { ...editor, text: text.slice(0, cursor - 1) + text.slice(cursor), cursor: cursor - 1 }
      break
    case 'delete':
      next = cursor === text.length ? editor : { ...editor, text: text.slice(0, cursor) + text.slice(byWord ? wordRight(text, cursor) : cursor + 1) }
      break
    case 'left':
      next = { ...editor, cursor: byWord ? wordLeft(text, cursor) : Math.max(0, cursor - 1) }
      break
    case 'right':
      next = { ...editor, cursor: byWord ? wordRight(text, cursor) : Math.min(text.length, cursor + 1) }
      break
    case 'up':
      next = toRow(editor, rows, rowOf(rows, cursor) - 1)
      break
    case 'down':
      next = toRow(editor, rows, rowOf(rows, cursor) + 1)
      break
    case 'pageup':
      next = toRow(editor, rows, rowOf(rows, cursor) - Math.max(1, height - 1))
      break
    case 'pagedown':
      next = toRow(editor, rows, rowOf(rows, cursor) + Math.max(1, height - 1))
      break
    case 'home':
      next = { ...editor, cursor: row.start }
      break
    case 'end':
      next = { ...editor, cursor: row.end }
      break
    default: {
      // A character, or a pasted text; a shortcut or another named key does nothing.
      const text = typed(event)
      if (text === undefined) return editor
      next = insert(editor, text)
    }
  }
  if (next.text === text && next.cursor === cursor) return editor
  return scrolled(next, width, height)
}

// The cursor where the person clicked, in the editor's cells.
export function clicked(editor: Editor, x: number, y: number, width: number): Editor {
  const rows = rowsOf(editor.text, width)
  const row = rows[Math.max(0, Math.min(rows.length - 1, editor.top + y))]
  if (row === undefined) return editor
  return { ...editor, cursor: Math.min(row.start + Math.max(0, x), row.end) }
}

// The editor as its surface keeps it: whether it has the keyboard; `given`,
// the text the hooks last drew; `sent`, the texts posted since, not drawn
// back yet.
export type EditorState = Editor & { active: boolean; given: string; sent: string[] }

// The text the hooks drew, taken in: the one shown, every post landed; one
// this editor posted, drawn back late, the keys since standing; any other,
// another session's, shown in place of this one's, the cursor kept within.
export function drawn(state: EditorState, text: string): EditorState {
  if (text === state.given) return state
  if (text === state.text) return { ...state, given: text, sent: [] }
  const echoed = state.sent.lastIndexOf(text)
  if (echoed >= 0) return { ...state, given: text, sent: state.sent.slice(echoed + 1) }
  const cursor = Math.min(state.cursor, text.length)
  return { ...state, text, cursor, top: Math.min(state.top, text.slice(0, cursor).split('\n').length - 1), given: text, sent: [] }
}
