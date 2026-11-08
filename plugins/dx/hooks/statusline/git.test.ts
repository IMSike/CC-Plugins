import { expect, test } from 'claude-code/testing'

import { branchFrom, branchOf } from './git'
import type { HeadPaths } from './git'

// A file system holding `files`, by path, that records every read, every
// lookup and every kind asked; a path exists when it is a file or a folder
// holding one. The paths in `unreadable` exist but cannot be read; whether
// those in `unanswered` exist, or what they are, cannot be told.
function disk(files: Record<string, string>, unreadable = new Set<string>(), unanswered = new Set<string>()) {
  const reads: string[] = []
  const lookups: string[] = []
  const kinds: string[] = []
  const isDir = (path: string) => Object.keys(files).some(file => file.startsWith(`${path}/`))
  const read = async (path: string) => {
    reads.push(path)
    return unreadable.has(path) ? undefined : files[path]
  }
  const exists = async (path: string) => {
    lookups.push(path)
    if (unanswered.has(path)) return undefined
    return path in files || isDir(path)
  }
  const kind = async (path: string) => {
    kinds.push(path)
    if (unanswered.has(path)) return undefined
    return path in files ? 'file' as const : isDir(path) ? 'dir' as const : undefined
  }
  return { files, unreadable, unanswered, reads, lookups, kinds, read, exists, kind }
}

test("a repository's branch is read from its HEAD, up from the directory", async () => {
  const fs = disk({ 'C:/repo/.git/HEAD': 'ref: refs/heads/dev\n' })
  expect(await branchFrom(fs, 'C:/repo/app/src', new Map())).toBe('dev')
})

test('a worktree reads the HEAD its .git file points to', async () => {
  const fs = disk({
    'C:/wt/.git': 'gitdir: C:/repo/.git/worktrees/wt\n',
    'C:/repo/.git/worktrees/wt/HEAD': 'ref: refs/heads/feature\n',
  })
  expect(await branchFrom(fs, 'C:/wt', new Map())).toBe('feature')
})

test('outside a repository, the .git is looked for once, not on every refresh', async () => {
  const fs = disk({})
  const heads: HeadPaths = new Map()
  expect(await branchFrom(fs, 'C:/a/b/c', heads)).toBeUndefined()
  // One lookup for each directory up to the root: c, b, a, C:; nothing read.
  expect(fs.lookups).toHaveLength(4)
  expect(fs.reads).toHaveLength(0)
  expect(await branchFrom(fs, 'C:/a/b/c', heads)).toBeUndefined()
  expect(fs.lookups).toHaveLength(4)
})

// A guard refusing the lookup: that no repository holds the directory is not
// concluded, nor kept for the session.
test('a lookup that cannot be answered keeps nothing: the next refresh looks again', async () => {
  const fs = disk({ 'C:/repo/.git/HEAD': 'ref: refs/heads/dev\n' })
  const heads: HeadPaths = new Map()
  fs.unanswered.add('C:/repo/app/.git')
  expect(await branchFrom(fs, 'C:/repo/app', heads)).toBeUndefined()
  expect(heads.has('C:/repo/app')).toBe(false)
  fs.unanswered.clear()
  expect(await branchFrom(fs, 'C:/repo/app', heads)).toBe('dev')
})

test('a HEAD whose lookup cannot be answered is not passed over', async () => {
  const head = 'C:/repo/app/.git/HEAD'
  const fs = disk({
    'C:/repo/.git/HEAD': 'ref: refs/heads/dev\n',
    [head]: 'ref: refs/heads/feature\n',
  }, new Set([head]), new Set([head]))
  const heads: HeadPaths = new Map()
  expect(await branchFrom(fs, 'C:/repo/app', heads)).toBeUndefined()
  expect(heads.has('C:/repo/app')).toBe(false)
})

test('the root is looked in too, then the way up stops: a Windows drive', async () => {
  const fs = disk({})
  expect(await branchFrom(fs, 'C:/a', new Map())).toBeUndefined()
  expect(fs.lookups).toEqual(['C:/a/.git', 'C:/.git'])

  const root = disk({ 'C:/.git/HEAD': 'ref: refs/heads/root\n' })
  expect(await branchFrom(root, 'C:/a', new Map())).toBe('root')
  expect(await branchFrom(root, 'C:/', new Map())).toBe('root')
})

test('the root is looked in too, then the way up stops: POSIX', async () => {
  const fs = disk({})
  expect(await branchFrom(fs, '/home/dev', new Map())).toBeUndefined()
  expect(fs.lookups).toEqual(['/home/dev/.git', '/home/.git', '/.git'])

  const root = disk({ '/.git/HEAD': 'ref: refs/heads/root\n' })
  expect(await branchFrom(root, '/home', new Map())).toBe('root')
  expect(await branchFrom(root, '/', new Map())).toBe('root')
  expect(root.lookups.filter(path => path === '/.git')).toHaveLength(2)
})

test('a network path goes up past its share to its host, then stops', async () => {
  const fs = disk({})
  expect(await branchFrom(fs, '//host/share/app', new Map())).toBeUndefined()
  expect(fs.lookups).toEqual(['//host/share/app/.git', '//host/share/.git', '//host/.git'])
})

test('the HEAD found is read again each time: a branch switch shows', async () => {
  const fs = disk({ 'C:/repo/.git/HEAD': 'ref: refs/heads/dev\n' })
  const heads: HeadPaths = new Map()
  expect(await branchFrom(fs, 'C:/repo/app', heads)).toBe('dev')
  const looked = fs.lookups.length
  const read1 = fs.reads.length
  fs.files['C:/repo/.git/HEAD'] = 'ref: refs/heads/main\n'
  expect(await branchFrom(fs, 'C:/repo/app', heads)).toBe('main')
  // The HEAD alone, not the way up to it.
  expect(fs.reads).toHaveLength(read1 + 1)
  expect(fs.lookups).toHaveLength(looked)
  expect(fs.kinds).toHaveLength(0)
})

test('a HEAD gone is looked for again', async () => {
  const fs = disk({ 'C:/repo/app/.git/HEAD': 'ref: refs/heads/dev\n' })
  const heads: HeadPaths = new Map()
  expect(await branchFrom(fs, 'C:/repo/app', heads)).toBe('dev')
  delete fs.files['C:/repo/app/.git/HEAD']
  fs.files['C:/repo/.git/HEAD'] = 'ref: refs/heads/main\n'
  expect(await branchFrom(fs, 'C:/repo/app', heads)).toBe('main')
})

// A `.git` folder left without a HEAD (an aborted `git init`, a broken copy)
// is no repository: Git goes on up, and so does the band.
test('a .git folder without a HEAD is passed over for the repository above', async () => {
  const fs = disk({
    'C:/repo/.git/HEAD': 'ref: refs/heads/dev\n',
    'C:/repo/app/.git/config': '',
  })
  expect(await branchFrom(fs, 'C:/repo/app', new Map())).toBe('dev')
})

// A worktree's or a submodule's `.git` file Git is rewriting cannot be read
// for a moment; it has no `.git/HEAD` under it either. Taken for a folder
// without a HEAD, the repository above would show, kept for the session.
test('a .git file that cannot be read for a moment is not passed over', async () => {
  const link = 'C:/repo/sub/.git'
  const fs = disk({
    'C:/repo/.git/HEAD': 'ref: refs/heads/dev\n',
    'C:/repo/.git/modules/sub/HEAD': 'ref: refs/heads/feature\n',
    [link]: 'gitdir: C:/repo/.git/modules/sub\n',
  }, new Set([link]))
  const heads: HeadPaths = new Map()
  expect(await branchFrom(fs, 'C:/repo/sub', heads)).toBeUndefined()
  expect(heads.has('C:/repo/sub')).toBe(false)
  fs.unreadable.clear()
  expect(await branchFrom(fs, 'C:/repo/sub', heads)).toBe('feature')
})

test('a .git that cannot be told a folder is not passed over', async () => {
  const git = 'C:/repo/app/.git'
  const fs = disk({
    'C:/repo/.git/HEAD': 'ref: refs/heads/dev\n',
    'C:/repo/app/.git/config': '',
  })
  // Gone between the lookup and the stat, or the stat refused.
  const kind = fs.kind
  const refused = { ...fs, kind: async (path: string) => path === git ? undefined : kind(path) }
  const heads: HeadPaths = new Map()
  expect(await branchFrom(refused, 'C:/repo/app', heads)).toBeUndefined()
  expect(heads.has('C:/repo/app')).toBe(false)
  const other = { ...fs, kind: async (path: string) => path === git ? 'other' as const : kind(path) }
  expect(await branchFrom(other, 'C:/repo/app', heads)).toBeUndefined()
  expect(heads.has('C:/repo/app')).toBe(false)
})

// Git refuses a `.git` file naming no `gitdir`, or naming a folder gone (a
// worktree removed), rather than going on up: no branch, and no need to look
// again on every refresh.
test('a .git file that never leads to a HEAD is kept as no repository', async () => {
  for (const link of ['garbage\n', 'gitdir: C:/repo/.git/worktrees/gone\n']) {
    const fs = disk({ 'C:/repo/.git/HEAD': 'ref: refs/heads/dev\n', 'C:/wt/.git': link })
    const heads: HeadPaths = new Map()
    expect(await branchFrom(fs, 'C:/wt', heads)).toBeUndefined()
    expect(heads.get('C:/wt')).toBe(null)
    const reads = fs.reads.length
    const lookups = fs.lookups.length
    expect(await branchFrom(fs, 'C:/wt', heads)).toBeUndefined()
    expect(fs.reads).toHaveLength(reads)
    expect(fs.lookups).toHaveLength(lookups)
  }
})

// Git reads the file as `gitdir: ` (one space) then the path: all the rest but
// the line endings at its end, spaces kept.
test('a .git file is read as Git reads it: "gitdir: " then the path', async () => {
  for (const link of [
    'gitdir: ../repo/.git/worktrees/wt\n',
    'gitdir: ../repo/.git/worktrees/wt\r\n',
    'gitdir: ../repo/.git/worktrees/wt\n\n',
  ]) {
    const fs = disk({ 'C:/wt/.git': link, 'C:/wt/../repo/.git/worktrees/wt/HEAD': 'ref: refs/heads/feature\n' })
    expect(await branchFrom(fs, 'C:/wt', new Map())).toBe('feature')
  }

  for (const link of [
    'garbage\ngitdir: C:/repo/.git/worktrees/wt\n',
    'gitdir:C:/repo/.git/worktrees/wt\n',
    'gitdir:  C:/repo/.git/worktrees/wt\n',
    'gitdir: C:/repo/.git/worktrees/wt \n',
    'gitdir: C:/repo/.git/worktrees/wt\nC:/other\n',
  ]) {
    const fs = disk({
      'C:/wt/.git': link,
      'C:/repo/.git/worktrees/wt/HEAD': 'ref: refs/heads/feature\n',
    })
    const heads: HeadPaths = new Map()
    expect(await branchFrom(fs, 'C:/wt', heads)).toBeUndefined()
    expect(heads.get('C:/wt')).toBe(null)
  }
})

// Git writes the `.git` file ending with a newline: read without it, the file
// may be cut short by the write, its `gitdir:` not there yet or its path cut
// in the middle. Nothing is kept; once written, it is read.
test('a .git file without its final newline keeps nothing', async () => {
  for (const partial of ['gitd', 'gitdir: C:/repo/.git/work']) {
    const fs = disk({
      'C:/repo/.git/HEAD': 'ref: refs/heads/dev\n',
      'C:/repo/.git/worktrees/wt/HEAD': 'ref: refs/heads/feature\n',
      'C:/wt/.git': partial,
    })
    const heads: HeadPaths = new Map()
    expect(await branchFrom(fs, 'C:/wt', heads)).toBeUndefined()
    expect(heads.has('C:/wt')).toBe(false)
    fs.files['C:/wt/.git'] = 'gitdir: C:/repo/.git/worktrees/wt\n'
    expect(await branchFrom(fs, 'C:/wt', heads)).toBe('feature')
  }
})

// A path cut in the middle may still lead to a HEAD: a worktree's cut down to
// the main repository's `.git`. Its branch shows, but the path is not kept:
// once the file is written, the worktree's shows.
test('a HEAD reached through a .git file without its final newline is not kept', async () => {
  const fs = disk({
    'C:/repo/.git/HEAD': 'ref: refs/heads/dev\n',
    'C:/repo/.git/worktrees/wt/HEAD': 'ref: refs/heads/feature\n',
    'C:/wt/.git': 'gitdir: C:/repo/.git',
  })
  const heads: HeadPaths = new Map()
  expect(await branchFrom(fs, 'C:/wt', heads)).toBe('dev')
  expect(heads.has('C:/wt')).toBe(false)
  fs.files['C:/wt/.git'] = 'gitdir: C:/repo/.git/worktrees/wt\n'
  expect(await branchFrom(fs, 'C:/wt', heads)).toBe('feature')
  expect(heads.get('C:/wt')).toBe('C:/repo/.git/worktrees/wt/HEAD')
})

// Git creates the `.git` file, then writes it; a worktree's HEAD is renamed
// over as it is written: neither is concluded on.
test('an empty .git file, or a linked HEAD missing from its folder, keeps nothing', async () => {
  const empty = disk({ 'C:/repo/.git/HEAD': 'ref: refs/heads/dev\n', 'C:/wt/.git': '' })
  const heads: HeadPaths = new Map()
  expect(await branchFrom(empty, 'C:/wt', heads)).toBeUndefined()
  expect(heads.has('C:/wt')).toBe(false)

  const head = 'C:/repo/.git/worktrees/wt/HEAD'
  const renaming = disk({
    'C:/wt/.git': 'gitdir: C:/repo/.git/worktrees/wt\n',
    'C:/repo/.git/worktrees/wt/commondir': '../..\n',
  })
  expect(await branchFrom(renaming, 'C:/wt', heads)).toBeUndefined()
  expect(heads.has('C:/wt')).toBe(false)
  renaming.files[head] = 'ref: refs/heads/feature\n'
  expect(await branchFrom(renaming, 'C:/wt', heads)).toBe('feature')
})

test('a HEAD there but unreadable is not passed over for the repository above', async () => {
  const head = 'C:/repo/app/.git/HEAD'
  const fs = disk({
    'C:/repo/.git/HEAD': 'ref: refs/heads/dev\n',
    [head]: 'ref: refs/heads/feature\n',
  }, new Set([head]))
  const heads: HeadPaths = new Map()
  expect(await branchFrom(fs, 'C:/repo/app', heads)).toBeUndefined()
  expect(heads.has('C:/repo/app')).toBe(false)
})

// Git renames HEAD.lock over HEAD as it writes it: on Windows a read at that
// moment fails. The repository is not taken for none: the next refresh reads.
test('a HEAD that cannot be read for a moment shows again at the next refresh', async () => {
  const head = 'C:/repo/.git/HEAD'
  const fs = disk({ [head]: 'ref: refs/heads/dev\n' })
  const heads: HeadPaths = new Map()

  // Unreadable at the first lookup: nothing kept.
  fs.unreadable.add(head)
  expect(await branchFrom(fs, 'C:/repo/app', heads)).toBeUndefined()
  expect(heads.has('C:/repo/app')).toBe(false)
  fs.unreadable.delete(head)
  expect(await branchFrom(fs, 'C:/repo/app', heads)).toBe('dev')

  // Unreadable once known: the path kept.
  fs.unreadable.add(head)
  expect(await branchFrom(fs, 'C:/repo/app', heads)).toBeUndefined()
  expect(heads.get('C:/repo/app')).toBe(head)
  fs.unreadable.delete(head)
  expect(await branchFrom(fs, 'C:/repo/app', heads)).toBe('dev')
})

test('the branch is read from .git/HEAD', () => {
  expect(branchOf('ref: refs/heads/dev\n')).toBe('dev')
  expect(branchOf('ref: refs/heads/feat/status-band')).toBe('feat/status-band')
  expect(branchOf('1ec6454f0e6c3b1d2a9f8e7d6c5b4a3928170615\n')).toBe('1ec6454')
  expect(branchOf('garbage')).toBeUndefined()
})
