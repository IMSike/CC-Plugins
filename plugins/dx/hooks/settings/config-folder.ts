// Claude Code's configuration folder, which the settings pane opens in the
// File Explorer (never writes in). Pure, without `$`: ./settings reads the
// environment, ./open-folder opens it.

// A drive as Git Bash and WSL write it: `/c/Users/…`, `/mnt/c/Users/…`.
const MOUNTED = /^\/(?:mnt\/)?([A-Za-z])\/(?=[^/])/

// Claude Code's configuration folder: `configDir` (`CLAUDE_CONFIG_DIR`) when
// set, else `.claude` in the home folder; made an absolute Windows path:
// `C:/…`, `/c/…` and `~` taken, a relative folder placed under the working
// directory `cwd`, `.` and `..` folded, separators single backslashes. None
// when it cannot be placed: a network path (`\\server`), a drive's own
// working directory (`C:x`), `~` without a home.
export function configFolder(configDir: string | undefined, home: string | undefined, cwd: string): string | undefined {
  const folder = configDir ?? (home === undefined ? undefined : `${home}\\.claude`)
  if (folder === undefined || /^[\\/]{2}/.test(folder) || /^[A-Za-z]:(?![\\/])/.test(folder)) return undefined
  let full: string
  const mounted = MOUNTED.exec(folder)
  if (/^[A-Za-z]:[\\/]/.test(folder)) full = folder
  else if (mounted !== null) full = `${mounted[1]?.toUpperCase()}:\\${folder.slice(mounted[0].length)}`
  else if (/^~(?:[\\/]|$)/.test(folder)) {
    if (home === undefined) return undefined
    full = `${home}\\${folder.slice(1)}`
  } else if (/^[\\/]/.test(folder)) {
    const drive = /^[A-Za-z]:/.exec(cwd)?.[0]
    if (drive === undefined) return undefined
    full = `${drive}${folder}`
  } else full = `${cwd}\\${folder}`
  return normalizedPath(full)
}

// A path with a drive, its `.` and `..` folded and its separators made single
// backslashes; none for any other path.
function normalizedPath(full: string): string | undefined {
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

// The name the button gives the folder: its last segment (`.claude`,
// `claude-config`), the drive alone for a drive's root.
export function folderName(folder: string): string {
  return folder.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? folder
}
