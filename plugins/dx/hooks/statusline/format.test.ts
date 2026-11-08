import { expect, test } from 'claude-code/testing'

import {
  compactNumber,
  countdown,
  duration,
  effortRank,
  exhaustionOf,
  modelLabel,
  paceOf,
  shortenPath,
  truncateStart,
  turnDuration,
} from './format'

const NOW = Date.parse('2026-10-25T10:00:00Z')

test('a turn lasts to the second under an hour, to the minute past it', () => {
  expect(turnDuration(0)).toBe('0m00')
  expect(turnDuration(42_900)).toBe('0m42')
  expect(turnDuration(64_000)).toBe('1m04')
  expect(turnDuration(3_900_000)).toBe('1h05')
})

test('the pace is the share of the window gone', () => {
  // 5-hour window resetting in 3 hours: 2 hours gone.
  expect(paceOf('2026-10-25T13:00:00Z', 5 * 3600, NOW)).toBe(40)
  expect(paceOf('2026-10-25T09:00:00Z', 5 * 3600, NOW)).toBeUndefined()
  expect(paceOf('2026-10-26T10:00:00Z', 5 * 3600, NOW)).toBeUndefined()
  expect(paceOf('not a date', 5 * 3600, NOW)).toBeUndefined()
})

test('a window used too fast says when it runs out', () => {
  // 2 hours gone, 3 left: 60% used runs out in 1h20, before the reset.
  expect(exhaustionOf(60, '2026-10-25T13:00:00Z', 5 * 3600, NOW)).toBe(4800)
  // 20% used lasts 8 more hours: after the reset, nothing to say.
  expect(exhaustionOf(20, '2026-10-25T13:00:00Z', 5 * 3600, NOW)).toBeUndefined()
  expect(exhaustionOf(100, '2026-10-25T13:00:00Z', 5 * 3600, NOW)).toBe(0)
  expect(exhaustionOf(0, '2026-10-25T13:00:00Z', 5 * 3600, NOW)).toBeUndefined()
  // A minute into the window: too early to tell.
  expect(exhaustionOf(10, '2026-10-25T14:59:00Z', 5 * 3600, NOW)).toBeUndefined()
})

test('durations and countdowns read in days, hours or minutes', () => {
  expect(duration(39 * 3600, 'j')).toBe('1j15h')
  expect(duration(3 * 3600 + 24 * 60, 'j')).toBe('3h24')
  expect(duration(3900, 'j')).toBe('1h05')
  expect(duration(750, 'j')).toBe('12m')
  expect(duration(-5, 'j')).toBe('0m')
  expect(countdown('2026-10-25T13:24:00Z', NOW, 'j')).toBe('3h24')
  expect(countdown('2026-10-25T09:00:00Z', NOW, 'j')).toBe('0m')
  expect(countdown('not a date', NOW, 'j')).toBe('')
})

test('days are written `j` or `d` as asked, hours and minutes alike', () => {
  expect(duration(39 * 3600, 'd')).toBe('1d15h')
  expect(duration(3 * 3600 + 24 * 60, 'd')).toBe('3h24')
  expect(countdown('2026-10-27T01:00:00Z', NOW, 'j')).toBe('1j15h')
  expect(countdown('2026-10-27T01:00:00Z', NOW, 'd')).toBe('1d15h')
})

test('numbers read compact', () => {
  expect(compactNumber(950)).toBe('950')
  expect(compactNumber(24_400)).toBe('24k')
  expect(compactNumber(200_000)).toBe('200k')
  expect(compactNumber(1_000_000)).toBe('1M')
  expect(compactNumber(1_250_000)).toBe('1.3M')
  expect(compactNumber(12_000_000)).toBe('12M')
})

test('an effort level has a rank from 1 to 5', () => {
  expect(effortRank('low')).toBe(1)
  expect(effortRank('xhigh')).toBe(4)
  expect(effortRank('max')).toBe(5)
  expect(effortRank('32000')).toBeUndefined()
})

test('a model id reads as its family and version', () => {
  expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelLabel('claude-sonnet-5-5[1m]')).toBe('Sonnet 5.5 (1M)')
  expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(modelLabel('Opus 5.5')).toBe('Opus 5.5')
  expect(modelLabel('opus')).toBe('opus')
})

test('the home directory reads as ~', () => {
  const home = String.raw`C:\Users\dev`
  expect(shortenPath(String.raw`C:\Users\dev\repo\app`, home)).toBe(String.raw`~\repo\app`)
  expect(shortenPath('c:/users/dev/repo', String.raw`C:\Users\dev\\`)).toBe('~/repo')
  expect(shortenPath(home, home)).toBe('~')
  expect(shortenPath(String.raw`C:\Users\developer`, home)).toBe(String.raw`C:\Users\developer`)
  expect(shortenPath('/home/dev/src', '/home/dev')).toBe('~/src')
  expect(shortenPath('/srv/app', undefined)).toBe('/srv/app')
})

test('a long path is cut from the left', () => {
  expect(truncateStart('~/repo/app', 20)).toBe('~/repo/app')
  expect(truncateStart('~/repo/app', 6)).toBe('…o/app')
  expect(truncateStart('~/repo/app', 1)).toBe('…')
  expect(truncateStart('~/repo/app', 0)).toBe('')
})
