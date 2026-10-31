import { expect, test } from 'claude-code/testing'

import { clicked, keyed, rowOf, rowsOf } from './editor-model'
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
