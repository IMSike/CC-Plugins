import { expect, test } from 'claude-code/testing'

import { branchFrom, branchOf } from './git'
import type { HeadPaths } from './git'

// A file system holding `files`, by path, that records every read.
function disk(files: Record<string, string>) {
  const reads: string[] = []
  const read = async (path: string) => {
    reads.push(path)
    return files[path]
  }
  return { files, reads, read }
}

test("a repository's branch is read from its HEAD, up from the directory", async () => {
  const { read } = disk({ 'C:/repo/.git/HEAD': 'ref: refs/heads/dev\n' })
  expect(await branchFrom(read, 'C:/repo/app/src', new Map())).toBe('dev')
})

test('a worktree reads the HEAD its .git file points to', async () => {
  const { read } = disk({
    'C:/wt/.git': 'gitdir: C:/repo/.git/worktrees/wt\n',
    'C:/repo/.git/worktrees/wt/HEAD': 'ref: refs/heads/feature\n',
  })
  expect(await branchFrom(read, 'C:/wt', new Map())).toBe('feature')
})

test('outside a repository, the HEAD is looked for once, not on every refresh', async () => {
  const { read, reads } = disk({})
  const heads: HeadPaths = new Map()
  expect(await branchFrom(read, 'C:/a/b/c', heads)).toBeUndefined()
  // Two reads for each directory up to the root: c, b, a, C:.
  expect(reads).toHaveLength(8)
  expect(await branchFrom(read, 'C:/a/b/c', heads)).toBeUndefined()
  expect(reads).toHaveLength(8)
})

test('the HEAD found is read again each time: a branch switch shows', async () => {
  const { files, read, reads } = disk({ 'C:/repo/.git/HEAD': 'ref: refs/heads/dev\n' })
  const heads: HeadPaths = new Map()
  expect(await branchFrom(read, 'C:/repo/app', heads)).toBe('dev')
  const looked = reads.length
  files['C:/repo/.git/HEAD'] = 'ref: refs/heads/main\n'
  expect(await branchFrom(read, 'C:/repo/app', heads)).toBe('main')
  // The HEAD alone, not the way up to it.
  expect(reads).toHaveLength(looked + 1)
})

test('a HEAD gone is looked for again', async () => {
  const { files, read } = disk({ 'C:/repo/app/.git/HEAD': 'ref: refs/heads/dev\n' })
  const heads: HeadPaths = new Map()
  expect(await branchFrom(read, 'C:/repo/app', heads)).toBe('dev')
  delete files['C:/repo/app/.git/HEAD']
  files['C:/repo/.git/HEAD'] = 'ref: refs/heads/main\n'
  expect(await branchFrom(read, 'C:/repo/app', heads)).toBe('main')
})

test('the branch is read from .git/HEAD', () => {
  expect(branchOf('ref: refs/heads/dev\n')).toBe('dev')
  expect(branchOf('ref: refs/heads/feat/status-band')).toBe('feat/status-band')
  expect(branchOf('1ec6454f0e6c3b1d2a9f8e7d6c5b4a3928170615\n')).toBe('1ec6454')
  expect(branchOf('garbage')).toBeUndefined()
})
