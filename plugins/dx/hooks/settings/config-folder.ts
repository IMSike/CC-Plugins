// Claude Code's configuration folder, which the settings pane opens in the
// File Explorer (never writes in), and whose settings files the clickable
// paths never link. Pure, without `$`: ./settings and ../paths/paths read
// the environment, ./open-folder opens it.

import { absolutePath } from '../shared/windows-path'

// Claude Code's configuration folder: `configDir` (`CLAUDE_CONFIG_DIR`) when
// set, else `.claude` in the home folder; made an absolute Windows path
// (`absolutePath`): `C:/…`, `/c/…` and `~` taken, a relative folder placed
// under the working directory `cwd`, `.` and `..` folded, separators single
// backslashes. None when it cannot be placed: a network path (`\\server`), a
// drive's own working directory (`C:x`), `~` without a home.
export function configFolder(configDir: string | undefined, home: string | undefined, cwd: string): string | undefined {
  const folder = configDir ?? (home === undefined ? undefined : `${home}\\.claude`)
  return folder === undefined ? undefined : absolutePath(folder, cwd, home)
}

// The name the button gives the folder: its last segment (`.claude`,
// `claude-config`), the drive alone for a drive's root.
export function folderName(folder: string): string {
  return folder.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? folder
}
