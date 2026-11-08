import { expect, test } from 'claude-code/testing'

import { branchFrom, branchOf } from './git'
import type { HeadPaths } from './git'

// A file system holding `files`, by path, that records every read and every
// lookup; a path exists when it is a file or a folder holding one. The paths
// in `unreadable` exist but cannot be read.
function disk(files: Record<string, string>, unreadable = new Set<string>()) {
  const reads: string[] = []
  const lookups: string[] = []
  const read = async (path: string) => {
    reads.push(path)
    return unreadable.has(path) ? undefined : files[path]
  }
  const exists = async (path: string) => {
    lookups.push(path)
    return Object.keys(files).some(file => file === path || file.startsWith(`${path}/`))
  }
  return { files, unreadable, reads, lookups, read, exists }
}

test("a repository's branch is read from its HEAD, up from the directory", async () => {
  const { read, exists } = disk({ 'C:/repo/.git/HEAD': 'ref: refs/heads/dev\n' })
  expect(await branchFrom(read, exists, 'C:/repo/app/src', new Map())).toBe('dev')
})

test('a worktree reads the HEAD its .git file points to', async () => {
  const { read, exists } = disk({
    'C:/wt/.git': 'gitdir: C:/repo/.git/worktrees/wt\n',
    'C:/repo/.git/worktrees/wt/HEAD': 'ref: refs/heads/feature\n',
  })
  expect(await branchFrom(read, exists, 'C:/wt', new Map())).toBe('feature')
})

test('outside a repository, the .git is looked for once, not on every refresh', async () => {
  const { read, exists, reads, lookups } = disk({})
  const heads: HeadPaths = new Map()
  expect(await branchFrom(read, exists, 'C:/a/b/c', heads)).toBeUndefined()
  // One lookup for each directory up to the root: c, b, a, C:; nothing read.
  expect(lookups).toHaveLength(4)
  expect(reads).toHaveLength(0)
  expect(await branchFrom(read, exists, 'C:/a/b/c', heads)).toBeUndefined()
  expect(lookups).toHaveLength(4)
})

test('the HEAD found is read again each time: a branch switch shows', async () => {
  const { files, read, exists, reads, lookups } = disk({ 'C:/repo/.git/HEAD': 'ref: refs/heads/dev\n' })
  const heads: HeadPaths = new Map()
  expect(await branchFrom(read, exists, 'C:/repo/app', heads)).toBe('dev')
  const looked = lookups.length
  const read1 = reads.length
  files['C:/repo/.git/HEAD'] = 'ref: refs/heads/main\n'
  expect(await branchFrom(read, exists, 'C:/repo/app', heads)).toBe('main')
  // The HEAD alone, not the way up to it.
  expect(reads).toHaveLength(read1 + 1)
  expect(lookups).toHaveLength(looked)
})

test('a HEAD gone is looked for again', async () => {
  const { files, read, exists } = disk({ 'C:/repo/app/.git/HEAD': 'ref: refs/heads/dev\n' })
  const heads: HeadPaths = new Map()
  expect(await branchFrom(read, exists, 'C:/repo/app', heads)).toBe('dev')
  delete files['C:/repo/app/.git/HEAD']
  files['C:/repo/.git/HEAD'] = 'ref: refs/heads/main\n'
  expect(await branchFrom(read, exists, 'C:/repo/app', heads)).toBe('main')
})

// A `.git` folder left without a HEAD (an aborted `git init`, a broken copy)
// is no repository: Git goes on up, and so does the band.
test('a .git folder without a HEAD is passed over for the repository above', async () => {
  const { read, exists } = disk({
    'C:/repo/.git/HEAD': 'ref: refs/heads/dev\n',
    'C:/repo/app/.git/config': '',
  })
  expect(await branchFrom(read, exists, 'C:/repo/app', new Map())).toBe('dev')
})

test('a HEAD there but unreadable is not passed over for the repository above', async () => {
  const head = 'C:/repo/app/.git/HEAD'
  const { read, exists } = disk({
    'C:/repo/.git/HEAD': 'ref: refs/heads/dev\n',
    [head]: 'ref: refs/heads/feature\n',
  }, new Set([head]))
  const heads: HeadPaths = new Map()
  expect(await branchFrom(read, exists, 'C:/repo/app', heads)).toBeUndefined()
  expect(heads.has('C:/repo/app')).toBe(false)
})

// Git renames HEAD.lock over HEAD as it writes it: on Windows a read at that
// moment fails. The repository is not taken for none: the next refresh reads.
test('a HEAD that cannot be read for a moment shows again at the next refresh', async () => {
  const head = 'C:/repo/.git/HEAD'
  const { read, exists, unreadable } = disk({ [head]: 'ref: refs/heads/dev\n' })
  const heads: HeadPaths = new Map()

  // Unreadable at the first lookup: nothing kept.
  unreadable.add(head)
  expect(await branchFrom(read, exists, 'C:/repo/app', heads)).toBeUndefined()
  expect(heads.has('C:/repo/app')).toBe(false)
  unreadable.delete(head)
  expect(await branchFrom(read, exists, 'C:/repo/app', heads)).toBe('dev')

  // Unreadable once known: the path kept.
  unreadable.add(head)
  expect(await branchFrom(read, exists, 'C:/repo/app', heads)).toBeUndefined()
  expect(heads.get('C:/repo/app')).toBe(head)
  unreadable.delete(head)
  expect(await branchFrom(read, exists, 'C:/repo/app', heads)).toBe('dev')
})

test('the branch is read from .git/HEAD', () => {
  expect(branchOf('ref: refs/heads/dev\n')).toBe('dev')
  expect(branchOf('ref: refs/heads/feat/status-band')).toBe('feat/status-band')
  expect(branchOf('1ec6454f0e6c3b1d2a9f8e7d6c5b4a3928170615\n')).toBe('1ec6454')
  expect(branchOf('garbage')).toBeUndefined()
})
