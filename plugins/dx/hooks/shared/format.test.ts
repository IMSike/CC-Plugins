import { expect, test } from 'claude-code/testing'

import { clockTime, dayTime, errorText } from './format'

test('times of day are local, to the minute', () => {
  const ms = new Date(2026, 9, 31, 9, 5).getTime()
  expect(clockTime(ms)).toBe('09:05')
  expect(dayTime(ms)).toBe('31/10 09:05')
})

test('an error reads as its message, anything else as a string', () => {
  expect(errorText(new Error('disk full'))).toBe('disk full')
  expect(errorText('store over 4 MiB')).toBe('store over 4 MiB')
  expect(errorText(undefined)).toBe('undefined')
})
