import { expect, test } from 'claude-code/testing'

import type { Activity, Task } from '../../types'
import { CURSOR_GREY, crewItems, crewLabel, crewWidth, iconGap, MONITOR, ROBOT, SPINNER, TERMINAL } from './crew'
import { DEFAULT_SETTINGS, MONITOR_ICONS, NOTES_ICONS, SETTINGS_ICONS } from './options'

const task = (id: string, kind: Task['kind'], agent?: Task['agent']): Task => ({ id, kind, command: id, agent, step: 0, dueAt: 0 })
// The icons of a kind shown before a count, a monitor's glyph: the defaults.
const MAX_ICONS = DEFAULT_SETTINGS.maxTaskIcons
const items = (crew: Activity) => crewItems(crew, MAX_ICONS, MAX_ICONS, MONITOR)

test('one icon per subagent and task, in a fixed order', () => {
  const crew: Activity = {
    agents: [
      { id: 'a1', type: 'Explore', status: 'idle' },
      { id: 'a2', type: 'Explore', status: 'running' },
    ],
    tasks: [task('b1', 'shell'), task('b2', 'monitor'), task('b3', 'shell', 'claude'), task('b4', 'shell', 'cursor')],
  }
  expect(items(crew)).toEqual([
    { glyph: '✻', color: 'claude', spin: true, open: 'a2' },
    { glyph: '✻', color: 'claude', dim: true, open: 'a1' },
    { glyph: ROBOT, color: 'claude', tail: 'b3' },
    { glyph: ROBOT, color: CURSOR_GREY, tail: 'b4' },
    { glyph: TERMINAL, color: 'subtle', tail: 'b1' },
    { glyph: MONITOR, color: 'subtle', tail: 'b2' },
  ])
})

test('a monitor is drawn with the glyph chosen for it', () => {
  const crew: Activity = { agents: [], tasks: [task('b1', 'monitor'), task('b2', 'shell')] }
  expect(crewItems(crew, MAX_ICONS, MAX_ICONS, '◎').map(item => item.glyph)).toEqual([TERMINAL, '◎'])
})

test('past the icons allowed for a kind, a count stands for the rest', () => {
  const tasks = Array.from({ length: MAX_ICONS + 3 }, (_, index) => task(`b${index}`, 'shell'))
  const shown = items({ agents: [], tasks })
  expect(shown).toHaveLength(MAX_ICONS + 1)
  expect(shown.at(-1)).toEqual({ glyph: '+3', color: 'subtle', dim: true })
  // Five icons and their own cell, `+3`, a space between each.
  expect(crewWidth(shown)).toBe(2 * MAX_ICONS + 2 + MAX_ICONS)
})

test('every pressable icon owns the cell after its glyph, the count none', () => {
  const crew: Activity = {
    agents: [
      { id: 'a1', type: 'Explore', status: 'running' },
      { id: 'a2', type: 'Explore', status: 'idle' },
    ],
    tasks: [task('b1', 'shell'), task('b2', 'monitor'), task('b3', 'shell', 'claude')],
  }
  for (const item of items(crew)) expect(crewLabel(item.glyph, item)).toBe(`${item.glyph} `)
  // Every frame of the spinner: the same two cells.
  const working = items(crew)[0]
  for (const frame of SPINNER) expect(Array.from(crewLabel(frame, working!))).toHaveLength(2)
  expect(crewLabel('+3', { glyph: '+3', color: 'subtle', dim: true })).toBe('+3')
  // Five icons of two cells, four spaces between them.
  expect(crewWidth(items(crew))).toBe(5 * 2 + 4)
})

test("the spinner turns there and back, without macOS's emoji-prone ✳", () => {
  expect(SPINNER.join('')).toBe('·✢*✶✻✽✽✻✶*✢·')
})

test('a Nerd Font icon keeps the cell after it, any other takes one space', () => {
  expect(iconGap(MONITOR)).toBe('  ')
  expect(iconGap(ROBOT)).toBe('  ')
  const narrow = [...MONITOR_ICONS, ...NOTES_ICONS, ...SETTINGS_ICONS]
    .map(([glyph]) => glyph)
    .filter(glyph => iconGap(glyph) === ' ')
  expect(narrow).toEqual(['◉', '◎', '⦿', '✎', '✐', '☰'])
})
