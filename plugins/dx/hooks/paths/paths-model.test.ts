import { expect, test } from 'claude-code/testing'

import { dxOpenUrl, findPaths, isClaudeSettingsFile, isHyperlinkForcedOff, isOpenable, isTooBroad, isWrittenPath, linkPaths, showsHyperlinks, VARIABLES, withVariable } from './paths-model'
import type { Found } from './paths-model'

// The model's bound, as paths-model sets it.
const MAX_PATHS = 256
// A long line, for the timing tests.
const LONG_LINE = 4000

// The paths found, as written.
function paths(text: string): string[] {
  return findPaths(text).map(item => item.path)
}

// The text as dx draws it, every path found linked.
function linked(text: string): string {
  return linkPaths(text, findPaths(text), item => `dx-open:///C:/${item.path}`)
}

test('paths in plain text are found: relative, absolute, with a drive, either separator', () => {
  expect(paths('Voir src/app.ts et C:\\Users\\dev\\notes.md, puis C:/temp/a.txt.')).toEqual(['src/app.ts', 'C:\\Users\\dev\\notes.md', 'C:/temp/a.txt'])
  expect(paths('Le fichier README.md, le dossier ./docs et ../other/x et ~/bin.')).toEqual(['README.md', './docs', '../other/x', '~/bin'])
  // Accented names, and `**bold**` around a path.
  expect(paths('**docs/fr/réglages.md**')).toEqual(['docs/fr/réglages.md'])
})

test('words, numbers and expressions are no paths', () => {
  expect(paths('Version 2.1.310 du 20/11 : e.g. $.process.run, and/or, 3.14')).toEqual(['20/11', 'and/or'])
  expect(paths('Un mot, une phrase. Rien ici')).toEqual([])
})

test('a word is a path whole or not at all: one sign outside the list makes it none', () => {
  for (const word of ['src/a,b.ts', 'src/a$b.ts', 'src/a#b.ts', 'src/a&b.ts', 'src/a=b.ts', 'src/a%20b.ts', 'C:\\a|b.ts', 'src/a*.ts', 'src/[a].ts', 'src/a!.ts', 'src/€.ts', 'src/😀.ts']) {
    expect(paths(`Voir ${word} ici`)).toEqual([])
  }
  expect(paths("Voir src/a+b@c~(1)/l'été.ts ici")).toEqual(["src/a+b@c~(1)/l'été.ts"])
})

test('the signs around a word that are not the path are left out: brackets, quotes, punctuation, the same marks on both sides', () => {
  expect(paths(`(src/a.ts), "src/b.ts", 'src/c.ts'; <src/d.ts>! src/e.ts? __src/f.ts__ ~~src/g.ts~~`)).toEqual([
    'src/a.ts',
    'src/b.ts',
    'src/c.ts',
    'src/d.ts',
    'src/e.ts',
    'src/f.ts',
    'src/g.ts',
  ])
  // A closing parenthesis the word opened is the name's.
  expect(paths('Voir (src/a(1).ts) et src/b(2).ts.')).toEqual(['src/a(1).ts', 'src/b(2).ts'])
  // A mark on one side alone is the name's; marks past an opening sign, or
  // runs of two kinds or that differ, are kept, and so no path.
  expect(paths('Le module my_file.py et _build/out.js')).toEqual(['my_file.py', '_build/out.js'])
  expect(paths('Voir ***src/a.ts*** ici')).toEqual(['src/a.ts'])
  for (const word of ['"*src/a.ts*"', '(**src/a.ts**)', '*_src/a.ts*_', '*_src/a.ts_*', '**__a.ts__**']) expect(paths(`Voir ${word} ici`)).toEqual([])
  // Claude Code strikes through with two tildes alone: other runs are the name's.
  expect(paths('Voir ~~src/a.ts~ et ~~~src/b.ts~~~ ici')).toEqual(['~~src/a.ts~', '~~~src/b.ts~~~'])
})

test('a word glued to code, a link or raw HTML is no path', () => {
  expect(paths('Voir `x`src/a.ts, src/b.ts`y`, [l](u)src/c.ts et <b>src/d.ts</b> ici')).toEqual([])
})

test('a line, a range and a column after a path are read, the column dropped', () => {
  const found = findPaths('Voir src/a.ts:12, src/b.ts:3-9 et src/c.ts:42:5.')
  expect(found.map(item => [item.path, item.place])).toEqual([
    ['src/a.ts', { line: 12 }],
    ['src/b.ts', { line: 3, endLine: 9 }],
    ['src/c.ts', { line: 42 }],
  ])
  // The suffix is part of what the link covers.
  const text = 'Voir src/c.ts:42:5.'
  const [item] = findPaths(text)
  expect(text.slice(item?.start, item?.end)).toBe('src/c.ts:42:5')
})

test('URLs and autolinks are left alone, a path inside them never looked for', () => {
  expect(paths('https://github.com/IMSike/CC-Plugins/blob/main/README.md et <https://x.dev/a.ts>')).toEqual([])
  expect(paths('Voir file:///C:/a/b.ts et <file:///C:/a/c.ts>.')).toEqual([])
})

test('inline code holding a path is found, spaces allowed; other code is not', () => {
  const found = findPaths('Ouvre `C:\\Program Files\\app\\app.json:4`, lance `npm run build`, appelle `foo.bar()`.')
  expect(found.map(item => [item.start, item.path, item.place])).toEqual([[6, 'C:\\Program Files\\app\\app.json', { line: 4 }]])
  expect(paths('`https://x.dev/a.ts` et ``src/x.ts``')).toEqual(['src/x.ts'])
})

test("a link's text and target are never looked into", () => {
  for (const text of ['[app](src/app.ts#L12-L14), [doc](<docs/a b.md>), ![img](logo.png)', '[src/a.ts](https://github.com/x/src/a.ts)', '[a [b] c](src/a.ts) [![i](x.png)](src/a.ts) [a [b [c]] d](src/a.ts)']) {
    expect(linked(text)).toBe(text)
  }
})

test('fenced code blocks are skipped, whatever their fence', () => {
  expect(paths('avant a/b.ts\n```ts\nimport x from "./c.ts"\n```\n~~~\nd/e.ts\n~~~\naprès f/g.ts')).toEqual(['a/b.ts', 'f/g.ts'])
  // A fence left open skips the rest.
  expect(paths('```\nsrc/x.ts')).toEqual([])
})

test('network paths and paths from a root are never found; a drive as Git Bash or WSL writes it is', () => {
  expect(paths('\\\\server\\share\\x.txt et //server/share/x.txt, /tmp/x.txt, /etc/hosts, \\Program.cs')).toEqual([])
  expect(paths('Voir /c/Users/dev/a.ts et /mnt/d/x/b.ts.')).toEqual(['/c/Users/dev/a.ts', '/mnt/d/x/b.ts'])
  expect(paths(String.raw`cmd /c dir, del /q x, dir /s et \n`)).toEqual([])
})

test('at most MAX_PATHS distinct paths are looked for', () => {
  const text = Array.from({ length: MAX_PATHS + 5 }, (_, index) => `d/f${index}.ts`).join('\n')
  expect(new Set(paths(text)).size).toBe(MAX_PATHS)
  // One already found is found again past the bound.
  expect(paths(`${text}\nd/f0.ts`).at(-1)).toBe('d/f0.ts')
})

test('a path holding spaces is found in inline code or in double quotes; never in plain text', () => {
  const file = String.raw`C:\Temp\chemins test\dossier (é)\fichier é (1).txt`
  expect(findPaths(`Voir "${file}:2" et \`${file}\`.`).map(item => [item.start, item.path, item.place])).toEqual([
    [6, file, { line: 2 }],
    [file.length + 13, file, undefined],
  ])
  expect(paths(`Voir ${file} ici.`)).toEqual([])
  // An opening parenthesis before the quote; a quote glued to a word opens
  // nothing.
  expect(paths(String.raw`(voir ("C:\mes notes\a.txt") et x"C:\mes notes\b.txt")`)).toEqual([String.raw`C:\mes notes\a.txt`])
})

test('two words that look like paths, a space between them, the second relative, are neither linked: they may be one path', () => {
  expect(paths(String.raw`Voir C:\mes notes\a.txt ici`)).toEqual([])
  expect(paths('Voir src/mes notes.md ici')).toEqual([])
  // A word after a path holding a sign a name holds: the path may go on.
  for (const text of [String.raw`Voir C:\a\fichier (1).txt ici`, 'Voir src/a - copie.md ici', 'Voir src/a b.md+y ici', 'Voir src/a.ts (ligne 3)']) expect(paths(text)).toEqual([])
  // Letters alone, or a dash that is no name's sign, are prose.
  expect(paths('Voir src/a.ts et src/b.ts — fin')).toEqual(['src/a.ts', 'src/b.ts'])
  // A list, a second path with a drive, words that are no paths.
  expect(paths(String.raw`Voir src/a.ts, src/b.ts et C:\a.ts C:\b.ts puis src/c.ts fin`)).toEqual(['src/a.ts', 'src/b.ts', String.raw`C:\a.ts`, String.raw`C:\b.ts`, 'src/c.ts'])
})

test('inline code holding a file name with parentheses is a path; a call is not', () => {
  const code = (text: string) => `\`${text}\``
  const text = `${code(String.raw`C:\a\dossier (é)\fichier é (1).txt:2`)} et ${code('f(x)')} et ${code('src/a(b).ts')}`
  expect(findPaths(text).map(item => [item.path, item.place])).toEqual([
    [String.raw`C:\a\dossier (é)\fichier é (1).txt`, { line: 2 }],
    ['src/a(b).ts', undefined],
  ])
})

test('a path is refused where markdown would draw it otherwise or Windows read another file: a backslash escape, a short name, a doubled or trailing separator, a name ending with a period', () => {
  for (const path of [String.raw`src\_a.ts`, String.raw`C:\a\(b).ts`, String.raw`C:\PROGRA~1\x.txt`, String.raw`C:\Users\dev\.claude\SETTIN~1.JSO`, 'src//a.ts', 'C:\\a\\b\\',String.raw`C:\a.\b.ts`]) {
    expect(isWrittenPath(path, false, true)).toBe(false)
  }
  for (const path of ['~/bin/a.txt', 'a~b.txt', 'C:/a/.git/x', '../..', 'src/.', 'src/a(1).ts']) expect(isWrittenPath(path, false, true)).toBe(true)
  // A parenthesis that closes none, or opens one never closed.
  for (const path of ['src/a).ts', 'src/(a.ts']) expect(isWrittenPath(path, false, true)).toBe(false)
  // In inline code, a backslash is written as is.
  for (const path of [String.raw`src\_a.ts`, String.raw`C:\a\.git\x`]) expect(isWrittenPath(path, true, false)).toBe(true)
})

test('a dx-open URL is a file URL of the dx-open scheme: each segment percent-encoded as UTF-8, the drive kept, the place a fragment', () => {
  expect(dxOpenUrl('C:\\Users\\dev\\mon dossier (1)\\é#.ts', { line: 3, endLine: 7 })).toBe('dx-open:///C:/Users/dev/mon%20dossier%20%281%29/%C3%A9%23.ts#L3-L7')
  expect(dxOpenUrl('D:\\a\\b.md', { line: 12 })).toBe('dx-open:///D:/a/b.md#L12')
  expect(dxOpenUrl('C:\\a')).toBe('dx-open:///C:/a')
  expect(dxOpenUrl("C:\\it's!*")).toBe('dx-open:///C:/it%27s%21%2A')
})

test('paths become links: plain text, inline code; the others as written', () => {
  const text = 'Voir src/a.ts:3, `src/b.ts` et [c](src/c.ts), pas src/none.ts.'
  const found = findPaths(text)
  const hrefOf = (item: Found) => (item.path.includes('none') ? undefined : `dx-open:///C:/r/${item.path.replace('src/', '')}`)
  expect(linkPaths(text, found, hrefOf)).toBe('Voir [src/a.ts:3](dx-open:///C:/r/a.ts), [`src/b.ts`](dx-open:///C:/r/b.ts) et [c](src/c.ts), pas src/none.ts.')
})

test('one URL may link a path many times; a URL past 2048 signs is not made', () => {
  expect(linkPaths('a.ts, a.ts', findPaths('a.ts, a.ts'), () => 'dx-open:///C:/a.ts')).toBe('[a.ts](dx-open:///C:/a.ts), [a.ts](dx-open:///C:/a.ts)')
  expect(linkPaths('a.ts', findPaths('a.ts'), () => `dx-open:///C:/${'x'.repeat(2048)}`)).toBe('a.ts')
})

test("only a drive path herdr's plugin takes whole is linked: no comma, semicolon, quote, wildcard, control, stream colon or name ending with a period or a space", () => {
  for (const good of [String.raw`C:\Users\dev\a b (1)\é.ts`, 'C:\\', String.raw`C:\a\.git\x`]) expect(isOpenable(good)).toBe(true)
  for (const bad of [
    String.raw`C:\a,b\x.ts`,
    String.raw`C:\a;b`,
    String.raw`C:\a"b`,
    String.raw`C:\a*b`,
    String.raw`C:\a|b`,
    'C:\\a\nb',
    'C:\\a\u0085b',
    String.raw`C:\a.txt:b.exe`,
    String.raw`C:\a\b.ts.`,
    String.raw`C:\a \b.ts`,
    String.raw`\\server\share\x`,
    String.raw`src\x.ts`,
  ]) {
    expect(isOpenable(bad)).toBe(false)
  }
})

test("Claude Code's own settings files are told as Claude Code tells them", () => {
  const configDir = 'D:\\claude-config'
  for (const refused of [
    String.raw`C:\Users\dev\.claude\settings.json`,
    String.raw`C:\Users\dev\.CLAUDE\Settings.Local.json`,
    'c:/users/dev//.claude/cowork_settings.json',
    String.raw`D:\claude-config\settings.json`,
    'd:/CLAUDE-CONFIG/cowork_settings.json',
    // dx's own rule, past Claude Code's.
    String.raw`D:\claude-config\settings.local.json`,
    String.raw`C:\x\claude_config_dir\settings.json`,
  ]) {
    expect(isClaudeSettingsFile(refused, configDir)).toBe(true)
  }
  for (const taken of [
    String.raw`C:\Users\dev\repo\settings.json`,
    String.raw`C:\Users\dev\.claude\agents`,
    String.raw`D:\claude-config\agents\a.md`,
  ]) {
    expect(isClaudeSettingsFile(taken, configDir)).toBe(false)
  }
  expect(isClaudeSettingsFile(String.raw`D:\claude-config\settings.json`, undefined)).toBe(false)
  // Set empty, CLAUDE_CONFIG_DIR is unset: not every settings.json.
  expect(isClaudeSettingsFile(String.raw`C:\x\settings.json`, '')).toBe(false)
})

test('hyperlinks show as Claude Code decides: FORCE_HYPERLINK, Windows Terminal outside tmux, a known terminal', () => {
  expect(showsHyperlinks({ wtSession: 'x' })).toBe(true)
  expect(showsHyperlinks({ wtSession: 'x', tmux: '/tmp/t' })).toBe(false)
  expect(showsHyperlinks({ termProgram: 'herdr' })).toBe(false)
  expect(showsHyperlinks({ termProgram: 'herdr', forceHyperlink: '1' })).toBe(true)
  expect(showsHyperlinks({ wtSession: 'x', forceHyperlink: '0' })).toBe(false)
  // WezTerm and VS Code are not on Claude Code's list.
  expect(showsHyperlinks({ termProgram: 'WezTerm' })).toBe(false)
  expect(showsHyperlinks({ termProgram: 'vscode' })).toBe(false)
  expect(showsHyperlinks({})).toBe(false)
})

test('a drive root, the working directory and the home folder are too broad', () => {
  const cwd = String.raw`C:\Users\dev\repo`
  const home = String.raw`C:\Users\dev`
  for (const abs of ['C:\\', 'D:\\', cwd, String.raw`c:\users\dev\repo`, home]) expect(isTooBroad(abs, cwd, home)).toBe(true)
  for (const abs of [String.raw`C:\Users`, String.raw`C:\Users\dev\repo\src`]) expect(isTooBroad(abs, cwd, home)).toBe(false)
})

test('a line or an end past 2^32 - 1, or not a safe integer, is dropped', () => {
  expect(findPaths('src/a.ts:4294967295')[0]?.place).toEqual({ line: 4294967295 })
  expect(findPaths('src/a.ts:4294967296')[0]?.place).toBeUndefined()
  expect(findPaths('src/a.ts:99999999999999999999')[0]?.place).toBeUndefined()
  expect(findPaths('src/a.ts:12-4294967296')[0]?.place).toEqual({ line: 12 })
})

test('a path holding an invisible sign is not linked: a control, a format character, a default-ignorable code point, half a surrogate pair', () => {
  const path = (sign: number) => String.raw`C:\a` + String.fromCodePoint(sign) + String.raw`b\x.ts`
  for (const sign of [
    0x0, 0x1f, 0x7f, 0x85, 0x9f, 0xad, 0x34f, 0x600, 0x61c, 0x115f, 0x17b4, 0x180e, 0x200b, 0x200e, 0x202e, 0x2028, 0x2029, 0x2060, 0x2065, 0x2066, 0x3164, 0xd800, 0xdfff, 0xfe00, 0xfe0f, 0xfeff,
    0xffa0, 0xfff9, 0x13430, 0x1bca0, 0x1d173, 0xe0001, 0xe0080, 0xe01ef, 0xe0fff,
  ]) {
    expect(isOpenable(path(sign))).toBe(false)
    expect(isWrittenPath(path(sign), false, false)).toBe(false)
  }
  // Letters, marks and digits of other scripts are taken.
  for (const sign of [0x627, 0x13000, 0x301, 0x663]) expect(isOpenable(path(sign))).toBe(true)
})

test('a number that is no decimal digit is no sign of a path: superscripts, fractions, Roman numerals', () => {
  for (const text of ['Voir x².md.', 'Voir ½.md.', 'Voir docs/Ⅻ.md.', 'Voir `src/x².md`.']) expect(findPaths(text)).toEqual([])
  for (const name of ['x².md', '½.md', 'Ⅻ.md']) expect(isOpenable(`C:\\a\\${name}`)).toBe(false)
  expect(findPaths('Voir x2.md et `src/x٣.md`.').map(item => item.path)).toEqual(['x2.md', 'src/x٣.md'])
})

// What the timing tests hold a reading to, in milliseconds. They catch a
// reading that grows with the square of its input, which takes seconds on
// these inputs, not a slower linear one. The test files run side by side, a
// run several times slower: the bound leaves room for that.
const QUICK = 1000

// How long finding the paths of `text` takes, in milliseconds: the fastest
// of three runs at most, so that a pause of the machine is not slowness.
function duration(text: string): number {
  let fastest = Infinity
  for (let run = 0; run < 3 && fastest >= QUICK; run++) {
    const began = Date.now()
    findPaths(text)
    fastest = Math.min(fastest, Date.now() - began)
  }
  return fastest
}

// A reply of `line` repeated, `\n` between, up to 100,000 signs.
function replyOf(line: string): string {
  return Array.from({ length: Math.floor(100_000 / (line.length + 1)) }, () => line).join('\n')
}

// Lines of `unit` repeated up to LONG_LINE, to a reply of 100,000 signs.
function linesOf(unit: string): string {
  return replyOf(unit.repeat(Math.floor((LONG_LINE - 1) / unit.length)))
}

test('lines of nested block quote or list marks are read at once, a reference definition or not', () => {
  for (const line of [
    `${'> '.repeat(25)}[a]`,
    `${'- '.repeat(30)}texte [a] b`,
    `${'>  '.repeat(20)}x`,
    `${'1. '.repeat(30)}[a] b`,
    `${'>\t'.repeat(30)}[a`,
    // As deep as a reply is read, each line through every mark.
    `${'> - '.repeat(50)}[a ]:`,
    `${'>  '.repeat(100)}[a]: `,
  ]) {
    expect(duration(replyOf(line))).toBeLessThan(QUICK)
  }
  // Still told: a definition behind those marks, left as written.
  expect(linked(`${'> '.repeat(25)}[r]: src/a.ts`)).toBe(`${'> '.repeat(25)}[r]: src/a.ts`)
})

test('a reply nesting past the depth read is left at once, no path found', () => {
  for (const line of [`${'> - '.repeat(900)}src/a.ts`, `${'>  '.repeat(1300)}src/a.ts`]) {
    expect(findPaths(line)).toEqual([])
    expect(duration(replyOf(line))).toBeLessThan(QUICK)
  }
})

test('long lines, backticks, brackets, spaces and words by the thousand are read at once', () => {
  const runs = Array.from({ length: 1300 }, (_, index) => '`'.repeat((index % 40) + 1)).join('\\ ')
  for (const text of [
    `[x](${' '.repeat(20_000)} src/app.ts`,
    runs,
    '\\`'.repeat(5000),
    `${'` '.repeat(3000)}\n${'`` '.repeat(3000)}`,
    '['.repeat(LONG_LINE),
    '[a]('.repeat(999),
    '[!['.repeat(1300),
    '](('.repeat(1300),
    linesOf('\\[a'),
    linesOf('C:\\a '),
    linesOf('~/a '),
    linesOf('"C:\\a b '),
    linesOf('src/a.ts '),
    Array.from({ length: 25 }, () => `[a](b${' '.repeat(LONG_LINE)}`).join('\n'),
    `a${')'.repeat(99_999)}`,
    `${'('.repeat(2000)}a${')'.repeat(97_000)}`,
    `src/a${'.'.repeat(99_990)}`,
    '_a _'.repeat(25_000),
    '~/a b~ '.repeat(14_000),
    `x ${'_'.repeat(99_990)}a`,
    `x ${'~'.repeat(99_990)}a`,
    `x ${'*'.repeat(99_990)}a`,
    `${'*'.repeat(50_000)}a/b${'*'.repeat(49_990)}`,
    `voir ${'='.repeat(10)} ${'_'.repeat(99_000)}x`,
    Array.from({ length: 2000 }, (_, index) => `Voir src/f${index}.ts et [l](d/x${index}.md) \`c${index}\``).join('\n').slice(0, 100_000),
  ]) {
    expect(duration(text)).toBeLessThan(QUICK)
  }
})

test('a line of list markers by the ten thousand is read at once', () => {
  for (const text of [`${'- '.repeat(40_000)}x`, `${'> - '.repeat(20_000)}x`, `${'1. '.repeat(30_000)}x`, `${'- '.repeat(20_000)}\`\`\`\n${'x '.repeat(20_000)}`, `${'- '.repeat(20_000)}<div>\n${'x '.repeat(20_000)}`]) {
    expect(duration(text)).toBeLessThan(QUICK)
  }
})

test('a fenced code block in a list item or a block quote is code: no path linked, its links left as written', () => {
  expect(paths('10.    ```\n    src/a.ts\n    ```\nsrc/b.ts')).toEqual(['src/b.ts'])
  expect(paths('- a\n  - b\n    ```\n    src/x.ts\n    ```\nsrc/y.ts')).toEqual(['src/y.ts'])
  expect(paths('> ```\n> src/a.ts\n> ```\nsrc/b.ts')).toEqual(['src/b.ts'])
  expect(linked('> ~~~\n> [x](src/b.ts) src/a.ts\n> ~~~')).toBe('> ~~~\n> [x](src/b.ts) src/a.ts\n> ~~~')
  // Three backticks with another after them on the line are inline code,
  // no fence.
  expect(paths('```x``` src/a.ts\nsrc/b.ts')).toEqual(['src/a.ts', 'src/b.ts'])
})

test('an indented code block is code; a paragraph of a list item, or a line continuing a paragraph, is not', () => {
  expect(paths('texte\n\n    src/a.ts\n\n    src/c.ts\nsrc/b.ts')).toEqual(['src/b.ts'])
  expect(paths('    src/a.ts')).toEqual([])
  expect(paths('texte\n    src/a.ts')).toEqual(['src/a.ts'])
  expect(paths('- a\n\n    src/a.ts')).toEqual(['src/a.ts'])
  expect(paths('1. a\n\n       src/a.ts\n\nsrc/b.ts')).toEqual(['src/b.ts'])
  expect(paths('- a\n\nfin\n\n    src/a.ts')).toEqual([])
})

test('a code span crossing a line break is code from its opening backticks to its closing ones', () => {
  expect(paths('voir `a\nsrc/x.ts` et src/y.ts\n\nsrc/z.ts')).toEqual(['src/y.ts', 'src/z.ts'])
  // A backtick alone, escaped, or not closed in its paragraph opens nothing.
  expect(paths('le signe ` puis\nsrc/a.ts')).toEqual(['src/a.ts'])
  expect(paths('le signe \\` puis\nsrc/a.ts `x`')).toEqual(['src/a.ts'])
  expect(paths('a `b\n\nsrc/c.ts `')).toEqual(['src/c.ts'])
  // A list item or a heading starts a paragraph of its own.
  expect(paths('a `b\n- src/c.ts `')).toEqual(['src/c.ts'])
  expect(paths('# T `a\nsrc/b.ts `')).toEqual(['src/b.ts'])
})

test('lines ending with a carriage return are read as the others', () => {
  expect(linked('Voir [x](\r\nsrc/a.ts) puis src/b.ts')).toBe('Voir [x](\r\nsrc/a.ts) puis [src/b.ts](dx-open:///C:/src/b.ts)')
  expect(linked('[r]:\r\n  src/a.ts\r\nfin')).toBe('[r]:\r\n  src/a.ts\r\nfin')
  expect(paths('```\r\nsrc/a.ts\r\n```\r\nsrc/b.ts\r\n')).toEqual(['src/b.ts'])
  const text = 'Voir src/a.ts:3\r\net src/b.ts'
  expect(findPaths(text).map(item => text.slice(item.start, item.end))).toEqual(['src/a.ts:3', 'src/b.ts'])
})

test('a carriage return alone ends a line as a line feed does, the positions kept', () => {
  expect(paths('a\rC:\\a\\b.ts')).toEqual(['C:\\a\\b.ts'])
  expect(paths('```\rsrc/a.ts\r```\rsrc/b.ts')).toEqual(['src/b.ts'])
  expect(linked('Voir [x](\rsrc/a.ts) puis src/b.ts')).toBe('Voir [x](\rsrc/a.ts) puis [src/b.ts](dx-open:///C:/src/b.ts)')
  const text = 'a\rVoir src/a.ts:3\r\ret src/b.ts\r\nsrc/c.ts'
  expect(findPaths(text).map(item => text.slice(item.start, item.end))).toEqual(['src/a.ts:3', 'src/b.ts', 'src/c.ts'])
})

test('links in code of any form are left as written: fenced, indented, inline, inline across lines', () => {
  for (const text of [
    '```\n[x](src/a.ts)\n```',
    '- a\n\n  ```\n  [x](src/a.ts) <src/b.ts>\n  ```',
    '> ```\n> [r]: src/a.ts\n> ```',
    'texte\n\n    [x](src/a.ts)',
    '>     [x](src/a.ts)',
    'Voir `[x](src/a.ts)` et `<src/b.ts>`.',
    'Voir `a\n[x](src/a.ts)` b',
  ]) {
    expect(linked(text)).toBe(text)
  }
  // Outside the code, on the same line, a path is still read.
  expect(linked('`[x](src/a.ts)` puis src/y.ts')).toBe('`[x](src/a.ts)` puis [src/y.ts](dx-open:///C:/src/y.ts)')
})

test('inline code is told as CommonMark tells it: backticks inside, runs of other lengths, a run never closed', () => {
  expect(findPaths('a `` `src/a.ts` `` b')).toEqual([])
  expect(findPaths('a `` b `src/c.ts` d')).toEqual([{ start: 7, end: 17, path: 'src/c.ts' }])
  // A backslash before a backtick outside code escapes it: the span is
  // `` ` b ` ``, the path glued to it.
  expect(findPaths('\\`a` b `src/c.ts`')).toEqual([])
  expect(paths('Voir `` ` src/a.ts ` `` et src/b.ts')).toEqual(['src/b.ts'])
  expect(paths('```` ``` src/a.ts ``` ````\nsrc/b.ts')).toEqual(['src/b.ts'])
  expect(paths('a `` b `src/a.ts` c')).toEqual(['src/a.ts'])
})

test('an indented code block may start after a heading, a thematic break or a setext underline, and inside a block quote past its marks', () => {
  for (const text of ['a\n# h\n    src/a.ts', 'a\n***\n    src/a.ts', 'Titre\n===\n    src/a.ts', 'Titre\n---\n    src/a.ts', '>     src/a.ts', '> para\n>\n>     src/a.ts', '>\t    src/a.ts']) {
    expect(paths(text)).toEqual([])
  }
  // A paragraph's line, inside a block quote or not, and three columns past
  // the mark's space, are text.
  expect(paths('> para\n>     src/a.ts')).toEqual(['src/a.ts'])
  expect(paths('>    src/a.ts')).toEqual(['src/a.ts'])
})

test('FORCE_HYPERLINK is read as Claude Code reads it: empty is unset; 0, false, no, off turn hyperlinks off', () => {
  for (const off of ['0', 'false', ' NO ', 'Off', '00']) expect(showsHyperlinks({ wtSession: 'x', forceHyperlink: off })).toBe(false)
  for (const on of ['1', 'yes', '2', 'x']) expect(showsHyperlinks({ forceHyperlink: on })).toBe(true)
  // Empty: the terminal decides.
  expect(showsHyperlinks({ wtSession: 'x', forceHyperlink: '' })).toBe(true)
  expect(showsHyperlinks({ forceHyperlink: '' })).toBe(false)
})

test('hyperlinks show in the terminals Claude Code knows: by TERM_PROGRAM, JetBrains, tmux 3.4 on, LC_TERMINAL, a kitty TERM', () => {
  for (const termProgram of ['ghostty', 'Hyper', 'kitty', 'alacritty', 'iTerm.app', 'iTerm2', 'rex', 'WarpTerminal']) expect(showsHyperlinks({ termProgram })).toBe(true)
  expect(showsHyperlinks({ terminalEmulator: 'JetBrains-JediTerm' })).toBe(true)
  expect(showsHyperlinks({ termProgram: 'tmux', termProgramVersion: '3.4' })).toBe(true)
  expect(showsHyperlinks({ termProgram: 'tmux', termProgramVersion: '3.3a' })).toBe(false)
  expect(showsHyperlinks({ lcTerminal: 'iTerm2' })).toBe(true)
  expect(showsHyperlinks({ term: 'xterm-kitty' })).toBe(true)
})

test('FORCE_HYPERLINK turning hyperlinks off is told apart from it unset', () => {
  for (const off of ['0', 'false', 'off']) expect(isHyperlinkForcedOff({ wtSession: 'x', forceHyperlink: off })).toBe(true)
  expect(isHyperlinkForcedOff({})).toBe(false)
  expect(isHyperlinkForcedOff({ forceHyperlink: '' })).toBe(false)
  expect(isHyperlinkForcedOff({ forceHyperlink: '1' })).toBe(false)
})

test('a fenced code block in a block quote or a list item ends with its container; the line that ends it is read again', () => {
  // A fence closed outside its block quote, or under its list item's column.
  expect(paths('> ```\n> x\n```\nC:\\a\\c.ts')).toEqual([])
  expect(paths('- a\n  ```\n  x\n```\nC:\\a\\c.ts')).toEqual([])
  expect(paths('- a\n  ```\n  x\n ```\nC:\\a\\c.ts')).toEqual([])
  // A block quote ended by a blank line ends its block.
  expect(paths('> ```\n> src/x.ts\n\nC:\\a\\c.ts')).toEqual(['C:\\a\\c.ts'])
  // A blank line inside a list item does not end it.
  expect(paths('- a\n  ```\n\n  src/x.ts\n  ```\nC:\\a\\c.ts')).toEqual(['C:\\a\\c.ts'])
  expect(paths('- a\n  ```\n  src/x.ts\n  ```\n  C:\\a\\c.ts')).toEqual(['C:\\a\\c.ts'])
  expect(paths('- > ```\n  > src/a.ts\n  > ```\nsrc/b.ts')).toEqual(['src/b.ts'])
  // A line leaving the container is text, or what it opens.
  expect(paths('> ```\n> src/a.ts\nsrc/b.ts')).toEqual(['src/b.ts'])
  expect(linked('> ```\n> x\nsrc/y.ts')).toBe('> ```\n> x\n[src/y.ts](dx-open:///C:/src/y.ts)')
})

test('a fence indented four columns past its container, or after a paragraph, is no fence', () => {
  expect(paths('texte\n    ```\nsrc/a.ts')).toEqual(['src/a.ts'])
  expect(paths('- a\n\n      ```\n      src/a.ts\nsrc/b.ts')).toEqual(['src/b.ts'])
})

test('a list item whose text starts five spaces or more past its marker is an indented code block', () => {
  expect(paths('-     C:\\a\\b.ts')).toEqual([])
  expect(paths('1.     C:\\a\\b.ts')).toEqual([])
  // Its lines four columns past the item's are code; a line at its column
  // is a paragraph of the item.
  expect(paths('-     C:\\a\\b.ts\n      src/x.ts\n  src/y.ts')).toEqual(['src/y.ts'])
  // An item numbered other than 1 does not interrupt a paragraph: the line
  // is text.
  expect(paths('texte\n2.     C:\\a\\b.ts')).toEqual(['C:\\a\\b.ts'])
  // Four spaces past the marker: the item's text.
  expect(paths('-    C:\\a\\b.ts')).toEqual(['C:\\a\\b.ts'])
})

test('an HTML closing tag is no path; a path in angle brackets is', () => {
  expect(paths('</code> et </tmp> ou </a > mais <src/a.ts> et <C:\\a\\b.ts>')).toEqual(['src/a.ts', 'C:\\a\\b.ts'])
})

test("an escaped bracket opens no link's label; one after an escaped backslash does", () => {
  for (const text of ['[a \\[ src/a.ts](x)', '\\\\[src/a.ts](x)']) expect(paths(text)).toEqual([])
})

test("Claude Code's configuration folder is also told where it lands: a junction, a short name, the \\\\?\\ prefix, any case", () => {
  // A junction: ~/.claude lands in D:\cfg\claude.
  expect(isClaudeSettingsFile(String.raw`D:\cfg\claude\settings.json`, undefined, String.raw`D:\cfg\claude`)).toBe(true)
  // A short 8.3 name in CLAUDE_CONFIG_DIR, the file read by its long one.
  expect(isClaudeSettingsFile(String.raw`C:\Program Files\cfg\settings.json`, String.raw`C:\PROGRA~1\cfg`, String.raw`C:\Program Files\cfg`)).toBe(true)
  expect(isClaudeSettingsFile(String.raw`C:\Program Files\cfg\settings.json`, String.raw`C:\PROGRA~1\cfg`)).toBe(false)
  // The \\?\ prefix, on the file or the folder, and the case.
  expect(isClaudeSettingsFile(String.raw`\\?\D:\cfg\claude\settings.local.json`, undefined, 'D:\\cfg\\claude\\')).toBe(true)
  expect(isClaudeSettingsFile('d:/CFG/Claude/Cowork_Settings.json', undefined, String.raw`\\?\D:\cfg\claude`)).toBe(true)
  // Other files of the folder, another folder.
  for (const taken of [String.raw`D:\cfg\claude\agents\settings.md`, String.raw`D:\cfg\claude-old\settings.json`, String.raw`D:\cfg\settings.json`]) {
    expect(isClaudeSettingsFile(taken, undefined, String.raw`D:\cfg\claude`)).toBe(false)
  }
  // The folder's landing not known: the rules as before.
  expect(isClaudeSettingsFile(String.raw`D:\cfg\claude\settings.json`, undefined, undefined)).toBe(false)
  expect(isClaudeSettingsFile(String.raw`D:\cfg\claude\settings.json`, undefined, '')).toBe(false)
})

test('a link, an image, an autolink or a definition written by the model is left as written, a dx-open one too', () => {
  for (const text of [
    'Voir [x](dx-open:///C:/x/evil.exe), ![i](dx-open:///C:/i.png) et <dx-open:///C:/y>.',
    '[r]: dx-open:///C:/z.exe\n\nVoir [r].',
    '[r]: src/f.ts "t"\n\nVoir [r], [s][r], [r][] et [R]src/a.ts.',
    '[un libellé\nsur deux lignes](src/a.ts) fin',
    'Voir [x](\nsrc/a.ts) fin',
    '[a [b](https://x) c](src/app.ts)',
    'Voir <x@y.z> et <http://x/src/a.ts>.',
  ]) {
    expect(linked(text)).toBe(text)
  }
  // A path past them is linked.
  expect(linked('Voir [x](dx-open:///C:/x.exe) et src/a.ts')).toBe('Voir [x](dx-open:///C:/x.exe) et [src/a.ts](dx-open:///C:/src/a.ts)')
})

test('a reference definition is one as CommonMark reads it: a title begun on the next line and never closed makes it none', () => {
  expect(linked('[r]: x\n"t\nsrc/a.ts')).toBe('[r]: x\n"t\n[src/a.ts](dx-open:///C:/src/a.ts)')
})

test('raw HTML is left as written, blocks and inline; the text between inline tags is read', () => {
  for (const text of [
    '<div>\nsrc/a.ts\n</div>',
    '<script>\nsrc/a.ts\n\nsrc/b.ts\n</script>',
    '<x-a b="c">\nsrc/a.ts',
    'Voir <!-- src/c.ts --> <?x src/d.ts?> <![CDATA[ src/e.ts ]]> <!X src/f.ts>',
  ]) {
    expect(linked(text)).toBe(text)
  }
  expect(paths('<div>\nsrc/a.ts\n</div>\n\nsrc/b.ts')).toEqual(['src/b.ts'])
  expect(paths('<script>\nsrc/a.ts\n\nsrc/b.ts\n</script>\nsrc/c.ts')).toEqual(['src/c.ts'])
  // A tag of type 7 does not interrupt a paragraph: the next line is text.
  expect(paths('texte\n<x-a b="c">\nsrc/a.ts')).toEqual(['src/a.ts'])
  expect(linked('<a href="src/g.ts"> src/h.ts </a>')).toBe('<a href="src/g.ts"> [src/h.ts](dx-open:///C:/src/h.ts) </a>')
})

test("a path struck through is linked inside the strikethrough's tildes", () => {
  expect(linked('~~src/a.ts~~ et ~src/b.ts~')).toBe('~~[src/a.ts](dx-open:///C:/src/a.ts)~~ et [~src/b.ts~](dx-open:///C:/~src/b.ts~)')
  expect(linked('~~src/a.ts:3~~')).toBe('~~[src/a.ts:3](dx-open:///C:/src/a.ts)~~')
  // A single tilde is the name's, as Claude Code draws it: a backup.
  expect(paths('voir src/a.ts~')).toEqual(['src/a.ts~'])
  // The home's `~/` is kept; three tildes open a fence.
  expect(paths('~/bin')).toEqual(['~/bin'])
  expect(paths('~~~src/a.ts~~~')).toEqual([])
})

test("a sentence's periods are left out of a path, never a folder's dots", () => {
  expect(paths('Voir src/a.ts. Et src/a.ts.. fin')).toEqual(['src/a.ts', 'src/a.ts'])
  expect(linked('Voir src/. et ../.. fin.')).toBe('Voir [src/](dx-open:///C:/src/). et [../..](dx-open:///C:/../..) fin.')
  // A separator, a dot or two dots alone are no paths.
  expect(paths(String.raw`Voir / et \ et . et .. fin.`)).toEqual([])
})

test('a link made after an unescaped exclamation mark escapes it: no image is made', () => {
  expect(linked('!`src/a.ts`')).toBe(String.raw`\![` + '`src/a.ts`](dx-open:///C:/src/a.ts)')
  expect(linked('\\!`src/a.ts`')).toBe(String.raw`\![` + '`src/a.ts`](dx-open:///C:/src/a.ts)')
  // A word glued to an exclamation mark is no path.
  expect(paths('Voir !src/a.ts')).toEqual([])
})

test('a name holding combining marks is found whole, decomposed or not', () => {
  expect(paths('Voir cafe\u0301.txt et caf\u00e9.txt')).toEqual(['cafe\u0301.txt', 'caf\u00e9.txt'])
  expect(paths('Voir docs/cafe\u0301/a.md')).toEqual(['docs/cafe\u0301/a.md'])
})

test('a label after a defined one is no path: linked, it would make the reference another', () => {
  for (const text of ['[r]: x\n\n[r][src/a.ts]', '[r]:*\n[r][a.ts]']) expect(linked(text)).toBe(text)
  expect(linked('[r]: x\n\n[r][src/a.ts] et src/b.ts')).toBe('[r]: x\n\n[r][src/a.ts] et [src/b.ts](dx-open:///C:/src/b.ts)')
})

test('blocks CommonMark reads as code or HTML in nested containers are left as written', () => {
  for (const text of ['0. >     p/x', '* >     a.ts', '1.\n\n\tC.sC', '0.\n       ~1.b', '*\n<e>\na.ts', '``\r*\t\n/s~~``']) {
    expect(linked(text)).toBe(text)
  }
})

test('a path may start with a variable of the list, any case; any other is no path', () => {
  expect(paths(String.raw`voir %TEMP%\a.txt et %localappdata%/b.txt, %PROGRAMFILES(X86)%\c.txt`)).toEqual([String.raw`%TEMP%\a.txt`, '%localappdata%/b.txt', String.raw`%PROGRAMFILES(X86)%\c.txt`])
  expect(paths('%FOO%\\x\\a.txt, ${X}/a.txt, $(pwd)/a.txt, $HOME/a.txt')).toEqual([])
  // In inline code too.
  expect(paths(`\`${String.raw`%ProgramFiles(x86)%\a.txt`}\``)).toEqual([String.raw`%ProgramFiles(x86)%\a.txt`])
})

test('a variable is expanded when known, set and a drive path, its name in any case', () => {
  const values = new Map([['TEMP', String.raw`C:\Users\dev\Temp`], ['APPDATA', 'relative'], ['TMP', undefined], ['PROGRAMFILES(X86)', String.raw`C:\Program Files (x86)`]])
  expect(withVariable(String.raw`%temp%\a.txt`, values)).toBe(String.raw`C:\Users\dev\Temp\a.txt`)
  expect(withVariable('%Temp%/a.txt', values)).toBe(String.raw`C:\Users\dev\Temp/a.txt`)
  expect(withVariable(String.raw`%APPDATA%\a.txt`, values)).toBeUndefined()
  expect(withVariable(String.raw`%TMP%\a.txt`, values)).toBeUndefined()
  expect(withVariable(String.raw`%FOO%\a.txt`, values)).toBeUndefined()
  expect(withVariable(String.raw`%programfiles(x86)%\a.txt`, values)).toBe(String.raw`C:\Program Files (x86)\a.txt`)
  expect(withVariable('src/a.txt', values)).toBe('src/a.txt')
  expect(VARIABLES).toContain('PROGRAMFILES(X86)')
})

test('a percent sign in a name is refused, a variable placed before the check', () => {
  expect(isOpenable(String.raw`C:\Users\dev\repo\100%.txt`)).toBe(false)
  expect(isOpenable(String.raw`C:\Users\dev\%TEMP%\a.txt`)).toBe(false)
  const values = new Map([['LOCALAPPDATA', String.raw`C:\Users\dev\AppData\Local`]])
  expect(isOpenable(withVariable(String.raw`%LOCALAPPDATA%\Temp\log.txt`, values) ?? '')).toBe(true)
})

test('an edge is never put next to a backtick run', () => {
  expect(linked('`\\```b.ts``')).toBe('`\\```b.ts``')
})

test('a word in quotes glued to another word is none', () => {
  for (const text of ['"$HOME"/notes.txt', "'$X'/a.txt", String.raw`!X!\f.txt`, '`pwd`/src/a.ts', String.raw`"x"C:\a.txt`]) expect(paths(text)).toEqual([])
  expect(paths(`"src/x.txt" et 'src/y.txt', (src/z.txt)`)).toEqual(['src/x.txt', 'src/y.txt', 'src/z.txt'])
})

test('a path never takes a `_` or `~~` that pairs with one outside it: the emphasis stays as written', () => {
  for (const text of ['_voir le src/a.ts_ ici', '~~voir le src/a.ts~~ ici', '_src/a.ts et la suite_ ici']) {
    expect(linked(text)).toBe(text)
  }
  // An underscore between letters or digits pairs with none; a lone mark, or
  // several openers, neither.
  expect(paths('Voir src/my_file.ts et other_file.ts')).toEqual(['src/my_file.ts', 'other_file.ts'])
  expect(paths('Voir _build/out et src/a.ts~ ici')).toEqual(['_build/out', 'src/a.ts~'])
  expect(paths('Voir ~/bin et ~/.config ici')).toEqual(['~/bin', '~/.config'])
  // A single tilde pairs with no strikethrough's.
  expect(paths('~voir le src/a.ts~, ~/bin et ~~x~~')).toEqual(['src/a.ts~', '~/bin'])
  expect(paths('Voir _src/a.ts_ et _b_')).toEqual(['src/a.ts'])
  // Marks that pair inside what a link would cover, or with the marks around
  // it, or a quoted path's with one outside the quotes: drawn as emphasis.
  for (const text of ['Voir __init__.py ici', 'Voir src/_a_.ts ici', 'Voir _src/_a.ts_ ici', 'Voir ~~src/~~a.ts~~ ici', '_voir "src/b_" ici', '_voir "_src/a.ts_" ici', '*voir "*src/a.ts*" ici']) {
    expect(linked(text)).toBe(text)
  }
})

test('words are split where CommonMark reads whitespace, nowhere else', () => {
  for (const space of ['\uFEFF', '\v', '\u2028', '\u200B']) expect(paths(`C#${space}src/a.ts`)).toEqual([])
  for (const space of ['\u00A0', '\u3000', '\t']) expect(paths(`C#${space}src/a.ts`)).toEqual(['src/a.ts'])
})

test('no two separators in a row, the root included, and no `..` above an absolute path\'s start', () => {
  for (const path of ['/c//x/a.ts', '/mnt/c//x/a.ts', String.raw`C:\\x\a.ts`, 'C://x', '~//a.txt', '/c/../d/x.ts', '/mnt/c/a/../../d/x.ts', String.raw`C:\..\x.ts`, '~/../x.txt']) {
    expect(paths(`Voir ${path} ici`)).toEqual([])
    expect(paths(`Voir \`${path}\` ici`)).toEqual([])
  }
  expect(paths('Voir ../x/a.ts et C:/a/../b.ts ici')).toEqual(['../x/a.ts', 'C:/a/../b.ts'])
})

test("two dots or more after a separator are a name, refused past two: an ellipsis never leads to the folder above; one is a sentence's", () => {
  expect(paths('Voir src/components/... ici, docs/en/.... et src/. puis ../..')).toEqual(['src/', '../..'])
})

test('a bare spaced path is not linked whatever the space between its parts', () => {
  for (const space of ['\u00A0', '\u202F', '  ']) {
    expect(paths(`Voir C:\\mes${space}notes\\a.txt ici`)).toEqual([])
    expect(paths(`Voir src/mes${space}notes/a.md ici`)).toEqual([])
  }
})

test('herdr\'s plugin takes no real path past MAX_PATH, on a network share, or naming a device', () => {
  expect(isOpenable(`C:\\${'a'.repeat(256)}`)).toBe(true)
  expect(isOpenable(`C:\\${'a'.repeat(257)}`)).toBe(false)
  expect(isOpenable(String.raw`\\?\C:\a\b.txt`)).toBe(true)
  expect(isOpenable(String.raw`\\?\UNC\server\share\a.txt`)).toBe(false)
  expect(isOpenable(String.raw`\\server\share\a.txt`)).toBe(false)
  for (const name of ['con.txt', 'NUL', 'aux .md', 'COM1.md', 'lpt¹', 'prn.tar.gz']) expect(isOpenable(`C:\\a\\${name}`)).toBe(false)
  for (const name of ['console.txt', 'COM10.md', 'nul2', 'a.con']) expect(isOpenable(`C:\\a\\${name}`)).toBe(true)
})

test('marks of two kinds around a path are kept: next to the link, the inner ones could pair with others', () => {
  for (const text of ['Voir _ceci, *_README.md_*', '*x _*a.ts*_', 'Voir *ceci, _*src/a.ts*_ et *cela*', '[r]: **__a.ts__**', 'Voir ~ceci, *~README.md~*']) {
    expect(linked(text)).toBe(text)
  }
})

test('a line ending ends a path: paths one per line are each linked, a quoted path never spans two lines', () => {
  expect(paths('src/a.ts\nsrc/b.ts\r\nnotes.md\n> src/d.ts\n> fin')).toEqual(['src/a.ts', 'src/b.ts', 'notes.md', 'src/d.ts'])
  expect(paths(String.raw`"C:\x\mes` + '\nnotes.md"')).toEqual([String.raw`C:\x\mes`, 'notes.md'])
})

test("inline code drops one space on each side, as CommonMark does, and nothing else", () => {
  expect(paths('` src/a.ts `')).toEqual(['src/a.ts'])
  for (const code of ['`  a.md`', '` src/a.ts`', '`src/a.ts\u3000`', '`\uFEFFsrc/a.ts`']) expect(paths(code)).not.toContain('src/a.ts')
  expect(paths('`  a.md`')).not.toContain('a.md')
})

test('what Claude Code makes a link of in plain text is no path: a www. address, an email address', () => {
  expect(paths('Voir www.example.com/index.html, contact@example.com et src/a@b.c/d.ts ici')).toEqual([])
  for (const text of ['voir a_www.x.com/b.md ici', 'voir a~www.x.com/b.md', 'voir src/(www.x.com)/b.md', 'voir "mes www.x.com/b.md" ici', 'voir __a.ts__WWW.x.md', 'Voir src/a_www. Puis', 'Voir user@.example/x.md', 'Voir docs/www.readme.md']) expect(paths(text)).toEqual([])
  expect(paths('Voir node_modules/@types/node ici')).toEqual(['node_modules/@types/node'])
})

test('a path in a word holding a URL is no path, in code too: Claude Code extends the URL over it', () => {
  for (const text of ['Doc: https://x.com/docs:`src/a.ts`', 'http://x`a.ts`', 'www.m`a.ts`', '`src/a.ts`https://x.com', 'Voir "src/a.ts".https://x ici']) expect(linked(text)).toBe(text)
  // A space apart, the path is linked, the URL left as written.
  expect(linked('https://x.com/docs and `src/a.ts`')).toBe('https://x.com/docs and [`src/a.ts`](dx-open:///C:/src/a.ts)')
})
