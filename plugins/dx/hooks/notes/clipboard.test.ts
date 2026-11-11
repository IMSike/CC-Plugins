import { expect, test } from 'claude-code/testing'

import {
  CLIPBOARD_NO_TOOL,
  CLIPBOARD_REMOTE,
  CLIPBOARD_TIMEOUT_MS,
  clipboardCommands,
  clipboardText,
  clipboardUnreadable,
  failureOf,
  isClipboardError,
  isEmptyClipboard,
  isTimedOut,
  WINDOWS_CLIPBOARD,
} from './clipboard'

test('the clipboard is read with PowerShell on Windows, the tools each system ships elsewhere', () => {
  const [windows, ...others] = clipboardCommands(true)
  expect(others).toEqual([])
  expect(windows?.slice(0, 4)).toEqual(['powershell', '-NoProfile', '-NonInteractive', '-EncodedCommand'])
  expect(clipboardCommands(false).map(argv => argv[0])).toEqual(['pbpaste', 'wl-paste', 'xclip', 'xsel'])
  // Text alone from Wayland, never an image's bytes.
  expect(clipboardCommands(false)[1]).toEqual(['wl-paste', '--no-newline', '--type', 'text'])
})

test("the Windows script stops at a failure, and writes its message plainly", () => {
  expect(WINDOWS_CLIPBOARD.startsWith("$ErrorActionPreference = 'Stop'\n")).toBe(true)
  expect(WINDOWS_CLIPBOARD).toContain('[Console]::Error.Write($_.Exception.Message)')
  expect(WINDOWS_CLIPBOARD).toContain('exit 1')
})

test("Windows' base64 of UTF-8 is decoded, accents and emoji kept; elsewhere the text is as printed", () => {
  // `café 🙂` and `été` as UTF-8, in base64.
  expect(clipboardText(true, 'Y2Fmw6kg8J+Zgg==\r\n')).toBe('café 🙂')
  expect(clipboardText(true, 'w6l0w6k=')).toBe('été')
  expect(clipboardText(true, '')).toBe('')
  expect(clipboardText(false, 'été\n')).toBe('été\n')
})

test("a failed tool's first line says why, else its exit code", () => {
  expect(failureOf(1, "\nError: Can't open display\nmore")).toBe("Error: Can't open display")
  expect(failureOf(2, '')).toBe('code 2')
})

test("PowerShell's CLIXML error is read for its text", () => {
  const clixml = '#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04">'
    + '<S S="Error">Get-Clipboard : Échec de l&apos;ouverture du presse-papiers_x000D__x000A_</S>'
    + '<S S="Error">Au caractère Ligne:3_x000D__x000A_</S></Objs>'
  expect(failureOf(1, clixml)).toBe("Get-Clipboard : Échec de l'ouverture du presse-papiers")
  expect(failureOf(1, '#< CLIXML\r\n<Objs Version="1.1.0.1"></Objs>')).toBe('code 1')
})

test('a run rejected at its timeout is told from one that could not start', () => {
  expect(isTimedOut(CLIPBOARD_TIMEOUT_MS, 'process killed')).toBe(true)
  expect(isTimedOut(0, 'Command timed out after 5000ms')).toBe(true)
  expect(isTimedOut(3, 'spawn wl-paste ENOENT')).toBe(false)
})

test("a clipboard warning is told from a note not saved", () => {
  expect(isClipboardError(CLIPBOARD_REMOTE)).toBe(true)
  expect(isClipboardError(CLIPBOARD_NO_TOOL)).toBe(true)
  expect(isClipboardError(clipboardUnreadable('code 2'))).toBe(true)
  expect(isClipboardError('note trop longue (95 000 caractères au plus)')).toBe(false)
})

test("wl-paste's and xclip's errors on a clipboard holding no text are an empty clipboard, no other", () => {
  const wayland = ['wl-paste', '--no-newline', '--type', 'text']
  const x11 = ['xclip', '-selection', 'clipboard', '-o']
  expect(isEmptyClipboard(wayland, 'Nothing is copied\n')).toBe(true)
  expect(isEmptyClipboard(wayland, 'No selection\n')).toBe(true)
  expect(isEmptyClipboard(wayland, 'No suitable type of content copied\n')).toBe(true)
  expect(isEmptyClipboard(wayland, 'nothing is copied')).toBe(true)
  expect(isEmptyClipboard(wayland, 'Failed to connect to a Wayland server')).toBe(false)
  expect(isEmptyClipboard(x11, 'Error: target UTF8_STRING not available\n')).toBe(true)
  expect(isEmptyClipboard(x11, 'Error: target STRING not available')).toBe(true)
  expect(isEmptyClipboard(x11, "Error: Can't open display: (null)")).toBe(false)
  expect(isEmptyClipboard(x11, 'Nothing is copied')).toBe(false)
  expect(isEmptyClipboard(['xsel', '--clipboard', '--output'], 'Error: target STRING not available')).toBe(false)
})
