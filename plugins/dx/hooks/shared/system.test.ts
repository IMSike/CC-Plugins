import { expect, test } from 'claude-code/testing'

import { encodeCommand, envValues, failureOf } from './system'

test('a script is encoded as PowerShell takes it: UTF-16LE in base64', () => {
  expect(encodeCommand('a')).toBe('YQA=')
  expect(encodeCommand('ab')).toBe('YQBiAA==')
  expect(encodeCommand('abc')).toBe('YQBiAGMA')
  expect(encodeCommand('é')).toBe('6QA=')
})

test('an environment read that failed, or set empty, is unset', async () => {
  const values = await envValues([Promise.resolve('a'), Promise.reject(new Error('refused')), Promise.resolve(''), Promise.resolve(undefined)])
  expect(values).toEqual(['a', undefined, undefined, undefined])
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
