import { expect, test } from 'claude-code/testing'

import { cleanPaste, clicked, drawn, encodedLength, fitsEditor, keyed, NOTE_MAX_CHARS, NOTE_MAX_SHOWN, pasted, pointed, refusalOf, rowRuns, selectedText, thousands } from './editor-model'
import type { Editor } from './editor-model'
import { rowsOf } from './wrap'

const at = (text: string, cursor = text.length, top = 0): Editor => ({ text, cursor, top })

test('keyed types, breaks lines and erases', () => {
  expect(keyed(at('ab', 1), { key: 'x' }, 10, 5)).toEqual(at('axb', 2))
  expect(keyed(at('ab'), { key: 'return' }, 10, 5)).toEqual(at('ab\n'))
  expect(keyed(at('ab'), { key: 'backspace' }, 10, 5)).toEqual(at('a'))
  expect(keyed(at('ab', 0), { key: 'delete' }, 10, 5)).toEqual(at('b', 0))
})

test('keyed types the characters named keys stand for, and nothing for the others', () => {
  expect(keyed(at('a'), { key: 'space' }, 10, 5)).toEqual(at('a '))
  expect(keyed(at('a'), { key: 'b', shift: true }, 10, 5)).toEqual(at('aB'))
  // AltGr's characters may come with ctrl and alt.
  expect(keyed(at('a'), { key: '@', ctrl: true, meta: true }, 10, 5)).toEqual(at('a@'))
  const editor = at('a')
  for (const key of ['insert', 'clear', 'f1', 'f12', 'wheelup', 'wheeldown', 'capslock']) {
    expect(keyed(editor, { key }, 10, 5)).toBe(editor)
  }
})

test('keyed leaves the editor alone for shortcuts and dead ends', () => {
  const editor = at('ab', 0)
  expect(keyed(editor, { key: 'c', ctrl: true }, 10, 5)).toBe(editor)
  expect(keyed(editor, { key: 'backspace' }, 10, 5)).toBe(editor)
  expect(keyed(editor, { key: 'left' }, 10, 5)).toBe(editor)
  expect(keyed(editor, { key: 'escape' }, 10, 5)).toBe(editor)
})

test('keyed moves over visual rows and scrolls to the cursor', () => {
  // Rows: 'abcd' 'ef' 'gh'.
  const text = 'abcdef\ngh'
  expect(keyed(at(text, 1), { key: 'down' }, 4, 5).cursor).toBe(5)
  expect(keyed(at(text, 3), { key: 'down' }, 4, 5).cursor).toBe(6)
  expect(keyed(at(text, 8), { key: 'up' }, 4, 5).cursor).toBe(5)
  expect(keyed(at(text, 5), { key: 'home' }, 4, 5).cursor).toBe(4)
  expect(keyed(at(text, 7), { key: 'end' }, 4, 5).cursor).toBe(9)
  // Two rows shown: going down to the third scrolls by one.
  expect(keyed(at(text, 5), { key: 'down' }, 4, 2)).toEqual(at(text, 8, 1))
  expect(keyed(at(text, 5, 1), { key: 'up' }, 4, 2)).toEqual(at(text, 1, 0))
})

test('clicked puts the cursor under the pointer', () => {
  const text = 'abcdef\ngh'
  expect(clicked(at(text, 0), 1, 1, 4).cursor).toBe(5)
  // Past a row's end: at its end.
  expect(clicked(at(text, 0), 9, 2, 4).cursor).toBe(9)
  // Below the last row: on it.
  expect(clicked(at(text, 0), 0, 7, 4).cursor).toBe(7)
  expect(clicked(at(text, 0, 1), 0, 0, 4).cursor).toBe(4)
})

test('ctrl with the arrows moves a word at a time, as a text editor', () => {
  const text = 'un deux, trois\n  quatre'
  const left = (cursor: number) => keyed(at(text, cursor), { key: 'left', ctrl: true }, 40, 5).cursor
  const right = (cursor: number) => keyed(at(text, cursor), { key: 'right', ctrl: true }, 40, 5).cursor
  // To the start of the word, over the spaces before it.
  expect(left(7)).toBe(3)
  expect(left(9)).toBe(7)
  expect(left(3)).toBe(0)
  // A line break stops it: the start of the line, then the end of the one above.
  expect(left(17)).toBe(15)
  expect(left(15)).toBe(14)
  // Alt moves a character, as without it.
  expect(keyed(at(text, 7), { key: 'left', meta: true }, 40, 5).cursor).toBe(6)
  // To the end of the word, over the spaces before it; punctuation is a word of its own.
  expect(right(0)).toBe(2)
  expect(right(2)).toBe(7)
  expect(right(7)).toBe(8)
  expect(right(14)).toBe(15)
  expect(right(15)).toBe(23)
})

test('ctrl with backspace erases the word before the cursor, ctrl with delete the one after', () => {
  expect(keyed(at('un deux trois', 7), { key: 'backspace', ctrl: true }, 40, 5)).toEqual(at('un  trois', 3))
  expect(keyed(at('un deux  '), { key: 'backspace', ctrl: true }, 40, 5)).toEqual(at('un '))
  expect(keyed(at('un deux trois', 2), { key: 'delete', ctrl: true }, 40, 5)).toEqual(at('un trois', 2))
  // Only with ctrl: ctrl+h, ctrl+w and alt with backspace erase no word.
  expect(keyed(at('un deux'), { key: 'backspace', meta: true }, 40, 5)).toEqual(at('un deu'))
  for (const event of [{ key: 'h', ctrl: true }, { key: 'w', ctrl: true }] as const) {
    const editor = at('un deux')
    expect(keyed(editor, event, 40, 5)).toBe(editor)
  }
  const start = at('un', 0)
  expect(keyed(start, { key: 'backspace', ctrl: true }, 40, 5)).toBe(start)
})

test('an edit past 95,000 characters is refused, a shortening never', () => {
  const full = 'x'.repeat(NOTE_MAX_CHARS)
  expect(NOTE_MAX_CHARS).toBe(95_000)
  expect(refusalOf('', full, NOTE_MAX_CHARS)).toBeUndefined()
  expect(refusalOf(full, `${full}y`, NOTE_MAX_CHARS)).toBe('too-long')
  // A paste past the limit, refused whole.
  expect(refusalOf('abc', 'x'.repeat(NOTE_MAX_CHARS + 10), NOTE_MAX_CHARS)).toBe('too-long')
  // A note longer already, from elsewhere: shortened, never lengthened.
  expect(refusalOf(`${full}yz`, `${full}y`, NOTE_MAX_CHARS)).toBeUndefined()
  expect(refusalOf(`${full}y`, `${full}yz`, NOTE_MAX_CHARS)).toBe('too-long')
})

test('a note is counted as written in JSON, an escaped character taking more', () => {
  expect(encodedLength('')).toBe(0)
  expect(encodedLength('pain lait')).toBe(9)
  expect(encodedLength('éà€ß')).toBe(4)
  // A quote, a backslash, a line break, a tab, a carriage return, a
  // backspace, a form feed: two each.
  expect(encodedLength('"')).toBe(2)
  expect(encodedLength('\\')).toBe(2)
  expect(encodedLength('a\nb')).toBe(4)
  expect(encodedLength('\t\r\b\f')).toBe(8)
  // Any other control character: six, `\u0001`; DEL is not one of them.
  expect(encodedLength('\u0001')).toBe(6)
  expect(encodedLength('\u001b')).toBe(6)
  expect(encodedLength('\u007f')).toBe(1)
  // An emoji: its two UTF-16 units, as `length` counts it; a lone half, six.
  expect(encodedLength('😀')).toBe(2)
  expect(encodedLength('\ud83d')).toBe(6)
  // U+2028 is left as it is.
  expect(encodedLength('\u2028')).toBe(1)
})

test('the limit counts the encoded note, its raw length shorter', () => {
  // 47,500 line breaks: 95,000 characters encoded.
  const lines = '\n'.repeat(NOTE_MAX_CHARS / 2)
  expect(refusalOf('', lines, NOTE_MAX_CHARS)).toBeUndefined()
  expect(refusalOf(lines, `${lines}y`, NOTE_MAX_CHARS)).toBe('too-long')
  // Line breaks pasted into a long text: refused, its raw length within.
  const text = 'x'.repeat(94_000)
  expect(refusalOf(text, `${text}${'\n'.repeat(600)}`, NOTE_MAX_CHARS)).toBe('too-long')
  expect(refusalOf(text, `${text}${'"'.repeat(500)}`, NOTE_MAX_CHARS)).toBeUndefined()
  // Past the limit already: shortened, or left as long, never lengthened.
  const over = '\n'.repeat(50_000)
  expect(refusalOf(over, over.slice(1), NOTE_MAX_CHARS)).toBeUndefined()
  expect(refusalOf(over, `yy${over.slice(1)}`, NOTE_MAX_CHARS)).toBeUndefined()
  expect(refusalOf(over, `${over}y`, NOTE_MAX_CHARS)).toBe('too-long')
  expect(refusalOf(over, `y${over}`, NOTE_MAX_CHARS)).toBe('too-long')
})

test("an edit past the store's room is refused, a shortening never", () => {
  expect(refusalOf('abc', 'abcd', 4)).toBeUndefined()
  expect(refusalOf('abcd', 'abcde', 4)).toBe('store-full')
  expect(refusalOf('abc', 'abc' + 'x'.repeat(100), 4)).toBe('store-full')
  // Past the room already (another session filled the store): shortened,
  // never lengthened.
  expect(refusalOf('abcdef', 'abcde', 4)).toBeUndefined()
  // Past 95,000 characters too: the note is too long whatever the room.
  expect(refusalOf('', 'x'.repeat(NOTE_MAX_CHARS + 1), 4)).toBe('too-long')
})

test('the longest note is written with its thousands set apart', () => {
  expect(NOTE_MAX_SHOWN).toBe('95 000')
  expect(thousands(150_000)).toBe('150 000')
  expect(thousands(999)).toBe('999')
})

test('the editor takes a note up to what a Client takes, once serialized', () => {
  expect(fitsEditor({ text: 'x'.repeat(NOTE_MAX_CHARS) })).toBe(true)
  expect(fitsEditor({ text: 'x'.repeat(150_000) })).toBe(false)
  // Each line break is written `\n`, two characters.
  expect(fitsEditor({ text: '\n'.repeat(60_000) })).toBe(false)
  // At the limit, with the editor's other props at their longest: it fits.
  expect(fitsEditor({
    text: '\n'.repeat(NOTE_MAX_CHARS / 2),
    max: NOTE_MAX_CHARS,
    rows: 9999,
    placeholder: 'Cliquer pour écrire. Ces notes restent hors du contexte de Claude.',
    tab: 'session',
    session: 'x'.repeat(200),
  })).toBe(true)
  // On either side of the length under which a note is not serialized: the
  // heaviest characters, six each once encoded.
  const surelyShort = Math.floor(NOTE_MAX_CHARS / 6)
  expect(fitsEditor({ text: '\u0001'.repeat(surelyShort) })).toBe(true)
  expect(fitsEditor({ text: '\u0001'.repeat(surelyShort + 1) })).toBe(true)
  // 100,002 characters once encoded: past what a Client takes.
  expect(fitsEditor({ text: '\u0001'.repeat(16_667) })).toBe(false)
})

test('the editor takes a paste with the note while both stay within the longest note', () => {
  // What the hooks module lets through: the note and the paste, encoded, at
  // the limit together, the other props at their longest.
  expect(fitsEditor({
    text: '\n'.repeat(NOTE_MAX_CHARS / 4),
    max: NOTE_MAX_CHARS,
    rows: 9999,
    placeholder: 'Cliquer pour écrire. Ces notes restent hors du contexte de Claude.',
    tab: 'session',
    session: 'x'.repeat(200),
    paste: { seq: Number.MAX_SAFE_INTEGER, text: '\n'.repeat(NOTE_MAX_CHARS / 4) },
  })).toBe(true)
  // Each short alone, too long together: the paste is counted.
  expect(fitsEditor({ text: '\u0001'.repeat(10_000), paste: { text: '\u0001'.repeat(10_000) } })).toBe(false)
  expect(fitsEditor({ text: 'x', paste: null })).toBe(true)
})

test('a paste keeps its text, its line ends made plain, a tab as two spaces', () => {
  expect(cleanPaste('un\r\ndeux\rtrois\nquatre')).toBe('un\ndeux\ntrois\nquatre')
  expect(cleanPaste('a\tb')).toBe('a  b')
  expect(cleanPaste('été 🎉 « ok »')).toBe('été 🎉 « ok »')
})

test('a paste drops the control characters a row would not show', () => {
  expect(cleanPaste('a\u0000b\u0007c\u001b[31md\u007fe\u0085f')).toBe('abc[31mdef')
  expect(cleanPaste('\u0001\u0002')).toBe('')
})

test('pasted inserts at the cursor, the cursor after it, kept in view', () => {
  expect(pasted(at('ab', 1), 'xy', 10, 5)).toEqual(at('axyb', 3))
  expect(pasted(at('ab', 1), 'un\r\ndeux', 10, 5)).toEqual(at('aun\ndeuxb', 8))
  // Many lines: the view follows the cursor down to the last.
  expect(pasted(at(''), '1\n2\n3\n4\n5', 10, 2)).toEqual(at('1\n2\n3\n4\n5', 9, 3))
  // Nothing left once cleaned: the same editor.
  const editor = at('ab')
  expect(pasted(editor, '\u0007', 10, 5)).toBe(editor)
})

// An editor showing `text`, having posted `sent` since the hooks drew `given`.
function editor(text: string, given: string, sent: string[] = []) {
  return { text, cursor: text.length, top: 0, active: true, given, sent, pasted: 0 }
}

test('a redraw of the text drawn already changes nothing', () => {
  const state = editor('abc', 'abc')
  expect(drawn(state, 'abc')).toBe(state)
})

test('a late echo of a key shows no step back', () => {
  // Typed `a`, then `b`: the redraw after `a` comes once `ab` is shown.
  const state = drawn(editor('ab', '', ['a', 'ab']), 'a')
  expect(state.text).toBe('ab')
  expect(state.sent).toEqual(['ab'])
  expect(drawn(state, 'ab')).toMatchObject({ text: 'ab', given: 'ab', sent: [] })
})

test("another session's text is shown, the cursor kept within it", () => {
  const state = drawn(editor('liste de courses', 'liste de courses'), 'pain')
  expect(state).toMatchObject({ text: 'pain', cursor: 4, given: 'pain', sent: [] })
})

test("another session's text wins over keys under way", () => {
  const state = drawn(editor('ab', '', ['a', 'ab']), 'écrit ailleurs')
  expect(state).toMatchObject({ text: 'écrit ailleurs', sent: [] })
})

test('ctrl+a selects the whole text; a key then replaces it, a move drops it', () => {
  const all = keyed(at('ab\ncd', 1), { key: 'a', ctrl: true }, 10, 5)
  expect(all).toEqual({ ...at('ab\ncd'), anchor: 0 })
  expect(selectedText(all)).toBe('ab\ncd')
  expect(keyed(all, { key: 'x' }, 10, 5)).toEqual(at('x'))
  expect(keyed(all, { key: 'return' }, 10, 5)).toEqual(at('\n'))
  expect(keyed(all, { key: 'left' }, 10, 5)).toEqual(at('ab\ncd', 4))
  // ctrl+c, as every shortcut, leaves it.
  expect(keyed(all, { key: 'c', ctrl: true }, 10, 5)).toBe(all)
  // Nothing to select in an empty note.
  const empty = at('')
  expect(keyed(empty, { key: 'a', ctrl: true }, 10, 5)).toBe(empty)
})

test('backspace and delete erase the selection, a paste replaces it', () => {
  // 'b\nc' selected, from the end backwards.
  const some = { ...at('ab\ncd', 1), anchor: 4 }
  expect(selectedText(some)).toBe('b\nc')
  for (const key of [{ key: 'backspace' }, { key: 'delete' }, { key: 'backspace', ctrl: true as const }]) {
    expect(keyed(some, key, 10, 5)).toEqual(at('ad', 1))
  }
  expect(pasted(some, 'XY', 10, 5)).toEqual(at('aXYd', 3))
  // An empty paste, Couper's, erases it; with nothing selected, nothing.
  expect(pasted(some, '', 10, 5)).toEqual(at('ad', 1))
  const none = at('ab', 1)
  expect(pasted(none, '', 10, 5)).toBe(none)
})

test('a drag selects from where the button went down, a click alone nothing', () => {
  // Rows: 'abcd' 'ef' 'gh'.
  const text = 'abcdef\ngh'
  const down = pointed(at(text, 0), 'down', 1, 0, 4, 5)
  expect(down).toEqual({ ...at(text, 1), anchor: 1 })
  expect(pointed(down, 'up', 1, 0, 4, 5)).toEqual(at(text, 1))
  const dragged = pointed(down, 'move', 1, 2, 4, 5)
  expect(selectedText(dragged)).toBe('bcdef\ng')
  expect(pointed(dragged, 'up', 1, 2, 4, 5)).toBe(dragged)
  // Past the bottom edge, two rows shown: the rows scroll.
  expect(pointed(down, 'move', 0, 2, 4, 2).top).toBe(1)
  // A move with no button down selects nothing.
  expect(pointed(at(text), 'move', 0, 0, 4, 5)).toEqual(at(text))
})

test('a row draws the selection inverse, else the cursor', () => {
  const text = 'abcd\n\nef'
  const rows = rowsOf(text, 10)
  const some = { ...at(text, 7), anchor: 2 }
  expect(rows.map(row => rowRuns(some, row, false, 10))).toEqual([
    [{ text: 'ab' }, { text: 'cd', inverse: true }],
    [{ text: ' ', inverse: true }],
    [{ text: 'e', inverse: true }, { text: 'f' }],
  ])
  const row = rows[0] ?? { start: 0, end: 0 }
  expect(rowRuns(at(text, 1), row, true, 10)).toEqual([{ text: 'a' }, { text: 'b', inverse: true }, { text: 'cd' }])
  expect(rowRuns(at(text, 1), row, false, 10)).toEqual([{ text: 'abcd' }])
  expect(rowRuns(at(text), rows[1] ?? row, false, 10)).toEqual([{ text: ' ' }])
})

test('the cursor moves over rows wrapped at a word', () => {
  // Rows at 8: 'un deux ' 'trois'.
  const text = 'un deux trois'
  const key = (cursor: number, name: string) => keyed(at(text, cursor), { key: name }, 8, 5).cursor
  // End stops before the space the row ends with; Home, at the row's start.
  expect(key(0, 'end')).toBe(7)
  expect(key(10, 'home')).toBe(8)
  expect(key(10, 'end')).toBe(13)
  // Up and down keep the column, past a shorter row's end at its end.
  expect(key(3, 'down')).toBe(11)
  expect(key(11, 'up')).toBe(3)
  expect(key(6, 'down')).toBe(13)
  // Right from the row's last stop: the next row's start.
  expect(key(7, 'right')).toBe(8)
  // A click past a wrapped row's text: before its last space, on that row.
  expect(clicked(at(text, 0), 20, 0, 8).cursor).toBe(7)
  expect(clicked(at(text, 0), 2, 1, 8).cursor).toBe(10)
  // A drag over both rows.
  const down = pointed(at(text, 0), 'down', 5, 0, 8, 5)
  expect(selectedText(pointed(down, 'move', 2, 1, 8, 5))).toBe('ux tr')
})

test('the cursor steps over an emoji whole, and keeps its column in cells', () => {
  const emoji = 'a\u{1F600}b'
  expect(keyed(at(emoji, 1), { key: 'right' }, 10, 5).cursor).toBe(3)
  expect(keyed(at(emoji, 3), { key: 'left' }, 10, 5).cursor).toBe(1)
  expect(keyed(at(emoji, 3), { key: 'backspace' }, 10, 5)).toEqual(at('ab', 1))
  expect(keyed(at(emoji, 1), { key: 'delete' }, 10, 5)).toEqual(at('ab', 1))
  // '日本語' over six cells: below its second character, the line's fifth cell.
  const wide = '\u{65E5}\u{672C}\u{8A9E}\nabcdef'
  expect(keyed(at(wide, 2), { key: 'down' }, 10, 5).cursor).toBe(8)
  expect(keyed(at(wide, 6), { key: 'up' }, 10, 5).cursor).toBe(1)
  // The cursor drawn over the whole emoji.
  const [row] = rowsOf(emoji, 10)
  expect(rowRuns(at(emoji, 1), row ?? { start: 0, end: 0 }, true, 10)).toEqual([{ text: 'a' }, { text: '\u{1F600}', inverse: true }, { text: 'b' }])
})

test('a selection over wrapped rows is drawn on each of them', () => {
  const text = 'un deux trois'
  const some = { ...at(text, 10), anchor: 5 }
  expect(rowsOf(text, 8).map(row => rowRuns(some, row, false, 8))).toEqual([
    [{ text: 'un de' }, { text: 'ux ', inverse: true }],
    [{ text: 'tr', inverse: true }, { text: 'ois' }],
  ])
})

test('the cursor among the spaces a row hangs is drawn on its last cell', () => {
  // Rows at 4: 'abcd ' (drawn 'abcd') | 'efgh' | ''.
  const text = 'abcd efgh'
  const rows = rowsOf(text, 4)
  const [first] = rows
  if (first === undefined) throw new Error('no row')
  const key = (cursor: number, name: string) => keyed(at(text, cursor), { key: name }, 4, 5).cursor
  expect(key(0, 'end')).toBe(4)
  expect(key(4, 'right')).toBe(5)
  expect(key(5, 'left')).toBe(4)
  expect(key(8, 'up')).toBe(3)
  expect(key(4, 'down')).toBe(9)
  expect(clicked(at(text, 0), 9, 0, 4).cursor).toBe(4)
  expect(rowRuns(at(text, 4), first, true, 4)).toEqual([{ text: 'abc' }, { text: 'd', inverse: true }])
  expect(rowRuns(at(text, 1), first, true, 4)).toEqual([{ text: 'a' }, { text: 'b', inverse: true }, { text: 'cd' }])
  expect(rowRuns(at(text, 0), first, false, 4)).toEqual([{ text: 'abcd' }])
})

test('a move by words takes a letter with its accents as one', () => {
  // 'été x', its accents written as marks of their own.
  const text = 'e\u{301}te\u{301} x'
  expect(keyed(at(text, 0), { key: 'right', ctrl: true }, 40, 5).cursor).toBe(5)
  expect(keyed(at(text, 5), { key: 'left', ctrl: true }, 40, 5).cursor).toBe(0)
  expect(keyed(at(text, 5), { key: 'backspace', ctrl: true }, 40, 5)).toEqual(at(' x', 0))
  expect(keyed(at(text, 0), { key: 'delete', ctrl: true }, 40, 5)).toEqual(at(' x', 0))
})
