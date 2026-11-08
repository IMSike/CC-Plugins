import { expect, test } from 'claude-code/testing'

import { clicked, drawn, encodedLength, fitsEditor, keyed, NOTE_MAX_CHARS, NOTE_MAX_SHOWN, refusalOf, rowOf, rowsOf, thousands } from './editor-model'
import type { Editor } from './editor-model'

const at = (text: string, cursor = text.length, top = 0): Editor => ({ text, cursor, top })

test('rowsOf wraps lines at the width', () => {
  expect(rowsOf('', 4)).toEqual([{ start: 0, end: 0 }])
  expect(rowsOf('abcdef\ngh', 4)).toEqual([
    { start: 0, end: 4 },
    { start: 4, end: 6 },
    { start: 7, end: 9 },
  ])
  // A line filling its row exactly leaves an empty row for its end.
  expect(rowsOf('abcd', 4)).toEqual([
    { start: 0, end: 4 },
    { start: 4, end: 4 },
  ])
  expect(rowOf(rowsOf('abcd', 4), 4)).toBe(1)
})

test('keyed types, breaks lines and erases', () => {
  expect(keyed(at('ab', 1), { key: 'x' }, 10, 5)).toEqual(at('axb', 2))
  expect(keyed(at('ab'), { key: 'return' }, 10, 5)).toEqual(at('ab\n'))
  expect(keyed(at('ab'), { key: 'backspace' }, 10, 5)).toEqual(at('a'))
  expect(keyed(at('ab', 0), { key: 'delete' }, 10, 5)).toEqual(at('b', 0))
  // A pasted text, its line ends made plain.
  expect(keyed(at(''), { key: 'un\r\ndeux' }, 10, 5)).toEqual(at('un\ndeux'))
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

// An editor showing `text`, having posted `sent` since the hooks drew `given`.
function editor(text: string, given: string, sent: string[] = []) {
  return { text, cursor: text.length, top: 0, active: true, given, sent }
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
