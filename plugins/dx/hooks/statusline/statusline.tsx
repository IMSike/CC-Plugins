import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, SessionUsage } from 'claude-code'

import type { Activity, Gauge, StatusSnapshot } from '../../types'
import { openAgent, showTask, startActivity } from './activity'
import { crewItems, crewWidth, isWorking, SPIN_MS, SPINNER } from './crew'
import {
  branchOf,
  compactNumber,
  countdown,
  duration,
  effortRank,
  exhaustionOf,
  heat,
  modelLabel,
  paceOf,
  shortenPath,
  truncateStart,
} from './format'
import type { FrameProps, FrameRun } from './frame'
import type { GaugeProps } from './gauge'

// Change the tag when StatusSnapshot's fields change: it declines what an
// earlier version stored, which outlives a reload.
const snapshot = atom({ plugin: 'dx', key: 'statusline' } as const, null, {
  shape: 'statusline-2',
})

// The frame's color, and as hex for its glints to lighten.
const FRAME = 'warning'
const FRAME_HEX = '#d4a72c'

// The spinner's frame, advanced while a subagent works.
const spin = atom({ plugin: 'dx', key: 'spin' } as const, 0, { shape: 'spin-1' })

async function spinTick($: EngineInterface): Promise<void> {
  const crew = await read($, activity)
  if (crew.agents.some(agent => isWorking(agent.status))) await update($, spin, frame => frame + 1)
}

// What runs beside the main loop, followed by ./activity.
const activity = atom({ plugin: 'dx', key: 'activity' } as const, { agents: [], tasks: [] } as Activity, {
  shape: 'activity-1',
})

// Countdowns are shown to the minute; the model, effort and branch may change
// between two turns.
const REFRESH_MS = 30_000
const FIVE_HOURS = 5 * 3600
const SEVEN_DAYS = 7 * 86400
// Columns: the frame and its padding (`│ ` and ` │`), the label (`ctx  12% `),
// the countdown (` ⚠ 1j15h`).
const FRAME_COLUMNS = 4
const LABEL_COLUMNS = 9
const RESET_COLUMNS = 8
const MIN_BAR_COLUMNS = 10
// The gauges' shuttles leave one after the other, this far apart.
const SHUTTLE_STAGGER_MS = 1400
// How far up from the session's directory a `.git` is looked for.
const MAX_DEPTH = 32

// The effort a main-loop request was really sent with (after a downgrade for
// the model), kept until the setting or the model changes again.
const effort: { turn?: string; setting?: string; model?: string } = {}

function gaugeOf(usage: SessionUsage, kind: string): Gauge | undefined {
  const window = usage.rateLimits.find(limit => limit.kind === kind)
  if (window === undefined) return undefined

  return { percent: window.percentUsed, resetsAt: window.resetsAt }
}

function parentOf(dir: string): string {
  return dir.replace(/[\\/]+[^\\/]*$/, '')
}

// The branch of the repository holding `cwd`: its `.git/HEAD`, or for a
// worktree or a submodule the HEAD its `.git` file points to.
async function branchFrom($: EngineInterface, cwd: string): Promise<string | undefined> {
  let dir = cwd.replace(/[\\/]+$/, '')
  for (let depth = 0; depth < MAX_DEPTH && dir !== ''; depth += 1) {
    const head = await $.fs.read(`${dir}/.git/HEAD`).catch(() => undefined)
    if (head !== undefined) return branchOf(head)

    const link = await $.fs.read(`${dir}/.git`).catch(() => undefined)
    const gitdir = link === undefined ? undefined : /^gitdir:\s*(.+)$/m.exec(link)?.[1]?.trim()
    if (gitdir !== undefined) {
      const absolute = /^([a-z]:)?[\\/]/i.test(gitdir) ? gitdir : `${dir}/${gitdir}`
      const linked = await $.fs.read(`${absolute}/HEAD`).catch(() => undefined)
      return linked === undefined ? undefined : branchOf(linked)
    }

    const parent = parentOf(dir)
    if (parent === dir) break
    dir = parent
  }

  return undefined
}

async function refresh($: EngineInterface): Promise<void> {
  const [model, cwd, usage, setting, home, now] = await Promise.all([
    $.session.model(),
    $.session.cwd(),
    $.session.usage(),
    $.settings.read({ key: 'effortLevel' }),
    $.env.get('USERPROFILE').then(profile => profile ?? $.env.get('HOME')),
    $.clock.now(),
  ])
  const configured = typeof setting === 'string' ? setting : undefined

  if (configured !== effort.setting || model !== effort.model) {
    effort.turn = undefined
    effort.setting = configured
    effort.model = model
  }

  const status: StatusSnapshot = {
    model: modelLabel(model),
    effort: effort.turn ?? configured,
    cwd: shortenPath(cwd, home),
    branch: await branchFrom($, cwd),
    context: usage.context.percent,
    contextTokens: usage.context.tokens,
    contextWindow: usage.context.window,
    fiveHour: gaugeOf(usage, 'five_hour'),
    sevenDay: gaugeOf(usage, 'seven_day'),
    startedAt: usage.startedAt,
    refreshedAt: now,
  }
  await update($, snapshot, () => status)
}

export function registerStatusline(on: On): void {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await startActivity($)
    $.clock.every(SPIN_MS, () => spinTick($))
    await refresh($)
    $.clock.every(REFRESH_MS, () => refresh($))

    return started
  })

  // turn.step streams: the hook is an async generator forwarding the chunks.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined && e.effort !== undefined) {
      effort.turn = String(e.effort)
    }

    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    if (e.agentId === undefined) await refresh($)

    return completed
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const status = await read($, snapshot)
    if (e.props.hasSurvey || status === null) return next(e)
    // The band is only raised there, and only there do gauges animate.
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)

    const { Box, Button, Client, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const columns = e.props.bodyColumns
    const barColumns = Math.max(
      MIN_BAR_COLUMNS,
      columns - FRAME_COLUMNS - LABEL_COLUMNS - RESET_COLUMNS,
    )
    const width = barColumns + FRAME_COLUMNS + LABEL_COLUMNS + RESET_COLUMNS

    const frame = FRAME

    // Top border: `╭─ ✻ Opus 5.5 ─ ▰▰▰▰▱ xhigh ───── ~\repo ⎇ dev ─╮`.
    const rank = status.effort === undefined ? undefined : effortRank(status.effort)
    const meter = rank === undefined ? '' : '▰'.repeat(rank) + '▱'.repeat(5 - rank)
    const effortText = status.effort === undefined ? '' : `${meter === '' ? '' : ' '}${status.effort}`
    const left = `╭─ ✻ ${status.model}${status.effort === undefined ? '' : ' ─ '}${meter}${effortText} `
    const branch = status.branch === undefined ? '' : ` ⎇ ${status.branch}`
    const pathRoom = Math.max(0, width - left.length - branch.length - 3 - 2)
    const path = truncateStart(status.cwd, pathRoom)
    const right = `${path === '' ? '' : ' '}${path}${branch} ─╮`
    const topFill = '─'.repeat(Math.max(1, width - left.length - right.length))

    // Bottom border: `╰──────── 24k/200k · session 1h12 ─╯`.
    const tokens = status.contextTokens === undefined
      ? ''
      : `${compactNumber(status.contextTokens)}/${compactNumber(status.contextWindow)} · `
    const info = ` ${tokens}session ${duration((now - status.startedAt) / 1000)} ─╯`
    // Its icons, one per subagent and background task: Buttons, since only a
    // press may change the view.
    const crew = await read($, activity)
    const crewList = crewItems(crew)
    const crewColumns = crewWidth(crewList)
    const spinFrame = await read($, spin)
    const viewed = e.props.view.agentId
    const icons = crewList.flatMap((item, index) => {
      const glyph = item.spin ? (SPINNER[spinFrame % SPINNER.length] ?? '✻') : item.glyph
      const label = <Text color={item.color} dimColor={item.dim} underline={item.open !== undefined && item.open === viewed}>{glyph}</Text>
      const gap = index === 0 ? [] : [<Text>{' '}</Text>]
      const agentId = item.open
      const taskId = item.tail
      if (agentId !== undefined) {
        return [...gap, <Button key={`crew-${agentId}`} plain onPress={() => openAgent($, agentId, viewed)}>{label}</Button>]
      }
      if (taskId !== undefined) {
        return [...gap, <Button key={`crew-${taskId}`} plain onPress={() => showTask($, taskId)}>{label}</Button>]
      }
      return [...gap, label]
    })
    const crewRoom = crewColumns === 0 ? 0 : crewColumns + 3
    const bottomFill = '─'.repeat(Math.max(1, width - 1 - info.length - crewRoom))

    // The frame's perimeter, clockwise from the top left corner, for its glint.
    const gaugeRows = 1 + (status.fiveHour ? 1 : 0) + (status.sevenDay ? 1 : 0)
    const height = gaugeRows + 2
    const perimeter = 2 * (width - 1) + 2 * (height - 1)
    const hex = FRAME_HEX
    const leftAt = (line: number) => (2 * (width - 1) + 2 * (height - 1) - line) % perimeter
    const rightAt = (line: number) => width - 1 + line
    const bottomAt = (column: number) => width - 1 + height - 1 + (width - 1 - column)
    const piece = (key: string, runs: FrameRun[], start: number, step: 1 | -1) => {
      const props: FrameProps = { runs, start, step, perimeter, hex }
      const columns = runs.reduce((sum, run) => sum + Array.from(run.text).length, 0)
      return <Client key={key} module="./frame.tsx" props={props} width={columns} />
    }

    const row = (
      index: number,
      label: string,
      percent: number | undefined,
      window?: { resetsAt?: string; seconds: number },
    ) => {
      const value = percent ?? 0
      const resetsAt = window?.resetsAt
      const pace = resetsAt === undefined || window === undefined ? undefined : paceOf(resetsAt, window.seconds, now)
      const gaugeProps: GaugeProps = {
        percent: value,
        pace: pace ?? null,
        width: barColumns,
        phase: index * SHUTTLE_STAGGER_MS,
      }
      const shown = percent === undefined ? '—' : `${Math.round(percent)}%`
      const exhaustion = resetsAt === undefined || window === undefined
        ? undefined
        : exhaustionOf(value, resetsAt, window.seconds, now)
      const reset = resetsAt === undefined
        ? ''
        : exhaustion === undefined
          ? `↻ ${countdown(resetsAt, now)}`
          : `⚠ ${duration(exhaustion)}`
      const line = index + 1

      return (
        <Box key={label} flexShrink={0}>
          {piece(`frame-l-${label}`, [{ text: '│', color: frame, frame: true }, { text: ' ', color: frame }], leftAt(line), 1)}
          <Text>{label.padEnd(4)}</Text>
          <Text color={percent === undefined ? 'subtle' : heat(value)} bold>
            {shown.padStart(4)}{' '}
          </Text>
          <Client key={`gauge-${label}`} module="./gauge.tsx" props={gaugeProps} width={barColumns} />
          <Text color={exhaustion === undefined ? 'subtle' : 'error'} bold={exhaustion !== undefined}>
            {` ${reset.padStart(RESET_COLUMNS - 1)}`}
          </Text>
          {piece(`frame-r-${label}`, [{ text: ' ', color: frame }, { text: '│', color: frame, frame: true }], rightAt(line) - 1, 1)}
        </Box>
      )
    }

    const top: FrameRun[] = [
      { text: '╭─ ', color: frame, frame: true },
      { text: '✻ ', color: e.props.isWorking ? 'claude' : 'subtle' },
      { text: status.model, color: 'text', bold: true },
      ...(status.effort !== undefined ? [{ text: ' ─ ', color: frame, frame: true as const }] : []),
      ...(rank !== undefined ? [{ text: '▰'.repeat(rank), color: 'claude' }, { text: '▱'.repeat(5 - rank), color: 'subtle' }] : []),
      ...(effortText !== '' ? [{ text: effortText, color: 'text', dim: true as const }] : []),
      { text: ` ${topFill}`, color: frame, frame: true },
      ...(path !== '' ? [{ text: ` ${path}`, color: 'text', dim: true as const }] : []),
      ...(branch !== '' ? [{ text: branch, color: 'claude' }] : []),
      { text: ' ─╮', color: frame, frame: true },
    ]
    const bottomLeft: FrameRun[] = [{ text: crewColumns > 0 ? '╰─ ' : '╰', color: frame, frame: true }]
    const bottomRight: FrameRun[] = [
      ...(crewColumns > 0 ? [{ text: ' ', color: frame }] : []),
      { text: bottomFill, color: frame, frame: true },
      { text: ` ${tokens}session ${duration((now - status.startedAt) / 1000)}`, color: 'text', dim: true },
      { text: ' ─╯', color: frame, frame: true },
    ]
    const rightStart = (crewColumns > 0 ? 3 + crewColumns : 1)

    return (
      <Box flexDirection="column">
        <Box flexDirection="column" width={width}>
          <Box flexShrink={0}>{piece('frame-top', top, 0, 1)}</Box>
          {row(0, 'ctx', status.context)}
          {status.fiveHour && row(1, '5h', status.fiveHour.percent, { resetsAt: status.fiveHour.resetsAt, seconds: FIVE_HOURS })}
          {status.sevenDay && row(2, '7d', status.sevenDay.percent, { resetsAt: status.sevenDay.resetsAt, seconds: SEVEN_DAYS })}
          <Box flexShrink={0}>
            {piece('frame-bl', bottomLeft, bottomAt(0), -1)}
            {crewColumns > 0 && <Box key="crew" flexShrink={0}>{icons}</Box>}
            {piece('frame-br', bottomRight, bottomAt(rightStart), -1)}
          </Box>
        </Box>
      </Box>
    )
  })
}
