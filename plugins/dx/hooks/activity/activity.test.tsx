import { expect, mock, test } from 'claude-code/testing'

import { TERMINAL } from '../shared/crew'
import { BAND, click, engine, NOTES_PANE, NOW, OUTPUT, PANE, SETTINGS_PANE, shell } from '../shared/testing'

test("a background shell's icon opens its command and output, and closes them", async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on, { files: OUTPUT })
  const panes = shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true })

  const ui = await $.ui.mount(BAND)
  await click(ui, 'crew-b1')
  expect(panes).toEqual(['dx-panel'])

  const pane = await $.ui.mount(PANE)
  expect((await pane.find({ type: 'Text', text: /^npm run dev$/ }))?.props.bold).toBe(true)
  expect(await pane.find({ type: 'Text', text: /^listening on 3000$/ })).toBeDefined()
  await pane.unmount()

  await click(ui, 'crew-b1')
  expect(panes).toEqual([])
  await ui.unmount()
})

// A `/clear` goes on under a new session id: a task started after it writes
// to that session's folder, not to the one found before.
test("a task started after a /clear shows its output, from the new session's folder", async ($, on) => {
  mock.clock(on, { now: NOW })
  const session = { id: 's1' }
  const files = { ...OUTPUT, '/claude/C--Users-dev-repo-app/s2/tasks/m1.output': 'tail started\n' }
  engine(on, { files, session })
  shell(on)
  on('tool.call', { tool: 'Monitor' }, () => ({ result: { taskId: 'm1' } as never }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true })
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  session.id = 's2'
  await $.tool.call({ tool: 'Monitor', command: 'tail -f app.log' } as never)

  const ui = await $.ui.mount(BAND)
  await click(ui, 'crew-m1')
  await ui.unmount()
  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ type: 'Text', text: /^tail started$/ })).toBeDefined()
  await pane.unmount()
})

test("the panel's tabs lead from the notes to a terminal and the settings", async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on, { files: OUTPUT })
  const panes = shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true })

  const ui = await $.ui.mount(BAND)
  await click(ui, 'notes')
  await ui.unmount()
  const notes = await $.ui.mount(NOTES_PANE)
  expect((await notes.find({ type: 'Text', text: /  Notes $/, in: 'pane-notes' }))?.props.inverse).toBe(true)
  // One pane whose content changes: it is never closed on the way.
  await click(notes, 'pane-task-b1')
  expect(panes).toEqual(['dx-panel'])
  await notes.unmount()

  const task = await $.ui.mount(PANE)
  expect((await task.find({ type: 'Text', text: /  npm run dev $/, in: 'pane-task-b1' }))?.props.inverse).toBe(true)
  await click(task, 'pane-settings')
  expect(panes).toEqual(['dx-panel'])
  await task.unmount()

  const settings = await $.ui.mount(SETTINGS_PANE)
  expect((await settings.find({ type: 'Text', text: / Réglages $/, in: 'pane-settings' }))?.props.inverse).toBe(true)
  await settings.unmount()
})

// A narrow icon chosen for monitors or notes takes one space after it in its
// tab; a Nerd Font glyph, drawn over two cells, two.
test("the panel's tabs space each icon by its width", async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on, { files: OUTPUT, stored: { settings: { monitorIcon: '◉', notesIcon: '✎' } } })
  shell(on)
  on('tool.call', { tool: 'Monitor' }, () => ({ result: { taskId: 'm1' } as never }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true })
  await $.tool.call({ tool: 'Monitor', command: 'tail -f app.log' } as never)

  const ui = await $.ui.mount(BAND)
  await click(ui, 'notes')
  await ui.unmount()
  const notes = await $.ui.mount(NOTES_PANE)
  expect(await notes.find({ type: 'Text', text: ' ◉ tail -f app.log ', in: 'pane-task-m1' })).toBeDefined()
  expect(await notes.find({ type: 'Text', text: ` ${TERMINAL}  npm run dev `, in: 'pane-task-b1' })).toBeDefined()
  expect(await notes.find({ type: 'Text', text: ' ✎ Notes ', in: 'pane-notes' })).toBeDefined()
  expect(await notes.find({ type: 'Text', text: /\u{F423} {2}Réglages $/u, in: 'pane-settings' })).toBeDefined()
  await notes.unmount()
})

test('a stopped shell leaves the border', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on, { files: OUTPUT })
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true })

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ key: 'crew-b1' })).toBeDefined()
  await $.tool.call({ tool: 'TaskStop', task_id: 'b1' })
  await ui.unmount()

  const after = await $.ui.mount(BAND)
  expect(await after.find({ key: 'crew-b1' })).toBeUndefined()
  await after.unmount()
})
