// How the notes editor lays its text out: each line wrapped at a word, over
// rows whose text is no wider than the editor, and how a cursor position
// maps to a row and a column there and back. ./editor-model moves the cursor
// with these, and ./editor draws the rows: one layout for both.

import { cellWidth } from '../shared/cell-width'

// A visual row: `text.slice(start, end)`, its line's newline left out, the
// spaces it ends with included even past the editor's width (see wrapLine).
// `isWrapped`, its line goes on on the next row, which starts at `end`: the
// cursor stops on it at most at rowLast.
export type Row = { start: number; end: number; isWrapped?: true }

// What the terminal draws in one go: a character, with the marks drawn on it
// (accents, an emoji's variation selector or skin tone, the emoji a joiner
// makes one with, a flag's second half), and the cells it takes.
type Cluster = { start: number; end: number; width: number }

// The cells of a code point that is never joined to the character before
// it, counted without cellWidth, most notes being written with them. One
// cell: printable ASCII, Latin-1 and the Latin extensions (below U+0300, but
// `©` and `®`, emoji a joiner may join), Greek, Cyrillic (but its combining
// marks, U+0483 to U+0489), Vietnamese's Latin letters (U+1E00 to U+1EFF),
// dashes, quotes, bullets and the ellipsis (U+2010 to U+2027), currency
// signs. Two: kana (but the combining sound marks U+3099 and U+309A), the
// main CJK ideographs, Hangul syllables. Undefined for any other code point,
// left to cellWidth.
function plainWidth(code: number): number | undefined {
  if (code >= 0x20 && code < 0x300) return (code < 0x7f || code > 0x9f) && code !== 0xa9 && code !== 0xae ? 1 : undefined
  if (code < 0x370) return undefined
  if ((code < 0x483 || (code > 0x489 && code < 0x530)) || (code >= 0x1e00 && code <= 0x1eff) || (code >= 0x2010 && code <= 0x2027) || (code >= 0x20a0 && code <= 0x20c0)) return 1
  if (code === 0x3099 || code === 0x309a) return undefined
  return (code >= 0x3041 && code <= 0x30ff) || (code >= 0x4e00 && code <= 0x9fff) || (code >= 0xac00 && code <= 0xd7a3) ? 2 : undefined
}

// The clusters of `text.slice(from, to)`, at most `max`. A code point joins
// the cluster before it when it takes no cell (a mark, a joiner, a variation
// selector), or when cellWidth counts the two together narrower than apart
// (an emoji after a joiner, a flag's second half, a skin tone). The engine's
// own widths, as cellWidth reckons them, and no full grapheme rules.
export function clustersOf(text: string, from = 0, to = text.length, max = Infinity): Cluster[] {
  const clusters: Cluster[] = []
  let current: Cluster | undefined
  let at = from
  while (at < to) {
    const code = text.codePointAt(at) ?? 0
    const end = Math.min(to, at + (code > 0xffff ? 2 : 1))
    const plain = plainWidth(code)
    const width = plain ?? cellWidth(text.slice(at, end))
    if (current !== undefined && plain === undefined) {
      const together = cellWidth(text.slice(current.start, end))
      if (width === 0 || together < current.width + width) {
        current.end = end
        current.width = together
        at = end
        continue
      }
    }
    if (clusters.length >= max) break
    current = { start: at, end, width }
    clusters.push(current)
    at = end
  }
  return clusters
}

// A space a line may break after; a no-break space is not one.
const BREAKING_SPACE = /[^\S\n\u00a0\u2007\u202f]/
function isSpace(text: string, cluster: Cluster): boolean {
  return BREAKING_SPACE.test(text.charAt(cluster.start))
}

// The rows of `line` (a line of the text, its newline left out), its offsets
// counted from the line's start. A word goes on the row when it fits there,
// the spaces after it with it, all of them: past the row's end they hang,
// not drawn, as in a notepad, so a row never starts with the spaces a line
// broke at, only with its indentation. A word that does not fit after what
// the row holds starts the next; a word wider than a whole row is cut where
// the row ends, as is a run of characters without spaces (Chinese,
// Japanese); a cluster wider than the whole row (a wide character on one
// cell) takes a row of its own. A line whose last row is full gets an empty
// row after it, where its end's cursor stands.
function wrapLine(line: string, cells: number): Row[] {
  const rows: Row[] = []
  const clusters = clustersOf(line)
  let start = 0
  let used = 0
  const breakAt = (at: number) => {
    rows.push({ start, end: at, isWrapped: true })
    start = at
    used = 0
  }
  let index = 0
  while (index < clusters.length) {
    // A word, clusters[index] to clusters[spaces - 1], then the spaces after
    // it, to clusters[next - 1].
    let spaces = index
    let width = 0
    for (let cluster = clusters[spaces]; cluster !== undefined && !isSpace(line, cluster); cluster = clusters[spaces]) {
      width += cluster.width
      spaces++
    }
    const first = clusters[index]
    if (first !== undefined && used > 0 && used + width > cells) breakAt(first.start)
    if (used + width <= cells) {
      used += width
    } else {
      for (const cluster of clusters.slice(index, spaces)) {
        if (used > 0 && used + cluster.width > cells) breakAt(cluster.start)
        used += cluster.width
      }
    }
    let next = spaces
    for (let cluster = clusters[next]; cluster !== undefined && isSpace(line, cluster); cluster = clusters[next]) {
      used += cluster.width
      next++
    }
    index = next
  }
  rows.push({ start, end: line.length })
  if (used >= cells) rows.push({ start: line.length, end: line.length })
  return rows
}

// The rows of each line already wrapped, by width and text: a key changes a
// line or two, whose rows alone are wrapped again. Emptied when it grows past
// CHARS_CACHED characters of lines: a long note held some ten times over, a
// line typed in kept at each key.
const CHARS_CACHED = 1_000_000
const lineRows = new Map<number, Map<string, Row[]>>()
let charsCached = 0

function rowsOfLine(line: string, cells: number): Row[] {
  const cached = lineRows.get(cells)?.get(line)
  if (cached !== undefined) return cached
  if (charsCached + line.length > CHARS_CACHED) {
    lineRows.clear()
    charsCached = 0
  }
  const byText = lineRows.get(cells) ?? new Map<string, Row[]>()
  lineRows.set(cells, byText)
  const rows = wrapLine(line, cells)
  byText.set(line, rows)
  charsCached += line.length + 1
  return rows
}

// The last texts laid out, and their rows: a key lays the text out before and
// after it, and the editor's draw once more.
const LAYOUTS_KEPT = 4
let layouts: { text: string; cells: number; rows: Row[] }[] = []

// The text's visual rows at `width` cells, each line wrapped at a word. The
// array is shared with later calls on the same text: not to be changed.
export function rowsOf(text: string, width: number): Row[] {
  const cells = Math.max(1, Math.floor(width))
  const kept = layouts.find(layout => layout.cells === cells && layout.text === text)
  if (kept !== undefined) return kept.rows
  const rows: Row[] = []
  let start = 0
  for (const line of text.split('\n')) {
    for (const row of rowsOfLine(line, cells)) {
      rows.push(row.isWrapped === true ? { start: start + row.start, end: start + row.end, isWrapped: true } : { start: start + row.start, end: start + row.end })
    }
    start += line.length + 1
  }
  layouts = [{ text, cells, rows }, ...layouts.slice(0, LAYOUTS_KEPT - 1)]
  return rows
}

// The row the cursor stands on: the last that starts at or before it. A
// cursor where a wrapped row ends stands at the start of the next.
export function rowOf(rows: readonly Row[], cursor: number): number {
  let low = 0
  let high = rows.length - 1
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if ((rows[middle]?.start ?? 0) <= cursor) low = middle
    else high = middle - 1
  }
  return low
}

// The cells before `cursor` on `row`: the cursor's column there, which the
// spaces a row hangs past its end may take beyond the row's width.
export function columnOf(text: string, row: Row, cursor: number): number {
  const to = Math.min(Math.max(cursor, row.start), row.end)
  return clustersOf(text, row.start, to).reduce((cells, cluster) => cells + cluster.width, 0)
}

// The farthest the cursor goes on `row`: its end; on a wrapped row, whose
// end is where the next starts, the end of its text, before the spaces it
// ends with, or, cut within a word, before its last character.
export function rowLast(text: string, row: Row): number {
  if (row.isWrapped !== true) return row.end
  let at = row.end
  while (at > row.start && BREAKING_SPACE.test(text.charAt(at - 1))) at--
  return at > row.start && at < row.end ? at : clusterBefore(text, row.end)
}

// Where the part of `row` drawn ends: before the first cluster past `width`
// cells, the spaces hanging past the row's end left out.
export function shownEnd(text: string, row: Row, width: number): number {
  const cells = Math.max(1, Math.floor(width))
  let used = 0
  for (const cluster of clustersOf(text, row.start, row.end)) {
    // A cluster wider than the whole row, alone on it, is drawn all the same.
    if (used > 0 && used + cluster.width > cells) return cluster.start
    if (used === 0 && cluster.width > cells) return cluster.end
    used += cluster.width
  }
  return row.end
}

// The cursor on `row` at `column`: before the character drawn over that
// cell (a wide one's second cell included); past the row's text, at
// rowLast.
export function offsetAt(text: string, row: Row, column: number): number {
  const last = rowLast(text, row)
  let cells = 0
  for (const cluster of clustersOf(text, row.start, last)) {
    if (column < cells + cluster.width) return cluster.start
    cells += cluster.width
  }
  return last
}

// Where the cluster after `at` ends: one step right, over a line break as one.
export function clusterAfter(text: string, at: number): number {
  if (at >= text.length) return text.length
  if (text.charAt(at) === '\n') return at + 1
  const end = text.indexOf('\n', at)
  const [cluster] = clustersOf(text, at, end < 0 ? text.length : end, 1)
  return cluster?.end ?? at + 1
}

// How far back clusterBefore looks: a cluster is never this long but in
// made-up text, and a line of a whole note is not read at every key.
const CLUSTER_LOOKBACK = 64

// Where the cluster before `at` starts: one step left, over a line break as one.
export function clusterBefore(text: string, at: number): number {
  if (at <= 0) return 0
  if (text.charAt(at - 1) === '\n') return at - 1
  const from = Math.max(text.lastIndexOf('\n', at - 1) + 1, at - CLUSTER_LOOKBACK)
  const clusters = clustersOf(text, from, at)
  return clusters[clusters.length - 1]?.start ?? at - 1
}
