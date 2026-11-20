import { expect, test } from 'claude-code/testing'

import { wrappedRows } from './tab-rows'

test('tabs that fit side by side take one row', () => {
  expect(wrappedRows([], 20)).toBe(1)
  // 5 + 1 + 5 + 1 + 8: exactly 20.
  expect(wrappedRows(['aaaaa', 'bbbbb', 'cccccccc'], 20)).toBe(1)
})

test('a tab past the row goes to the next, a cell between each', () => {
  expect(wrappedRows(['aaaaa', 'bbbbb', 'ccccccccc'], 20)).toBe(2)
  expect(wrappedRows(['aaaaaaaaaa', 'bbbbbbbbbb', 'cccccccccc'], 20)).toBe(3)
})

test('a tab wider than the pane takes a row, cut there', () => {
  expect(wrappedRows(['x'.repeat(50)], 20)).toBe(1)
  expect(wrappedRows(['a', 'x'.repeat(50), 'b'], 20)).toBe(3)
})

// An emoji or a CJK character takes two cells: five emoji fill 10 columns.
test('a wide character counts the two cells it takes', () => {
  expect(wrappedRows(['\u{1F600}'.repeat(5), 'aaaa'], 10)).toBe(2)
  expect(wrappedRows(['\u{65E5}\u{672C}\u{8A9E}', 'aaa'], 10)).toBe(1)
  expect(wrappedRows(['\u{65E5}\u{672C}\u{8A9E}', 'aaaa'], 10)).toBe(2)
})
