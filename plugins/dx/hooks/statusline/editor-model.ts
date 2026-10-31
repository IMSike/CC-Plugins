// The notes editor's model: a text, a cursor in it, and the first visual row
// shown. Lines wrap at the editor's width; the cursor moves over the visual
// rows, as in a plain notepad.

export type Editor = { text: string; cursor: number; top: number }

// A visual row: `text.slice(start, end)`, its line's newline left out.
export type Row = { start: number; end: number }

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
  let next: Editor
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
      next = cursor === text.length ? editor : { ...editor, text: text.slice(0, cursor) + text.slice(cursor + 1) }
      break
    case 'left':
      next = { ...editor, cursor: Math.max(0, cursor - 1) }
      break
    case 'right':
      next = { ...editor, cursor: Math.min(text.length, cursor + 1) }
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
