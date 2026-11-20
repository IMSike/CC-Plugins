import { expect, test } from 'claude-code/testing'

import { cellWidth } from './cell-width'

test('a text is counted in cells', () => {
  expect(cellWidth('npm run dev')).toBe(11)
  expect(cellWidth('\u{1F600} \u{65E5}\u{672C}')).toBe(7)
  // Accents combined, a text variation selector, a joined emoji: no cell more.
  expect(cellWidth('e\u{301}te\u{301}')).toBe(3)
  expect(cellWidth('\u{2764}\u{FE0E}')).toBe(1)
  expect(cellWidth('\u{2229}\u{FE00}')).toBe(1)
  expect(cellWidth('\u{1F469}\u{200D}\u{1F4BB}')).toBe(2)
  // Hangul spelled in jamo: the vowel and the final consonant join the first.
  expect(cellWidth('\u{1112}\u{1161}\u{11AB}')).toBe(2)
  expect(cellWidth('\u{1100}\u{D7B0}')).toBe(2)
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
  // A subdivision flag: a black flag spelling England in tags.
  expect(cellWidth('\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}')).toBe(2)
  // A skin tone after no emoji: a swatch of its own.
  expect(cellWidth('\u{1F3FD}')).toBe(2)
  expect(cellWidth('a\u{1F3FD}')).toBe(3)
  // After an emoji that takes none: a swatch beside it.
  expect(cellWidth('\u{2764}\u{1F3FD}')).toBe(3)
  expect(cellWidth('\u{1F600}\u{1F3FD}')).toBe(4)
})

// A heart, a check mark or a keycap's digit is text by default: the emoji
// variation selector draws it as emoji, over two cells.
test('an emoji made emoji by its variation selector counts two', () => {
  expect(cellWidth('\u{2764}\u{FE0F}')).toBe(2)
  expect(cellWidth('\u{2714}\u{FE0F}')).toBe(2)
  expect(cellWidth('1\u{FE0F}\u{20E3}')).toBe(2)
  // Already wide, or not an emoji: unchanged.
  expect(cellWidth('\u{1F600}\u{FE0F}')).toBe(2)
  expect(cellWidth('a\u{FE0F}')).toBe(1)
  // The rainbow flag: a white flag made emoji, joined to a rainbow.
  expect(cellWidth('\u{1F3F3}\u{FE0F}\u{200D}\u{1F308}')).toBe(2)
  // A selector after the joiner leaves what follows joined.
  expect(cellWidth('\u{1F469}\u{200D}\u{FE0F}\u{1F4BB}')).toBe(2)
})

// A victory hand, a pointing finger, a writing hand or a raised hand is text
// by default: a skin tone draws it as emoji, over two cells.
test('an emoji made emoji by its skin tone counts two', () => {
  expect(cellWidth('\u{270C}\u{1F3FD}')).toBe(2)
  expect(cellWidth('\u{261D}\u{1F3FB}')).toBe(2)
  expect(cellWidth('\u{270D}\u{1F3FF}')).toBe(2)
  expect(cellWidth('\u{1F590}\u{1F3FC}')).toBe(2)
  // With the emoji variation selector too: still two.
  expect(cellWidth('\u{270C}\u{FE0F}\u{1F3FD}')).toBe(2)
})

// A joiner between letters shapes them; it hides neither.
test('a joiner between letters leaves each its cell', () => {
  expect(cellWidth('\u{0644}\u{200D}\u{0627}')).toBe(2)
  expect(cellWidth('\u{0915}\u{094D}\u{200D}\u{0937}')).toBe(2)
})

// A joiner after an emoji joins only an emoji: a letter keeps its cell.
test('a joiner between an emoji and a letter leaves the letter its cell', () => {
  expect(cellWidth('\u{1F469}\u{200D}a')).toBe(3)
  expect(cellWidth('\u{1F469}\u{200D}\u{65E5}')).toBe(4)
})
