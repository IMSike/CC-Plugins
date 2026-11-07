import { expect, test } from 'claude-code/testing'

import { firstLine, othersOf, othersStart } from './others'

test("a row shows its note's first line, cut to the pane", () => {
  expect(firstLine('piste\nsuite', 40)).toBe('piste')
  expect(firstLine('abcdef', 3)).toBe('abc')
  expect(firstLine('x'.repeat(200_000), 50_000)).toHaveLength(1000)
  // A character beyond the BMP is kept whole or left out, never split.
  expect(firstLine('😀😀😀', 2)).toBe('😀😀')
  expect(firstLine('a😀', 1)).toBe('a')
})

test("the other sessions' notes, latest first, this session's left out", () => {
  const note = (updatedAt: number) => ({ text: 'x', updatedAt })
  const sessions = { a: note(1), s0: note(9), b: note(3), c: note(2) }
  const value = { global: null, project: null, sessions, root: '/repo', session: 's0', id: 's1' }
  expect(othersOf(value).map(([id]) => id)).toEqual(['b', 'c', 'a'])
})

test('the list of other sessions stays within its notes', () => {
  expect(othersStart(0, 5, 3)).toBe(0)
  expect(othersStart(4, 5, 3)).toBe(2)
  expect(othersStart(-2, 5, 3)).toBe(0)
  expect(othersStart(3, 2, 3)).toBe(0)
})
