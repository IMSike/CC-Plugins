import { expect, test } from 'claude-code/testing'

import {
  branchOf,
  compactNumber,
  countdown,
  duration,
  effortRank,
  exhaustionOf,
  filledCells,
  GAP,
  gauge,
  glow,
  heat,
  lighten,
  modelLabel,
  paceOf,
  shortenPath,
  SHUTTLE_REST_MS,
  shuttleAt,
  TRACK,
  travelMs,
  truncateStart,
  USED,
} from './format'

const NOW = Date.parse('2026-10-25T10:00:00Z')
const text = (runs: { text: string }[]) => runs.map(run => run.text).join('')

test('the heat scale goes green, yellow, orange, red, halfway at 25, 50 and 75%', () => {
  expect(heat(0)).toBe('#2ea043')
  expect(heat(12.5)).toBe('#2ea043')
  expect(heat(25)).toBe('#81a438')
  expect(heat(37.5)).toBe('#d4a72c')
  expect(heat(50)).toBe('#dc8e2e')
  expect(heat(75)).toBe('#ee633c')
  expect(heat(87.5)).toBe('#f85149')
  expect(heat(100)).toBe('#da3651')
  expect(heat(-10)).toBe(heat(0))
  expect(heat(130)).toBe(heat(100))
  expect(heat(60)).toMatch(/^#[0-9a-f]{6}$/)
})

test('a gauge is a string of beads on a dotted track', () => {
  expect(text(gauge(0, 10, 'subtle'))).toBe(TRACK.repeat(10))
  expect(text(gauge(100, 10, 'subtle'))).toBe(USED.repeat(10))
  expect(text(gauge(45, 10, 'subtle'))).toBe(`${USED.repeat(5)}${TRACK.repeat(5)}`)
  expect(text(gauge(150, 4, 'subtle'))).toBe(USED.repeat(4))
  expect(text(gauge(1, 40, 'subtle'))).toBe(`${USED}${TRACK.repeat(39)}`)
  expect(gauge(42, 37, 'subtle').reduce((sum, run) => sum + run.text.length, 0)).toBe(37)
})

test('a gauge is colored by the position of each cell, runs merged', () => {
  const runs = gauge(100, 40, 'subtle')
  expect(runs[0]?.color).toBe(heat(1.25))
  expect(runs[runs.length - 1]?.color).toBe(heat(98.75))
  expect(gauge(0, 10, 'subtle')).toEqual([{ text: TRACK.repeat(10), color: 'subtle' }])
})

test('the budget left up to the pace is pale beads', () => {
  const runs = gauge(20, 10, 'subtle', 60)
  expect(text(runs)).toBe(`${USED.repeat(2)}${GAP.repeat(4)}${TRACK.repeat(4)}`)
  expect(runs.filter(run => run.dim).map(run => run.text).join('')).toBe(GAP.repeat(4))
})

test('what is consumed ahead of the pace is beads in full color', () => {
  const runs = gauge(80, 10, 'subtle', 30)
  expect(text(runs)).toBe(`${USED.repeat(3)}${GAP.repeat(5)}${TRACK.repeat(2)}`)
  expect(runs.some(run => run.dim)).toBe(false)
  // Without a pace, nothing is marked.
  expect(text(gauge(80, 10, 'subtle'))).toBe(`${USED.repeat(8)}${TRACK.repeat(2)}`)
})

test('the shuttle is a lit bead in a glow fading behind it', () => {
  const runs = gauge(100, 20, 'subtle', undefined, 8)
  const lit = runs.find(run => run.bold && run.color === lighten(heat(42.5), 0.7))
  expect(lit?.text).toBe(USED)
  expect(runs.find(run => run.color === lighten(heat(37.5), glow(1)))?.text).toBe(USED)
  // Past the part consumed, the shuttle is not drawn.
  expect(text(gauge(20, 20, 'subtle', undefined, 12))).toBe(`${USED.repeat(4)}${TRACK.repeat(16)}`)
  expect(gauge(20, 20, 'subtle', undefined, 12).some(run => run.bold)).toBe(false)
})

test('between two cells, the glow is shared by both', () => {
  expect(glow(0)).toBe(0.7)
  expect(glow(-0.5)).toBe(0.35)
  expect(glow(0.5) > glow(1)).toBe(true)
  expect(glow(-1)).toBe(0)
  expect(glow(3)).toBe(0)
  const runs = gauge(100, 20, 'subtle', undefined, 8.5)
  expect(runs.find(run => run.color === lighten(heat(42.5), glow(0.5)))).toBeDefined()
  expect(runs.find(run => run.color === lighten(heat(47.5), glow(-0.5)))).toBeDefined()
})

test('the shuttle glides from the first bead to the last consumed, then rests', () => {
  const travel = travelMs(39)
  expect(shuttleAt(0, 40)).toBe(0)
  expect(Math.abs((shuttleAt(travel / 2, 40) ?? 0) - 19.5) < 0.01).toBe(true)
  expect(shuttleAt(travel - 1, 40)! > 38.9).toBe(true)
  expect(shuttleAt(travel, 40)).toBeUndefined()
  expect(shuttleAt(travel + SHUTTLE_REST_MS, 40)).toBe(0)
  // Eased: it covers less ground in its first tenth than in its middle one.
  const long = travelMs(99)
  const early = shuttleAt(long * 0.1, 100) ?? 0
  const middle = (shuttleAt(long * 0.55, 100) ?? 0) - (shuttleAt(long * 0.45, 100) ?? 0)
  expect(early < middle).toBe(true)
  expect(shuttleAt(0, 5)).toBeUndefined()
  // A negative phase lands on the same course.
  expect(shuttleAt(-(travel + SHUTTLE_REST_MS), 40)).toBe(0)
})

test('a short course is a quick one, a long one is capped', () => {
  expect(travelMs(4) < travelMs(40)).toBe(true)
  expect(travelMs(200)).toBe(travelMs(500))
})

test('lightening mixes with white', () => {
  expect(lighten('#000000', 0)).toBe('#000000')
  expect(lighten('#000000', 1)).toBe('#ffffff')
  expect(lighten('#2ea043', 0.5)).toBe('#97d0a1')
  expect(filledCells(0, 10)).toBe(0)
  expect(filledCells(0.1, 10)).toBe(1)
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
  expect(duration(39 * 3600)).toBe('1j15h')
  expect(duration(3 * 3600 + 24 * 60)).toBe('3h24')
  expect(duration(3900)).toBe('1h05')
  expect(duration(750)).toBe('12m')
  expect(duration(-5)).toBe('0m')
  expect(countdown('2026-10-25T13:24:00Z', NOW)).toBe('3h24')
  expect(countdown('2026-10-25T09:00:00Z', NOW)).toBe('0m')
  expect(countdown('not a date', NOW)).toBe('')
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

test('the branch is read from .git/HEAD', () => {
  expect(branchOf('ref: refs/heads/dev\n')).toBe('dev')
  expect(branchOf('ref: refs/heads/feat/status-band')).toBe('feat/status-band')
  expect(branchOf('1ec6454f0e6c3b1d2a9f8e7d6c5b4a3928170615\n')).toBe('1ec6454')
  expect(branchOf('garbage')).toBeUndefined()
})
