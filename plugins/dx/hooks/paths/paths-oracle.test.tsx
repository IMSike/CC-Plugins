import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, ProcessRunResult } from 'claude-code'

import { engine, NOW, windowsPath } from '../shared/testing'

// Oracle for dx's "never a link to the wrong file" rule.
//
// Each reply is built from tokens whose meaning is known: a path P, written
// alone or with signs glued to it. A glue that a reader skips (a sentence's
// period, a quote, `:12`) leaves P as the path meant; any other glue (`&amp;`,
// `#`, `^`, a letter) makes the whole token the name meant, P alone being a
// mere part of it. The disk holds, at random, the path meant and decoys: every
// part of the token cut at a sign. A link dx makes passes when it leads to a
// path the token means; a link to anything else (a part of a path holding
// spaces included), or out of every token, is a violation. A path meant that
// exists and is left unlinked is a miss, allowed, but a fifth of them at
// least must be linked.

const CWD = String.raw`C:\Users\dev\repo\app`
const HOME = String.raw`C:\Users\dev`
const TEMP = String.raw`C:\Users\dev\AppData\Local\Temp`
// Replies drawn per run: seeds x cases, about 2 s per 200 cases.
const SEEDS = 5
const CASES = 200

// --- the paths meant, and what may be glued to them -----------------------

const PATHS = [
  'src/app.ts', 'docs/guide.md', 'README.md', 'a/b/c.txt', '../lib/x.js', './run.sh', String.raw`notes\a.txt`,
  'src/a', 'A/notes.md', 'examples/C', String.raw`C:\x\y.ts`, 'C:/x/y.ts', '~/bin/tool.txt', String.raw`%TEMP%\log.txt`,
  String.raw`C:\mes notes\a.txt`, String.raw`C:\Program Files\x y\z.md`, String.raw`C:\a b\c d\e.txt`,
  String.raw`C:\a\fichier (1).txt`, "docs/l'été.md", 'src/a(b).ts', String.raw`src\_a.ts`, 'src/a b.md',
]
// [glue, whether a reader skips it]
const LEFT: [string, boolean][] = [
  ['', true], ['', true], ['', true], ['', true], ['(', true], ['"', true], ["'", true], ['*', true], ['@', true], [':', true], [',', true], ['=', true],
  ['&', false], ['&amp;', false], ['&#38;', false], ['#', false], ['^', false], ['Q&', false], ['Q&amp;', false],
  ['C#', false], ['a^', false], ['x', false], ['é', false], ['+', false], ['~', true], ['-', false],
]
const RIGHT: [string, boolean][] = [
  ['', true], ['', true], ['', true], ['', true], ['.', true], [',', true], [';', true], [':', true], ['?', true], [')', true], ['"', true], ["'", true],
  ['*', true], [':12', true], [':12-14', true], ['#L12', true],
  ['&', false], ['&amp;', false], ['&amp;b.ts', false], ['&#38;x', false], ['#', false], ['#x', false], ['#/b.cs', false], ['^b', false],
  ['é', false], ['~', true], ['-x', false], ['+y', false], ['/Program.cs', false], [String.raw`\b.md`, false], ['x', false],
]
const FILLER = ['Voir', 'puis', 'et', 'ici', 'le fichier', 'dans', 'Q&amp;amp;A', 'R&amp;D', 'C#', 'a^b', '—', 'x', 'cp', 'Erreur', '1', 'notes', 'mes', 'fin']
const SHAPES = ['plain', 'plain', 'plain', 'code', 'strong', 'strike', 'list', 'quote'] as const

// --- reading a path as Windows places it ------------------------------------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decode = (text: string) =>
  text.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (all, name: string) =>
    name[0] === '#' ? String.fromCodePoint(name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)) : (ENTITIES[name.toLowerCase()] ?? all),
  )

// The absolute path a written path names, folded as Windows compares; none
// for one dx is not asked about here (from a root, `/…`: Git Bash's) or no
// valid Windows name.
function placed(path: string): string | undefined {
  let abs: string
  if (/^[a-z]:[\\/]/i.test(path)) abs = path
  else if (/^~[\\/]/.test(path)) abs = HOME + path.slice(1)
  else if (/^%temp%[\\/]/i.test(path)) abs = TEMP + path.slice(6)
  else if (/^\\(?!\\)/.test(path)) abs = 'C:' + path
  else if (path.startsWith('/') || path.startsWith('\\\\') || path === '') return undefined
  else abs = CWD + '\\' + path
  const rest = abs.slice(2)
  if (/[<>:"|?*\u0000-\u001f%]/.test(rest)) return undefined
  const parts: string[] = []
  for (const part of rest.split(/[\\/]+/)) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  if (parts.some(part => /[. ]$/.test(part))) return undefined
  return (abs.slice(0, 2) + '\\' + parts.join('\\')).toLowerCase()
}

// --- the random replies -----------------------------------------------------

function random(seed: number) {
  let s = seed >>> 0 || 1
  const next = () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)), (s ^= s >>> 16) >>> 0) / 4294967296
  return { next, pick: <T,>(list: readonly T[]) => list[Math.floor(next() * list.length)] as T, chance: (p: number) => next() < p }
}

type Token = { start: number; end: number; text: string; meant: Set<string>; wanted?: string }
type Case = { text: string; tokens: Token[] }

// Cut points: the token's ends, and each side of every sign that is no letter
// nor digit.
function cuts(text: string): number[] {
  const at = new Set([0, text.length])
  for (let i = 0; i < text.length; i++) if (!/[\p{L}\p{N}]/u.test(text[i] ?? '')) (at.add(i), at.add(i + 1))
  return [...at].sort((a, b) => a - b)
}

function makeCase(r: ReturnType<typeof random>, files: Map<string, 'file' | 'dir'>): Case {
  let text = ''
  const tokens: Token[] = []
  const count = 1 + Math.floor(r.next() * 3)
  for (let n = 0; n < count; n++) {
    text += r.pick(FILLER) + ' '
    if (r.chance(0.3)) text += r.pick(FILLER) + ' '
    const path = r.pick(PATHS)
    const [left, leftSkipped] = r.pick(LEFT)
    const [right, rightSkipped] = r.pick(RIGHT)
    const shape = r.pick(SHAPES)
    const raw = left + path + right
    // In code, character references are not read; elsewhere they are.
    const read = shape === 'code' ? raw : decode(raw)
    // What the token may mean: the path with each glue kept, or left out
    // where a reader skips it; read as written in code, decoded elsewhere.
    const meant = new Set<string>()
    const form = (text: string) => (shape === 'code' ? text : decode(text))
    for (const l of leftSkipped ? ['', left] : [left])
      for (const rr of rightSkipped ? ['', right] : [right]) {
        const one = placed(form(l + path + rr))
        if (one !== undefined) meant.add(one)
      }
    const whole = placed(read)
    // The path meant, there or not; its folders there when it is.
    const wanted = (leftSkipped && rightSkipped ? placed(path) : undefined) ?? whole
    if (wanted !== undefined && r.chance(0.5)) addFile(files, wanted, r.chance(0.8) ? 'file' : 'dir')
    // Decoys: each part of the token, cut at its signs, read both as written and decoded.
    for (const form of new Set([raw, read])) {
      const points = cuts(form)
      for (const i of points) for (const j of points) {
        if (j - i < 2) continue
        const part = form.slice(i, j)
        if (!/[\p{L}]/u.test(part)) continue
        const abs = placed(part)
        if (abs === undefined || meant.has(abs) || !r.chance(0.6)) continue
        addFile(files, abs, /[\\/]$/.test(part) || r.chance(0.4) ? 'dir' : 'file')
      }
    }
    const opening = { plain: '', code: '`', strong: '**', strike: '~~', list: '', quote: '' }[shape]
    if (shape === 'list') text += '\n- '
    if (shape === 'quote') text += '\n> '
    text += opening
    tokens.push({ start: text.length - opening.length, end: text.length + raw.length + opening.length, text: raw, meant, ...(wanted === undefined ? {} : { wanted }) })
    text += raw + opening + ' '
  }
  text += r.pick(FILLER) + (r.chance(0.5) ? '.' : '')
  return { text, tokens }
}

function addFile(files: Map<string, 'file' | 'dir'>, abs: string, kind: 'file' | 'dir') {
  if (abs === CWD.toLowerCase() || abs === HOME.toLowerCase()) return
  if (!files.has(abs) || kind === 'dir') files.set(abs, kind)
  const parts = abs.split('\\')
  for (let k = 2; k < parts.length; k++) files.set(parts.slice(0, k).join('\\'), 'dir')
}

// --- dx's links in what it hands the engine ---------------------------------

type Made = { start: number; end: number; target: string; label: string }

// The links dx made, placed in the reply as written: each `[label](dx-open:…)`
// dropped back to its label, an `\` dx put before `!` dropped too. Undefined
// when what remains is not the reply (dx changed its text).
function linksIn(drawn: string, original: string): Made[] | undefined {
  const made: Made[] = []
  let rebuilt = ''
  let at = 0
  const link = /(\\(?=!\[))?\[((?:[^\]\\]|\\.)*)\]\((dx-open:[^)\s]*)\)/g
  for (let m = link.exec(drawn); m !== null; m = link.exec(drawn)) {
    rebuilt += drawn.slice(at, m.index)
    const label = m[2] ?? ''
    const start = rebuilt.length
    rebuilt += label
    at = m.index + m[0].length
    const url = (m[3] ?? '').slice('dx-open:///'.length).split('#')[0] ?? ''
    made.push({ start, end: start + label.length, target: decodeURIComponent(url).replace(/\//g, '\\').toLowerCase(), label })
  }
  rebuilt += drawn.slice(at)
  return rebuilt === original ? made : undefined
}

// --- the engine, as dx's own tests set it ----------------------------------

const OK: ProcessRunResult = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const LISTED = JSON.stringify({
  id: 'cli:plugin',
  result: { plugins: [{ plugin_id: 'imsike.links', enabled: true, link_handlers: [{ action: 'open', id: 'dx-open', pattern: '^dx-open:' }] }], type: 'plugin_list' },
})

async function start($: Engine, on: On, files: Map<string, 'file' | 'dir'>) {
  mock.clock(on, { now: NOW })
  on('ui.log', () => ({ value: undefined }))
  // The disk: exactly the files and folders drawn, compared as Windows does.
  on('fs.stat', { path: /[\s\S]/ }, (_, e) => {
    const kind = files.get(windowsPath(e.path).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase())
    const realPath = e.resolve ? { realPath: windowsPath(e.path) } : {}
    return kind === undefined ? { deny: 'ENOENT' } : { value: { kind, size: 0, mtimeMs: 0, isLink: false, ...realPath } }
  })
  engine(on, {
    files: {},
    env: { OS: 'Windows_NT', SystemRoot: String.raw`C:\Windows`, HERDR_PANE_ID: 'w1:p1', TERM_PROGRAM: 'herdr', FORCE_HYPERLINK: '1' },
    run: argv => (/(?:^|\\)herdr(?:\.exe)?$/.test(argv[0] ?? '') ? { ...OK, stdout: LISTED } : undefined),
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
}

function engineDrawn(on: On): string[] {
  const drawn: string[] = []
  on('ui.render', { component: 'AssistantMessage' }, (_, e) => {
    drawn.push(e.props.text)
    return { type: 'Text', props: {}, children: ['engine'] } as never
  })
  return drawn
}

async function drawnText($: Engine, drawn: string[], text: string): Promise<string> {
  const ui = await $.ui.mount({ plugin: 'dx', component: 'AssistantMessage', surface: 'terminal', requestId: 'm1', props: { text, isFirstOfReply: true } } as const)
  await ui.unmount()
  return drawn.at(-1) ?? text
}

// --- the oracle -------------------------------------------------------------

for (let seed = 1; seed <= SEEDS; seed++) {
  test(`oracle seed ${seed}: every link leads to a path its text means`, { timeoutMs: 30_000 }, async ($, on) => {
    const r = random(seed * 7919)
    const files = new Map<string, 'file' | 'dir'>()
    const cases = Array.from({ length: CASES }, () => makeCase(r, files))
    const drawn = engineDrawn(on)
    await start($, on, files)
    const violations: string[] = []
    let wantedThere = 0
    let linked = 0
    for (const one of cases) {
      const out = await drawnText($, drawn, one.text)
      const made = linksIn(out, one.text)
      if (made === undefined) {
        violations.push(`TEXT CHANGED ${JSON.stringify(one.text)} -> ${JSON.stringify(out)}`)
        continue
      }
      for (const link of made) {
        const token = one.tokens.find(t => link.start >= t.start && link.end <= t.end)
        if (token === undefined) violations.push(`OUTSIDE ${JSON.stringify(one.text)} label ${JSON.stringify(link.label)} -> ${link.target}`)
        else if (!token.meant.has(link.target))
          violations.push(`WRONG ${JSON.stringify(one.text)} token ${JSON.stringify(token.text)} label ${JSON.stringify(link.label)} -> ${link.target} (meant: ${[...token.meant].join(' | ') || 'none'})`)
      }
      for (const token of one.tokens) {
        if (token.wanted === undefined || !files.has(token.wanted)) continue
        wantedThere++
        if (made.some(link => link.start >= token.start && link.end <= token.end)) linked++
      }
    }
    expect(violations.slice(0, 20)).toEqual([])
    // A judge passed by linking nothing proves nothing: a fifth of the paths
    // meant that exist at least are linked (the rest glued to signs, or
    // holding spaces in plain text).
    expect(linked).toBeGreaterThan(wantedThere / 5)
  })
}

// --- the findings, as fixed cases ------------------------------------------

// The audits' wrong-target findings, and the oracle's new ones, as fixed
// cases: the reply, the files on disk, the target a link must never have.
// Paths written with `/`, the disk's as Windows folds them.
const SEP = String.fromCharCode(92)
const win = (path: string) => path.split('/').join(SEP).toLowerCase()
const APP = 'c:/users/dev/repo/app/'

const FINDINGS: { name: string; text: string; files: string[]; never: string }[] = [
  { name: 'D36 entity glued before', text: 'Voir Q&amp;A/notes.md ici', files: [APP + 'a/notes.md'], never: APP + 'a/notes.md' },
  { name: 'D36 # glued before', text: 'Voir C#' + SEP + 'Program.cs ici', files: ['c:/program.cs'], never: 'c:/program.cs' },
  { name: 'D41 entity glued after', text: 'Voir src/a&amp;b.ts ici', files: [APP + 'src/a'], never: APP + 'src/a' },
  { name: 'D45 entity later on the line', text: 'Voir C:' + SEP + 'mes notes' + SEP + 'a.txt puis Q&amp;amp;A.', files: [APP + 'notes/a.txt'], never: APP + 'notes/a.txt' },
  { name: 'D46 # glued after', text: 'Voir examples/C#/Program.cs ici', files: [APP + 'examples/c/x'], never: APP + 'examples/c' },
  { name: 'D46 ^ glued after', text: 'Voir src/a^b.ts ici', files: [APP + 'src/a'], never: APP + 'src/a' },
  { name: 'NEW = before a spaced path', text: 'PATH=C:' + SEP + 'mes notes' + SEP + 'a.txt ici', files: [APP + 'notes/a.txt'], never: APP + 'notes/a.txt' },
  { name: 'NEW @ before a spaced path', text: 'Voir @C:' + SEP + 'mes notes' + SEP + 'a.txt ici', files: [APP + 'notes/a.txt'], never: APP + 'notes/a.txt' },
  { name: 'NEW & before a spaced path', text: 'Voir &C:' + SEP + 'mes notes' + SEP + 'a.txt ici', files: [APP + 'notes/a.txt'], never: APP + 'notes/a.txt' },
  { name: 'NEW : before a spaced path', text: 'Fichier:C:' + SEP + 'mes notes' + SEP + 'a.txt ici', files: [APP + 'notes/a.txt'], never: APP + 'notes/a.txt' },
  { name: 'V2 spaced path, its first part', text: 'Voir C:' + SEP + 'mes notes' + SEP + 'a.txt ici', files: ['c:/mes', 'c:/mes notes/a.txt'], never: 'c:/mes' },
  { name: 'V2 spaced relative path, its last part', text: 'Voir src/mes notes/a.md ici', files: [APP + 'notes/a.md'], never: APP + 'notes/a.md' },
  { name: 'V2 parenthesis left after an opening one', text: 'Voir C:' + SEP + 'a' + SEP + 'fichier (1).txt ici', files: [APP + '1).txt'], never: APP + '1).txt' },
  { name: 'V2 emphasis closed past the word', text: '_voir src/a.ts_ ici', files: [APP + 'src/a.ts'], never: APP + 'src/a.ts' },
  { name: 'V2 escaped sign drawn otherwise', text: 'Voir src' + SEP + '_a.ts ici', files: [APP + 'src/_a.ts'], never: APP + 'src/_a.ts' },
  { name: 'V3 code glued to a URL', text: 'Doc: https://x.com/docs:`src/app.ts`', files: [APP + 'src/app.ts'], never: APP + 'src/app.ts' },
  { name: 'V2 short name', text: 'Voir C:' + SEP + 'PROGRA~1' + SEP + 'x.txt ici', files: ['c:/progra~1/x.txt'], never: 'c:/progra~1/x.txt' },
]

for (const one of FINDINGS)
  test(`REPRO ${one.name}`, async ($, on) => {
    const files = new Map<string, 'file' | 'dir'>()
    for (const file of one.files.map(win)) {
      files.set(file, 'file')
      const parts = file.split(SEP)
      for (let k = 2; k < parts.length; k++) files.set(parts.slice(0, k).join(SEP), 'dir')
    }
    const drawn = engineDrawn(on)
    await start($, on, files)
    const out = await drawnText($, drawn, one.text)
    const made = linksIn(out, one.text) ?? []
    const bad = made.filter(link => link.target === win(one.never))
    expect(bad.map(link => `${link.label} -> ${out}`)).toEqual([])
  })
