import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, RenderElement } from 'claude-code'

import type { Activity, PanelView, Task, TaskView } from '../../types'
import { heldSettings } from '../settings/settings'
import { iconGap, ROBOT, TERMINAL } from '../shared/crew'
import { errorText } from '../shared/format'
import { closePanel, isShowing, PANEL, panelView, showPanel, TITLES } from '../shared/panes'
import { pressBoard } from '../shared/presses'
import { cellWidth, wrappedRows } from './tab-rows'
import {
  cliAgentUnder,
  encodeCommand,
  outputOf,
  parsePosixTree,
  parseWindowsTree,
  POSIX_TREE,
  SHELLS,
  shellOf,
  tasksDirFor,
  WINDOWS_TREE,
} from './tasks'
import type { ProcessTree } from './tasks'

// What runs beside the main loop: the session's agents, as the engine lists
// them, and the background shells and monitors. A task is followed from the
// call that started it; its end comes from the engine (a stop, a notification)
// or, as a safety net, from the system's process list, read only when a task
// is due for a check: soon after it starts (to tell an agent CLI in it), then
// further and further apart (ADR 0003).

// The agents and the tasks followed, drawn on the band's bottom border.
const activity = atom({ plugin: 'dx', key: 'activity' } as const, { agents: [], tasks: [] } as Activity, {
  shape: 'activity-2',
})

// The task shown in the terminal pane, its output read every PANE_MS.
const taskView = atom({ plugin: 'dx', key: 'taskView' } as const, null as TaskView | null, { shape: 'task-view-2' })
const PANE_MS = 1000
const PANE_LINES = 200
// Its output file not found, it is looked for on disk at every refresh for
// LOOK_FAST_MS after the task is shown, then every LOOK_SLOW_MS.
const LOOK_FAST_MS = 30_000
const LOOK_SLOW_MS = 10_000

const TICK_MS = 3000
const LIVE = new Set(['pending', 'running', 'waiting', 'idle'])
const ENDED = /^(completed|failed|killed|stopped|cancelled|canceled|error)$/i
// When a task's process is looked for, from its start: then every last step.
const CHECKS_MS = [2_000, 10_000, 60_000, 300_000, 900_000]

// Ids of tasks a notification row reported ended: a drawing may not write the
// state, so the next tick does.
const ended = new Set<string>()

// The folder the engine writes background output to, once known: named by an
// Agent result, else found on disk holding a task's output file (findOutput).
// Kept with the session id it was known for: a `/clear` goes on under a new
// id, whose tasks write to a folder of their own: the known one with the new
// id (tasksDirFor).
let tasksDir: { session: string; dir: string } | undefined

// When the shown task's output was first and last looked for on disk; reset
// as a task is shown.
let looked: { since: number; last: number } | undefined

async function processTree($: EngineInterface): Promise<ProcessTree> {
  if ((await $.env.get('OS')) === 'Windows_NT') {
    const ran = await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodeCommand(WINDOWS_TREE)])
    return parseWindowsTree(ran.stdout)
  }
  const ran = await $.process.run(['sh', '-c', POSIX_TREE])
  return parsePosixTree(ran.stdout)
}

async function refreshAgents($: EngineInterface): Promise<void> {
  const listed = await $.agent.list().catch(() => [])
  const agents = listed
    .filter(agent => LIVE.has(agent.status))
    .map(agent => ({ id: agent.id, type: agent.type, status: agent.status }))
  const current = await read($, activity)
  if (JSON.stringify(current.agents) !== JSON.stringify(agents)) {
    await update($, activity, value => ({ ...value, agents }))
  }
}

// The session id, or the last one known when it cannot be read.
async function sessionId($: EngineInterface): Promise<string | undefined> {
  return $.session.id().catch(() => tasksDir?.session)
}

// A task's output file in the folder known, moved to its session's after a
// `/clear`; undefined while none is known.
function knownOutput(id: string, session: string): string | undefined {
  if (tasksDir === undefined) return undefined
  const dir = tasksDir.session === session ? tasksDir.dir : tasksDirFor(tasksDir.dir, tasksDir.session, session)
  return dir === undefined ? undefined : `${dir}/${id}.output`
}

// A task's output file found on disk: `<id>.output` in its session's
// `<session>/tasks` under whichever folder of `<temp>/claude` holds it,
// whatever that one's name (the project's directory encoded, for older
// sessions; an id of the engine's own since). Should two hold it, the newest.
// The file alone tells the folder: a session resumed across that change has
// both, the older never written again. Found, the folder is kept as known,
// in place of one known before. `<temp>`, the first of the variables set:
// one that cannot be read is passed over, not the others.
async function findOutput($: EngineInterface, id: string, session: string): Promise<string | undefined> {
  const unread = () => undefined
  const roots = await Promise.all([
    $.env.get('CLAUDE_CODE_TMPDIR').catch(unread),
    $.env.get('TEMP').catch(unread),
    $.env.get('TMPDIR').catch(unread),
  ])
  const root = roots.find(value => value !== undefined && value !== '')
  if (root === undefined) return undefined
  const claude = `${root.replace(/[\\/]+$/, '')}/claude`
  const entries = await $.fs.list(claude).catch(() => [])
  const found = await Promise.all(
    entries
      .filter(entry => entry.kind !== 'file')
      .map(async entry => {
        const dir = `${claude}/${entry.name}/${session}/tasks`
        const stat = await $.fs.stat(`${dir}/${id}.output`).catch(() => undefined)
        return stat?.kind === 'file' ? { dir, mtimeMs: stat.mtimeMs } : undefined
      }),
  )
  let newest: { dir: string; mtimeMs: number } | undefined
  for (const one of found) if (one !== undefined && (newest === undefined || one.mtimeMs > newest.mtimeMs)) newest = one
  if (newest === undefined) return undefined
  tasksDir = { session, dir: newest.dir }
  return `${newest.dir}/${id}.output`
}

// Whether the shown task's output is due to be looked for on disk: at every
// refresh for LOOK_FAST_MS after it is shown, then every LOOK_SLOW_MS.
async function isLookDue($: EngineInterface): Promise<boolean> {
  const now = await $.clock.now()
  looked ??= { since: now, last: now }
  if (now - looked.since >= LOOK_FAST_MS && now - looked.last < LOOK_SLOW_MS) return false
  looked.last = now
  return true
}

// The last lines of the file at `path`; null when it is not there (yet); any
// other failure, its reason.
async function outputLines($: EngineInterface, path: string): Promise<string[] | null> {
  return $.fs.read(path).then(
    text => (text === '' ? [] : text.replace(/\r/g, '').split('\n').slice(-PANE_LINES)),
    async (error: unknown) => ((await $.fs.exists(path).catch(() => true)) ? [`(sortie illisible : ${errorText(error)})`] : null),
  )
}

// A task's output file and its last lines: the file named, else in the folder
// known. None there, looked for on disk when due (isLookDue): the engine may
// create its folder after the task started, a folder known may be the wrong
// one, and the task's own session's is looked into, should a `/clear` have
// come since. `lines` null while no file is found.
async function paneOutput($: EngineInterface, view: TaskView): Promise<Pick<TaskView, 'output' | 'lines'>> {
  const session = view.session ?? (await sessionId($))
  const known = view.output ?? (session === undefined ? undefined : knownOutput(view.id, session))
  const lines = known === undefined ? null : await outputLines($, known)
  if (lines !== null || session === undefined || !(await isLookDue($))) return { output: known, lines }
  const found = await findOutput($, view.id, session)
  if (found === undefined || found === known) return { output: known, lines }
  return { output: found, lines: await outputLines($, found) }
}

// Reads the shown task's output, while the panel shows it.
async function refreshPane($: EngineInterface): Promise<void> {
  const view = await read($, taskView)
  if (view === null) return
  if (!(await isShowing($, 'task'))) {
    await update($, taskView, () => null)
    return
  }
  const { output, lines } = await paneOutput($, view)
  if (output !== view.output || JSON.stringify(lines) !== JSON.stringify(view.lines)) {
    await update($, taskView, value => (value?.id !== view.id ? value : { ...value, output, lines }))
  }
}

// A task the session started: followed from now on, its output file named by
// its result, else in the folder known, else found on disk; none found yet,
// the pane looks for it while it shows the task.
async function followTask($: EngineInterface, id: string, kind: Task['kind'], command: string, result: unknown): Promise<void> {
  const session = await sessionId($)
  const output =
    outputOf(result, id) ?? (session === undefined ? undefined : (knownOutput(id, session) ?? (await findOutput($, id, session))))
  const now = await $.clock.now()
  const due = now + (CHECKS_MS[0] ?? 2000)
  await update($, activity, value =>
    value.tasks.some(task => task.id === id)
      ? value
      : { ...value, tasks: [...value.tasks, { id, kind, command, output, session, step: 0, dueAt: due }] },
  )
}

async function removeTasks($: EngineInterface, ids: ReadonlySet<string>): Promise<void> {
  if (ids.size === 0) return
  await update($, activity, value =>
    value.tasks.some(task => ids.has(task.id)) ? { ...value, tasks: value.tasks.filter(task => !ids.has(task.id)) } : value,
  )
}

// Looks for the processes of the tasks due for a check, once for all of them.
async function checkTasks($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const { tasks } = await read($, activity)
  if (!tasks.some(task => task.dueAt <= now)) return

  const tree = await processTree($).catch(() => undefined)
  // No process list: the engine's signals alone, the checks pushed back.
  if (tree === undefined) {
    await update($, activity, value => ({
      ...value,
      tasks: value.tasks.map(task => (task.dueAt <= now ? { ...task, dueAt: now + (CHECKS_MS.at(-1) ?? 900_000) } : task)),
    }))
    return
  }

  const shells = tree.procs.filter(proc => proc.ppid === tree.self && SHELLS.has(proc.name))
  await update($, activity, value => {
    const claimed = new Set(value.tasks.flatMap(task => (task.pid === undefined ? [] : [task.pid])))
    const next: Task[] = []
    for (const task of value.tasks) {
      if (task.dueAt > now) {
        next.push(task)
        continue
      }
      let pid = task.pid !== undefined && shells.some(shell => shell.pid === task.pid) ? task.pid : undefined
      if (pid === undefined && task.pid === undefined) {
        pid = shellOf(task.command, shells.filter(shell => !claimed.has(shell.pid)))?.pid
        if (pid !== undefined) claimed.add(pid)
      }
      // Its process gone once found: the task has ended. Never found, it stays
      // until the engine reports its end.
      if (task.pid !== undefined && pid === undefined) continue
      const step = Math.min(task.step + 1, CHECKS_MS.length - 1)
      const agent = pid === undefined ? task.agent : cliAgentUnder(tree.procs, pid)
      next.push({ ...task, pid, agent, step, dueAt: now + (CHECKS_MS[step] ?? 900_000) })
    }
    return { ...value, tasks: next }
  })
}

async function tick($: EngineInterface): Promise<void> {
  await refreshAgents($)
  if (ended.size > 0) {
    const ids = new Set(ended)
    ended.clear()
    await removeTasks($, ids)
  }
  await checkTasks($)
}

// Called by ../register once the session has started: nothing followed yet,
// then its clocks. A tick that fails (the state refused a moment) is left to
// the next one, never thrown at the clock.
export async function startActivity($: EngineInterface): Promise<void> {
  ended.clear()
  await update($, activity, () => ({ agents: [], tasks: [] }))
  await refreshAgents($)
  $.clock.every(TICK_MS, () => {
    tick($).catch(() => undefined)
  })
  $.clock.every(PANE_MS, () => {
    refreshPane($).catch(() => undefined)
  })
}

// Shows a task's terminal in the panel, its output read first: the pane never
// says its file is not found while it is. A click on the task's icon
// (`toggle`) closes the panel instead when it already shows that task.
export async function showTask($: EngineInterface, id: string, toggle = true): Promise<void> {
  const shown = await read($, taskView)
  if (toggle && shown?.id === id && (await isShowing($, 'task'))) {
    await closePanel($)
    await update($, taskView, () => null)
    return
  }
  const task = (await read($, activity)).tasks.find(one => one.id === id)
  if (task === undefined) return
  looked = undefined
  const view: TaskView = { id, command: task.command, session: task.session, output: task.output, lines: null }
  const withOutput = { ...view, ...(await paneOutput($, view)) }
  await update($, taskView, () => withOutput)
  await showPanel($, 'task')
}

// What `$.ui.resolve` takes: a pane's render event.
type PaneRender = Parameters<EngineInterface['ui']['resolve']>[0]
// Characters of a command its tab shows.
const TAB_COMMAND = 24

// What each tab atop the panel shows when pressed: a content, or a background
// task's terminal.
type TabPress = { view: 'notes' | 'settings' } | { task: string }
// The task each terminal's tab shows, by its key; none for the tab in front.
// Rebuilt as the tabs are drawn, it holds the drawn ones alone. Every key
// starts with `pane-task-`, which the press hook matches; the notes' and the
// settings' tabs are answered by their own features.
let taskTabs = new Map<string, string>()

// Takes up the terminals' tabs a render drew (paneTabs' `actions`), called by
// that render once nothing is awaited any more (../shared/presses), with its
// own presses.
export function keepTaskTabs(actions: Map<string, string>): void {
  taskTabs = actions
}

// A tab pressed where no Client draws (a Button's press): the notes and the
// settings draw only where one does, so their own loading is not needed here.
async function tabPressed($: EngineInterface, action: TabPress): Promise<void> {
  if ('task' in action) return showTask($, action.task, false)
  return showPanel($, action.view)
}

// The panel's tabs, atop each of its contents: the notes, the settings, and a
// terminal per background task, the one in front marked; `rows`, what they
// take with their margin. Each is drawn by ../shared/press.tsx: the terminal
// selects nothing however the clicks come. `actions`, the task each
// terminal's tab shows, for the render to hand to keepTaskTabs.
export async function paneTabs(
  $: EngineInterface,
  e: PaneRender,
  current: PanelView,
  bodyColumns: number,
): Promise<{ tabs: RenderElement; rows: number; actions: Map<string, string> }> {
  // A pane with no column still draws each tab a cell wide, not none.
  const columns = Math.max(1, bodyColumns)
  const elements = $.ui.resolve(e)
  const { Box, Button, Text } = elements
  const { tasks } = await read($, activity)
  const view = await read($, taskView)
  const { notesIcon, settingsIcon, monitorIcon } = await heldSettings($)
  const labels: string[] = []
  // A surface with no Client draws a Button, the one way to press there.
  const board = 'Client' in elements ? pressBoard<string>(elements.Client, 'pane-') : undefined
  const tab = (key: string, label: string, isCurrent: boolean, action: TabPress) => {
    labels.push(label)
    if (board === undefined) {
      return (
        <Button key={`pane-${key}`} plain hover={{ bold: true }} onPress={() => (isCurrent ? undefined : tabPressed($, action))}>
          <Text color={isCurrent ? 'claude' : 'subtle'} inverse={isCurrent} bold={isCurrent} wrap="truncate-end">{label}</Text>
        </Button>
      )
    }
    // As wide as drawn, cut to the pane only when longer, in terminal cells as
    // wrappedRows counts them: the region's `width` is in columns.
    const width = cellWidth(label) > columns ? columns : undefined
    const parts = [{ text: label, color: isCurrent ? 'claude' : 'subtle', inverse: isCurrent, bold: isCurrent }]
    return board.press(key, isCurrent || !('task' in action) ? undefined : action.task, parts, { bold: true }, width)
  }
  // A wide glyph is followed by its own cell, then the space; a narrow one by
  // the space alone.
  const icon = (glyph: string) => `${glyph}${iconGap(glyph)}`
  const notesTab = tab('notes', ` ${icon(notesIcon)}${TITLES.notes} `, current === 'notes', { view: 'notes' })
  const settingsTab = tab('settings', ` ${icon(settingsIcon)}${TITLES.settings} `, current === 'settings', { view: 'settings' })
  const terminals = tasks.map(task => {
    const glyph = task.agent !== undefined ? ROBOT : task.kind === 'monitor' ? monitorIcon : TERMINAL
    const command = task.command.split('\n')[0] ?? ''
    const label = command.length > TAB_COMMAND ? `${command.slice(0, TAB_COMMAND - 1)}…` : command
    return tab(`task-${task.id}`, ` ${icon(glyph)}${label} `, current === 'task' && view?.id === task.id, { task: task.id })
  })

  const tabs = (
    <Box key="pane-tabs" flexShrink={0} flexWrap="wrap" columnGap={1} marginBottom={1}>
      {notesTab}
      {settingsTab}
      {terminals}
    </Box>
  )
  return { tabs, rows: wrappedRows(labels, columns) + 1, actions: board?.actions ?? new Map() }
}

// Puts a subagent's transcript in view (a click on its icon), or the main
// conversation back when that subagent's is the one in view.
export async function openAgent($: EngineInterface, id: string, viewed: string | undefined): Promise<void> {
  const shown = await $.ui.view(viewed === id ? {} : { agentId: id })
  if (shown.deny !== undefined) $.ui.toast(`dx : ${shown.deny}`)
}

// The tool hooks hand back the call's result whatever becomes of following it.
export function registerActivity(on: On): void {
  // Each terminal's tab pressed atop the panel.
  on('ui.message', { module: /press\.tsx$/, requestId: PANEL, element: /^pane-task-/ }, async ($, e) => {
    const task = taskTabs.get(e.element)
    if (task !== undefined) await showTask($, task, false)

    return {}
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    await refreshAgents($).catch(() => undefined)

    return spawned
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    const id = ran.deny === undefined && !ran.isError ? ran.result?.backgroundTaskId : undefined
    if (id !== undefined) await followTask($, id, 'shell', e.command, ran.result).catch(() => undefined)

    return ran
  })

  on('tool.call', { tool: 'Monitor' }, async ($, e, next) => {
    const ran = await next(e)
    const id = ran.deny === undefined && !ran.isError ? ran.result?.taskId : undefined
    const command = e.command ?? ''
    if (id !== undefined) await followTask($, id, 'monitor', command, ran.result).catch(() => undefined)

    return ran
  })

  // An async agent's result names its output file: the folder every task's is in.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const ran = await next(e)
    // Cast: of the kinds of Agent result, only some name a file.
    const file = (ran.result as { outputFile?: string } | undefined)?.outputFile
    const session = ran.deny === undefined && file !== undefined ? await $.session.id().catch(() => undefined) : undefined
    if (session !== undefined && file !== undefined) tasksDir = { session, dir: file.replace(/[\\/][^\\/]+$/, '') }

    return ran
  })

  on('tool.call', { tool: 'TaskStop' }, async ($, e, next) => {
    const ran = await next(e)
    const id = e.task_id ?? e.shell_id
    if (ran.deny === undefined && id !== undefined) await removeTasks($, new Set([id])).catch(() => undefined)

    return ran
  })

  // A task notification row names the task it reports on, and how it ended.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const task = e.props.task
    if (task?.id !== undefined && task.status !== undefined && ENDED.test(task.status)) ended.add(task.id)

    return next(e)
  })

  // The terminal pane: the command whole, wrapped, then as much of the
  // output's end as fits under it. A command taller than the pane scrolls it.
  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e, next) => {
    const view = await read($, taskView)
    if (view === null || (await panelView($)) !== 'task') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const { tabs, rows, actions } = await paneTabs($, e, 'task', e.props.bodyColumns)
    const columns = Math.max(10, e.props.bodyColumns)
    const commandRows = `$ ${view.command}`
      .split('\n')
      .reduce((rows, line) => rows + Math.max(1, Math.ceil(Array.from(line).length / columns)), 0)
    // Under the tabs, their margin and the rule.
    const room = Math.max(1, e.props.scroll.bodyRows - commandRows - rows - 1)
    const lines = (view.lines ?? []).slice(-room)

    // Nothing is awaited from here on: the tabs drawn replace the last ones.
    keepTaskTabs(actions)
    return (
      <Box flexDirection="column">
        {tabs}
        <Text wrap="wrap"><Text color="claude" bold>$ </Text><Text bold>{view.command}</Text></Text>
        <Text dimColor>{'─'.repeat(columns)}</Text>
        {view.lines === null && <Text dimColor>Fichier de sortie pas encore trouvé, dx le cherche encore.</Text>}
        {view.lines?.length === 0 && <Text dimColor>Pas encore de sortie.</Text>}
        {lines.map(line => <Text wrap="truncate-end">{line === '' ? ' ' : line}</Text>)}
      </Box>
    )
  })
}
