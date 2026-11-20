import { expect, test } from 'claude-code/testing'

import { clusterAfter, clusterBefore, clustersOf, columnOf, offsetAt, rowLast, rowOf, rowsOf, shownEnd } from './wrap'

test('a line wraps at a word, the spaces after it kept on its row', () => {
  // 'un deux ' | 'trois'.
  expect(rowsOf('un deux trois', 8)).toEqual([
    { start: 0, end: 8, isWrapped: true },
    { start: 8, end: 13 },
  ])
  // 'un deux' fills the row: its space hangs past it, 'trois' starts the next.
  expect(rowsOf('un deux trois', 7)).toEqual([
    { start: 0, end: 8, isWrapped: true },
    { start: 8, end: 13 },
  ])
  // Each line on its own rows.
  expect(rowsOf('un deux\ntrois', 5)).toEqual([
    { start: 0, end: 3, isWrapped: true },
    { start: 3, end: 7 },
    { start: 8, end: 13 },
    { start: 13, end: 13 },
  ])
  expect(rowsOf('', 4)).toEqual([{ start: 0, end: 0 }])
  expect(rowsOf('a\n\nb', 4)).toEqual([
    { start: 0, end: 1 },
    { start: 2, end: 2 },
    { start: 3, end: 4 },
  ])
})

test('a word filling its row leaves the space after it on that row', () => {
  // 'abcd ' | 'efgh' | '': no row starts with the space broken at.
  expect(rowsOf('abcd efgh', 4)).toEqual([
    { start: 0, end: 5, isWrapped: true },
    { start: 5, end: 9 },
    { start: 9, end: 9 },
  ])
  expect(rowsOf('abcd ef', 4)).toEqual([
    { start: 0, end: 5, isWrapped: true },
    { start: 5, end: 7 },
  ])
  // 'abc de' fits six cells: 'abc de ' | 'f'.
  expect(rowsOf('abc de f', 6)).toEqual([
    { start: 0, end: 7, isWrapped: true },
    { start: 7, end: 8 },
  ])
  // The space typed after a full row: the word stays, the cursor goes below.
  expect(rowsOf('abcd ', 4)).toEqual([
    { start: 0, end: 5 },
    { start: 5, end: 5 },
  ])
  // The hanging space is not drawn.
  const [row] = rowsOf('abcd efgh', 4)
  if (row === undefined) throw new Error('no row')
  expect(shownEnd('abcd efgh', row, 4)).toBe(4)
})

test('a word wider than a row is cut where the row ends', () => {
  expect(rowsOf('abcdef\ngh', 4)).toEqual([
    { start: 0, end: 4, isWrapped: true },
    { start: 4, end: 6 },
    { start: 7, end: 9 },
  ])
  // 'abcd' | 'efgh' | 'ij ' | 'kl'.
  expect(rowsOf('abcdefghij kl', 4)).toEqual([
    { start: 0, end: 4, isWrapped: true },
    { start: 4, end: 8, isWrapped: true },
    { start: 8, end: 11, isWrapped: true },
    { start: 11, end: 13 },
  ])
})

test('a line filling its last row leaves an empty row for its end', () => {
  expect(rowsOf('abcd', 4)).toEqual([
    { start: 0, end: 4 },
    { start: 4, end: 4 },
  ])
  expect(rowsOf('ab cd', 5)).toEqual([
    { start: 0, end: 5 },
    { start: 5, end: 5 },
  ])
  expect(rowOf(rowsOf('abcd', 4), 4)).toBe(1)
})

test('indentation starts its line, and runs of spaces hang', () => {
  // '    ab ' | 'cd'.
  expect(rowsOf('    ab cd', 6)).toEqual([
    { start: 0, end: 7, isWrapped: true },
    { start: 7, end: 9 },
  ])
  expect(rowsOf('  ab cd', 6)).toEqual([
    { start: 0, end: 5, isWrapped: true },
    { start: 5, end: 7 },
  ])
  // 'ab      ' | 'c', drawn 'ab  ' | 'c'.
  expect(rowsOf('ab      c', 4)).toEqual([
    { start: 0, end: 8, isWrapped: true },
    { start: 8, end: 9 },
  ])
  // Every row's text fits, the spaces it ends with aside, and no row a line
  // goes on to starts with a space.
  const text = 'Lorem ipsum   dolor sit amet,  consectetur adipiscing elit, sed do'
  for (const width of [1, 2, 3, 5, 8, 13, 21]) {
    for (const row of rowsOf(text, width)) {
      expect(clustersOf(text.slice(row.start, row.end).trimEnd()).length).toBeLessThanOrEqual(width)
      if (row.start > 0) expect(text.charAt(row.start)).not.toBe(' ')
    }
  }
})

test('a no-break space keeps the words on each side together', () => {
  // 'ab cd' is one word: cut, as it is wider than the row.
  expect(rowsOf('ab\u00a0cd ef', 4)[0]).toEqual({ start: 0, end: 4, isWrapped: true })
  expect(rowsOf('ab cd ef', 4)[0]).toEqual({ start: 0, end: 3, isWrapped: true })
})

test('wide characters count their two cells, and are never cut in two', () => {
  // '日本' | '語で' | 'す'.
  expect(rowsOf('\u{65E5}\u{672C}\u{8A9E}\u{3067}\u{3059}', 5)).toEqual([
    { start: 0, end: 2, isWrapped: true },
    { start: 2, end: 4, isWrapped: true },
    { start: 4, end: 5 },
  ])
  // An emoji's two code units stay together: 'a' | '😀' | 'b'.
  expect(rowsOf('a\u{1F600}b', 2)).toEqual([
    { start: 0, end: 1, isWrapped: true },
    { start: 1, end: 3, isWrapped: true },
    { start: 3, end: 4 },
  ])
  // A character wider than the row takes one of its own.
  expect(rowsOf('\u{65E5}', 1)).toEqual([
    { start: 0, end: 1 },
    { start: 1, end: 1 },
  ])
})

test('a character and the marks drawn on it are one cluster', () => {
  const accents = 'e\u{301}te\u{301}'
  expect(clustersOf(accents)).toEqual([
    { start: 0, end: 2, width: 1 },
    { start: 2, end: 3, width: 1 },
    { start: 3, end: 5, width: 1 },
  ])
  // A flag, a technologist (an emoji sequence), a red heart.
  expect(clustersOf('\u{1F1EB}\u{1F1F7}')).toEqual([{ start: 0, end: 4, width: 2 }])
  expect(clustersOf('\u{1F469}\u{200D}\u{1F4BB}!')).toEqual([
    { start: 0, end: 5, width: 2 },
    { start: 5, end: 6, width: 1 },
  ])
  expect(clustersOf('\u{2764}\u{FE0F}')).toEqual([{ start: 0, end: 2, width: 2 }])
  expect(clustersOf('abc', 0, 3, 2)).toEqual([
    { start: 0, end: 1, width: 1 },
    { start: 1, end: 2, width: 1 },
  ])
})

test('the cursor steps over a whole cluster, and a line break', () => {
  const text = 'a\u{1F600}e\u{301}\nb'
  expect(clusterAfter(text, 0)).toBe(1)
  expect(clusterAfter(text, 1)).toBe(3)
  expect(clusterAfter(text, 3)).toBe(5)
  expect(clusterAfter(text, 5)).toBe(6)
  expect(clusterAfter(text, 7)).toBe(7)
  expect(clusterBefore(text, 7)).toBe(6)
  expect(clusterBefore(text, 6)).toBe(5)
  expect(clusterBefore(text, 5)).toBe(3)
  expect(clusterBefore(text, 3)).toBe(1)
  expect(clusterBefore(text, 0)).toBe(0)
})

test('a column maps to the cursor and back, in cells', () => {
  const text = '\u{65E5}\u{672C} ab'
  const [row] = rowsOf(text, 10)
  if (row === undefined) throw new Error('no row')
  expect(columnOf(text, row, 2)).toBe(4)
  expect(columnOf(text, row, 5)).toBe(7)
  // Over a wide character's second cell: before it.
  expect(offsetAt(text, row, 1)).toBe(0)
  expect(offsetAt(text, row, 2)).toBe(1)
  expect(offsetAt(text, row, 4)).toBe(2)
  // Past the text: at the line's end.
  expect(offsetAt(text, row, 99)).toBe(5)
})

test('on a wrapped row the cursor goes at most before its last character', () => {
  const text = 'un deux trois'
  const [first, second] = rowsOf(text, 8)
  if (first === undefined || second === undefined) throw new Error('no rows')
  // Before the space after 'deux': where the next row starts is the next row's.
  expect(offsetAt(text, first, 99)).toBe(7)
  expect(offsetAt(text, first, 7)).toBe(7)
  expect(offsetAt(text, second, 99)).toBe(13)
  expect(rowOf(rowsOf(text, 8), 8)).toBe(1)
})

test("a wrapped row's last stop: before the spaces it ends with, or its last character", () => {
  const spaced = 'abc de f'
  const cut = 'abcdefgh'
  const [spacedRow] = rowsOf(spaced, 6)
  const [cutRow] = rowsOf(cut, 4)
  if (spacedRow === undefined || cutRow === undefined) throw new Error('no rows')
  expect(rowLast(spaced, spacedRow)).toBe(6)
  expect(rowLast(cut, cutRow)).toBe(3)
})

test('a text laid out again gives the same rows, a line changed its own', () => {
  const text = 'un deux trois\nquatre cinq six'
  const first = rowsOf(text, 8)
  expect(rowsOf(text, 8)).toBe(first)
  expect(rowsOf(text, 9)).not.toBe(first)
  expect(rowsOf('un deux trois\nquatre cinq sept', 8)).toEqual([
    ...first.slice(0, 2),
    { start: 14, end: 21, isWrapped: true },
    { start: 21, end: 26, isWrapped: true },
    { start: 26, end: 30 },
  ])
})
