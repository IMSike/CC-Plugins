import { powershell } from '../shared/system'

// The system clipboard, read for the notes' paste button through the tools
// the system ships (ADR 0006): the API writes the clipboard but cannot read
// it, and a paste in the terminal goes to the prompt box.

// How long each tool may take before it is given up.
export const CLIPBOARD_TIMEOUT_MS = 5000

// Prints the clipboard's text as base64 of its UTF-8 bytes, so that no
// console code page garbles an accent; nothing when it holds no text. A
// failure (the clipboard held by another program) stops the script, which
// writes its message alone to stderr, in UTF-8, not PowerShell's CLIXML
// record.
export const WINDOWS_CLIPBOARD = String.raw`$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  $text = Get-Clipboard -Raw
  if ($null -eq $text) { $text = '' }
  [Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$text)))
} catch {
  [Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
  [Console]::Error.Write($_.Exception.Message)
  exit 1
}`

// The commands that read the clipboard, tried in turn until one reads it: on
// Windows, PowerShell; elsewhere macOS's own, then Wayland's and X11's.
// `wl-paste` is asked for text alone, never an image's bytes.
export function clipboardCommands(isWindows: boolean): string[][] {
  if (isWindows) return [powershell(WINDOWS_CLIPBOARD)]
  return [
    ['pbpaste'],
    ['wl-paste', '--no-newline', '--type', 'text'],
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
export const CLIPBOARD_TIMED_OUT = `délai dépassé (${CLIPBOARD_TIMEOUT_MS / 1000} s)`
export function clipboardUnreadable(reason: string): string {
  return `presse-papiers illisible : ${reason}`
}

// The first line a failed command wrote, or its exit code. An error
// PowerShell wrote as CLIXML (`#< CLIXML`, then XML) is read for its text.
export function failureOf(exitCode: number, stderr: string): string {
  const plain = stderr.includes('#< CLIXML') ? clixmlErrors(stderr) : stderr
  return plain.split(/\r?\n/).find(line => line.trim() !== '')?.trim() ?? `code ${exitCode}`
}

// The text of a CLIXML stream's error records, its escapes undone.
function clixmlErrors(stderr: string): string {
  const entities: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }
  return Array.from(stderr.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g), match => match[1] ?? '')
    .join('')
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&(lt|gt|quot|apos|amp);/g, (_, name: string) => entities[name] ?? '')
}

// Whether a rejected run was killed at its timeout rather than unable to
// start: it rejected that late, or says so. Both reject, and the API names
// neither: the time is what tells them apart.
export function isTimedOut(elapsedMs: number, message: string): boolean {
  return elapsedMs >= CLIPBOARD_TIMEOUT_MS * 0.9 || /timed? ?out/i.test(message)
}

// Whether the pane's warning is about the clipboard, which leaves the note
// as it was, rather than a note not saved.
export function isClipboardError(reason: string): boolean {
  return reason === CLIPBOARD_REMOTE || reason.startsWith('presse-papiers illisible')
}

// Whether a failed read only says the clipboard holds no text: `wl-paste`
// exits with an error when it is empty or holds no text, `xclip` when it
// holds nothing of the type asked.
export function isEmptyClipboard(argv: readonly string[], stderr: string): boolean {
  if (argv[0] === 'wl-paste') return /nothing is copied|no selection|no suitable type/i.test(stderr)
  if (argv[0] === 'xclip') return /target \S+ not available/i.test(stderr)
  return false
}
