import { expect, test } from 'claude-code/testing'

import { NOTE_MAX_CHARS } from './editor-model'
import { entryBytes, noteMax, STORE_MAX_BYTES, UNIT_MAX_BYTES, utf8Length } from './store-size'

test('a text is measured in UTF-8 bytes', () => {
  expect(utf8Length('abc')).toBe(3)
  expect(utf8Length('é')).toBe(2)
  expect(utf8Length('€')).toBe(3)
  expect(utf8Length('😀')).toBe(4)
  // A lone surrogate is written as three bytes.
  expect(utf8Length('\ud83d')).toBe(3)
})

test("an entry adds its key, its value's JSON text, a colon and a comma", () => {
  expect(entryBytes('k', 'é')).toBe(3 + 1 + 4 + 1)
  const note = { text: 'a', updatedAt: 1 }
  expect(entryBytes('notes.global', note)).toBe(14 + 1 + JSON.stringify(note).length + 1)
})

test('the store is kept under 3.8 MiB', () => {
  expect(STORE_MAX_BYTES).toBe(Math.floor(3.8 * 1024 * 1024))
})

test('no code unit of a note takes more than six bytes in the store', () => {
  const note = (text: string) => entryBytes('notes.global', { text, updatedAt: 1 })
  const empty = note('')
  // The heaviest: a control character, a lone surrogate, written escaped.
  expect(note('\u0001') - empty).toBe(UNIT_MAX_BYTES)
  expect(note('\udc00') - empty).toBe(UNIT_MAX_BYTES)
  for (const units of ['a', '"', '\\', '\n', 'é', '€', ' ', '😀', '\u001f\u007f']) {
    expect(note(units) - empty).toBeLessThanOrEqual(UNIT_MAX_BYTES * units.length)
  }
})

test('a note may grow by what the room left holds at six bytes a character', () => {
  const key = 'notes.global'
  const overhead = entryBytes(key, { text: '', updatedAt: Number.MAX_SAFE_INTEGER })
  expect(noteMax(key, 10, overhead + 60)).toBe(20)
  expect(noteMax(key, 10, overhead + 65)).toBe(20)
  // No room: as long as it is, never shorter than stored.
  expect(noteMax(key, 10, 0)).toBe(10)
  expect(noteMax(key, 10, -500)).toBe(10)
  // Room enough, or a store that cannot be read: 95,000 characters.
  expect(noteMax(key, 10, STORE_MAX_BYTES)).toBe(NOTE_MAX_CHARS)
  expect(noteMax(key, 10, undefined)).toBe(NOTE_MAX_CHARS)
})
