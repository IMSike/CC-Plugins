import { expect, test } from 'claude-code/testing'

import { othersOf, othersStart } from './others'

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
