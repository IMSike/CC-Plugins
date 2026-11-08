// How many rows the panel's tabs take (./activity's paneTabs).

// Code points a terminal draws over two cells: East Asian Wide and Fullwidth
// (Hangul, CJK, kana, fullwidth forms), the main blocks alone, and emoji drawn
// as emoji by default.
const WIDE =
  /\p{Emoji_Presentation}|[\u{1100}-\u{115F}\u{2E80}-\u{303E}\u{3041}-\u{33FF}\u{3400}-\u{4DBF}\u{4E00}-\u{9FFF}\u{A000}-\u{A4CF}\u{AC00}-\u{D7A3}\u{F900}-\u{FAFF}\u{FE30}-\u{FE4F}\u{FF00}-\u{FF60}\u{FFE0}-\u{FFE6}\u{20000}-\u{3FFFD}]/u
const JOINER = '\u{200D}'
// What a joiner makes one emoji with the code point after it.
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u
// Two of them make a flag.
const REGIONAL = /[\u{1F1E6}-\u{1F1FF}]/u
// Code points drawn over no cell of their own: combining marks, variation
// selectors, zero-width spaces and joiners, skin tone modifiers.
const ZERO = /[\p{Mn}\p{Me}\u{FE00}-\u{FE0F}\u{200B}-\u{200D}\u{1F3FB}-\u{1F3FF}]/u

// The cells a text takes in the terminal: a wide code point counts two, a
// zero-width one none, one joined to an emoji before it (an emoji sequence
// such as a technologist) none more, and a flag, a pair of regional
// indicators, two. A joiner between letters (Arabic, Indic scripts) joins
// nothing away. A Nerd Font glyph counts one, as the engine counts it
// (../shared/crew's iconGap leaves the cell after it). Simple on purpose: no
// full grapheme clusters, no ambiguous widths.
export function cellWidth(text: string): number {
  let width = 0
  // The last code point drawn over cells of its own, or joined to one.
  let base = ''
  let isJoined = false
  let isFlagOpen = false
  for (const char of text) {
    const isZero = ZERO.test(char)
    const isRegional = REGIONAL.test(char)
    if (!isZero && !isJoined && !(isRegional && isFlagOpen)) width += WIDE.test(char) ? 2 : 1
    isFlagOpen = isRegional && !isFlagOpen
    isJoined = char === JOINER && PICTOGRAPHIC.test(base)
    if (!isZero) base = char
  }
  return width
}

// The rows a row of labels takes, wrapped in `columns` with a cell between:
// a label wider than `columns` takes a row of its own, cut there.
export function wrappedRows(labels: readonly string[], columns: number): number {
  let rows = 1
  let used = 0
  for (const label of labels) {
    const width = Math.min(columns, cellWidth(label))
    if (used > 0 && used + 1 + width > columns) {
      rows += 1
      used = width
    } else {
      used += (used > 0 ? 1 : 0) + width
    }
  }
  return rows
}
