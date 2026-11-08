// How many rows the panel's tabs take (./activity's paneTabs).

// Code points a terminal draws over two cells: East Asian Wide and Fullwidth
// (Hangul, CJK, kana, fullwidth forms), the main blocks alone, and emoji drawn
// as emoji by default.
const WIDE =
  /\p{Emoji_Presentation}|[\u{1100}-\u{115F}\u{2E80}-\u{303E}\u{3041}-\u{33FF}\u{3400}-\u{4DBF}\u{4E00}-\u{9FFF}\u{A000}-\u{A4CF}\u{AC00}-\u{D7A3}\u{F900}-\u{FAFF}\u{FE30}-\u{FE4F}\u{FF00}-\u{FF60}\u{FFE0}-\u{FFE6}\u{20000}-\u{3FFFD}]/u
const JOINER = '\u{200D}'
// What a joiner makes one emoji of, before it and after it.
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u
// Two of them make a flag.
const REGIONAL = /[\u{1F1E6}-\u{1F1FF}]/u
// Draws the emoji before it as emoji, over two cells, when it is text by
// default (a heart, a check mark, a keycap's digit).
const EMOJI_STYLE = '\u{FE0F}'
const EMOJI = /\p{Emoji}/u
// Skin tone modifiers: drawn on the emoji before them, making it emoji over
// two cells when it is text by default (a victory hand), as a swatch of their
// own after anything else.
const MODIFIER = /[\u{1F3FB}-\u{1F3FF}]/u
// Code points drawn over no cell of their own: combining marks (the other
// variation selectors among them), zero-width spaces and joiners, the Hangul
// vowels and final consonants joined to the leading consonant before them,
// and the tags spelling a subdivision flag.
const ZERO = /[\p{Mn}\p{Me}\u{200B}-\u{200D}\u{1160}-\u{11FF}\u{D7B0}-\u{D7FF}\u{E0020}-\u{E007F}]/u

// The cells a text takes in the terminal: a wide code point counts two, a
// zero-width one none, an emoji joined to an emoji before it (an emoji
// sequence such as a technologist) none more, and a flag, a pair of regional
// indicators, two. An emoji drawn as text by default counts two when made
// emoji (a red heart, a keycap, a victory hand with a skin tone). A joiner
// between letters (Arabic, Indic scripts), or between an emoji and anything
// but an emoji, joins nothing away. A Nerd Font glyph counts one, as the
// engine counts it (../shared/crew's iconGap leaves the cell after it). Simple
// on purpose: no full grapheme clusters, no ambiguous widths.
export function cellWidth(text: string): number {
  let width = 0
  // The last code point drawn over cells of its own, or joined to one, and
  // the cells it was counted.
  let base = ''
  let cells = 0
  let isJoined = false
  let isFlagOpen = false
  for (const char of text) {
    const isRegional = REGIONAL.test(char)
    const isModifier = MODIFIER.test(char) && PICTOGRAPHIC.test(base)
    if (char === EMOJI_STYLE || isModifier) {
      if (cells === 1 && (isModifier || EMOJI.test(base))) {
        width += 1
        cells = 2
      }
    } else if (ZERO.test(char)) {
      if (char === JOINER) isJoined = PICTOGRAPHIC.test(base)
    } else {
      const isJoinedEmoji = isJoined && PICTOGRAPHIC.test(char)
      cells = isJoinedEmoji || (isRegional && isFlagOpen) ? 0 : WIDE.test(char) ? 2 : 1
      width += cells
      isJoined = false
      base = char
    }
    isFlagOpen = isRegional && !isFlagOpen
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
