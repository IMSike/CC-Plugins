import { expect, test } from 'claude-code/testing'

import { MONITOR } from './crew'
import { DEFAULT_SETTINGS, hexOf, MONITOR_ICONS, settingsOf, thresholdsOf } from './options'

test('a color typed loosely is read as hex, anything else is refused', () => {
  expect(hexOf('#D4A72C')).toBe('#d4a72c')
  expect(hexOf(' 58a6ff ')).toBe('#58a6ff')
  expect(hexOf('#fff')).toBeUndefined()
  expect(hexOf('jaune')).toBeUndefined()
})

test('stored settings are read field by field, the rest from the defaults', () => {
  expect(settingsOf(undefined)).toEqual(DEFAULT_SETTINGS)
  expect(settingsOf('garbage')).toEqual(DEFAULT_SETTINGS)

  const read = settingsOf({ show: { branch: false, model: 'no' }, frameColor: 'nope', branchColor: 'warning', effortColor: '#58A6FF', gaugeColor: 'heat', hideIdleFiveHour: false })
  expect(read.show.branch).toBe(false)
  expect(read.show.model).toBe(true)
  expect(read.frameColor).toBe(DEFAULT_SETTINGS.frameColor)
  expect(read.effortColor).toBe('#58a6ff')
  // The theme's warning is the frame's alone.
  expect(read.branchColor).toBe('claude')
  expect(read.gaugeColor).toBe('heat')
  expect(read.hideIdleFiveHour).toBe(false)
  expect(read.animate).toEqual(DEFAULT_SETTINGS.animate)
})

test('the bottom order keeps each fact once, the missing ones after', () => {
  expect(settingsOf({ bottomOrder: ['tokens', 'tokens', 'nope', 'end'] }).bottomOrder).toEqual(['tokens', 'end', 'duration', 'total'])
})

test('numbers and choices out of bounds take their defaults', () => {
  const read = settingsOf({ maxAgentIcons: 0, notesOthers: 2.5, speed: 'warp', notesIcon: 'x', monitorIcon: 'x', notesTab: 'session' })
  expect(read.maxAgentIcons).toBe(DEFAULT_SETTINGS.maxAgentIcons)
  expect(read.notesOthers).toBe(DEFAULT_SETTINGS.notesOthers)
  expect(read.speed).toBe('normal')
  expect(read.notesIcon).toBe(DEFAULT_SETTINGS.notesIcon)
  expect(read.monitorIcon).toBe(DEFAULT_SETTINGS.monitorIcon)
  expect(read.notesTab).toBe('session')
})

test("a monitor's icon is a pulse unless another offered one is chosen", () => {
  expect(DEFAULT_SETTINGS.monitorIcon).toBe(MONITOR)
  expect(MONITOR_ICONS[0]).toEqual([MONITOR, 'nf-oct-pulse'])
  expect(settingsOf({ monitorIcon: '◉' }).monitorIcon).toBe('◉')
})

test("the 7-day gauge reads 7j unless 7d is chosen", () => {
  expect(DEFAULT_SETTINGS.sevenDayLabel).toBe('7j')
  expect(settingsOf({ sevenDayLabel: '7d' }).sevenDayLabel).toBe('7d')
  expect(settingsOf({ sevenDayLabel: '7w' }).sevenDayLabel).toBe('7j')
  // Settings stored before the choice existed keep the default.
  expect(settingsOf({ speed: 'fast' }).sevenDayLabel).toBe('7j')
})

test('the red threshold stays above the orange one', () => {
  expect(thresholdsOf(50, 75)).toEqual([50, 75])
  expect(thresholdsOf(80, 60)).toEqual([80, 85])
  expect(thresholdsOf(95, 95)).toEqual([90, 95])
  expect(settingsOf({ heatOrange: 70, heatRed: 40 })).toMatchObject({ heatOrange: 70, heatRed: 75 })
})

test("the frame takes the theme's warning color, or one of its own", () => {
  expect(DEFAULT_SETTINGS.frameColor).toBe('warning')
  expect(settingsOf({ frameColor: '#58A6FF' }).frameColor).toBe('#58a6ff')
  expect(settingsOf({ frameColor: 'warning' }).frameColor).toBe('warning')
})

test('animations run whatever works unless set otherwise', () => {
  expect(DEFAULT_SETTINGS).toMatchObject({ animateOnlyWorking: false, animateWithCrew: true })
  expect(settingsOf({ animateOnlyWorking: true, animateWithCrew: 'yes' })).toMatchObject({ animateOnlyWorking: true, animateWithCrew: true })
})
