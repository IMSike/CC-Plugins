import { branchOf } from '../shared/format'

// The band's Git branch, without `$`: the files are read through `read`, which
// resolves undefined for a file it cannot read.

export type ReadFile = (path: string) => Promise<string | undefined>

// Where the HEAD of the repository holding each directory is, null for none.
export type HeadPaths = Map<string, string | null>

// How far up from the session's directory a `.git` is looked for.
const MAX_DEPTH = 32

function parentOf(dir: string): string {
  return dir.replace(/[\\/]+[^\\/]*$/, '')
}

// The HEAD of the repository holding `cwd`, with its path: its `.git/HEAD`, or
// for a worktree or a submodule the HEAD its `.git` file points to.
async function headOf(read: ReadFile, cwd: string): Promise<{ path: string; text: string } | undefined> {
  let dir = cwd.replace(/[\\/]+$/, '')
  for (let depth = 0; depth < MAX_DEPTH && dir !== ''; depth += 1) {
    const path = `${dir}/.git/HEAD`
    const head = await read(path)
    if (head !== undefined) return { path, text: head }

    const link = await read(`${dir}/.git`)
    const gitdir = link === undefined ? undefined : /^gitdir:\s*(.+)$/m.exec(link)?.[1]?.trim()
    if (gitdir !== undefined) {
      const absolute = /^([a-z]:)?[\\/]/i.test(gitdir) ? gitdir : `${dir}/${gitdir}`
      const linkedPath = `${absolute}/HEAD`
      const linked = await read(linkedPath)
      return linked === undefined ? undefined : { path: linkedPath, text: linked }
    }

    const parent = parentOf(dir)
    if (parent === dir) break
    dir = parent
  }

  return undefined
}

// The branch of the repository holding `cwd`, a short commit when detached.
// Where its HEAD is (or that there is none) is looked for once per directory
// and kept in `heads`, up to two reads for each parent; the HEAD itself is
// read again each time, so a branch switch shows, and looked for again once
// gone (the repository moved, a worktree removed).
export async function branchFrom(read: ReadFile, cwd: string, heads: HeadPaths): Promise<string | undefined> {
  const known = heads.get(cwd)
  if (known === null) return undefined
  if (known !== undefined) {
    const head = await read(known)
    if (head !== undefined) return branchOf(head)
  }

  const found = await headOf(read, cwd)
  heads.set(cwd, found?.path ?? null)
  return found === undefined ? undefined : branchOf(found.text)
}
