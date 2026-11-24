// The paths of an assistant reply: found in its markdown and made links to
// `dx-open:` URLs, which herdr's `imsike.links` plugin opens (ADR 0009). Pure,
// without `$`; the file system is asked by ./paths.tsx.
//
// One rule decides what a path is: a run of characters a path is commonly
// made of (`isWrittenPath`). A word holding any other one is no path, whole:
// no part of it is ever read as one. A reply's word therefore has one reading,
// checked once on disk.

import { normalizedPath } from '../shared/windows-path'
import { normalizedLabel, readMarkdown } from './markdown'

// A place in a file: a line, or a range of them.
type Place = { line: number; endLine?: number }

// A path written in the reply: where it is written (`start`..`end`, what the
// link covers, the backticks of inline code included), the path as written,
// and its place.
export type Found = { start: number; end: number; path: string; place?: Place }

// The scheme of the links dx makes, which herdr's `imsike.links` plugin
// answers (its `^dx-open:` link handler).
const DX_OPEN = 'dx-open:'

// The most distinct paths looked for in one reply, which bounds the checks
// one drawing makes on disk; the paths past it are left as written.
const MAX_PATHS = 256
// The longest link made: the length herdr's plugin takes.
const MAX_HREF = 2048

// The Windows environment variables a path may start with (`%TEMP%\a.txt`),
// as ./paths.tsx reads them: their names in capitals, as Windows compares
// them whatever their case.
export const VARIABLES = ['USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMDATA', 'SYSTEMROOT', 'WINDIR', 'PUBLIC'] as const

// How a path may start: a drive (`C:\`, `C:/`), the home (`~/`), a variable
// of VARIABLES (`%TEMP%\`), a drive as Git Bash and WSL write it (`/c/`,
// `/mnt/c/`); else it is relative. Any other root (`/tmp`, `\x`) is no path.
const ABSOLUTE = /^(?:[A-Za-z]:[\\/]|~[\\/]|%[A-Za-z()0-9]+%[\\/]|\/(?:mnt\/)?[A-Za-z]\/)/
// The characters a path is made of past its start: letters of any script and
// the marks that combine with them, decimal digits of any script (not `²`
// nor `½`), `. _ - + ~ @ ( ) '`, the separators; a space where the path is
// delimited (code, quotes).
const NAME_SIGNS = String.raw`\p{L}\p{M}\p{Nd}._\-+~@()'\\/`
// A default-ignorable code point is drawn as nothing (a Hangul filler, a
// variation selector): a path holding one is not the path it looks like.
const VISIBLE = String.raw`(?!\p{Default_Ignorable_Code_Point})`
const WRITTEN = new RegExp(`^(?:${VISIBLE}[${NAME_SIGNS}])+$`, 'u')
const WRITTEN_SPACED = new RegExp(`^(?:${VISIBLE}[${NAME_SIGNS} ])+$`, 'u')
// A line, or a range, after a path (`:12`, `:12-14`, a column dropped:
// `:12:5`).
const LINE_SUFFIX = /:(\d+)(?:-(\d+))?(?::\d+)?$/

// The signs around a word in plain text that are not the path's: before it,
// an opening bracket or quote; after it, a sentence's punctuation or a
// closing one (a `)` only when it closes none the word opened). Then, at the
// word's edges, a run of one emphasis or strikethrough mark as long on both
// sides (`**a.ts**`, `_a.ts_`, `~~a.ts~~`), which markdown draws as no
// character.
const OPENING = '("\'<'
const CLOSING = '.,;:!?)"\'>'
const MARKS = '*_~'
// The signs of NAME_SIGNS a word of prose seldom holds: a word holding one
// next to a path may be the rest of its name.
const NAME_SIGN = /[._\-+~@()'\\/]/
// What CommonMark reads as whitespace: what stands between words.
const SPACE = /[\p{Zs}\t\n\f\r]/u
// Spaces on one line: two words they stand between may be one name.
const SPACED = /^[\p{Zs}\t\f]+$/u
// What Claude Code makes a link of in plain text, looked for in a word
// between whitespace: a URL (`://`, `www.` anywhere), which it extends over
// all that is glued after it, a link dx made included; an email address
// (`a@b.com`, `a@.b`).
const AUTOLINK = /:\/\/|www\.|[A-Za-z0-9._+-]@[A-Za-z0-9._-]*\.[A-Za-z0-9]/i

// Whether `path`, as written, is a path dx may link: it starts as ABSOLUTE
// says or is relative (no root, no network path), holds only WRITTEN signs
// (`spaced`, spaces too), as many `(` as `)`, no two separators in a row,
// no `..` above its start when absolute (`/c/../d` is `D:\` to Git Bash,
// `C:\d` to Windows), ends with no backslash (`\]` would escape the link's
// bracket), and looks like a path: a separator in it, or a name with an
// extension starting with a letter, four signs at least (`README.md`, not
// `1.2` nor `e.g`). No name holds a tilde then a digit (a short 8.3 name,
// `PROGRA~1`: the file it leads to could be any) nor ends with a period or a
// space (Windows drops them, opening another file). With `escapes`, where
// markdown reads a backslash before an ASCII punctuation sign as an escape
// (plain text), the path holds none: what is drawn is not
// what is written (`src\_a.ts` drawn `src_a.ts`).
export function isWrittenPath(path: string, spaced: boolean, escapes: boolean): boolean {
  const start = ABSOLUTE.exec(path)?.[0] ?? ''
  const rest = path.slice(start.length)
  if (rest === '' || (start === '' && /^[\\/]/.test(path)) || !(spaced ? WRITTEN_SPACED : WRITTEN).test(rest)) return false
  if (start.startsWith('%') && !VARIABLES.includes(start.slice(1, start.indexOf('%', 1)).toUpperCase() as (typeof VARIABLES)[number])) return false
  if (rest.split('(').length !== rest.split(')').length || /[\\/]{2}/.test(path) || /\\$|~\d/.test(rest) || (escapes && /\\[!-/:-@[-`{-~]/.test(path))) return false
  const names = rest.split(/[\\/]/)
  if (names.some(name => /[. ]$/.test(name) && name !== '.' && name !== '..')) return false
  let depth = 0
  if (start !== '' && names.some(name => (depth += name === '..' ? -1 : name === '.' ? 0 : 1) < 0)) return false
  return /[\\/]/.test(path) || (path.length >= 4 && /^[^.]+(?:\.[^.]+)*\.\p{L}[\p{L}\p{Nd}_-]*$/u.test(path))
}

// The paths written in `text`, in order, MAX_PATHS distinct ones at most: in
// its plain text and its inline code spans, as CommonMark reads them
// (./markdown), none in a word between whitespace that Claude Code makes a
// link of (AUTOLINK). None in a reply whose block quotes and list items nest
// past what ./markdown reads.
export function findPaths(text: string): Found[] {
  const markdown = readMarkdown(text)
  if (markdown === undefined) return []
  const items: Found[] = []
  const marks = emphasisMarks(text, markdown.text)
  textPaths(text, markdown.text, marks, items)
  for (const [from, to] of markdown.code) {
    const ticks = /^`+/.exec(text.slice(from, to))?.[0].length ?? 0
    const inner = text.slice(from + ticks, to - ticks)
    // CommonMark drops one space on each side, when both hold one and the
    // code is not spaces alone.
    const found = placed(/^ [^]*[^ ][^]* $/.test(inner) ? inner.slice(1, -1) : inner, true, false)
    if (found !== undefined) items.push({ start: from, end: to, ...found })
  }
  const autolinked = new Uint8Array(text.length)
  for (const word of text.matchAll(/\S+/g)) if (AUTOLINK.test(word[0])) autolinked.fill(1, word.index, word.index + word[0].length)
  // A link right after a shortcut reference (`[ref]`), or right after a `]`
  // closing nothing when its own text is a label defined, would make the two
  // one reference link (`[ref][path](url)`); one in a label that keeps a `]`
  // from closing a shortcut reference would let it close one.
  const guarded = new Uint8Array(text.length + 1)
  for (const [from, to] of markdown.guarded) guarded.fill(1, from, to)
  const isKept = (item: Found) =>
    guarded[item.start] === 0 &&
    !autolinked.subarray(item.start, item.end).includes(1) &&
    !markdown.shortcutEnds.has(item.start) &&
    !(markdown.closers.has(item.start - 1) && markdown.defined.has(normalizedLabel(`[${text.slice(item.start, item.end)}]`)))
  const distinct = new Set<string>()
  return items
    .sort((a, b) => a.start - b.start)
    .filter(item => {
      if (!isKept(item) || (!distinct.has(item.path) && distinct.size >= MAX_PATHS)) return false
      distinct.add(item.path)
      return true
    })
}

// A path as written with the line that may follow it (LINE_SUFFIX), and its
// place; none when it is no path dx links (`isWrittenPath`).
function placed(written: string, spaced: boolean, escapes: boolean): { path: string; place?: Place } | undefined {
  const numbers = LINE_SUFFIX.exec(written)
  const path = numbers === null ? written : written.slice(0, numbers.index)
  if (!isWrittenPath(path, spaced, escapes)) return undefined
  return { path, ...placeOf(numbers?.[1], numbers?.[2]) }
}

// The paths of the plain text of `text` (`plain`, 1 for each character of
// it), added to `found`. A word, what stands between spaces, is read as a
// path once the signs around it that are not the path's are left out
// (`trimmed`). A word glued to what is not plain text (code, a link, raw
// HTML) is no path. A run in double quotes on one line may hold spaces
// (`"C:\mes notes\a.txt"`): read whole when it is a path, else word by word.
//
// A path holding a space, written without quotes (`C:\mes notes\a.txt`,
// `fichier (1).txt`, `a - copie.md`), is two words or more: none of them is
// linked, as each may be part of another path. Of two words only spaces
// apart on a line, the second not absolute, neither is linked when the other
// holds a sign a name holds besides letters and digits (NAME_SIGN:
// `notes\a.txt`, `(1).txt`, `-`): the second's closing signs left out, the
// first's opening ones. A word ending with signs left out, or a line ending,
// ends the path (`src/a.ts, src/b.ts` is a list, `**src/a.ts** src/b.ts` two
// paths, as paths one per line). A word of letters alone next to a path is
// taken as prose (`C:\Program Files` links `C:\Program`, when it exists).
function textPaths(text: string, plain: Uint8Array, marks: Marks, found: Found[]): void {
  // A word, where it is written, the part of it that may be a path, whether
  // it is glued to what is not plain text, and whether it was read in quotes.
  type Word = { start: number; end: number; core: [number, number]; glued: boolean; quoted: boolean }
  const isText = (at: number) => plain[at] === 1
  const isSpace = (at: number) => SPACE.test(text[at] ?? '')
  const words: Word[] = []
  for (let at = 0; at < text.length; ) {
    if (!isText(at) || isSpace(at)) {
      at++
      continue
    }
    const gluedBefore = at > 0 && !isSpace(at - 1)
    const opened = text[at] === '"' ? at + 1 : text.startsWith('("', at) ? at + 2 : -1
    const quoted = opened < 0 || gluedBefore ? undefined : quotedPath(text, opened, isText, isSpace)
    if (quoted !== undefined) {
      words.push({ start: at, end: quoted.close, core: [opened, quoted.close], glued: false, quoted: true })
      const { close, ...path } = quoted
      if (!mayPair(marks, [opened, close])) found.push({ start: opened, end: close, ...path })
      at = close
      continue
    }
    let end = at
    while (isText(end) && !isSpace(end)) end++
    words.push({ start: at, end, core: trimmed(text, at, end), glued: gluedBefore || (end < text.length && !isSpace(end)), quoted: false })
    at = end
  }
  const blocked = new Set<Word>()
  for (let index = 1; index < words.length; index++) {
    const [first, second] = [words[index - 1], words[index]] as [Word, Word]
    if (first.quoted || second.quoted || first.core[1] !== first.end || !SPACED.test(text.slice(first.end, second.start))) continue
    if (ABSOLUTE.test(text.slice(...second.core))) continue
    if (NAME_SIGN.test(text.slice(second.start, second.core[1]))) blocked.add(first)
    if (NAME_SIGN.test(text.slice(first.core[0], first.end))) blocked.add(second)
  }
  for (const word of words) {
    if (word.quoted || word.glued || blocked.has(word) || mayPair(marks, word.core)) continue
    const [start, end] = word.core
    const path = placed(text.slice(start, end), false, true)
    if (path !== undefined) found.push({ start, end, ...path })
  }
}

// The runs of `_`, and of two `~`, in a reply's plain text, by where each
// starts, and whether CommonMark's flanking rules let it open or close
// emphasis (`_`) or a strikethrough (`~~`: Claude Code strikes through with
// two tildes alone, and draws any other run as written); and, for each sign,
// where the first run that opens and the last that closes start.
type Run = { sign: string; length: number; open: boolean; close: boolean }
type Marks = { runs: Map<number, Run>; firstOpen: Map<string, number>; lastClose: Map<string, number> }

function emphasisMarks(text: string, plain: Uint8Array): Marks {
  const marks: Marks = { runs: new Map(), firstOpen: new Map(), lastClose: new Map() }
  const isSpace = (sign: string | undefined) => sign === undefined || SPACE.test(sign)
  const isPunctuation = (sign: string | undefined) => sign !== undefined && /[\p{P}\p{S}]/u.test(sign)
  for (let at = 0; at < text.length; at++) {
    const sign = text[at] ?? ''
    if (plain[at] !== 1 || (sign !== '_' && sign !== '~')) continue
    let end = at
    while (text[end] === sign && plain[end] === 1) end++
    if (sign === '~' && end - at !== 2) {
      at = end - 1
      continue
    }
    const [before, after] = [text[at - 1], text[end]]
    const left = !isSpace(after) && (!isPunctuation(after) || isSpace(before) || isPunctuation(before))
    const right = !isSpace(before) && (!isPunctuation(before) || isSpace(after) || isPunctuation(after))
    const open = sign === '~' ? left : left && (!right || isPunctuation(before))
    const close = sign === '~' ? right : right && (!left || isPunctuation(after))
    marks.runs.set(at, { sign, length: end - at, open, close })
    if (open && !marks.firstOpen.has(sign)) marks.firstOpen.set(sign, at)
    if (close) marks.lastClose.set(sign, at)
    at = end - 1
  }
  return marks
}

// Whether a run of `_` or `~~` in `start`..`end`, what a link would cover,
// may pair with another, an opener with a closer after it, a closer with an
// opener before it: drawn as emphasis or a strikethrough, the path is not
// what is written (`src/_a_.ts`, `__init__.py`), and a link around it would
// break one (`_voir le src/a.ts_ ici`, the second `_` read as the name's).
function mayPair(marks: Marks, [start, end]: [number, number]): boolean {
  for (let at = start; at < end; at++) {
    const run = marks.runs.get(at)
    if (run === undefined) continue
    if (run.open && (marks.lastClose.get(run.sign) ?? -1) > at) return true
    if (run.close && (marks.firstOpen.get(run.sign) ?? Infinity) < at) return true
  }
  return false
}

// A path in double quotes, its text starting at `at` (past the quote): what
// stands before the next quote on the line's plain text, when that quote
// ends a word and what it holds is a path, spaces allowed
// (`"C:\mes notes\a.txt"`). `close` is where the closing quote stands.
function quotedPath(text: string, at: number, isText: (at: number) => boolean, isSpace: (at: number) => boolean): { path: string; place?: Place; close: number } | undefined {
  let close = at
  while (isText(close) && text[close] !== '"') close++
  if (!isText(close)) return undefined
  const after = close + 1
  if (after < text.length && !isSpace(after) && !(isText(after) && CLOSING.includes(text[after] ?? ''))) return undefined
  const found = placed(text.slice(at, close), true, true)
  return found === undefined ? undefined : { ...found, close }
}

// The part of the word `start`..`end` of `text` that may be a path: the
// OPENING and CLOSING signs around it left out, and a run of one of MARKS at
// its start when as long a run of it ends it (`**a.ts**`; `~` doubled
// alone, as Claude Code strikes through). Marks past an opening sign, or of
// two kinds (`"*a.ts*"`, `*_a.ts_*`), are kept: next to the link, between two
// punctuation signs, an inner run could pair with one outside the word. Two
// dots or more right after a separator are a name (`../..`, `src/...`, which
// `isWrittenPath` refuses), one a sentence's (`docs/.`).
function trimmed(text: string, start: number, end: number): [number, number] {
  const word = start
  let opened = 0
  let closed = 0
  for (let at = start; at < end; at++) {
    if (text[at] === '(') opened++
    else if (text[at] === ')') closed++
  }
  for (let changed = true; changed && start < end; ) {
    changed = false
    while (start < end && OPENING.includes(text[start] ?? '')) {
      if (text[start] === '(') opened--
      start++
      changed = true
    }
    while (start < end && CLOSING.includes(text[end - 1] ?? '')) {
      if (text[end - 1] === '.') {
        let dots = end
        while (dots > start && text[dots - 1] === '.') dots--
        if (dots === start || ((text[dots - 1] === '/' || text[dots - 1] === '\\') && end - dots > 1)) break
        end = dots
      } else {
        if (text[end - 1] === ')' && opened >= closed) break
        if (text[end - 1] === ')') closed--
        end--
      }
      changed = true
    }
    if (start !== word) continue
    const sign = text[start] ?? ''
    if (!MARKS.includes(sign)) continue
    let lead = start
    while (lead < end && text[lead] === sign) lead++
    let tail = end
    while (tail > lead && text[tail - 1] === sign) tail--
    if (tail > lead && end - tail === lead - start && (sign !== '~' || lead - start === 2)) {
      start = lead
      end = tail
      changed = true
    }
  }
  return [start, end]
}

// A place from the numbers written, none when there is no line. A line past
// MAX_LINE_NUMBER (herdr's plugin reads it as a 32-bit unsigned number)
// drops the place; an end past it, or not past the line, the end alone.
const MAX_LINE_NUMBER = 4_294_967_295
function placeOf(line: string | undefined, end: string | undefined): { place?: Place } {
  const isLine = (value: number) => Number.isSafeInteger(value) && value > 0 && value <= MAX_LINE_NUMBER
  const from = Number(line)
  if (line === undefined || !isLine(from)) return {}
  const to = Number(end)
  return { place: end !== undefined && isLine(to) && to > from ? { line: from, endLine: to } : { line: from } }
}

// A path written from a variable (`%LOCALAPPDATA%\x`) with the variable's
// value in its place, `values` holding each of VARIABLES read; the path as
// written when it starts with none. None for a variable unset, or one that
// holds no path with a drive.
export function withVariable(path: string, values: ReadonlyMap<string, string | undefined>): string | undefined {
  const variable = /^%([^%]+)%(?=[\\/])/.exec(path)
  if (variable === null) return path
  const value = values.get(variable[1]?.toUpperCase() ?? '')
  return value === undefined || !/^[A-Za-z]:[\\/]/.test(value) ? undefined : value + path.slice(variable[0].length)
}

// The `dx-open:` URL of an absolute Windows path, with its place as a
// fragment (`#L12`, `#L12-L14`), as herdr's `imsike.links` plugin reads it:
// `dx-open:///C:/dossier/fichier%20(1).txt#L12-L14`, each segment
// percent-encoded as UTF-8, parentheses and quotes included, so that the
// markdown link holds it whole.
export function dxOpenUrl(abs: string, place?: Place): string {
  const [drive = '', ...parts] = abs.split('\\')
  const encoded = parts.map(part => encodeURIComponent(part).replace(/[!'()*]/g, sign => `%${sign.charCodeAt(0).toString(16).toUpperCase()}`))
  const fragment = place === undefined ? '' : `#L${place.line}${place.endLine !== undefined ? `-L${place.endLine}` : ''}`
  return `${DX_OPEN}///${drive}/${encoded.join('/')}${fragment}`
}

// Whether dx may link an absolute path. What herdr's plugin refuses, as it
// checks a link and the real path it leads to, is refused: no drive (a
// network share), MAX_PATH (260 UTF-16 units) or longer, a device's name
// (`NUL`, `con.txt`, `COM1.md`, which Windows 11 lets a file be named). dx's
// own rule is stricter than herdr's, which refuses in a name
// `/ \ : * ? " < > | , ; %`, controls, invisible and private-use characters
// and noncharacters: names of WRITTEN signs or spaces alone, none ending
// with a period or a space.
// Checked on the path placed, as a variable may lead anywhere
// (`%TEMP%\a.txt`), and on where it lands.
export function isOpenable(abs: string): boolean {
  const plain = abs.replace(/^\\\\\?\\(?=[A-Za-z]:)/, '')
  if (!/^[A-Za-z]:\\/.test(plain) || plain.length >= 260 || !WRITTEN_SPACED.test(plain.slice(3) || 'x')) return false
  return plain
    .slice(3)
    .split('\\')
    .every(name => !/[. ]$/.test(name) && !/^(?:CON|PRN|AUX|NUL|COM[0-9¹²³]|LPT[0-9¹²³])$/.test(name.split('.')[0]?.trimEnd().toUpperCase() ?? ''))
}

// Whether a path is one of Claude Code's own settings files, which Claude
// Code refuses a plugin to name to a program: as observed in Claude Code
// 2.1.330 (its built-in `cc-plugin-sec-default` mod; not documented, and it
// may change), a path holding `settings.json` or `settings.local.json` that,
// its separators made single slashes and its case lowered, holds
// `.claude/settings.json`, `.claude/settings.local.json` or
// `.claude/cowork_settings.json`, the words `claude_config_dir`, or
// `settings.json` or `cowork_settings.json` in `configDir`, the folder
// `CLAUDE_CONFIG_DIR` names, placed as an absolute path
// (../settings/config-folder; its default, `.claude` in the home folder,
// is held by the rule before). dx makes no link to one, so that no program
// is handed it by a click either; the settings pane's configuration folder
// button opens their folder.
//
// Besides, dx's own rules: a path holding `settings.local.json` in
// `configDir` too; a path holding `settings.json`, `settings.local.json` or
// `cowork_settings.json` in `configReal`, where Claude Code's configuration
// folder lands (its `realPath`, through a junction, a short 8.3 name or the
// `\\?\` prefix), whatever its case. Not checked when `configReal` is not
// known.
export function isClaudeSettingsFile(abs: string, configDir: string | undefined, configReal?: string): boolean {
  if (!/settings(?:\.local)?\.json/i.test(abs)) return false
  const plain = (text: string) => text.replace(/^[/\\]{2}\?[/\\]/, '').replace(/[/\\]+/g, '/').toLowerCase()
  const said = plain(abs)
  if (/\.claude\/(?:settings|settings\.local|cowork_settings)\.json/.test(said) || said.includes('claude_config_dir')) return true
  if (configDir !== undefined && configDir !== '' && [`${configDir}/settings.json`, `${configDir}/settings.local.json`, `${configDir}/cowork_settings.json`].some(file => said.includes(plain(file)))) return true
  if (configReal === undefined || configReal === '') return false
  const folder = plain(configReal).replace(/\/$/, '')
  return ['settings.json', 'settings.local.json', 'cowork_settings.json'].some(name => said.includes(`${folder}/${name}`))
}

// The reply with each path found that leads somewhere made a link to its
// `dx-open:` URL: `hrefOf` answers a path's URL, undefined to leave it as
// written. Plain text becomes `[text](url)`, inline code `` [`code`](url) ``.
// A link longer than MAX_HREF is left as written. A `!` right before a link
// made would make it an image: it is escaped (`\!`).
export function linkPaths(text: string, found: readonly Found[], hrefOf: (item: Found) => string | undefined): string {
  let out = ''
  let at = 0
  for (const item of found) {
    const href = hrefOf(item)
    if (href === undefined || href.length > MAX_HREF) continue
    let before = text.slice(at, item.start)
    if (before.endsWith('!') && isUnescaped(text, item.start - 1)) before = `${before.slice(0, -1)}\\!`
    out += `${before}[${text.slice(item.start, item.end)}](${href})`
    at = item.end
  }
  return out + text.slice(at)
}

// Whether the sign at `index` of `text` is not escaped: an even count of
// backslashes before it.
function isUnescaped(text: string, index: number): boolean {
  let count = 0
  while (index - count - 1 >= 0 && text[index - count - 1] === '\\') count++
  return count % 2 === 0
}

// The environment variables Claude Code reads to tell whether the terminal
// shows hyperlinks (OSC 8), as read: one set empty is unset, as Claude Code
// takes it.
type TerminalEnv = {
  forceHyperlink?: string | undefined
  wtSession?: string | undefined
  tmux?: string | undefined
  termProgram?: string | undefined
  termProgramVersion?: string | undefined
  terminalEmulator?: string | undefined
  lcTerminal?: string | undefined
  term?: string | undefined
}

// Terminals Claude Code takes as showing hyperlinks by their `TERM_PROGRAM`
// or `LC_TERMINAL`: its own list, copied as observed in Claude Code 2.1.330
// (not documented), to be checked again when Claude Code changes it.
const HYPERLINK_TERMINALS = ['ghostty', 'Hyper', 'kitty', 'alacritty', 'iTerm.app', 'iTerm2', 'rex', 'WarpTerminal']

// Whether Claude Code draws a link as a hyperlink, its text alone: as it
// decides, as observed in Claude Code 2.1.330 (its rule is not documented):
// `FORCE_HYPERLINK` first, set and not empty (off when `0`, `false`, `no` or
// `off`, whatever the case and the spaces around, or a number read as 0; on
// otherwise); then Windows Terminal outside tmux; then a terminal it knows
// by `TERM_PROGRAM`; then JetBrains' terminal
// (`TERMINAL_EMULATOR=JetBrains-JediTerm`); then tmux 3.4 or later
// (`TERM_PROGRAM=tmux`, `TERM_PROGRAM_VERSION`); then a terminal it knows by
// `LC_TERMINAL`; then a `TERM` naming kitty. Where it does not, it draws the
// text and then the URL, so dx makes no link at all. A terminal inside
// another, such as herdr in Windows Terminal, is not known:
// `FORCE_HYPERLINK=1` turns it on.
export function showsHyperlinks(env: TerminalEnv): boolean {
  const force = env.forceHyperlink
  if (force !== undefined && force !== '') {
    return !(['0', 'false', 'no', 'off'].includes(force.trim().toLowerCase()) || Number.parseInt(force, 10) === 0)
  }
  const program = env.termProgram
  if (env.wtSession !== undefined && env.tmux === undefined && program !== 'tmux') return true
  if (program !== undefined && HYPERLINK_TERMINALS.includes(program)) return true
  if (env.terminalEmulator === 'JetBrains-JediTerm') return true
  if (program === 'tmux') {
    const [major = NaN, minor = NaN] = (env.termProgramVersion ?? '').split('.').map(part => Number.parseInt(part, 10))
    if (major > 3 || (major === 3 && minor >= 4)) return true
  }
  if (env.lcTerminal !== undefined && HYPERLINK_TERMINALS.includes(env.lcTerminal)) return true
  return env.term?.includes('kitty') === true
}

// Whether `FORCE_HYPERLINK` is what turns hyperlinks off (`0`, `false`…),
// rather than their being off for want of it.
export function isHyperlinkForcedOff(env: TerminalEnv): boolean {
  return env.forceHyperlink !== undefined && env.forceHyperlink !== '' && !showsHyperlinks(env)
}

// Folders too broad to be what a reply's word means: a drive's root, the
// working directory itself, the home folder: they are left as written.
export function isTooBroad(abs: string, cwd: string, home: string | undefined): boolean {
  const same = (other: string | undefined) => other !== undefined && abs.toLowerCase() === normalizedPath(other)?.toLowerCase()
  return /^[A-Za-z]:\\$/.test(abs) || same(cwd) || same(home)
}
