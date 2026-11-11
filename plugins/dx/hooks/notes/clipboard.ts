import { encodeCommand } from '../activity/tasks'

// The system clipboard, read for the notes' paste button through the tools
// the system ships (ADR 0006): the API writes the clipboard but cannot read
// it, and a paste in the terminal goes to the prompt box.

// How long a read may take before it is given up.
export const CLIPBOARD_TIMEOUT_MS = 5000

// Prints the clipboard's text as base64 of its UTF-8 bytes, so that no
// console code page garbles an accent; nothing when it holds no text.
export const WINDOWS_CLIPBOARD = String.raw`$ProgressPreference = 'SilentlyContinue'
$text = Get-Clipboard -Raw
if ($null -eq $text) { $text = '' }
[Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$text)))`

// The commands that read the clipboard, tried in turn until one runs: on
// Windows, PowerShell; elsewhere macOS's own, then Wayland's and X11's.
export function clipboardCommands(isWindows: boolean): string[][] {
  if (isWindows) return [['powershell', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodeCommand(WINDOWS_CLIPBOARD)]]
  return [
    ['pbpaste'],
    ['wl-paste', '--no-newline'],
    ['xclip', '-selection', 'clipboard', '-o'],
    ['xsel', '--clipboard', '--output'],
  ]
}

// The text a command printed: on Windows, decoded from base64 and UTF-8.
export function clipboardText(isWindows: boolean, stdout: string): string {
  if (!isWindows) return stdout
  const binary = atob(stdout.trim())
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new TextDecoder('utf-8').decode(bytes)
}

// Why the clipboard was not read, as the pane says it.
export const CLIPBOARD_REMOTE = 'session SSH : le presse-papiers lu serait celui de la machine distante'
export const CLIPBOARD_NO_TOOL = 'presse-papiers illisible : installez wl-clipboard, xclip ou xsel'
export function clipboardUnreadable(reason: string): string {
  return `presse-papiers illisible : ${reason}`
}

// The first line a failed command wrote, or its exit code.
export function failureOf(exitCode: number, stderr: string): string {
  return stderr.split(/\r?\n/).find(line => line.trim() !== '')?.trim() ?? `code ${exitCode}`
}

// Whether the pane's warning is about the clipboard, which leaves the note
// as it was, rather than a note not saved.
export function isClipboardError(reason: string): boolean {
  return reason === CLIPBOARD_REMOTE || reason.startsWith('presse-papiers illisible')
}

// Whether a failed read only says the clipboard is empty: `wl-paste` exits
// with an error then.
export function isEmptyClipboard(argv: readonly string[], stderr: string): boolean {
  return argv[0] === 'wl-paste' && /nothing is copied|no selection/i.test(stderr)
}
