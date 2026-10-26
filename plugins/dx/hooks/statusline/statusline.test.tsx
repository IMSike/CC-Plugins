import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { heat, travelMs } from './format'
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
// `files` more files to read, by the end of their path.
function engine(on: On, rateLimits = true, agents: unknown[] = [], files: Record<string, string> = {}) {
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
            { kind: 'five_hour', percentUsed: 20, resetsAt: '2026-10-25T13:24:00Z' },
            { kind: 'seven_day', percentUsed: 90, resetsAt: '2026-10-27T01:00:00Z' },
          ]
        : [],
    },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.list', () => ({ value: agents as never }))
  // No process list: tasks are followed from the engine's signals alone.
  on('process.run', () => ({ deny: 'no process in tests' }))
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

// A background shell `b1`, and the panes the band opens.
function shell(on: On) {
  const panes: string[] = []
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' } as never }))
  on('tool.call', { tool: 'TaskStop' }, () => ({ result: { message: 'stopped' } as never }))
  on('ui.panes', () => ({ value: panes.map(id => ({ id })) as never }))
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
  requestId: 'dx-task',
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
  expect((await ui.find({ type: 'Text', text: /session/, in: 'frame-br' }))?.text).toBe(' 24k/200k · session 1h00')
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
  expect(await frameColors(ui)).toContain('warning')
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
  expect(panes).toEqual(['dx-task'])

  const pane = await $.ui.mount(PANE)
  expect((await pane.find({ type: 'Text', text: /^npm run dev$/ }))?.props.bold).toBe(true)
  expect(await pane.find({ type: 'Text', text: /^listening on 3000$/ })).toBeDefined()
  await pane.unmount()

  await ui.press({ key: 'crew-b1' })
  expect(panes).toEqual([])
  await ui.unmount()
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
