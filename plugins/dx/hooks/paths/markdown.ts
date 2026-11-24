// A reply's markdown read as CommonMark 0.31.2 reads it (commonmark.js, its
// reference implementation), for the paths alone: which characters are
// plain text, what of the rest a path may still be found in (an inline code
// span), and the reference labels defined. Pure: one pass over the lines for
// the blocks, then one over each paragraph and heading for its inlines.

// Past this many block quotes and list items open at once, one inside the
// other, the reply is not read: each line goes through all of them, which a
// deeper stack would make quadratic. Checked as each block starts, the only
// place one opens. No reply nests so deep.
const MAX_DEPTH = 100

// What the paths are looked for in. Positions are the text's (`\r\n` two
// characters, a line ending at `\n`, `\r\n` or `\r`).
type Markdown = {
  // 1 for each character of plain text: in a paragraph or a heading, outside
  // code spans, raw HTML, autolinks, links and images (their text
  // included), and reference definitions. 0 for anything else: code blocks,
  // HTML blocks, the marks of block quotes, list items, headings and
  // thematic breaks, the spaces markdown drops.
  text: Uint8Array
  // The code spans on one line outside links and images, backticks included,
  // but one right after a backtick (an escaped one): a link's `[` written
  // between the two would make other backtick runs of them.
  code: [number, number][]
  // Where a `]` that closes no link or image stands, and where a shortcut
  // reference (`[ref]`) ends: a link written right after either would read
  // as a reference's label (`[ref][path](url)`).
  closers: Set<number>
  shortcutEnds: Set<number>
  // The labels written right after a `]` whose own text is a label defined
  // (`[ref][label]`, `label` not one): a link made in one would make the
  // `]` a shortcut reference's.
  guarded: [number, number][]
  // The labels defined, as `normalizedLabel` writes them.
  defined: Set<string>
}

// A label as CommonMark compares labels: its brackets left out, its spaces
// trimmed and made one, its case folded.
export function normalizedLabel(label: string): string {
  return label.slice(1, -1).trim().replace(/[ \t\r\n]+/g, ' ').toLowerCase().toUpperCase()
}

// The text read as markdown; undefined past MAX_DEPTH.
export function readMarkdown(source: string): Markdown | undefined {
  // NUL is read as U+FFFD, one character for another.
  const text = source.includes('\0') ? source.replace(/\0/g, '�') : source
  const blocks = readBlocks(text)
  if (blocks === undefined) return undefined
  const read: Markdown = {
    text: new Uint8Array(text.length),
    code: [],
    closers: new Set(),
    shortcutEnds: new Set(),
    guarded: [],
    defined: blocks.defined,
  }
  // The opaque ranges, as differences: +1 where one starts, -1 where it ends.
  const opaque = new Int32Array(text.length + 1)
  for (const leaf of blocks.leaves) readInlines(leaf, read, opaque)
  let depth = 0
  for (let at = 0; at < text.length; at++) {
    depth += opaque[at] ?? 0
    if (depth > 0) read.text[at] = 0
  }
  return read
}

// A paragraph's or a heading's content as CommonMark builds it: its lines
// joined by `\n`, each with the place in the text of each of its characters
// (`places`; a tab's spaces, a partly read tab, all at the tab's place).
type Leaf = { content: string; places: Int32Array; skip: number }

// ---------------------------------------------------------------------------
// Blocks: commonmark.js's `incorporateLine`, with its container stack (block
// quotes, list items), its lazy continuation lines and its leaves. Lists are
// left out: an item is its own container, which reads the same lines.

type Block =
  | { type: 'document' | 'quote' | 'heading' | 'thematic' | 'indented' }
  | { type: 'item'; width: number; hasChild: boolean }
  | { type: 'fence'; sign: string; length: number; offset: number }
  | { type: 'html'; kind: number }
  | { type: 'paragraph'; lines: Line[]; skip: number }

// A line of a paragraph: its text from `from` to `to`, `pad` spaces before
// it (a tab partly read, at `tab`), and its end at `end`.
type Line = { from: number; to: number; pad: number; tab: number; end: number }

const CODE_INDENT = 4

// The HTML blocks' starts and ends, CommonMark's types 1 to 7.
const HTML_OPEN = [
  /<(?:script|pre|textarea|style)(?:\s|>|$)/iy,
  /<!--/y,
  /<\?/y,
  /<![A-Za-z]/y,
  /<!\[CDATA\[/y,
  /<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[123456]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|search|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|\/?>|$)/iy,
]
const HTML_CLOSE = [/<\/(?:script|pre|textarea|style)>/i, /-->/, /\?>/, />/, /\]\]>/]
const ATX = /#{1,6}(?:[ \t]+|$)/y
const SETEXT = /(?:=+|-+)[ \t]*$/y
const ORDERED = /(\d{1,9})([.)])/y
const SPACES_TO_END = /\s*$/y
// A backtick in a fence's info string, as commonmark.js's `(?!.*`)` finds
// one: its `.` stops at a line or paragraph separator.
const FENCE_INFO_TICK = /^[^\u2028\u2029]*`/
// A line and its end, none for the last.
const LINE = /([^\r\n]*)(\r\n|\r|\n|)/g

function isSpaceOrTab(sign: string | undefined): boolean {
  return sign === ' ' || sign === '\t'
}

// Past what `pattern` (sticky) matches at `at` of `text`, or -1.
function matchedEnd(pattern: RegExp, text: string, at: number): number {
  pattern.lastIndex = at
  return pattern.test(text) ? pattern.lastIndex : -1
}

type Blocks = { leaves: Leaf[]; defined: Set<string> }

function readBlocks(text: string): Blocks | undefined {
  const leaves: Leaf[] = []
  const defined = new Set<string>()
  const stack: Block[] = [{ type: 'document' }]

  // The state of the line read, as commonmark.js names it.
  let line = ''
  let lineStart = 0
  let offset = 0
  let column = 0
  let nextNonspace = 0
  let nextNonspaceColumn = 0
  let indent = 0
  let indented = false
  let blank = false
  let partiallyConsumedTab = false
  let allClosed = true
  let lastMatched = 0
  // The block quotes and list items open (MAX_DEPTH).
  let containers = 0

  const findNextNonspace = () => {
    let at = offset
    let columns = column
    let sign = line[at]
    while (sign === ' ' || sign === '\t') {
      columns += sign === ' ' ? 1 : 4 - (columns % 4)
      sign = line[++at]
    }
    blank = sign === undefined
    nextNonspace = at
    nextNonspaceColumn = columns
    indent = columns - column
    indented = indent >= CODE_INDENT
  }
  const advanceNextNonspace = () => {
    offset = nextNonspace
    column = nextNonspaceColumn
    partiallyConsumedTab = false
  }
  const advanceOffset = (count: number, columns: boolean) => {
    let left = count
    while (left > 0 && offset < line.length) {
      if (line[offset] === '\t') {
        const toTab = 4 - (column % 4)
        if (columns) {
          partiallyConsumedTab = toTab > left
          const advance = toTab > left ? left : toTab
          column += advance
          offset += partiallyConsumedTab ? 0 : 1
          left -= advance
        } else {
          partiallyConsumedTab = false
          column += toTab
          offset += 1
          left -= 1
        }
      } else {
        partiallyConsumedTab = false
        offset += 1
        column += 1
        left -= 1
      }
    }
  }
  const tip = () => stack[stack.length - 1] ?? { type: 'document' }

  // A block closed: a paragraph's definitions read, its rest kept for its
  // inlines; a heading kept.
  const finalize = () => {
    const block = stack.pop()
    if (block?.type === 'quote' || block?.type === 'item') containers--
    else if (block?.type === 'paragraph') {
      const leaf = leafOf(text, block.lines, block.skip)
      leaf.skip = definitionsEnd(leaf.content, leaf.skip, defined)
      if (leaf.content.slice(leaf.skip).trim() !== '') leaves.push(leaf)
    }
  }
  const closeUnmatchedBlocks = () => {
    if (allClosed) return
    while (stack.length - 1 > lastMatched) finalize()
    allClosed = true
  }
  const addChild = (block: Block) => {
    // Only a container takes a child: any leaf open is closed first.
    for (let top = tip(); top.type !== 'document' && top.type !== 'quote' && top.type !== 'item'; top = tip()) finalize()
    const parent = tip()
    if (parent.type === 'item') parent.hasChild = true
    stack.push(block)
    if (block.type === 'quote' || block.type === 'item') containers++
  }
  const addLine = () => {
    const block = tip()
    if (block.type !== 'paragraph') return
    let pad = 0
    const tab = lineStart + offset
    if (partiallyConsumedTab) {
      offset += 1
      pad = 4 - (column % 4)
    }
    block.lines.push({ from: lineStart + offset, to: lineStart + line.length, pad, tab, end: lineStart + line.length })
  }

  // A block quote's marker at the line's next non-space, read with the space
  // after it; false when there is none.
  const quoteMarker = (): boolean => {
    if (indented || line[nextNonspace] !== '>') return false
    advanceNextNonspace()
    advanceOffset(1, false)
    if (isSpaceOrTab(line[offset])) advanceOffset(1, true)
    return true
  }

  // Whether a container goes on: 0 when it does, 1 when it does not, as
  // commonmark.js's `continue` (2 is a closing fence: the line read).
  const goesOn = (block: Block): 0 | 1 | 2 => {
    switch (block.type) {
      case 'document':
        return 0
      case 'quote':
        return quoteMarker() ? 0 : 1
      case 'item':
        if (blank) {
          if (!block.hasChild) return 1
          advanceNextNonspace()
        } else if (indent >= block.width) {
          advanceOffset(block.width, true)
        } else {
          return 1
        }
        return 0
      case 'heading':
      case 'thematic':
        return 1
      case 'fence': {
        if (indent <= 3 && line[nextNonspace] === block.sign) {
          let end = nextNonspace
          while (line[end] === block.sign) end++
          let rest = end
          while (isSpaceOrTab(line[rest])) rest++
          if (end - nextNonspace >= 3 && end - nextNonspace >= block.length && rest === line.length) {
            finalize()
            return 2
          }
        }
        for (let left = block.offset; left > 0 && isSpaceOrTab(line[offset]); left--) advanceOffset(1, true)
        return 0
      }
      case 'indented':
        if (indent >= CODE_INDENT) advanceOffset(CODE_INDENT, true)
        else if (blank) advanceNextNonspace()
        else return 1
        return 0
      case 'html':
        return blank && block.kind >= 6 ? 1 : 0
      case 'paragraph':
        return blank ? 1 : 0
    }
  }

  // The block starts, tried in this order: 0 none, 1 a container, 2 a leaf.
  const starts: ((container: Block) => 0 | 1 | 2)[] = [
    // A block quote.
    () => {
      if (!quoteMarker()) return 0
      closeUnmatchedBlocks()
      addChild({ type: 'quote' })
      return 1
    },
    // An ATX heading, its closing marks left out.
    () => {
      const end = indented ? -1 : matchedEnd(ATX, line, nextNonspace)
      if (end < 0) return 0
      advanceNextNonspace()
      advanceOffset(end - nextNonspace, false)
      closeUnmatchedBlocks()
      addChild({ type: 'heading' })
      const content = headingContent(line, offset)
      leaves.push(leafOf(text, [{ from: lineStart + offset, to: lineStart + offset + content, pad: 0, tab: 0, end: lineStart + line.length }], 0))
      advanceOffset(line.length - offset, false)
      return 2
    },
    // A fenced code block: three backticks or more with none after them on
    // the line before a line or paragraph separator (U+2028, U+2029), where
    // commonmark.js's pattern stops looking; or three tildes or more.
    () => {
      const sign = line[nextNonspace]
      if (indented || (sign !== '`' && sign !== '~')) return 0
      let end = nextNonspace
      while (line[end] === sign) end++
      if (end - nextNonspace < 3 || (sign === '`' && FENCE_INFO_TICK.test(line.slice(end)))) return 0
      closeUnmatchedBlocks()
      addChild({ type: 'fence', sign, length: end - nextNonspace, offset: indent })
      advanceNextNonspace()
      advanceOffset(end - nextNonspace, false)
      return 2
    },
    // An HTML block. Type 7 interrupts no paragraph, a lazy one included.
    container => {
      if (indented || line[nextNonspace] !== '<') return 0
      for (let kind = 1; kind <= 7; kind++) {
        const opens =
          kind < 7
            ? matchedEnd(HTML_OPEN[kind - 1] ?? /$^/y, line, nextNonspace) >= 0
            : container.type !== 'paragraph' && !(!allClosed && !blank && tip().type === 'paragraph') && isTagLine(line, nextNonspace)
        if (!opens) continue
        closeUnmatchedBlocks()
        addChild({ type: 'html', kind })
        return 2
      }
      return 0
    },
    // A setext heading's underline: the paragraph's definitions read, a
    // heading of what is left, if anything.
    container => {
      if (indented || container.type !== 'paragraph' || matchedEnd(SETEXT, line, nextNonspace) < 0) return 0
      closeUnmatchedBlocks()
      const leaf = leafOf(text, container.lines, container.skip)
      container.skip = definitionsEnd(leaf.content, leaf.skip, defined)
      if (container.skip >= leaf.content.length) return 0
      stack.pop()
      leaf.skip = container.skip
      leaves.push(leaf)
      stack.push({ type: 'heading' })
      advanceOffset(line.length - offset, false)
      return 2
    },
    // A thematic break.
    () => {
      if (indented || !isThematicBreak(line, nextNonspace)) return 0
      closeUnmatchedBlocks()
      addChild({ type: 'thematic' })
      advanceOffset(line.length - offset, false)
      return 2
    },
    // A list item.
    container => {
      const width = indented ? undefined : listItemWidth(container)
      if (width === undefined) return 0
      closeUnmatchedBlocks()
      addChild({ type: 'item', width, hasChild: false })
      return 1
    },
    // An indented code block.
    () => {
      if (!indented || tip().type === 'paragraph' || blank) return 0
      advanceOffset(CODE_INDENT, true)
      closeUnmatchedBlocks()
      addChild({ type: 'indented' })
      return 2
    },
  ]

  // A list item's marker at the line's next non-space: the columns its
  // content starts past the container's, as commonmark.js's
  // `parseListMarker` reads them; the line read up to its content.
  const listItemWidth = (container: Block): number | undefined => {
    if (indent >= 4) return undefined
    const sign = line[nextNonspace]
    let markerEnd: number
    if (sign === '*' || sign === '+' || sign === '-') {
      markerEnd = nextNonspace + 1
    } else {
      ORDERED.lastIndex = nextNonspace
      const ordered = ORDERED.exec(line)
      if (ordered === null || (container.type === 'paragraph' && Number(ordered[1]) !== 1)) return undefined
      markerEnd = ORDERED.lastIndex
    }
    const after = line[markerEnd]
    if (after !== undefined && !isSpaceOrTab(after)) return undefined
    // Interrupting a paragraph, an item may not be empty.
    if (container.type === 'paragraph' && !/[^ \t\f\v\r\n]/.test(line.slice(markerEnd))) return undefined
    const markerOffset = indent
    const marker = markerEnd - nextNonspace
    advanceNextNonspace()
    advanceOffset(marker, true)
    const spacesStartColumn = column
    const spacesStartOffset = offset
    do advanceOffset(1, true)
    while (column - spacesStartColumn < 5 && isSpaceOrTab(line[offset]))
    const blankItem = offset >= line.length
    const spaces = column - spacesStartColumn
    if (spaces >= 5 || spaces < 1 || blankItem) {
      column = spacesStartColumn
      offset = spacesStartOffset
      if (isSpaceOrTab(line[offset])) advanceOffset(1, true)
      return markerOffset + marker + 1
    }
    return markerOffset + marker + spaces
  }

  // One line, from `start`: false when its block quotes and list items nest
  // too deep (MAX_DEPTH).
  const readLine = (start: number, end: number): boolean => {
    line = text.slice(start, end)
    lineStart = start
    offset = 0
    column = 0
    blank = false
    partiallyConsumedTab = false
    const oldTip = stack.length - 1
    let container = 0
    let closed = false
    for (let at = 1; at < stack.length; at++) {
      findNextNonspace()
      const result = goesOn(stack[at] ?? { type: 'document' })
      if (result === 2) {
        closed = true
        break
      }
      if (result === 1) break
      container = at
    }
    if (closed) return true
    allClosed = container === oldTip
    lastMatched = container
    let current = stack[container] ?? { type: 'document' }
    let matchedLeaf = current.type === 'fence' || current.type === 'indented' || current.type === 'html'
    while (!matchedLeaf) {
      findNextNonspace()
      if (!indented && !/[#`~*+_=<>0-9-]/.test(line[nextNonspace] ?? '')) {
        advanceNextNonspace()
        break
      }
      let tried = 0
      for (const start of starts) {
        const result = start(current)
        if (result !== 0) {
          current = tip()
          matchedLeaf = result === 2
          break
        }
        tried++
      }
      if (containers > MAX_DEPTH) return false
      if (tried === starts.length) {
        advanceNextNonspace()
        break
      }
    }
    // What is left of the line is text: a lazy paragraph's line, a leaf's,
    // or a new paragraph.
    const top = tip()
    if (!allClosed && !blank && top.type === 'paragraph') {
      addLine()
      return true
    }
    closeUnmatchedBlocks()
    if (current.type === 'paragraph') {
      addLine()
    } else if (current.type === 'html') {
      const kind = current.kind
      if (kind <= 5 && HTML_CLOSE[kind - 1]?.test(line.slice(offset)) === true) finalize()
    } else if (current.type !== 'fence' && current.type !== 'indented' && offset < line.length && !blank) {
      addChild({ type: 'paragraph', lines: [], skip: 0 })
      advanceNextNonspace()
      addLine()
    }
    return true
  }

  // Each line, ended by `\n`, `\r\n` or `\r`; a final line feed ends the
  // last line, no line after it.
  for (const one of text.matchAll(LINE)) {
    if (one.index === text.length && text.length > 0 && text.endsWith('\n')) break
    if (!readLine(one.index, one.index + (one[1] ?? '').length)) return undefined
    if (one[2] === '') break
  }
  while (stack.length > 0) finalize()
  return { leaves, defined }
}

// The length of an ATX heading's content from `at`, its closing marks and
// the spaces before them left out, as commonmark.js cuts them, read once.
function headingContent(line: string, at: number): number {
  let end = line.length
  while (end > at && isSpaceOrTab(line[end - 1])) end--
  let marks = end
  while (marks > at && line[marks - 1] === '#') marks--
  if (marks === end) return line.length - at
  let spaces = marks
  while (spaces > at && isSpaceOrTab(line[spaces - 1])) spaces--
  // Marks alone, spaces around them: no content.
  if (spaces === at) return 0
  return spaces < marks ? spaces - at : line.length - at
}

// Whether `line` from `at` is a thematic break: three `*`, `-` or `_` or
// more, the same, spaces or tabs between them, nothing else.
function isThematicBreak(line: string, at: number): boolean {
  const sign = line[at]
  if (sign !== '*' && sign !== '-' && sign !== '_') return false
  let count = 0
  for (let index = at; index < line.length; index++) {
    if (line[index] === sign) count++
    else if (!isSpaceOrTab(line[index])) return false
  }
  return count >= 3
}

// Whether `line` from `at` is an HTML block of type 7: an open or a closing
// tag, alone on its line.
function isTagLine(line: string, at: number): boolean {
  const end = tagEnd(line, at, new Scan(line))
  return end >= 0 && matchedEnd(SPACES_TO_END, line, end) >= 0
}

// A paragraph's (or a heading's) content and places, as commonmark.js
// builds its `_string_content`: each line, after a partly read tab's spaces,
// then `\n`.
function leafOf(text: string, lines: readonly Line[], skip: number): Leaf {
  let length = 0
  for (const one of lines) length += one.pad + (one.to - one.from) + 1
  const places = new Int32Array(length)
  const parts: string[] = []
  let at = 0
  for (const one of lines) {
    if (one.pad > 0) parts.push(' '.repeat(one.pad))
    for (let pad = 0; pad < one.pad; pad++) places[at++] = one.tab
    parts.push(text.slice(one.from, one.to), '\n')
    for (let place = one.from; place < one.to; place++) places[at++] = place
    places[at++] = one.end
  }
  return { content: parts.join(''), places, skip }
}

// ---------------------------------------------------------------------------
// Inlines: commonmark.js's inline parser, for what is no plain text.

// The ASCII punctuation a backslash escapes.
const ESCAPABLE = /[!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~-]/
const AUTOLINK = /<[A-Za-z][A-Za-z0-9.+-]{1,31}:[^<>\x00-\x20]*>/y
const EMAIL = /<[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*>/y
const MAX_LABEL = 1001
// What a pattern's `.` does not take, but a carriage return, which no
// paragraph holds.
const LINE_BREAK = /[\n\u2028\u2029]/

function isEscapable(sign: string | undefined): boolean {
  return sign !== undefined && sign.length === 1 && ESCAPABLE.test(sign)
}

// The whitespace a link's destination ends at.
function isLineSpace(sign: string | undefined): boolean {
  return sign === ' ' || sign === '\t' || sign === '\n' || sign === '\v' || sign === '\f' || sign === '\r'
}

// JavaScript's `\s`, which raw HTML's patterns use.
function isSpace(sign: string | undefined): boolean {
  return sign !== undefined && /\s/.test(sign)
}

// What the patterns that look far ahead ask of a text, each found once: the
// place past a string's next occurrence, and the ends of the tags already
// read past a quoted value.
class Scan {
  private readonly found = new Map<string, number[]>()
  readonly tags = new Map<number, number>()
  private readonly text: string
  constructor(text: string) {
    this.text = text
  }

  // Past the first `needle` from `at`, or -1.
  past(needle: string, at: number): number {
    let places = this.found.get(needle)
    if (places === undefined) {
      places = []
      for (let place = this.text.indexOf(needle); place >= 0; place = this.text.indexOf(needle, place + 1)) places.push(place)
      this.found.set(needle, places)
    }
    let low = 0
    let high = places.length
    while (low < high) {
      const middle = (low + high) >> 1
      if ((places[middle] ?? 0) < at) low = middle + 1
      else high = middle
    }
    const place = places[low]
    return place === undefined ? -1 : place + needle.length
  }
}

// An open tag read a sign at a time, every way its pattern may read it at
// once (`<name (\s+attr(\s*=\s*value)?)* \s* /? >`): the states it may be in.
const AFTER_NAME = 1
const SPACED = 2
const IN_ATTRIBUTE = 4
const AFTER_ATTRIBUTE = 8
const BEFORE_VALUE = 16
const IN_VALUE = 32
const SLASH = 64

function isNameStart(sign: string): boolean {
  return /[A-Za-z_:]/.test(sign)
}
function isNameSign(sign: string): boolean {
  return /[A-Za-z0-9_:.-]/.test(sign)
}
function isValueSign(sign: string): boolean {
  return !/["'=<>`\x00-\x20]/.test(sign)
}

// The end of the raw HTML tag at `at` (a `<`) of `text`, or -1: an open or
// a closing tag, a comment, a processing instruction, a declaration, a
// CDATA section. Read once: a quoted value is passed at once, and a tag
// reaching the end of one already read ends where that one did.
function tagEnd(text: string, at: number, scan: Scan): number {
  if (text.startsWith('<!--', at)) {
    if (text.startsWith('<!-->', at)) return at + 5
    if (text.startsWith('<!--->', at)) return at + 6
    return scan.past('-->', at + 4)
  }
  if (text.startsWith('<?', at)) return scan.past('?>', at + 2)
  if (text.startsWith('<![CDATA[', at)) return scan.past(']]>', at + 9)
  if (text[at + 1] === '!') return /[A-Za-z]/.test(text[at + 2] ?? '') ? scan.past('>', at + 3) : -1
  const closing = text[at + 1] === '/'
  let index = at + (closing ? 2 : 1)
  if (!/[A-Za-z]/.test(text[index] ?? '')) return -1
  while (/[A-Za-z0-9-]/.test(text[index] ?? '')) index++
  if (closing) {
    while (isSpace(text[index])) index++
    return text[index] === '>' ? index + 1 : -1
  }
  const quoted: number[] = []
  let end = -1
  let states = AFTER_NAME
  for (; index < text.length && states !== 0; index++) {
    const sign = text[index] ?? ''
    if (sign === '>' && (states & ~BEFORE_VALUE) !== 0) {
      end = index + 1
      break
    }
    if ((sign === '"' || sign === "'") && (states & BEFORE_VALUE) !== 0) {
      const close = scan.past(sign, index + 1)
      if (close < 0) break
      const known = scan.tags.get(close)
      if (known !== undefined) {
        end = known
        break
      }
      quoted.push(close)
      states = AFTER_NAME
      index = close - 1
      continue
    }
    const space = isSpace(sign)
    let next = 0
    if (states & (AFTER_NAME | SPACED | IN_ATTRIBUTE | AFTER_ATTRIBUTE | IN_VALUE)) {
      if (sign === '/') next |= SLASH
    }
    if (states & AFTER_NAME) {
      if (space) next |= SPACED
    }
    if (states & SPACED) {
      if (space) next |= SPACED
      else if (isNameStart(sign)) next |= IN_ATTRIBUTE
    }
    if (states & IN_ATTRIBUTE) {
      if (isNameSign(sign)) next |= IN_ATTRIBUTE
      else if (space) next |= AFTER_ATTRIBUTE
      else if (sign === '=') next |= BEFORE_VALUE
    }
    if (states & AFTER_ATTRIBUTE) {
      if (space) next |= AFTER_ATTRIBUTE
      else if (sign === '=') next |= BEFORE_VALUE
      else if (isNameStart(sign)) next |= IN_ATTRIBUTE
    }
    if (states & BEFORE_VALUE) {
      if (space) next |= BEFORE_VALUE
      else if (isValueSign(sign)) next |= IN_VALUE
    }
    if (states & IN_VALUE) {
      if (isValueSign(sign)) next |= IN_VALUE
      if (space) next |= SPACED
    }
    states = next
  }
  for (const place of quoted) scan.tags.set(place, end)
  return end
}

// What a paragraph's inlines leave out of its plain text, read into `read`.
function readInlines(leaf: Leaf, read: Markdown, opaque: Int32Array): void {
  // What the inline parser reads: the content past its definitions,
  // trimmed.
  const whole = leaf.content.slice(leaf.skip)
  const subject = whole.trim()
  const base = leaf.skip + whole.length - whole.trimStart().length
  const { places } = leaf
  const place = (at: number) => places[base + at] ?? 0
  for (let at = 0; at < subject.length; at++) if (subject[at] !== '\n') read.text[place(at)] = 1
  const hide = (start: number, end: number) => {
    if (end <= start) return
    opaque[place(start)] = (opaque[place(start)] ?? 0) + 1
    const last = place(end - 1) + 1
    opaque[last] = (opaque[last] ?? 0) - 1
  }
  const code: [number, number][] = []
  const inline = new Inline(subject, read.defined)
  inline.parse({
    hide,
    code: (start, end) => {
      if (subject[start - 1] !== '`' && !subject.slice(start, end).includes('\n')) code.push([start, end])
    },
    // What a link or an image holds is its own: no code span in it is read.
    drop: from => {
      while ((code.at(-1)?.[0] ?? -1) >= from) code.pop()
    },
    closer: at => read.closers.add(place(at)),
    shortcut: end => read.shortcutEnds.add(place(end - 1) + 1),
    guard: (start, end) => read.guarded.push([place(start), place(end - 1) + 1]),
  })
  for (const [start, end] of code) read.code.push([place(start), place(end - 1) + 1])
}

type Found = {
  hide: (start: number, end: number) => void
  code: (start: number, end: number) => void
  drop: (from: number) => void
  closer: (at: number) => void
  shortcut: (end: number) => void
  guard: (start: number, end: number) => void
}

// A `[` or `![` not closed yet.
type Opener = { index: number; image: boolean; bracketAfter: boolean }

class Inline {
  private readonly s: string
  private readonly defined: ReadonlySet<string>
  private readonly scan: Scan
  // For each character, whether a backslash escapes it, read from the
  // start of its run of backslashes.
  private readonly escaped: Uint8Array
  private readonly titles = new Map<number, number>()
  // What only some paragraphs need, made the first time it is: the
  // parentheses (`parens`), the backtick runs (`backticks`).
  private parenArrays: { depth: Int32Array; drop: Int32Array; space: Int32Array } | undefined
  private runs: Map<number, { starts: number[]; next: number }> | undefined

  constructor(s: string, defined: ReadonlySet<string>) {
    this.s = s
    this.defined = defined
    this.scan = new Scan(s)
    const n = s.length
    this.escaped = new Uint8Array(n + 1)
    for (let at = 0; at < n; at++) {
      if (s.charCodeAt(at) === 0x5c && isEscapable(s[at + 1])) {
        this.escaped[at + 1] = 1
        at++
      }
    }
  }

  // For each place: the net count of parentheses before it, escaped ones
  // left out (`depth`); the first `)` from it that brings the count below
  // it within its stretch without whitespace, -1 when none (`drop`); the
  // next whitespace from it, the end when none (`space`).
  private parens(): { depth: Int32Array; drop: Int32Array; space: Int32Array } {
    if (this.parenArrays !== undefined) return this.parenArrays
    const s = this.s
    const n = s.length
    const depth = new Int32Array(n + 1)
    for (let at = 0; at < n; at++) {
      const code = s.charCodeAt(at)
      const counted = this.escaped[at] === 0
      depth[at + 1] = (depth[at] ?? 0) + (counted && code === 0x28 ? 1 : counted && code === 0x29 ? -1 : 0)
    }
    const drop = new Int32Array(n + 1).fill(-1)
    const space = new Int32Array(n + 1).fill(n)
    // The nearest `)` read at each count (shifted by n + 1, a count being
    // within -n..n), and the counts set since the last whitespace, cleared
    // there.
    const nearest = new Int32Array(2 * n + 3).fill(-1)
    const set: number[] = []
    for (let at = n - 1; at >= 0; at--) {
      if (isLineSpace(s[at])) {
        if (set.length > 0) {
          for (const level of set) nearest[level] = -1
          set.length = 0
        }
        space[at] = at
        continue
      }
      space[at] = space[at + 1] ?? n
      const level = (depth[at] ?? 0) + n + 1
      if (s.charCodeAt(at) === 0x29 && this.escaped[at] === 0) {
        nearest[level] = at
        set.push(level)
      }
      drop[at] = nearest[level] ?? -1
    }
    this.parenArrays = { depth, drop, space }
    return this.parenArrays
  }

  // The backtick runs of each length, and how far each was looked through.
  private backticks(): Map<number, { starts: number[]; next: number }> {
    if (this.runs !== undefined) return this.runs
    const s = this.s
    const runs = new Map<number, { starts: number[]; next: number }>()
    for (let at = s.indexOf('`'); at >= 0; at = s.indexOf('`', at)) {
      let end = at
      while (s[end] === '`') end++
      const same = runs.get(end - at) ?? { starts: [], next: 0 }
      same.starts.push(at)
      runs.set(end - at, same)
      at = end
    }
    this.runs = runs
    return runs
  }

  parse(found: Found): void {
    const s = this.s
    const openers: Opener[] = []
    // Every link opener below this place in `openers` is inactive: a link
    // holds no link.
    let inactiveBelow = 0
    const pop = () => {
      openers.pop()
      inactiveBelow = Math.min(inactiveBelow, openers.length)
    }
    let pos = 0
    while (pos < s.length) {
      const sign = s[pos]
      if (sign === '\\') {
        pos += s[pos + 1] === '\n' || isEscapable(s[pos + 1]) ? 2 : 1
      } else if (sign === '`') {
        let end = pos
        while (s[end] === '`') end++
        const close = this.closingRun(end - pos, end)
        if (close < 0) {
          pos = end
        } else {
          found.hide(pos, close)
          found.code(pos, close)
          pos = close
        }
      } else if (sign === '[' || (sign === '!' && s[pos + 1] === '[')) {
        const top = openers.at(-1)
        if (top !== undefined) top.bracketAfter = true
        const image = sign === '!'
        openers.push({ index: image ? pos + 1 : pos, image, bracketAfter: false })
        pos += image ? 2 : 1
      } else if (sign === ']') {
        const opener = openers.at(-1)
        const startpos = pos + 1
        if (opener === undefined) {
          found.closer(pos)
          pos = startpos
          continue
        }
        if (!opener.image && openers.length - 1 < inactiveBelow) {
          found.closer(pos)
          pop()
          pos = startpos
          continue
        }
        const link = this.linkAfter(startpos, opener)
        if (link === undefined) {
          // A label after it kept it from being a shortcut reference.
          const label = this.labelLength(startpos)
          if (label > 2 && !opener.bracketAfter && this.defined.has(normalizedLabel(s.slice(opener.index, startpos)))) found.guard(startpos, startpos + label)
          found.closer(pos)
          pop()
          pos = startpos
          continue
        }
        const from = opener.image ? opener.index - 1 : opener.index
        found.drop(from)
        found.hide(from, link.end)
        if (link.shortcut) found.shortcut(link.end)
        pop()
        if (!opener.image) inactiveBelow = openers.length
        pos = link.end
      } else if (sign === '<') {
        const end = Math.max(matchedEnd(AUTOLINK, s, pos), matchedEnd(EMAIL, s, pos))
        const raw = end >= 0 ? end : tagEnd(s, pos, this.scan)
        if (raw < 0) {
          pos++
        } else {
          found.hide(pos, raw)
          pos = raw
        }
      } else {
        pos++
      }
    }
  }

  // Past the run of `length` backticks that closes the one ending at
  // `from`, or -1.
  private closingRun(length: number, from: number): number {
    const same = this.backticks().get(length)
    if (same === undefined) return -1
    while ((same.starts[same.next] ?? Number.POSITIVE_INFINITY) < from) same.next++
    const start = same.starts[same.next]
    return start === undefined ? -1 : start + length
  }

  // Past spaces and at most one line break, from `at`.
  spnl(at: number): number {
    let pos = at
    while (this.s[pos] === ' ') pos++
    if (this.s[pos] === '\n') {
      pos++
      while (this.s[pos] === ' ') pos++
    }
    return pos
  }

  // What a `]` before `at` closes, its opener `opener`: an inline link, or a
  // reference to a label defined (a shortcut one when no label follows);
  // undefined when it closes none.
  private linkAfter(at: number, opener: Opener): { end: number; shortcut?: true } | undefined {
    const s = this.s
    if (s[at] === '(') {
      const start = this.spnl(at + 1)
      const destination = this.destinationEnd(start)
      if (destination >= 0) {
        let pos = this.spnl(destination)
        if (isLineSpace(s[pos - 1])) {
          const title = this.titleEnd(pos)
          if (title >= 0) pos = title
        }
        pos = this.spnl(pos)
        if (s[pos] === ')') return { end: pos + 1 }
      }
    }
    const label = this.labelLength(at)
    let reference: string | undefined
    if (label > 2) reference = s.slice(at, at + label)
    else if (!opener.bracketAfter) reference = s.slice(opener.index, at)
    if (reference === undefined || !this.defined.has(normalizedLabel(reference))) return undefined
    return label === 0 ? { end: at, shortcut: true } : { end: at + label }
  }

  // The end of a link's destination from `at`, or -1: in angle brackets, or
  // up to whitespace or an unbalanced `)`, its parentheses balanced. In angle
  // brackets, a backslash takes any sign after it but a line break or a line
  // or paragraph separator (U+2028, U+2029), as commonmark.js's `\\.` does.
  destinationEnd(at: number): number {
    const s = this.s
    if (s[at] === '<') {
      for (let index = at + 1; index < s.length; index++) {
        const sign = s[index]
        if (this.escaped[index] === 1) continue
        if (sign === '>') return index + 1
        if (sign === '<' || sign === '\n' || (sign === '\\' && LINE_BREAK.test(s[index + 1] ?? ''))) return -1
      }
      return -1
    }
    const { depth, drop, space } = this.parens()
    const close = drop[at] ?? -1
    if (close >= 0) return close
    const end = space[at] ?? s.length
    if (end === at || depth[end] !== depth[at]) return -1
    return end
  }

  // The end of a link's title at `at`, or -1: in double or single quotes,
  // or parentheses, a backslash escaping the sign after it.
  titleEnd(at: number): number {
    const known = this.titles.get(at)
    if (known !== undefined) return known
    const s = this.s
    const open = s[at]
    const close = open === '(' ? ')' : open
    let end = -1
    if (open === '"' || open === "'" || open === '(') {
      for (let index = at + 1; index < s.length; index++) {
        if (this.escaped[index] === 1) continue
        const sign = s[index]
        if (sign === close) {
          end = index + 1
          break
        }
        if (open === '(' && sign === '(') break
      }
    }
    this.titles.set(at, end)
    return end
  }

  // The length of the link label at `at`, or 0: brackets in it escaped, at
  // most MAX_LABEL characters.
  labelLength(at: number): number {
    const s = this.s
    if (s[at] !== '[') return 0
    const limit = Math.min(s.length, at + MAX_LABEL)
    for (let index = at + 1; index < limit; index++) {
      if (this.escaped[index] === 1) continue
      const sign = s[index]
      if (sign === ']') return index + 1 - at
      if (sign === '[') return 0
    }
    return 0
  }
}

// ---------------------------------------------------------------------------
// Reference definitions, at the start of a paragraph.

// Past the reference definitions at `at` of a paragraph's `content`, their
// labels added to `defined`, as commonmark.js's `parseReference` reads them
// one after the other.
function definitionsEnd(content: string, at: number, defined: Set<string>): number {
  if (content[at] !== '[') return at
  const s = content.slice(at)
  const inline = new Inline(s, defined)
  let pos = 0
  for (let length = 1; s[pos] === '[' && length > 0; pos += length) length = definitionLength(inline, s, pos, defined)
  return at + pos
}

// The length of the definition at `at` of `s` (its own `Inline`), or 0.
function definitionLength(inline: Inline, s: string, at: number, defined: Set<string>): number {
  const label = inline.labelLength(at)
  if (label === 0 || s[at + label] !== ':') return 0
  const start = inline.spnl(at + label + 1)
  const destination = inline.destinationEnd(start)
  if (destination < 0) return 0
  const lineEnd = (from: number) => {
    let pos = from
    while (s[pos] === ' ') pos++
    if (pos >= s.length) return pos
    return s[pos] === '\n' ? pos + 1 : -1
  }
  let end = -1
  const spaced = inline.spnl(destination)
  if (spaced !== destination) {
    const title = inline.titleEnd(spaced)
    if (title >= 0) end = lineEnd(title)
  }
  if (end < 0) end = lineEnd(destination)
  const name = normalizedLabel(s.slice(at, at + label))
  if (end < 0 || name === '') return 0
  defined.add(name)
  return end - at
}
