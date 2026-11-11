import { expect, test } from 'claude-code/testing'

import { encodeCommand, envValues } from './system'

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
