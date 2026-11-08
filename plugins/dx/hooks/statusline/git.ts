// The band's Git branch, without `$`: the files are read through `read`, which
// resolves undefined for a file it cannot read; looked for through `exists`,
// which resolves false for a path it cannot find and undefined when that
// cannot be told (a network path, `\\server\share`; a guard refusing the
// lookup); and told apart through `kind`, which resolves undefined when that
// cannot be told (the path gone, a guard refusing the lookup).
export type GitFiles = {
  read: (path: string) => Promise<string | undefined>
  exists: (path: string) => Promise<boolean | undefined>
  kind: (path: string) => Promise<'file' | 'dir' | 'other' | undefined>
}

// Where the HEAD of the repository holding each directory is, null for none.
export type HeadPaths = Map<string, string | null>

// A HEAD found: where it is, what it says, and whether that path may be kept
// for the session (not when the `.git` file naming it may be half-written).
type Head = { path: string; text: string; keep: boolean } | 'none' | undefined

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

// The HEAD the `.git` file in `dir`, reading `link`, points to. As Git reads
// it, the file is `gitdir: ` (one space) then the path, which is all the rest
// but the line endings at its end, kept as is otherwise. 'none' when it never
// will lead to a HEAD: a file not made so (Git refuses it rather than going
// on up), or naming a folder that is gone (a worktree removed). Git writes the
// file whole, ending with a newline: one without it may be cut short by a
// write still going on (an empty file, as Git leaves it between creating and
// writing it, a path cut in the middle). Such a file concludes nothing, nor
// does a HEAD missing from a folder still there (being renamed as Git writes
// it): undefined then. A HEAD it leads to is shown but not kept, as a path cut
// short may lead to another repository's (the main one, for a worktree's).
async function linkedHead(files: GitFiles, dir: string, link: string): Promise<Head> {
  const whole = link.endsWith('\n')
  const gitdir = /^gitdir: ([^\r\n]+)[\r\n]*$/.exec(link)?.[1]
  if (gitdir === undefined) return whole ? 'none' : undefined
  const absolute = /^([a-z]:)?[\\/]/i.test(gitdir) ? gitdir : `${dir}/${gitdir}`
  const path = `${absolute}/HEAD`
  const text = await files.read(path)
  if (text !== undefined) return { path, text, keep: whole }
  return whole && await files.exists(absolute) === false ? 'none' : undefined
}

// The HEAD of the repository holding `cwd`: its `.git/HEAD`, or for a
// worktree or a submodule the HEAD its `.git` file points to. A `.git` folder
// without a HEAD is passed over, as Git does. 'none' when no directory up from
// `cwd`, its root included, holds a `.git`, or when the `.git` found never
// leads to a HEAD; undefined when one does but its HEAD could not be read now
// (git renaming it as it writes it, on Windows), when the `.git` file may be
// read half-written and leads to no HEAD, or when a lookup could not be
// answered: nothing is concluded then.
async function headOf(files: GitFiles, cwd: string): Promise<Head> {
  // A POSIX path goes up to '', its root, looked in as `/.git`; a Windows
  // path stops at its drive (`C:`), its own parent. A network path
  // (`\\host\share\app`) goes up past its share to the host, looked in as
  // `\\host/.git` too, then ends at '', which is no root of its own; the file
  // system refuses such a location anyway, so the first lookup goes unanswered.
  const posix = /^\/(?![\\/])/.test(cwd)
  let dir = cwd.replace(/[\\/]+$/, '')
  for (let depth = 0; depth < MAX_DEPTH && (dir !== '' || posix); depth += 1) {
    const git = await files.exists(`${dir}/.git`)
    if (git === undefined) return undefined
    if (git) {
      const path = `${dir}/.git/HEAD`
      const head = await files.read(path)
      if (head !== undefined) return { path, text: head, keep: true }
      if (await files.exists(path) !== false) return undefined

      // No `.git/HEAD`: a `.git` file pointing to the HEAD, or a folder
      // without one, which cannot be read as a file.
      const link = await files.read(`${dir}/.git`)
      if (link !== undefined) return linkedHead(files, dir, link)

      // Unreadable: a folder, or a file that cannot be read now (Git
      // rewriting it). Only a folder is passed over: the repository above,
      // taken for this one's, would be kept for the session. Asked only on
      // this way up, so a refresh still reads the HEAD alone.
      if (await files.kind(`${dir}/.git`) !== 'dir') return undefined
    }

    const parent = parentOf(dir)
    if (parent === dir) break
    dir = parent
  }

  return 'none'
}

// The branch of the repository holding `cwd`, a short commit when detached.
// Where its HEAD is, or that no directory up from `cwd` holds a `.git` (or one
// that never leads to a HEAD), is looked for once per directory and kept in
// `heads`, one lookup for each parent; the HEAD itself is read again each
// time, so a branch switch shows, and looked for again once gone (the
// repository moved, a worktree removed). A HEAD that cannot be read now, a
// `.git` file that may be half-written (the branch it leads to shown all the
// same), or a lookup that cannot be answered keeps nothing: the next refresh
// looks again.
export async function branchFrom(files: GitFiles, cwd: string, heads: HeadPaths): Promise<string | undefined> {
  const known = heads.get(cwd)
  if (known === null) return undefined
  if (known !== undefined) {
    const head = await files.read(known)
    if (head !== undefined) return branchOf(head)
  }

  const found = await headOf(files, cwd)
  if (found === undefined) return undefined
  if (found === 'none') {
    heads.set(cwd, null)
    return undefined
  }
  if (found.keep) heads.set(cwd, found.path)
  return branchOf(found.text)
}
