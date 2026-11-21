import { powershell, windowsPowershell } from '../shared/system'

// The clipboard rewritten for Remote Desktop (ADR 0008): the text a copy left
// on the clipboard written again, once, by the Win32 API alone, so that a
// paste into a Remote Desktop session finds it. Pure logic, without `$`.

// How long after a copy dx sees the rewrite starts: past Claude Code's second
// write (PowerShell's, about 0.2 s after the terminal's). PowerShell's start
// adds about 0.4 s before the clipboard is written.
export const REPAIR_DELAY_MS = 1000
// A selection whose text the clipboard did not hold yet (the mouse button
// still down) is tried once more, this long after.
export const RETRY_DELAY_MS = 2000
// How often the person's selection is read, to see a copy made on selection.
export const SELECTION_POLL_MS = 500
// How long PowerShell may take.
export const REWRITE_TIMEOUT_MS = 10_000

// The slash command that rewrites the clipboard at once.
export const RDP_COMMAND = 'dx-tse'

// Reads the clipboard's text and writes it again in one opening of the
// clipboard, with no owner window: OpenClipboard(NULL), EmptyClipboard,
// SetClipboardData(CF_UNICODETEXT), CloseClipboard. The Win32 calls are
// declared in memory (`DefinePInvokeMethod`), with no C# compiled: no
// `csc.exe`, nothing written to the temporary folder. The text never leaves
// the process, so it is written back to the UTF-16 unit, line ends as they
// were. Standard input holds the text the copy was expected to leave, as
// base64 of its UTF-8 bytes (`comparable`), or nothing. Nothing is written
// when the clipboard holds anything but plain text (`skip formats <names>`:
// an image, files, HTML, a password manager's marks would be lost), no text
// (`skip empty`), or another text than expected (`skip changed`), each
// followed by `|` and every format the clipboard holds; else
// `rewritten <length>`. Plain text is what Claude Code's copies leave: the
// text in its three forms, its locale, OLE's `DataObject` and
// `Ole Private Data`, and .NET's `System.String` (`SetDataObject`). A
// failure (the clipboard held by another program 1 s long) stops the script,
// which writes its message alone to stderr, in UTF-8, and exits 1.
export const WINDOWS_REWRITE = String.raw`$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  $expected = [Console]::In.ReadToEnd().Trim()
  $assembly = [AppDomain]::CurrentDomain.DefineDynamicAssembly((New-Object Reflection.AssemblyName 'DxRdp'), [Reflection.Emit.AssemblyBuilderAccess]::Run)
  $builder = $assembly.DefineDynamicModule('DxRdp').DefineType('DxRdp.Clip', 'Public, Class')
  $declare = {
    param([string]$dll, [string]$name, [type]$returns, [type[]]$parameters)
    $method = $builder.DefinePInvokeMethod($name, $dll, [Reflection.MethodAttributes]'Public, Static, PinvokeImpl', [Reflection.CallingConventions]::Standard, $returns, $parameters, [Runtime.InteropServices.CallingConvention]::Winapi, [Runtime.InteropServices.CharSet]::Unicode)
    $method.SetImplementationFlags([Reflection.MethodImplAttributes]::PreserveSig)
  }
  & $declare 'user32.dll' 'OpenClipboard' ([bool]) @([IntPtr])
  & $declare 'user32.dll' 'CloseClipboard' ([bool]) ([type[]]@())
  & $declare 'user32.dll' 'EmptyClipboard' ([bool]) ([type[]]@())
  & $declare 'user32.dll' 'EnumClipboardFormats' ([uint32]) @([uint32])
  & $declare 'user32.dll' 'GetClipboardFormatNameW' ([int]) @([uint32], [Text.StringBuilder], [int])
  & $declare 'user32.dll' 'GetClipboardData' ([IntPtr]) @([uint32])
  & $declare 'user32.dll' 'SetClipboardData' ([IntPtr]) @([uint32], [IntPtr])
  & $declare 'kernel32.dll' 'GlobalAlloc' ([IntPtr]) @([uint32], [UIntPtr])
  & $declare 'kernel32.dll' 'GlobalFree' ([IntPtr]) @([IntPtr])
  & $declare 'kernel32.dll' 'GlobalLock' ([IntPtr]) @([IntPtr])
  & $declare 'kernel32.dll' 'GlobalUnlock' ([bool]) @([IntPtr])
  & $declare 'kernel32.dll' 'GlobalSize' ([UIntPtr]) @([IntPtr])
  $clip = $builder.CreateType()
  $opened = $false
  for ($try = 0; $try -lt 40 -and -not $opened; $try++) {
    $opened = $clip::OpenClipboard([IntPtr]::Zero)
    if (-not $opened) { Start-Sleep -Milliseconds 25 }
  }
  if (-not $opened) { throw 'OpenClipboard: clipboard held by another program' }
  try {
    $standard = @{ 1 = 'CF_TEXT'; 7 = 'CF_OEMTEXT'; 13 = 'CF_UNICODETEXT'; 16 = 'CF_LOCALE' }
    $all = @()
    $others = @()
    $format = [uint32]0
    while (($format = $clip::EnumClipboardFormats($format)) -ne 0) {
      $name = New-Object Text.StringBuilder 128
      if ($standard.ContainsKey([int]$format)) { [void]$name.Append($standard[[int]$format]) }
      else { [void]$clip::GetClipboardFormatNameW($format, $name, 128) }
      $label = $(if ($name.Length -gt 0) { $name.ToString() } else { [string]$format })
      $all += $label
      if (@('CF_TEXT', 'CF_OEMTEXT', 'CF_UNICODETEXT', 'CF_LOCALE', 'DataObject', 'Ole Private Data', 'System.String') -cnotcontains $label) { $others += $label }
    }
    $formats = '|' + ($all -join ',')
    if ($others.Count -gt 0) { [Console]::Out.Write('skip formats ' + ($others -join ',') + $formats); exit 0 }
    $data = $clip::GetClipboardData(13)
    if ($data -eq [IntPtr]::Zero) { [Console]::Out.Write('skip empty' + $formats); exit 0 }
    $size = [int][uint64]$clip::GlobalSize($data)
    $pointer = $clip::GlobalLock($data)
    if ($pointer -eq [IntPtr]::Zero) { throw 'GlobalLock: clipboard text unreadable' }
    try { $text = [Runtime.InteropServices.Marshal]::PtrToStringUni($pointer, [int][Math]::Floor($size / 2)) } finally { [void]$clip::GlobalUnlock($data) }
    $end = $text.IndexOf([char]0)
    if ($end -ge 0) { $text = $text.Substring(0, $end) }
    if ($text.Length -eq 0) { [Console]::Out.Write('skip empty' + $formats); exit 0 }
    if ($expected -ne '') {
      $want = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($expected))
      $lf = [string][char]10
      $seen = [regex]::Replace($text.Replace([string][char]13 + $lf, $lf), '[ \t]+(?=\n|$)', '').TrimEnd([char]10)
      if ($seen -cne $want) { [Console]::Out.Write('skip changed' + $formats); exit 0 }
    }
    $bytes = [Text.Encoding]::Unicode.GetBytes($text + [char]0)
    $memory = $clip::GlobalAlloc(2, [UIntPtr][uint64]$bytes.Length)
    if ($memory -eq [IntPtr]::Zero) { throw 'GlobalAlloc: no memory' }
    $target = $clip::GlobalLock($memory)
    if ($target -eq [IntPtr]::Zero) {
      [void]$clip::GlobalFree($memory)
      throw 'GlobalLock: no memory'
    }
    [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $target, $bytes.Length)
    [void]$clip::GlobalUnlock($memory)
    if (-not $clip::EmptyClipboard()) {
      [void]$clip::GlobalFree($memory)
      throw 'EmptyClipboard failed: clipboard left as it was'
    }
    if ($clip::SetClipboardData(13, $memory) -eq [IntPtr]::Zero) {
      [void]$clip::GlobalFree($memory)
      throw 'SetClipboardData failed: clipboard left empty'
    }
    [Console]::Out.Write('rewritten ' + $text.Length)
  } finally {
    [void]$clip::CloseClipboard()
  }
} catch {
  [Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
  [Console]::Error.Write($_.Exception.Message)
  exit 1
}`

// The command line rewriting the clipboard: Windows PowerShell 5.1 by its
// full path under the system's folder.
export function rewriteCommand(systemRoot: string): string[] {
  return powershell(WINDOWS_REWRITE, windowsPowershell(systemRoot))
}

// A text as the script compares it with the clipboard's: line ends as LF,
// the blanks ending a line and the newlines ending the text left out, which
// a copy may write otherwise than the selection reads.
export function comparable(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/[ \t]+(?=\n|$)/g, '').replace(/\n+$/, '')
}

// The script's standard input: the expected text, comparable, as base64 of
// its UTF-8 bytes, so that no console code page garbles it; empty when any
// plain text will do.
export function expectedInput(expected: string | undefined): string {
  if (expected === undefined) return ''
  const bytes = new TextEncoder().encode(comparable(expected))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

// What a rewrite did, as the script printed it; a skip with every format
// the clipboard held (`held`), for the debug log.
export type Outcome =
  | { kind: 'rewritten'; length: number }
  | { kind: 'skipped'; reason: 'changed' | 'empty' | 'formats'; formats?: string; held: string }
  | { kind: 'failed'; reason: string }

export function outcomeOf(stdout: string): Outcome {
  const out = stdout.trim()
  const rewritten = /^rewritten (\d+)$/.exec(out)
  if (rewritten !== null) return { kind: 'rewritten', length: Number(rewritten[1]) }
  const skipped = /^skip (changed|empty|formats)(?: ([^|]*))?\|(.*)$/.exec(out)
  if (skipped !== null) {
    const reason = skipped[1] as 'changed' | 'empty' | 'formats'
    const held = skipped[3] ?? ''
    return reason === 'formats' ? { kind: 'skipped', reason, formats: skipped[2] ?? '', held } : { kind: 'skipped', reason, held }
  }
  return { kind: 'failed', reason: `réponse inattendue : ${out.slice(0, 80) || 'rien'}` }
}

// An outcome as the command's output says it.
export function outcomeText(outcome: Outcome): string {
  switch (outcome.kind) {
    case 'rewritten':
      return `presse-papiers réécrit (${outcome.length} caractère${outcome.length > 1 ? 's' : ''})`
    case 'skipped':
      if (outcome.reason === 'changed') return 'presse-papiers laissé tel quel : il a changé depuis la copie'
      if (outcome.reason === 'empty') return 'presse-papiers laissé tel quel : il ne contient pas de texte'
      return `presse-papiers laissé tel quel : il ne contient pas que du texte (${outcome.formats ?? ''})`
    case 'failed':
      return `presse-papiers non réécrit : ${outcome.reason}`
  }
}

// An outcome as the debug log says it: a skip with every format the
// clipboard held.
export function outcomeLog(outcome: Outcome): string {
  const text = outcomeText(outcome)
  return outcome.kind === 'skipped' ? `${text} [formats : ${outcome.held || 'aucun'}]` : text
}
