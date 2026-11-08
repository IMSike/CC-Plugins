import { expect, test } from 'claude-code/testing'

import { filledCells, GAP, gauge, glow, heat, lighten, SHUTTLE_REST_MS, shuttleAt, TRACK, travelMs, USED } from './gauge-model'

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
  expect(text(gauge(0, 10))).toBe(TRACK.repeat(10))
  expect(text(gauge(100, 10))).toBe(USED.repeat(10))
  expect(text(gauge(45, 10))).toBe(`${USED.repeat(5)}${TRACK.repeat(5)}`)
  expect(text(gauge(150, 4))).toBe(USED.repeat(4))
  expect(text(gauge(1, 40))).toBe(`${USED}${TRACK.repeat(39)}`)
  expect(gauge(42, 37).reduce((sum, run) => sum + run.text.length, 0)).toBe(37)
})

test('a gauge is colored by the position of each cell, runs merged', () => {
  const runs = gauge(100, 40)
  expect(runs[0]?.color).toBe(heat(1.25))
  expect(runs[runs.length - 1]?.color).toBe(heat(98.75))
  expect(gauge(0, 10)).toEqual([{ text: TRACK.repeat(10), color: 'subtle' }])
})

test('the budget left up to the pace is pale beads', () => {
  const runs = gauge(20, 10, 60)
  expect(text(runs)).toBe(`${USED.repeat(2)}${GAP.repeat(4)}${TRACK.repeat(4)}`)
  expect(runs.filter(run => run.dim).map(run => run.text).join('')).toBe(GAP.repeat(4))
})

test('what is consumed ahead of the pace is beads in full color', () => {
  const runs = gauge(80, 10, 30)
  expect(text(runs)).toBe(`${USED.repeat(3)}${GAP.repeat(5)}${TRACK.repeat(2)}`)
  expect(runs.some(run => run.dim)).toBe(false)
  // Without a pace, nothing is marked.
  expect(text(gauge(80, 10))).toBe(`${USED.repeat(8)}${TRACK.repeat(2)}`)
})

test('the shuttle is a lit bead in a glow fading behind it', () => {
  const runs = gauge(100, 20, undefined, 8)
  const lit = runs.find(run => run.bold && run.color === lighten(heat(42.5), 0.7))
  expect(lit?.text).toBe(USED)
  expect(runs.find(run => run.color === lighten(heat(37.5), glow(1)))?.text).toBe(USED)
  // Past the part consumed, the shuttle is not drawn.
  expect(text(gauge(20, 20, undefined, 12))).toBe(`${USED.repeat(4)}${TRACK.repeat(16)}`)
  expect(gauge(20, 20, undefined, 12).some(run => run.bold)).toBe(false)
})

test('between two cells, the glow is shared by both', () => {
  expect(glow(0)).toBe(0.7)
  expect(glow(-0.5)).toBe(0.35)
  expect(glow(0.5) > glow(1)).toBe(true)
  expect(glow(-1)).toBe(0)
  expect(glow(3)).toBe(0)
  const runs = gauge(100, 20, undefined, 8.5)
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
