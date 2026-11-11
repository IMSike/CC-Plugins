import { expect, mock, test } from 'claude-code/testing'

import { TERMINAL } from '../shared/crew'
import { BAND, click, engine, NOTES_PANE, NOW, OUTPUT, PANE, SETTINGS_PANE, shell, TASKS } from '../shared/testing'

// The engine names the folder above the session's as it likes (an id of its
// own, once the project's directory): dx finds it on disk, no agent having
// named it.
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
  const files = { ...OUTPUT, '/claude/5f3a9c21d84e07b6/s2/tasks/m1.output': 'tail started\n' }
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

// The folder an Agent result named is the engine's own: after a `/clear`, the
// new session's is beside it, found with no look on disk (every listing
// refused).
test('after a /clear, a tasks folder learned from an agent moves to the new session', async ($, on) => {
  mock.clock(on, { now: NOW })
  const session = { id: 's1' }
  const files = { '/claude/9f3a/s2/tasks/m1.output': 'tail started\n' }
  engine(on, { files, session, refused: new Set(['fs.list']) })
  shell(on)
  on('tool.call', { tool: 'Agent' }, () => ({ result: { outputFile: String.raw`C:\Temp\claude\9f3a\s1\tasks\a1.output` } as never }))
  on('tool.call', { tool: 'Monitor' }, () => ({ result: { taskId: 'm1' } as never }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Agent', prompt: 'look', description: 'look', run_in_background: true } as never)
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

// A session id that cannot be read for a moment never loses a task: the last
// one known finds its output; none known, the task is followed all the same.
test('a task started while the session id cannot be read is still followed', async ($, on) => {
  mock.clock(on, { now: NOW })
  const refused = new Set<string>()
  const files = { ...OUTPUT, [`${TASKS}/m1.output`]: 'tail started\n' }
  engine(on, { files, refused })
  shell(on)
  on('tool.call', { tool: 'Monitor' }, () => ({ result: { taskId: 'm1' } as never }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true })
  refused.add('session.id')
  await $.tool.call({ tool: 'Monitor', command: 'tail -f app.log' } as never)

  const ui = await $.ui.mount(BAND)
  await click(ui, 'crew-m1')
  await ui.unmount()
  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ type: 'Text', text: /^tail started$/ })).toBeDefined()
  await pane.unmount()
})

test('a first task started while the session id cannot be read is followed, its output unknown', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on, { refused: new Set(['session.id']) })
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true })

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ key: 'crew-b1' })).toBeDefined()
  await ui.unmount()
})

// The engine creates the tasks folder with the session's first background
// task, maybe after its result: not there then, it is looked for again.
test('a tasks folder created after the task started is found on a later refresh', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Record<string, string> = {}
  engine(on, { files })
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true })

  const ui = await $.ui.mount(BAND)
  await click(ui, 'crew-b1')
  await ui.unmount()
  Object.assign(files, OUTPUT)
  await clock.advance(1000)
  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ type: 'Text', text: /^listening on 3000$/ })).toBeDefined()
  await pane.unmount()
})

// Not found, the pane says it is still looked for.
test('an output file not found yet is said to be looked for', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on, { files: { [`${TASKS}/b0.output`]: 'done\n' } })
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true })

  const ui = await $.ui.mount(BAND)
  await click(ui, 'crew-b1')
  await ui.unmount()
  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ type: 'Text', text: 'Fichier de sortie pas encore trouvé, dx le cherche encore.' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /illisible|Pas encore de sortie/ })).toBeUndefined()
  await pane.unmount()
})

// The file there, the shell has written nothing in it yet.
test('an empty output file is no output so far', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on, { files: { [`${TASKS}/b1.output`]: '' } })
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true })

  const ui = await $.ui.mount(BAND)
  await click(ui, 'crew-b1')
  await ui.unmount()
  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ type: 'Text', text: 'Pas encore de sortie.' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /trouvé|illisible/ })).toBeUndefined()
  await pane.unmount()
})

// A session resumed across the engine's change of folder names has both: the
// project's directory, encoded, holds no file of it, however recent.
test("the folder holding the task's own output file is the one read", async ($, on) => {
  mock.clock(on, { now: NOW })
  const old = '/claude/C--Users-dev-repo-app/s1/tasks'
  engine(on, { files: { [`${old}/`]: '', ...OUTPUT }, mtimes: { [old]: NOW, [TASKS]: NOW - 60_000 } })
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true })

  const ui = await $.ui.mount(BAND)
  await click(ui, 'crew-b1')
  await ui.unmount()
  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ type: 'Text', text: /^listening on 3000$/ })).toBeDefined()
  await pane.unmount()
})

test('of several folders holding the output file, the newest is read', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files = {
    '/claude/0a1b/s1/tasks/b1.output': 'old run\n',
    [`${TASKS}/b1.output`]: 'listening on 3000\n',
    '/claude/C--Users-dev-repo-app/s1/tasks/b1.output': 'older run\n',
  }
  const mtimes = { '/claude/0a1b/s1/tasks/b1.output': NOW - 60_000, [`${TASKS}/b1.output`]: NOW, 'C--Users-dev-repo-app/s1/tasks/b1.output': NOW - 120_000 }
  engine(on, { files, mtimes })
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true })

  const ui = await $.ui.mount(BAND)
  await click(ui, 'crew-b1')
  await ui.unmount()
  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ type: 'Text', text: /^listening on 3000$/ })).toBeDefined()
  await pane.unmount()
})

// A task started before a `/clear` writes on in its own session's folder.
test('a task shown across a /clear is looked for in its own session', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const session = { id: 's1' }
  const files: Record<string, string> = {}
  engine(on, { files, session })
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true })

  const ui = await $.ui.mount(BAND)
  await click(ui, 'crew-b1')
  await ui.unmount()
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  session.id = 's2'
  Object.assign(files, OUTPUT)
  await clock.advance(1000)
  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ type: 'Text', text: /^listening on 3000$/ })).toBeDefined()
  await pane.unmount()
})

// Each look lists `<temp>/claude`: every second for 30 s, then every 10 s.
test('an output file not found is looked for less often after 30 s', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const listed: string[] = []
  engine(on, { listed })
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true })

  const ui = await $.ui.mount(BAND)
  await click(ui, 'crew-b1')
  await ui.unmount()
  const looks = async (ms: number) => {
    const before = listed.length
    for (let elapsed = 0; elapsed < ms; elapsed += 1000) await clock.advance(1000)
    return listed.length - before
  }
  expect(await looks(29_000)).toBe(29)
  expect(await looks(10_000)).toBe(1)
  expect(await looks(10_000)).toBe(1)
})

// An output over 4 MiB, which the engine will not read: the reason shown.
test('an output file that cannot be read shows why', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on, { files: OUTPUT, refused: new Set(['fs.read']) })
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true })

  const ui = await $.ui.mount(BAND)
  await click(ui, 'crew-b1')
  await ui.unmount()
  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ type: 'Text', text: /^\(sortie illisible : .*file over 4 MiB\)$/ })).toBeDefined()
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

// A tab's label is cut to the pane by the cells it takes: 20 characters of
// which 15 wide take 35 cells, past a pane of 30.
test("a tab of wide characters is cut to the pane's cells", async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on, { files: OUTPUT })
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: '日本語の開発サーバーを起動する', run_in_background: true })

  const ui = await $.ui.mount(BAND)
  await click(ui, 'crew-b1')
  await ui.unmount()
  const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 30 } })
  expect((await pane.find({ key: 'pane-task-b1' }))?.props.width).toBe(30)
  expect((await pane.find({ key: 'pane-notes' }))?.props.width).toBeUndefined()
  await pane.unmount()
})

// A pane given no column, as it opens or shrinks away: each tab keeps a cell.
test('a pane without columns cuts its tabs to one cell, not none', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on, { files: OUTPUT })
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true })

  const ui = await $.ui.mount(BAND)
  await click(ui, 'crew-b1')
  await ui.unmount()
  const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 0 } })
  expect((await pane.find({ key: 'pane-task-b1' }))?.props.width).toBe(1)
  expect((await pane.find({ key: 'pane-notes' }))?.props.width).toBe(1)
  await pane.unmount()
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
