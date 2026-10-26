import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { Activity, Task, TaskView } from '../../types'
import {
  cliAgentUnder,
  encodeCommand,
  outputOf,
  parsePosixTree,
  parseWindowsTree,
  POSIX_TREE,
  SHELLS,
  shellOf,
  tasksDirOf,
  WINDOWS_TREE,
} from './tasks'
import type { ProcessTree } from './tasks'

// What runs beside the main loop: the session's agents, as the engine lists
// them, and the background shells and monitors. A task is followed from the
// call that started it; its end comes from the engine (a stop, a notification)
// or, as a safety net, from the system's process list, read only when a task
// is due for a check: soon after it starts (to tell an agent CLI in it), then
// further and further apart (ADR 0003).
export const activity = atom({ plugin: 'dx', key: 'activity' } as const, { agents: [], tasks: [] } as Activity, {
  shape: 'activity-1',
})

// The task shown in the terminal pane, its output read every PANE_MS.
const taskView = atom({ plugin: 'dx', key: 'taskView' } as const, null as TaskView | null, { shape: 'task-view-1' })
export const PANE = 'dx-task'
const PANE_MS = 1000
const PANE_LINES = 200

const TICK_MS = 3000
const LIVE = new Set(['pending', 'running', 'waiting', 'idle'])
const ENDED = /^(completed|failed|killed|stopped|cancelled|canceled|error)$/i
// When a task's process is looked for, from its start: then every last step.
export const CHECKS_MS = [2_000, 10_000, 60_000, 300_000, 900_000]

// Ids of tasks a notification row reported ended: a drawing may not write the
// state, so the next tick does.
const ended = new Set<string>()

// The folder the engine writes background output to, once known: named by an
// Agent result, else worked out from the session (tasksDirOf).
let tasksDir: string | undefined

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

// Where a task's output is written: the Bash and Monitor results do not say.
async function outputPath($: EngineInterface, id: string, result: unknown): Promise<string | undefined> {
  const named = outputOf(result, id)
  if (named !== undefined) return named
  if (tasksDir === undefined) {
    const [override, temp, tmpdir, cwd, session] = await Promise.all([
      $.env.get('CLAUDE_CODE_TMPDIR'),
      $.env.get('TEMP'),
      $.env.get('TMPDIR'),
      $.session.cwd(),
      $.session.id(),
    ])
    const root = override ?? temp ?? tmpdir
    if (root === undefined) return undefined
    tasksDir = tasksDirOf(root, cwd, session)
  }
  return `${tasksDir}/${id}.output`
}

// Reads the shown task's output, while its pane is open.
async function refreshPane($: EngineInterface): Promise<void> {
  const view = await read($, taskView)
  if (view === null) return
  const panes = await $.ui.panes().catch(() => [])
  if (!panes.some(pane => pane.id === PANE)) {
    await update($, taskView, () => null)
    return
  }
  if (view.output === undefined) return
  const text = await $.fs.read(view.output).catch(() => undefined)
  const lines = text === undefined ? ['(sortie illisible)'] : text.replace(/\r/g, '').split('\n').slice(-PANE_LINES)
  if (JSON.stringify(lines) !== JSON.stringify(view.lines)) {
    await update($, taskView, value => (value === null ? value : { ...value, lines }))
  }
}

async function addTask($: EngineInterface, id: string, kind: Task['kind'], command: string, output?: string): Promise<void> {
  const now = await $.clock.now()
  const due = now + (CHECKS_MS[0] ?? 2000)
  await update($, activity, value =>
    value.tasks.some(task => task.id === id)
      ? value
      : { ...value, tasks: [...value.tasks, { id, kind, command, output, step: 0, dueAt: due }] },
  )
}

// A task the session started: followed from now on, its output file found.
async function followTask($: EngineInterface, id: string, kind: Task['kind'], command: string, result: unknown): Promise<void> {
  await addTask($, id, kind, command, await outputPath($, id, result))
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

// Called once the session has started: nothing followed yet.
export async function startActivity($: EngineInterface): Promise<void> {
  ended.clear()
  await update($, activity, () => ({ agents: [], tasks: [] }))
  await refreshAgents($)
  $.clock.every(TICK_MS, () => tick($))
  $.clock.every(PANE_MS, () => refreshPane($))
}

// Opens the terminal pane on a task (a click on its icon), or closes it when
// it already shows that task.
export async function showTask($: EngineInterface, id: string): Promise<void> {
  const shown = await read($, taskView)
  const panes = await $.ui.panes().catch(() => [])
  if (shown?.id === id && panes.some(pane => pane.id === PANE)) {
    await $.ui.close({ id: PANE }).catch(() => undefined)
    await update($, taskView, () => null)
    return
  }
  const task = (await read($, activity)).tasks.find(one => one.id === id)
  if (task === undefined) return
  const name = task.agent === 'claude' ? 'Claude CLI' : task.agent === 'cursor' ? 'Cursor CLI' : task.kind === 'monitor' ? 'Monitor' : 'Terminal'
  await update($, taskView, () => ({ id, command: task.command, output: task.output, lines: [] }))
  await $.ui.open({ id: PANE, title: `${name} · ${task.command.slice(0, 60)}` })
  await refreshPane($)
}

// Puts a subagent's transcript in view (a click on its icon), or the main
// conversation back when that subagent's is the one in view.
export async function openAgent($: EngineInterface, id: string, viewed: string | undefined): Promise<void> {
  const shown = await $.ui.view(viewed === id ? {} : { agentId: id })
  if ('deny' in shown && shown.deny !== undefined) $.ui.toast(`dx : ${shown.deny}`)
}

// The tool hooks hand back the call's result whatever becomes of following it.
export function registerActivity(on: On): void {
  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    await refreshAgents($).catch(() => undefined)

    return spawned
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    const id = ran.deny === undefined ? (ran.result as { backgroundTaskId?: string } | undefined)?.backgroundTaskId : undefined
    if (id !== undefined) await followTask($, id, 'shell', e.command, ran.result).catch(() => undefined)

    return ran
  })

  on('tool.call', { tool: 'Monitor' }, async ($, e, next) => {
    const ran = await next(e)
    const id = ran.deny === undefined ? (ran.result as { taskId?: string } | undefined)?.taskId : undefined
    const command = String((e as unknown as { command?: string }).command ?? '')
    if (id !== undefined) await followTask($, id, 'monitor', command, ran.result).catch(() => undefined)

    return ran
  })

  // An async agent's result names its output file: the folder every task's is in.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const ran = await next(e)
    const file = (ran.result as { outputFile?: string } | undefined)?.outputFile
    if (ran.deny === undefined && file !== undefined) tasksDir = file.replace(/[\\/][^\\/]+$/, '')

    return ran
  })

  on('tool.call', { tool: 'TaskStop' }, async ($, e, next) => {
    const ran = await next(e)
    const input = e as unknown as { task_id?: string; shell_id?: string }
    const id = input.task_id ?? input.shell_id
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
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const view = await read($, taskView)
    if (view === null) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const columns = Math.max(10, e.props.bodyColumns)
    const commandRows = `$ ${view.command}`
      .split('\n')
      .reduce((rows, line) => rows + Math.max(1, Math.ceil(Array.from(line).length / columns)), 0)
    const room = Math.max(1, e.props.scroll.bodyRows - commandRows - 1)
    const lines = view.lines.slice(-room)

    return (
      <Box flexDirection="column">
        <Text wrap="wrap"><Text color="claude" bold>$ </Text><Text bold>{view.command}</Text></Text>
        <Text dimColor>{'─'.repeat(columns)}</Text>
        {view.output === undefined && <Text dimColor>Fichier de sortie introuvable.</Text>}
        {view.output !== undefined && lines.length === 0 && <Text dimColor>Pas encore de sortie.</Text>}
        {lines.map(line => <Text wrap="truncate-end">{line === '' ? ' ' : line}</Text>)}
      </Box>
    )
  })
}
