import { expect, test } from 'claude-code/testing'

import type { Activity, Task } from '../../types'
import { CURSOR_GREY, crewItems, crewWidth, MAX_ICONS, MONITOR, ROBOT, SPINNER, TERMINAL } from './crew'
import { lightAt } from './frame'

const task = (id: string, kind: Task['kind'], agent?: Task['agent']): Task => ({ id, kind, command: id, agent, step: 0, dueAt: 0 })

test('one icon per subagent and task, in a fixed order', () => {
  const crew: Activity = {
    agents: [
      { id: 'a1', type: 'Explore', status: 'idle' },
      { id: 'a2', type: 'Explore', status: 'running' },
    ],
    tasks: [task('b1', 'shell'), task('b2', 'monitor'), task('b3', 'shell', 'claude'), task('b4', 'shell', 'cursor')],
  }
  expect(crewItems(crew)).toEqual([
    { glyph: '✻', color: 'claude', spin: true, open: 'a2' },
    { glyph: '✻', color: 'claude', dim: true, open: 'a1' },
    { glyph: ROBOT, color: 'claude', wide: true, tail: 'b3' },
    { glyph: ROBOT, color: CURSOR_GREY, wide: true, tail: 'b4' },
    { glyph: TERMINAL, color: 'subtle', wide: true, tail: 'b1' },
    { glyph: MONITOR, color: 'subtle', tail: 'b2' },
  ])
})

test('past MAX_ICONS of a kind, a count stands for the rest', () => {
  const tasks = Array.from({ length: MAX_ICONS + 3 }, (_, index) => task(`b${index}`, 'shell'))
  const items = crewItems({ agents: [], tasks })
  expect(items).toHaveLength(MAX_ICONS + 1)
  expect(items.at(-1)).toEqual({ glyph: '+3', color: 'subtle', dim: true })
  // Five wide icons, `+3`, a space between each.
  expect(crewWidth(items)).toBe(2 * MAX_ICONS + 2 + MAX_ICONS)
})

test("the spinner turns there and back, without macOS's emoji-prone ✳", () => {
  expect(SPINNER.join('')).toBe('·✢*✶✻✽✽✻✶*✢·')
})

test('two glints go round the frame half a lap apart, each fading in ahead and out behind', () => {
  const perimeter = 100
  expect(lightAt(40, 40, perimeter)).toBeGreaterThan(0.8)
  expect(lightAt(90, 40, perimeter)).toBeGreaterThan(0.8)
  expect(lightAt(35, 40, perimeter)).toBeLessThan(lightAt(38, 40, perimeter))
  expect(lightAt(42, 40, perimeter)).toBeGreaterThan(0)
  expect(lightAt(42, 40, perimeter)).toBeLessThan(lightAt(41, 40, perimeter))
  expect(lightAt(44, 40, perimeter)).toBe(0)
  expect(lightAt(65, 40, perimeter)).toBe(0)
})
