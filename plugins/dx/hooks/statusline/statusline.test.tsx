import { expect, mock, test } from 'claude-code/testing'

import { SPIN_MS } from '../shared/crew'
import { clockTime } from '../shared/format'
import { BAND, click, engine, frameColors, NOW, OUTPUT, shell, showSettings, views } from '../shared/testing'
import type { Mounted } from '../shared/testing'
import { FRAME_MS } from './gauge'
import { heat, travelMs } from './gauge-model'

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

  // The rows' labels, in French as the countdowns: `7j`, seven days.
  expect(await ui.find({ type: 'Text', text: /^5h  $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^7j  $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /↻ 3h24$/ })).toBeDefined()
  // 7 days minus 39 hours gone, 90% used: the last 10% last 14h20.
  const warning = await ui.find({ type: 'Text', text: /⚠ 14h20$/ })
  expect(warning?.props.color).toBe('error')
  await ui.unmount()
})

test("the 7-day gauge's label set in its pane is drawn", async ($, on) => {
  mock.clock(on, { now: NOW })
  const store = engine(on)
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await showSettings($)
  await click(pane, 'settings:seven-day-label-7d')
  await pane.unmount()

  expect((store.get('settings') as { sevenDayLabel: string }).sevenDayLabel).toBe('7d')
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /^7d  $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^7j/ })).toBeUndefined()
  await ui.unmount()
})

test("the band's durations write their days as the 7-day gauge's label", async ($, on) => {
  mock.clock(on, { now: NOW })
  // A session started 39 hours ago: its total runs over a day.
  const session = { id: 's1', startedAt: NOW - 39 * 3600_000 }
  engine(on, { session })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /total/, in: 'frame-br' }))?.text).toBe(' total 1j15h · 24k/200k')
  await ui.unmount()
})

test("with the 7-day gauge labeled `7d`, the band's days are `d`", async ($, on) => {
  mock.clock(on, { now: NOW })
  const session = { id: 's1', startedAt: NOW - 39 * 3600_000 }
  engine(on, { stored: { settings: { sevenDayLabel: '7d' } }, session })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /total/, in: 'frame-br' }))?.text).toBe(' total 1d15h · 24k/200k')
  await ui.unmount()
})

test('without a subscription, only the context gauge is shown', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on, { rateLimits: false })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(BAND)

  expect(await ui.find({ type: 'Text', text: /^ctx/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^5h/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^7j/ })).toBeUndefined()
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
  engine(on, { rateLimits: false })
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
  engine(on, { rateLimits: false, files: OUTPUT, stored: { settings: { animateOnlyWorking: true, animateWithCrew: true } } })
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
  engine(on, { agents: [{ id: 'a1', type: 'Explore', status: 'running' }] })
  const asked = views(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ key: 'crew-a1' }))?.text).toBe('· ')
  await click(ui, 'crew-a1')
  expect(asked).toEqual([{ agentId: 'a1' }])
  await ui.unmount()

  // Its transcript in view: the icon is underlined, a press goes back.
  const viewing = await $.ui.mount({ ...BAND, props: { ...BAND.props, view: { agentId: 'a1' } } })
  expect((await viewing.find({ type: 'Text', text: /^· $/ }))?.props.underline).toBe(true)
  await click(viewing, 'crew-a1')
  expect(asked).toEqual([{ agentId: 'a1' }, {}])
  await viewing.unmount()
})

type Drawn = { type: string; props?: { key?: string; width?: number }; children?: (Drawn | string)[] }

// The bottom border's row: the Box holding the frame's bottom left piece.
function bottomRow(tree: Drawn): Drawn | undefined {
  const children = (tree.children ?? []).filter((child): child is Drawn => typeof child !== 'string')
  if (children.some(child => child.props?.key === 'frame-bl')) return tree
  for (const child of children) {
    const found = bottomRow(child)
    if (found !== undefined) return found
  }
  return undefined
}

function textOf(element: Drawn | string): string {
  return typeof element === 'string' ? element : (element.children ?? []).map(textOf).join('')
}

// The cells a row's elements take, as the layout counts them: a Client its
// width, anything else its text, a code point a cell.
function cellsOf(element: Drawn): number {
  return element.type === 'Client' ? (element.props?.width ?? 0) : Array.from(textOf(element)).length
}

test('each bottom icon is pressable on the cell after its glyph, as the top ones', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engine(on, { agents: [{ id: 'a1', type: 'Explore', status: 'running' }], files: OUTPUT })
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true })
  const ui = await $.ui.mount(BAND)

  // Every frame of the spinner, and the terminal icon: a Button of the glyph
  // and the cell after it, set in the row between the frame's pieces, as the
  // notes and settings Buttons are; the row as wide as the band.
  const frames = new Set<string>()
  for (let frame = 0; frame < 12; frame += 1) {
    const row = bottomRow((await ui.drawn()) as Drawn)
    const children = (row?.children ?? []).filter((child): child is Drawn => typeof child !== 'string')
    expect(children.map(child => child.type)).toEqual(['Client', 'Button', 'Text', 'Button', 'Client'])
    const [, agent, gap, task] = children
    expect(agent?.props?.key).toBe('crew-a1')
    expect(Array.from(textOf(agent!))).toHaveLength(2)
    expect(textOf(agent!).endsWith(' ')).toBe(true)
    frames.add(textOf(agent!))
    expect(textOf(gap!)).toBe(' ')
    expect(task?.props?.key).toBe('crew-b1')
    expect(Array.from(textOf(task!))).toHaveLength(2)
    expect(textOf(task!).endsWith(' ')).toBe(true)
    expect(children.reduce((sum, child) => sum + cellsOf(child), 0)).toBe(BAND.props.bodyColumns)
    await clock.advance(SPIN_MS)
  }
  expect(frames.size).toBe(6)
  await ui.unmount()
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

  const ui = await $.ui.mount(BAND)
  // One panel: an icon shows its content there, a second click closes it.
  await click(ui, 'notes')
  expect(panes).toEqual(['dx-panel'])
  await click(ui, 'settings')
  expect(panes).toEqual(['dx-panel'])
  await click(ui, 'settings')
  expect(panes).toEqual([])
  await ui.unmount()
})

test("the bottom border's facts follow the order set, in the color set", async ($, on) => {
  mock.clock(on, { now: NOW })
  const store = engine(on)
  shell(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const pane = await showSettings($)
  await click(pane, 'settings:up-tokens')
  await click(pane, 'settings:info-color-58a6ff')
  await pane.unmount()
  expect((store.get('settings') as { bottomOrder: string[] }).bottomOrder).toEqual(['duration', 'end', 'tokens', 'total'])

  const ui = await $.ui.mount(BAND)
  const info = await ui.find({ type: 'Text', text: /total/, in: 'frame-br' })
  expect(info?.text).toBe(' 24k/200k · total 1h00')
  expect(info?.props.color).toBe('#58a6ff')
  await ui.unmount()
})

test('stored settings hide elements, and may keep an idle 5-hour row', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on, { stored: { settings: { show: { branch: false }, hideIdleFiveHour: false } }, fiveHour: false })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /⎇/, in: 'frame-top' })).toBeUndefined()
  // No 5-hour window yet: its row drawn empty.
  expect(await ui.find({ type: 'Text', text: /^5h/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^   — $/ })).toBeDefined()
  await ui.unmount()
})
