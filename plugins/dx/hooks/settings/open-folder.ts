import type { EngineInterface } from 'claude-code'

import { errorText } from '../shared/format'
import { failureOf, powershell, systemFolder, windowsPowershell } from '../shared/system'

// Opens the settings pane's folder, Claude Code's configuration folder, in
// the File Explorer: a folder alone, never a file in it. Claude Code refuses
// a plugin's run of a program whose argument names one of its settings files
// (`settings.json`; its own rule, as observed in Claude Code 2.1.330, not
// documented), and dx does not work around that: from the folder, the file
// opens with a double click (ADR 0007).

// How long Windows PowerShell may take to start and hand the folder over.
const OPEN_TIMEOUT_MS = 15_000

// The variable that hands the folder to the script: no quoting to get right.
const FOLDER_VARIABLE = 'DX_OPEN_FOLDER'

// Opens the folder as a double click on it does (`Invoke-Item`, the shell's
// own opening, in a window shown in front). Not `explorer.exe <folder>` run
// directly: Claude Code starts a plugin's programs with their window hidden,
// and the File Explorer opens the folder in a hidden window then (as observed
// in Claude Code 2.1.330). A failure stops the script, which exits 1.
export const WINDOWS_OPEN_FOLDER = String.raw`$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Invoke-Item -LiteralPath $env:${FOLDER_VARIABLE}`

// Why the folder did not open: it is not there (`isMissing`), or why Windows
// could not open it.
export type OpenFailure = { isMissing: boolean; reason: string }

// Opens `folder`, an absolute Windows path, in the File Explorer, through
// Windows PowerShell run by its full path from the system's folder
// (`SystemRoot`), so that no program of the same name in the session's
// folder or the `PATH` runs in its place. A path that is not a folder is
// missing. Resolves with why it did not open, if it did not; never rejects.
export async function openFolder($: EngineInterface, folder: string): Promise<OpenFailure | undefined> {
  const root = await systemFolder($)
  if (root === undefined) return { isMissing: false, reason: "pas d'Explorateur de fichiers sur ce système" }
  const stat = await $.fs.stat(folder, { resolve: true }).catch(() => undefined)
  if (stat?.kind !== 'dir') return { isMissing: true, reason: `introuvable, ${folder}` }
  try {
    const ran = await $.process.run(powershell(WINDOWS_OPEN_FOLDER, windowsPowershell(root)), {
      cwd: root,
      env: { [FOLDER_VARIABLE]: folder },
      timeoutMs: OPEN_TIMEOUT_MS,
    })
    return ran.exitCode === 0 ? undefined : { isMissing: false, reason: failureOf(ran.exitCode, ran.stderr) }
  } catch (error) {
    return { isMissing: false, reason: errorText(error) }
  }
}
