import { expect, test } from 'claude-code/testing'

import { comparable, expectedInput, outcomeLog, outcomeOf, outcomeText, rewriteCommand, WINDOWS_REWRITE } from './rewrite'

test('the clipboard is rewritten by Windows PowerShell 5.1, by its full path under the system folder', () => {
  const argv = rewriteCommand(String.raw`C:\Windows`)
  expect(argv.slice(0, 4)).toEqual([String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`, '-NoProfile', '-NonInteractive', '-EncodedCommand'])
  expect(rewriteCommand('C:\\Windows\\')[0]).toBe(String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`)
})

test('the script writes once, with no owner window, by the Win32 API alone', () => {
  expect(WINDOWS_REWRITE.startsWith("$ErrorActionPreference = 'Stop'\n")).toBe(true)
  expect(WINDOWS_REWRITE).toContain('OpenClipboard([IntPtr]::Zero)')
  expect(WINDOWS_REWRITE).toContain('SetClipboardData(13, $memory)')
  // Neither OLE nor .NET's clipboard, which write as Set-Clipboard does.
  expect(WINDOWS_REWRITE).not.toContain('Set-Clipboard')
  expect(WINDOWS_REWRITE).not.toContain('Windows.Forms')
  // Declared in memory: no C# compiled, nothing written to the temporary folder.
  expect(WINDOWS_REWRITE).toContain('DefinePInvokeMethod')
  expect(WINDOWS_REWRITE).not.toContain('Add-Type')
  // A lock or an emptying that fails stops the write.
  expect(WINDOWS_REWRITE).toContain("throw 'GlobalLock: no memory'")
  expect(WINDOWS_REWRITE).toContain('if (-not $clip::EmptyClipboard())')
  // Plain text as .NET writes it is tolerated; a password manager's marks are not.
  expect(WINDOWS_REWRITE).toContain("'System.String'")
  expect(WINDOWS_REWRITE).not.toContain('ExcludeClipboardContentFromMonitorProcessing')
  // No backtick: the script is a template literal.
  expect(WINDOWS_REWRITE).not.toContain('`')
})

test('a text is compared with line ends as LF, without blanks ending its lines or newlines ending it', () => {
  expect(comparable('a  \r\nb\t\n\n')).toBe('a\nb')
  expect(comparable('été 🙂')).toBe('été 🙂')
})

test('the expected text goes in as base64 of its UTF-8 bytes; none, empty', () => {
  expect(expectedInput(undefined)).toBe('')
  // `café 🙂` as UTF-8, in base64.
  expect(expectedInput('café 🙂\r\n')).toBe('Y2Fmw6kg8J+Zgg==')
})

test("the script's answer is read, an unexpected one a failure", () => {
  expect(outcomeOf('rewritten 12\r\n')).toEqual({ kind: 'rewritten', length: 12 })
  expect(outcomeOf('skip changed|CF_UNICODETEXT,CF_TEXT')).toEqual({ kind: 'skipped', reason: 'changed', held: 'CF_UNICODETEXT,CF_TEXT' })
  expect(outcomeOf('skip empty|')).toEqual({ kind: 'skipped', reason: 'empty', held: '' })
  expect(outcomeOf('skip formats HTML Format,15|CF_UNICODETEXT,HTML Format,15')).toEqual({
    kind: 'skipped',
    reason: 'formats',
    formats: 'HTML Format,15',
    held: 'CF_UNICODETEXT,HTML Format,15',
  })
  expect(outcomeOf('skip changed').kind).toBe('failed')
  expect(outcomeOf('').kind).toBe('failed')
  expect(outcomeText({ kind: 'rewritten', length: 1 })).toBe('presse-papiers réécrit (1 caractère)')
  expect(outcomeText({ kind: 'skipped', reason: 'formats', formats: 'HTML Format', held: 'CF_TEXT,HTML Format' })).toContain('(HTML Format)')
})

test('the debug log names every format a skipped clipboard held', () => {
  const skipped = outcomeOf('skip changed|DataObject,CF_UNICODETEXT')
  expect(outcomeLog(skipped)).toBe('presse-papiers laissé tel quel : il a changé depuis la copie [formats : DataObject,CF_UNICODETEXT]')
  expect(outcomeLog({ kind: 'rewritten', length: 2 })).toBe('presse-papiers réécrit (2 caractères)')
})
