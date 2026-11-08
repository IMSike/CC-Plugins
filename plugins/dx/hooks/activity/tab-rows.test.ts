import { expect, test } from 'claude-code/testing'

import { cellWidth, wrappedRows } from './tab-rows'

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

test('a text is counted in cells', () => {
  expect(cellWidth('npm run dev')).toBe(11)
  expect(cellWidth('\u{1F600} \u{65E5}\u{672C}')).toBe(7)
  // Accents combined, a variation selector, a joined emoji: no cell more.
  expect(cellWidth('e\u{301}te\u{301}')).toBe(3)
  expect(cellWidth('\u{2764}\u{FE0F}')).toBe(1)
  expect(cellWidth('\u{1F469}\u{200D}\u{1F4BB}')).toBe(2)
  // A Nerd Font glyph, as the engine counts it.
  expect(cellWidth('\u{F489}')).toBe(1)
})

test('an emoji sequence counts as one emoji, a flag too', () => {
  // A skin tone, alone or within a joined sequence: no cell more.
  expect(cellWidth('\u{1F44D}\u{1F3FB}')).toBe(2)
  expect(cellWidth('\u{1F469}\u{1F3FD}\u{200D}\u{1F4BB}')).toBe(2)
  expect(cellWidth('\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}')).toBe(2)
  // Regional indicators by pairs: one flag, then two.
  expect(cellWidth('\u{1F1EB}\u{1F1F7}')).toBe(2)
  expect(cellWidth('\u{1F1EB}\u{1F1F7}\u{1F1E9}\u{1F1EA}')).toBe(4)
})

// A joiner between letters shapes them; it hides neither.
test('a joiner between letters leaves each its cell', () => {
  expect(cellWidth('\u{0644}\u{200D}\u{0627}')).toBe(2)
  expect(cellWidth('\u{0915}\u{094D}\u{200D}\u{0937}')).toBe(2)
})
