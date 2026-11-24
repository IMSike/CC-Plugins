// Paths as Windows places them, for the features that name a file or a
// folder from what a person or the environment wrote (the clickable paths,
// Claude Code's configuration folder). Pure, without `$`.

// A drive as Git Bash and WSL write it: `/c/Users/…`, `/mnt/c/Users/…`.
const MOUNTED = /^\/(?:mnt\/)?([A-Za-z])\/(?=[^/])/

// Where a path leads, absolute, on Windows: from the working directory `cwd`
// when relative, from the home with `~`, from the working directory's drive
// with a root alone; `.` and `..` folded, separators backslashes. A drive as
// Git Bash and WSL write it, `/c/Users/…` and `/mnt/c/Users/…`, is that drive
// (`C:\Users\…`); `/c` alone is no drive but a folder at the working
// directory's drive's root (`C:\c`). None for what cannot be placed without
// the network or a drive's own working directory: `\\server`, `C:x`, `~`
// without a home.
export function absolutePath(path: string, cwd: string, home: string | undefined): string | undefined {
  if (/^[\\/]{2}/.test(path) || /^[A-Za-z]:(?![\\/])/.test(path)) return undefined
  let full: string
  const mounted = MOUNTED.exec(path)
  if (/^[A-Za-z]:[\\/]/.test(path)) full = path
  else if (mounted !== null) full = `${mounted[1]?.toUpperCase()}:\\${path.slice(mounted[0].length)}`
  else if (/^~(?:[\\/]|$)/.test(path)) {
    if (home === undefined) return undefined
    full = `${home}\\${path.slice(1)}`
  } else if (/^[\\/]/.test(path)) {
    const drive = /^[A-Za-z]:/.exec(cwd)?.[0]
    if (drive === undefined) return undefined
    full = `${drive}${path}`
  } else full = `${cwd}\\${path}`
  return normalizedPath(full)
}

// A path with a drive (`C:\…`, `C:/…`), its `.` and `..` folded and its
// separators made single backslashes; none for any other path.
export function normalizedPath(full: string): string | undefined {
  if (/^[\\/]{2}/.test(full) || !/^[A-Za-z]:[\\/]/.test(full)) return undefined
  const [drive = '', ...parts] = full.split(/[\\/]+/)
  const kept: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') kept.pop()
    else kept.push(part)
  }
  return `${drive}\\${kept.join('\\')}`
}
