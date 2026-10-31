import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { clockTime, heat, travelMs } from './format'
import { FRAME_MS } from './gauge'

const NOW = Date.parse('2026-10-25T10:00:00Z')

const BAND = {
  plugin: 'dx',
  component: 'AbovePrompt',
  surface: 'terminal',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 60,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

// The engine beneath the plugin: a session on Opus started an hour ago, in a
// repository on `dev`; context at 12%, 5-hour window at 20% resetting in 3h24,
// 7-day window at 90% resetting in 1j15h. `agents` are the session's agents,
// `files` more files to read, by the end of their path, `stored` what dx's
// store holds; without `fiveHour`, the 5-hour window has not started.
function engine(
  on: On,
  rateLimits = true,
  agents: unknown[] = [],
  files: Record<string, string> = {},
  stored: Record<string, unknown> = {},
  fiveHour = true,
) {
  // dx's store, read back by the tests.
  const store = new Map(Object.entries(stored))
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)

    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    store.delete(e.key)

    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('session.root', () => ({ value: String.raw`C:\Users\dev\repo\app` }))
  mock.env(on, { USERPROFILE: String.raw`C:\Users\dev`, TEMP: String.raw`C:\Users\dev\AppData\Local\Temp` })
  on('session.id', () => ({ value: 's1' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.cwd', () => ({ value: String.raw`C:\Users\dev\repo\app` }))
  on('settings.read', () => ({ value: { effortLevel: 'xhigh' } }))
  // Off Windows, the engine resolves the path against its own directory first.
  on('fs.read', (_, e) => {
    const path = e.path.replace(/\\/g, '/')
    if (path.endsWith('C:/Users/dev/repo/app/.git/HEAD')) return { value: 'ref: refs/heads/dev\n' }
    const file = Object.keys(files).find(end => path.endsWith(end))

    return file === undefined ? { deny: 'ENOENT' } : { value: files[file] ?? '' }
  })
  on('session.usage', () => ({
    value: {
      startedAt: NOW - 3600_000,
      context: { window: 200000, tokens: 24000, percent: 12 },
      rateLimits: rateLimits
        ? [
            ...(fiveHour ? [{ kind: 'five_hour', percentUsed: 20, resetsAt: '2026-10-25T13:24:00Z' }] : []),
            { kind: 'seven_day', percentUsed: 90, resetsAt: '2026-10-27T01:00:00Z' },
          ]
        : [],
    },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.list', () => ({ value: agents as never }))
  // No process list: tasks are followed from the engine's signals alone.
  on('process.run', () => ({ deny: 'no process in tests' }))

  return store
}

// The views the band asks for.
function views(on: On) {
  const views: { agentId?: string }[] = []
  on('ui.view', (_, e) => {
    views.push(e)

    return { value: {} }
  })

  return views
}

// Where the engine writes the background shell `b1`'s output, in the session's
// tasks folder.
const OUTPUT = { '/claude/C--Users-dev-repo-app/s1/tasks/b1.output': 'ready\nlistening on 3000\n' }

// A background shell `b1`, and the panes the band opens: dx's one panel.
function shell(on: On) {
  const panes: string[] = []
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' } as never }))
  on('tool.call', { tool: 'TaskStop' }, () => ({ result: { message: 'stopped' } as never }))
  // The last opened is the tab in front.
  on('ui.panes', () => ({ value: panes.map((id, index) => ({ id, isShown: index === panes.length - 1 })) as never }))
  on('ui.open', (_, e) => {
    if (!panes.includes(e.id)) panes.push(e.id)

    return { value: { isPlaced: true } as never }
  })
  on('ui.close', (_, e) => {
    panes.splice(panes.indexOf(e.id), 1)

    return { value: undefined }
  })

  return panes
}

const PANE = {
  plugin: 'dx',
  component: 'Pane',
  surface: 'terminal',
  requestId: 'dx-panel',
  props: { title: 'Terminal', isFocused: false, bodyColumns: 60, placement: 'inline', scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

type Mounted = {
  findAll: (query: { type: string; text: RegExp; in: string }) => Promise<{ props: { color?: string; bold?: boolean } }[]>
}

// The colors of the top border's line, but where a glint lights it.
async function frameColors(ui: Mounted) {
  return (await ui.findAll({ type: 'Text', text: /─/, in: 'frame-top' })).map(text => text.props.color)
}

test('the band frames the model, the effort, the directory and the branch', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(BAND)

  // The borders are drawn by the frame's surface modules.
  expect((await ui.find({ type: 'Text', text: /^Opus 5.5$/, in: 'frame-top' }))?.props.bold).toBe(true)
  expect(await ui.find({ type: 'Text', text: /^▰▰▰▰$/, in: 'frame-top' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^▱$/, in: 'frame-top' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ xhigh$/, in: 'frame-top' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /repo/, in: 'frame-top' }))?.text).toBe(String.raw` ~\repo\app`)
  expect((await ui.find({ type: 'Text', text: /⎇/, in: 'frame-top' }))?.text).toBe(' ⎇ dev')
  expect((await ui.find({ type: 'Text', text: /total/, in: 'frame-br' }))?.text).toBe(' total 1h00 · 24k/200k')
  await ui.unmount()
})

test('gauges are colored by level, the frame is yellow', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(BAND)

  expect((await ui.find({ type: 'Text', text: /12%/ }))?.props.color).toBe(heat(12))
  expect((await ui.find({ type: 'Text', text: /90%/ }))?.props.color).toBe(heat(90))
  expect(await frameColors(ui)).toContain('warning')

  // The glints lighten the theme's yellow as hex, never a theme key.
  const top = (await ui.find({ key: 'frame-top' })) as { props: { props: { hex: string } } } | undefined
  expect(top?.props.props.hex).toBe('#d4a72c')
  await ui.unmount()
})

test('a window used too fast warns when it runs out, another counts down', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(BAND)

  expect(await ui.find({ type: 'Text', text: /↻ 3h24$/ })).toBeDefined()
  // 7 days minus 39 hours gone, 90% used: the last 10% last 14h20.
  const warning = await ui.find({ type: 'Text', text: /⚠ 14h20$/ })
  expect(warning?.props.color).toBe('error')
  await ui.unmount()
})

test('without a subscription, only the context gauge is shown', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on, false)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(BAND)

  expect(await ui.find({ type: 'Text', text: /^ctx/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^5h/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^7d/ })).toBeUndefined()
  await ui.unmount()
})

test('the spark lights up while Claude works', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, isWorking: true } })

  expect((await ui.find({ type: 'Text', text: /^✻ $/, in: 'frame-top' }))?.props.color).toBe('claude')
  await ui.unmount()
})

test('a survey keeps the band', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>survey</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true } })

  expect((await ui.find({ type: 'Text' }))?.text).toBe('survey')
  await ui.unmount()
})

// The shuttle: the brightest bead the context gauge's module draws.
async function lit(ui: Mounted) {
  return (await ui.findAll({ type: 'Text', text: /^◎$/, in: 'gauge-ctx' })).find(text => text.props.bold === true)
}

test('a shuttle glides along the gauge, then rests', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on, false)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  // 120 columns: the context gauge is long enough for a shuttle.
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 120 } })

  expect(await lit(ui)).toBeUndefined()
  await ui.advance(FRAME_MS * 10)
  expect(await lit(ui)).toBeDefined()
  // 12% of 99 cells: an 11-cell course.
  await ui.advance(travelMs(11))
  expect(await lit(ui)).toBeUndefined()
  await ui.unmount()
})

test('the shuttle rests while nothing works, when the setting says so', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on, false, [], OUTPUT, { settings: { animateOnlyWorking: true, animateWithCrew: true } })
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const wide = { ...BAND, props: { ...BAND.props, bodyColumns: 120 } }

  const idle = await $.ui.mount(wide)
  await idle.advance(FRAME_MS * 10)
  expect(await lit(idle)).toBeUndefined()
  await idle.unmount()

  const working = await $.ui.mount({ ...wide, props: { ...wide.props, isWorking: true } })
  await working.advance(FRAME_MS * 10)
  expect(await lit(working)).toBeDefined()
  await working.unmount()

  // A background shell runs: it counts.
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true })
  const shellRuns = await $.ui.mount(wide)
  await shellRuns.advance(FRAME_MS * 10)
  expect(await lit(shellRuns)).toBeDefined()
  await shellRuns.unmount()
})

test("a subagent's icon turns and opens its transcript, then the main one again", async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on, true, [{ id: 'a1', type: 'Explore', status: 'running' }])
  const asked = views(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ key: 'crew-a1' }))?.text).toBe('·')
  await ui.press({ key: 'crew-a1' })
  expect(asked).toEqual([{ agentId: 'a1' }])
  await ui.unmount()

  // Its transcript in view: the icon is underlined, a press goes back.
  const viewing = await $.ui.mount({ ...BAND, props: { ...BAND.props, view: { agentId: 'a1' } } })
  expect((await viewing.find({ type: 'Text', text: /^·$/ }))?.props.underline).toBe(true)
  await viewing.press({ key: 'crew-a1' })
  expect(asked).toEqual([{ agentId: 'a1' }, {}])
  await viewing.unmount()
})

test("a background shell's icon opens its command and output, and closes them", async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on, true, [], OUTPUT)
  const panes = shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true })

  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'crew-b1' })
  expect(panes).toEqual(['dx-panel'])

  const pane = await $.ui.mount(PANE)
  expect((await pane.find({ type: 'Text', text: /^npm run dev$/ }))?.props.bold).toBe(true)
  expect(await pane.find({ type: 'Text', text: /^listening on 3000$/ })).toBeDefined()
  await pane.unmount()

  await ui.press({ key: 'crew-b1' })
  expect(panes).toEqual([])
  await ui.unmount()
})

test("the panel's tabs lead from the notes to a terminal and the settings", async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on, true, [], OUTPUT)
  const panes = shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true })

  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'notes' })
  await ui.unmount()
  const notes = await $.ui.mount(NOTES_PANE)
  expect((await notes.find({ type: 'Text', text: /  Notes $/ }))?.props.inverse).toBe(true)
  // One pane whose content changes: it is never closed on the way.
  await notes.press({ key: 'pane-task-b1' })
  expect(panes).toEqual(['dx-panel'])
  await notes.unmount()

  const task = await $.ui.mount(PANE)
  expect((await task.find({ type: 'Text', text: /  npm run dev $/ }))?.props.inverse).toBe(true)
  await task.press({ key: 'pane-settings' })
  expect(panes).toEqual(['dx-panel'])
  await task.unmount()

  const settings = await $.ui.mount(SETTINGS_PANE)
  expect((await settings.find({ type: 'Text', text: / Réglages $/ }))?.props.inverse).toBe(true)
  await settings.unmount()
})

test('a stopped shell leaves the border', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on, true, [], OUTPUT)
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

test('the bottom border times the last turn and says when it ended', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engine(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const before = await $.ui.mount(BAND)
  expect((await before.find({ type: 'Text', text: /total/, in: 'frame-br' }))?.text).toBe(' total 1h00 · 24k/200k')
  await before.unmount()

  await $.turn.start({ text: 'go', turnId: 't1' })
  await clock.advance(42_000)
  const running = await $.ui.mount(BAND)
  expect((await running.find({ type: 'Text', text: /durée/, in: 'frame-br' }))?.text).toBe(' durée 0m42 · total 1h00 · 24k/200k')
  await running.unmount()

  await clock.advance(22_000)
  await $.turn.complete({ answer: 'ok', durationMs: 64_000, isAborted: false, turnId: 't1', reason: 'answer' })
  const done = await $.ui.mount(BAND)
  expect((await done.find({ type: 'Text', text: /durée/, in: 'frame-br' }))?.text)
    .toBe(` durée 1m04 · fin ${clockTime(NOW + 64_000)} · total 1h01 · 24k/200k`)
  await done.unmount()
})

test('the notes and settings icons open their panes, and close them', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on)
  const panes = shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  // An earlier version's pane, kept open across a reload.
  panes.push('dx-settings')
  const ui = await $.ui.mount(BAND)
  // One panel: an icon shows its content there, a second click closes it.
  await ui.press({ key: 'notes' })
  expect(panes).toEqual(['dx-panel'])
  panes.push('dx-notes')
  await ui.press({ key: 'settings' })
  expect(panes).toEqual(['dx-panel'])
  await ui.press({ key: 'settings' })
  expect(panes).toEqual([])
  await ui.unmount()
})

const SETTINGS_PANE = { ...PANE, props: { ...PANE.props, title: 'Réglages', scroll: { offset: 0, bodyRows: 40 } } } as const
const NOTES_PANE = { ...PANE, props: { ...PANE.props, title: 'Notes', scroll: { offset: 0, bodyRows: 20 } } } as const

// The band's settings icon pressed: the panel on the settings.
async function showSettings($: Engine) {
  const band = await $.ui.mount(BAND)
  await band.press({ key: 'settings' })
  await band.unmount()

  return $.ui.mount(SETTINGS_PANE)
}

test("the bottom border's facts follow the order set, in the color set", async ($, on) => {
  mock.clock(on, { now: NOW })
  const store = engine(on)
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await showSettings($)
  await pane.press({ key: 'up-tokens' })
  await pane.press({ key: 'info-color-58a6ff' })
  await pane.unmount()
  expect((store.get('settings') as { bottomOrder: string[] }).bottomOrder).toEqual(['duration', 'end', 'tokens', 'total'])

  const ui = await $.ui.mount(BAND)
  const info = await ui.find({ type: 'Text', text: /total/, in: 'frame-br' })
  expect(info?.text).toBe(' 24k/200k · total 1h00')
  expect(info?.props.color).toBe('#58a6ff')
  await ui.unmount()
})

test('the notes open on the last tab shown, or on the one set', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on, true, [], {}, { notesTab: 'session' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount(NOTES_PANE)
  expect((await pane.find({ type: 'Text', text: /^ Session $/ }))?.props.inverse).toBe(true)
  await pane.unmount()
})

test('the notes open on the tab set when the last one is not taken up', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on, true, [], {}, { notesTab: 'session', settings: { notesTab: 'project', resumeNotesTab: false } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount(NOTES_PANE)
  expect((await pane.find({ type: 'Text', text: /^ Projet $/ }))?.props.inverse).toBe(true)
  await pane.unmount()
})

test('a setting changed in its pane is kept and redraws the band', async ($, on) => {
  mock.clock(on, { now: NOW })
  const store = engine(on)
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await showSettings($)
  await pane.press({ key: 'show-total' })
  await pane.press({ key: 'frame-color-58a6ff' })
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

test('stored settings hide elements, and may keep an idle 5-hour row', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on, true, [], {}, { settings: { show: { branch: false }, hideIdleFiveHour: false } }, false)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /⎇/, in: 'frame-top' })).toBeUndefined()
  // No 5-hour window yet: its row drawn empty.
  expect(await ui.find({ type: 'Text', text: /^5h/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^   — $/ })).toBeDefined()
  await ui.unmount()
})

test('notes are kept per tab, out of the conversation', async ($, on) => {
  mock.clock(on, { now: NOW })
  const store = engine(on, true, [], {}, { 'notes.session.old': { text: 'ancienne piste\nsuite', updatedAt: NOW - 86400_000 } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  // Every change is kept at once; Enter types a new line, and the text stays shown.
  const pane = await $.ui.mount(NOTES_PANE)
  await pane.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'note-global-s1' })
  await pane.key({ key: 'pain', in: 'note-global-s1' })
  await pane.key({ key: 'return', in: 'note-global-s1' })
  await pane.key({ key: 'lait', in: 'note-global-s1' })
  expect(store.get('notes.global')).toEqual({ text: 'pain\nlait', updatedAt: NOW })
  expect(await pane.find({ type: 'Text', text: /lait/, in: 'note-global-s1' })).toBeDefined()
  await pane.press({ key: 'tab-project' })
  await pane.post({ tab: 'project', session: 's1', text: 'migrer la base' }, { in: 'note-project-s1' })
  expect(store.get(String.raw`notes.project.C:\Users\dev\repo\app`)).toEqual({ text: 'migrer la base', updatedAt: NOW })
  await pane.press({ key: 'tab-global' })
  expect(await pane.find({ type: 'Text', text: /pain/, in: 'note-global-s1' })).toBeDefined()

  // The session tab lists the other sessions' notes: one opened, then deleted.
  await pane.press({ key: 'tab-session' })
  await pane.press({ key: 'session-old' })
  expect(await pane.find({ type: 'Text', text: /ancienne piste/, in: 'note-session-old' })).toBeDefined()
  await pane.press({ key: 'delete' })
  expect(store.get('notes.session.old')).toBeUndefined()
  expect(await pane.find({ key: 'session-old' })).toBeUndefined()
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
  await pane.press({ key: 'show-total' })
  await pane.unmount()
  expect(store.get('settings')).toMatchObject({ show: { branch: false, total: false } })
})

test('the crew animation setting turns the working one on with it', async ($, on) => {
  mock.clock(on, { now: NOW })
  const store = engine(on, true, [], {}, { settings: { animateWithCrew: false } })
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await showSettings($)
  await pane.press({ key: 'animate-with-crew' })
  expect(store.get('settings')).toMatchObject({ animateOnlyWorking: true, animateWithCrew: true })
  await pane.press({ key: 'animate-with-crew' })
  expect(store.get('settings')).toMatchObject({ animateOnlyWorking: true, animateWithCrew: false })
  await pane.unmount()
})
