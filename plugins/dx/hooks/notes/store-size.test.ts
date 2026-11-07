import { expect, test } from 'claude-code/testing'

import { entryBytes, STORE_MAX_BYTES, utf8Length } from './store-size'

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
