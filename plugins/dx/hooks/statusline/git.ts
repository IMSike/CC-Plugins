// The band's Git branch, without `$`: the files are read through `read`, which
// resolves undefined for a file it cannot read, and looked for through
// `exists`, which resolves false for a path it cannot find and undefined when
// that cannot be told (a network location, a guard refusing the lookup).

type ReadFile = (path: string) => Promise<string | undefined>
type Exists = (path: string) => Promise<boolean | undefined>

// Where the HEAD of the repository holding each directory is, null for none.
export type HeadPaths = Map<string, string | null>

// How far up from the session's directory a `.git` is looked for.
const MAX_DEPTH = 32

// The branch a `.git/HEAD` names, or a short commit when it is detached.
export function branchOf(head: string): string | undefined {
  const text = head.trim()
  const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(text)
  if (ref !== null) return ref[1]
  if (/^[0-9a-f]{40,64}$/i.test(text)) return text.slice(0, 7)
  return undefined
}

function parentOf(dir: string): string {
  return dir.replace(/[\\/]+[^\\/]*$/, '')
}

// The HEAD of the repository holding `cwd`: its `.git/HEAD`, or for a
// worktree or a submodule the HEAD its `.git` file points to. A `.git` folder
// without a HEAD is passed over, as Git does. 'none' when no directory up from
// `cwd` holds a `.git`; undefined when one does but its HEAD could not be read
// now (git renaming it as it writes it, on Windows), or when a lookup could
// not be answered: nothing is concluded then.
async function headOf(read: ReadFile, exists: Exists, cwd: string): Promise<{ path: string; text: string } | 'none' | undefined> {
  let dir = cwd.replace(/[\\/]+$/, '')
  for (let depth = 0; depth < MAX_DEPTH && dir !== ''; depth += 1) {
    const git = await exists(`${dir}/.git`)
    if (git === undefined) return undefined
    if (git) {
      const path = `${dir}/.git/HEAD`
      const head = await read(path)
      if (head !== undefined) return { path, text: head }
      if (await exists(path) !== false) return undefined

      // No `.git/HEAD`: a `.git` file pointing to the HEAD, or a folder
      // without one, which cannot be read as a file.
      const link = await read(`${dir}/.git`)
      if (link !== undefined) {
        const gitdir = /^gitdir:\s*(.+)$/m.exec(link)?.[1]?.trim()
        if (gitdir === undefined) return undefined
        const absolute = /^([a-z]:)?[\\/]/i.test(gitdir) ? gitdir : `${dir}/${gitdir}`
        const linkedPath = `${absolute}/HEAD`
        const linked = await read(linkedPath)
        return linked === undefined ? undefined : { path: linkedPath, text: linked }
      }
    }

    const parent = parentOf(dir)
    if (parent === dir) break
    dir = parent
  }

  return 'none'
}

// The branch of the repository holding `cwd`, a short commit when detached.
// Where its HEAD is, or that no directory up from `cwd` holds a `.git`, is
// looked for once per directory and kept in `heads`, one lookup for each
// parent; the HEAD itself is read again each time, so a branch switch shows,
// and looked for again once gone (the repository moved, a worktree removed).
// A HEAD that cannot be read now, or a lookup that cannot be answered, keeps
// nothing: the next refresh looks again.
export async function branchFrom(read: ReadFile, exists: Exists, cwd: string, heads: HeadPaths): Promise<string | undefined> {
  const known = heads.get(cwd)
  if (known === null) return undefined
  if (known !== undefined) {
    const head = await read(known)
    if (head !== undefined) return branchOf(head)
  }

  const found = await headOf(read, exists, cwd)
  if (found === undefined) return undefined
  heads.set(cwd, found === 'none' ? null : found.path)
  return found === 'none' ? undefined : branchOf(found.text)
}
