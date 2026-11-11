import { expect, test } from 'claude-code/testing'

import { CLIPBOARD_NO_TOOL, CLIPBOARD_REMOTE, clipboardCommands, clipboardText, clipboardUnreadable, failureOf, isClipboardError, isEmptyClipboard } from './clipboard'

test('the clipboard is read with PowerShell on Windows, the tools each system ships elsewhere', () => {
  const [windows, ...others] = clipboardCommands(true)
  expect(others).toEqual([])
  expect(windows?.slice(0, 4)).toEqual(['powershell', '-NoProfile', '-NonInteractive', '-EncodedCommand'])
  expect(clipboardCommands(false).map(argv => argv[0])).toEqual(['pbpaste', 'wl-paste', 'xclip', 'xsel'])
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

test("a clipboard warning is told from a note not saved", () => {
  expect(isClipboardError(CLIPBOARD_REMOTE)).toBe(true)
  expect(isClipboardError(CLIPBOARD_NO_TOOL)).toBe(true)
  expect(isClipboardError(clipboardUnreadable('code 2'))).toBe(true)
  expect(isClipboardError('note trop longue (95 000 caractères au plus)')).toBe(false)
})

test("wl-paste's error on an empty clipboard is an empty clipboard, no other tool's", () => {
  expect(isEmptyClipboard(['wl-paste', '--no-newline'], 'Nothing is copied\n')).toBe(true)
  expect(isEmptyClipboard(['wl-paste', '--no-newline'], 'No selection\n')).toBe(true)
  expect(isEmptyClipboard(['wl-paste', '--no-newline'], 'Failed to connect to a Wayland server')).toBe(false)
  expect(isEmptyClipboard(['xclip', '-selection', 'clipboard', '-o'], 'Nothing is copied')).toBe(false)
})
