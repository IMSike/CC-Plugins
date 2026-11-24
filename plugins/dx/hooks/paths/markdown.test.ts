import { expect, test } from 'claude-code/testing'

import { normalizedLabel, readMarkdown } from './markdown'

// The places a reading marks, as the text they cover.
function covered(text: string, ranges: readonly (readonly [number, number])[]): string[] {
  return ranges.map(([from, to]) => text.slice(from, to))
}

test('the plain text and the code spans of a reply are told apart', () => {
  const text = '[r]: x\n\nVoir `a.ts` [l](src/c.ts) <b>x</b> [r][src/a.ts]'
  const read = readMarkdown(text)
  expect(read).toBeDefined()
  if (read === undefined) return
  expect(covered(text, read.code)).toEqual(['`a.ts`'])
  // A label after a defined one is guarded; the definition is no text.
  expect(covered(text, read.guarded)).toEqual(['[src/a.ts]'])
  expect(read.defined.has('R')).toBe(true)
  expect(read.text[0]).toBe(0)
  expect(read.text[text.indexOf('Voir')]).toBe(1)
  // Raw HTML is no text.
  expect(read.text[text.indexOf('<b>')]).toBe(0)
})

test('a fenced or indented code block is code, not text', () => {
  const text = '```\nsrc/a.ts\n```\n\n    src/b.ts\n\nsrc/c.ts'
  const read = readMarkdown(text)
  expect(read?.text[text.indexOf('src/a.ts')]).toBe(0)
  expect(read?.text[text.indexOf('src/b.ts')]).toBe(0)
  expect(read?.text[text.indexOf('src/c.ts')]).toBe(1)
})

test('a reply nesting more than MAX_DEPTH block quotes and list items is not read', () => {
  expect(readMarkdown(`${'> '.repeat(100)}src/a.ts`)).toBeDefined()
  expect(readMarkdown(`${'> - '.repeat(50)}src/a.ts`)).toBeDefined()
  expect(readMarkdown(`${'> '.repeat(101)}src/a.ts`)).toBeUndefined()
  expect(readMarkdown(`${'> - '.repeat(50)}- src/a.ts`)).toBeUndefined()
  // Opened over several lines, or with a leaf in the deepest: the same.
  expect(readMarkdown(`${'> '.repeat(60)}a\n${'> '.repeat(60)}- b`)).toBeDefined()
  expect(readMarkdown(`${'> '.repeat(100)}\`\`\`\nx`)).toBeDefined()
  expect(readMarkdown(`${'> '.repeat(60)}a\n${'> '.repeat(60)}${'- '.repeat(41)}b`)).toBeUndefined()
})

test('a line or paragraph separator ends what a pattern of commonmark.js reads to the end of its line', () => {
  // A backtick past a separator does not keep a fence from opening: its
  // lines are code; in a block quote, the next line leaves it, a definition.
  expect(readMarkdown('```\u2028`\nsrc/a.ts\n```')?.text.includes(1)).toBe(false)
  expect(readMarkdown('>```\u2028`\n[r]: x.rd\n[r]')?.defined.has('R')).toBe(true)
  // A backslash before one ends a target in angle brackets: no link but the
  // outer one, whose text is no plain text.
  for (const separator of ['\u2028', '\u2029']) {
    const text = `[see src/b.ts [x](<b\\${separator}>) c](https://e.com)`
    expect(readMarkdown(text)?.text.includes(1)).toBe(false)
  }
})

test('a code span right after an escaped backtick is not read as a path: a link there would make other runs', () => {
  const text = '`\\```b.ts``'
  expect(readMarkdown(text)?.code).toEqual([])
  expect(covered('a ``b.ts`` c', readMarkdown('a ``b.ts`` c')?.code ?? [])).toEqual(['``b.ts``'])
})

test('labels are compared as CommonMark compares them: spaces made one, case folded', () => {
  expect(normalizedLabel('[ Mes  Notes\n]')).toBe(normalizedLabel('[mes notes]'))
  expect(normalizedLabel('[ẞ]')).toBe(normalizedLabel('[ss]'))
})
