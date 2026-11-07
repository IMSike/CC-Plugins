import { expect, mock, test } from 'claude-code/testing'

import { BAND, click, engine, frameColors, NOTES_PANE, NOW, shell, showSettings } from '../shared/testing'

test('a setting changed in its pane is kept and redraws the band', async ($, on) => {
  mock.clock(on, { now: NOW })
  const store = engine(on)
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await showSettings($)
  await click(pane, 'settings:show-total')
  await click(pane, 'settings:frame-color-58a6ff')
  await pane.unmount()

  const stored = store.get('settings') as { show: { total: boolean }; frameColor: string }
  expect(stored.show.total).toBe(false)
  expect(stored.frameColor).toBe('#58a6ff')
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /total/, in: 'frame-br' })).toBeUndefined()
  expect(await frameColors(ui)).toContain('#58a6ff')
  await ui.unmount()
})

test('a stepper sets its number from clicks drawn on its own thread', async ($, on) => {
  mock.clock(on, { now: NOW })
  const store = engine(on)
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await showSettings($)
  // Its last cells are the step up: 50 % then 55 %, red still above.
  await pane.pointer({ type: 'down', x: 11, y: 0, button: 'left', in: 'heat-orange-stepper' })
  expect(store.get('settings')).toMatchObject({ heatOrange: 55, heatRed: 75 })
  // Orange up to red: red pushed a step above.
  await pane.post({ setting: 'heat-orange', value: 75 }, { in: 'heat-orange-stepper' })
  expect(store.get('settings')).toMatchObject({ heatOrange: 75, heatRed: 80 })
  // Subagents and terminals are counted apart.
  await pane.post({ setting: 'max-task-icons', value: 2 }, { in: 'max-task-icons-stepper' })
  expect(store.get('settings')).toMatchObject({ maxAgentIcons: 5, maxTaskIcons: 2 })
  await pane.unmount()
})

test('a note or a setting written by another session is taken up, not overwritten', async ($, on) => {
  mock.clock(on, { now: NOW })
  const store = engine(on)
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  // Written elsewhere since this session started.
  store.set('notes.global', { text: 'écrit ailleurs', updatedAt: NOW - 1000 })
  store.set('settings', { show: { branch: false } })
  const notes = await $.ui.mount(NOTES_PANE)
  expect(await notes.find({ type: 'Text', text: /écrit ailleurs/, in: 'note-global-s1' })).toBeDefined()
  await notes.unmount()

  const pane = await showSettings($)
  await click(pane, 'settings:show-total')
  await pane.unmount()
  expect(store.get('settings')).toMatchObject({ show: { branch: false, total: false } })
})

test('the crew animation setting turns the working one on with it', async ($, on) => {
  mock.clock(on, { now: NOW })
  const store = engine(on, { stored: { settings: { animateWithCrew: false } } })
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await showSettings($)
  await click(pane, 'settings:animate-with-crew')
  expect(store.get('settings')).toMatchObject({ animateOnlyWorking: true, animateWithCrew: true })
  await click(pane, 'settings:animate-with-crew')
  expect(store.get('settings')).toMatchObject({ animateOnlyWorking: true, animateWithCrew: false })
  await pane.unmount()
})
