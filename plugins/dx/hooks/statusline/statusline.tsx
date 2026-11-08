import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, SessionUsage, TurnStartInput } from 'claude-code'

import type { Activity, BottomFact, Gauge, StatusSnapshot, TurnTime } from '../../types'
import { openAgent, showTask } from '../activity/activity'
import { toggleNotes } from '../notes/notes'
import { toggleSettings } from '../settings/settings'
import { crewItems, crewLabel, crewWidth, isWorking, SPIN_MS, SPINNER } from '../shared/crew'
import { clockTime } from '../shared/format'
import { dayUnitOf, DEFAULT_SETTINGS, DIM_TEXT, HEAT, SPEED_FACTORS, THEME_FRAME, THEME_FRAME_HEX, thresholdsOf } from '../shared/options'
import {
  compactNumber,
  countdown,
  duration,
  effortRank,
  exhaustionOf,
  modelLabel,
  paceOf,
  shortenPath,
  truncateStart,
  turnDuration,
} from './format'
import type { FrameProps, FrameRun } from './frame'
import type { GaugeProps } from './gauge'
import { heat } from './gauge-model'
import { branchFrom } from './git'
import type { HeadPaths } from './git'

// Change the tag when StatusSnapshot's fields change: it declines what an
// earlier version stored, which outlives a reload.
const snapshot = atom({ plugin: 'dx', key: 'statusline' } as const, null, {
  shape: 'statusline-2',
})

// What the band shows, animates and is colored with, set in ../settings/settings.
const settings = atom({ plugin: 'dx', key: 'settings' } as const, DEFAULT_SETTINGS, { shape: 'settings-3' })

// The main loop's last turn, and a tick each second while it runs, so its
// duration is redrawn.
const turn = atom({ plugin: 'dx', key: 'turn' } as const, null as TurnTime | null, { shape: 'turn-1' })
const tick = atom({ plugin: 'dx', key: 'tick' } as const, 0, { shape: 'tick-1' })
const TICK_MS = 1000

async function turnTick($: EngineInterface): Promise<void> {
  const current = await read($, turn)
  if (current !== null && current.endedAt === undefined) await update($, tick, value => value + 1)
}

// The spinner's frame, advanced while a subagent works.
const spin = atom({ plugin: 'dx', key: 'spin' } as const, 0, { shape: 'spin-1' })

async function spinTick($: EngineInterface): Promise<void> {
  const crew = await read($, activity)
  if (crew.agents.some(agent => isWorking(agent.status))) await update($, spin, frame => frame + 1)
}

// What runs beside the main loop, followed by ../activity/activity.
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

// The effort a main-loop request was really sent with (after a downgrade for
// the model), kept until the setting or the model changes again.
const effort: { turn?: string; setting?: string; model?: string } = {}

function gaugeOf(usage: SessionUsage, kind: string): Gauge | undefined {
  const window = usage.rateLimits.find(limit => limit.kind === kind)
  if (window === undefined) return undefined

  return { percent: window.percentUsed, resetsAt: window.resetsAt }
}

// Where the HEAD of the repository holding each directory is, kept from one
// refresh to the next (./git).
const heads: HeadPaths = new Map()

// The file at `path`, or undefined when it cannot be read.
function readFile($: EngineInterface, path: string): Promise<string | undefined> {
  return $.fs.read(path).catch(() => undefined)
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
    branch: await branchFrom(path => readFile($, path), cwd, heads),
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

// Called by ../register once the session has started, after the settings it
// draws with: the band's clocks, then its first snapshot. A first snapshot that
// fails is left to the next refresh, the clocks already running.
export async function startStatusline($: EngineInterface): Promise<void> {
  $.clock.every(TICK_MS, () => turnTick($))
  $.clock.every(SPIN_MS, () => spinTick($))
  $.clock.every(REFRESH_MS, () => refresh($))
  await refresh($).catch(() => undefined)
}

// Called by ../register as a turn starts: the main loop's turn is timed.
export async function startStatuslineTurn($: EngineInterface, e: TurnStartInput): Promise<void> {
  if (e.agentId !== undefined) return
  const now = await $.clock.now()
  await update($, turn, () => ({ startedAt: now }))
}

export function registerStatusline(on: On): void {
  // turn.step streams: the hook is an async generator forwarding the chunks.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined && e.effort !== undefined) {
      effort.turn = String(e.effort)
    }

    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      await update($, turn, current => ({ startedAt: current?.startedAt ?? now - e.durationMs, durationMs: e.durationMs, endedAt: now }))
      // A refresh that fails keeps the last snapshot, for the next to replace.
      await refresh($).catch(() => undefined)
    }

    return completed
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const status = await read($, snapshot)
    if (e.props.hasSurvey || status === null) return next(e)
    // The band is only raised there, and only there do gauges animate.
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)

    const { Box, Button, Client, Text } = $.ui.resolve(e)
    const options = await read($, settings)
    const { show } = options
    const now = await $.clock.now()
    const resetColumns = show.countdowns ? RESET_COLUMNS : 0
    const columns = e.props.bodyColumns
    const barColumns = Math.max(
      MIN_BAR_COLUMNS,
      columns - FRAME_COLUMNS - LABEL_COLUMNS - resetColumns,
    )
    const width = barColumns + FRAME_COLUMNS + LABEL_COLUMNS + resetColumns

    const frame = options.frameColor
    // What the glints lighten: hex.
    const frameHex = frame === THEME_FRAME ? THEME_FRAME_HEX : frame
    // A solid gauge's color is hex: its shuttle lightens it.
    const solid = options.gaugeColor === HEAT ? null : options.gaugeColor
    const thresholds = thresholdsOf(options.heatOrange, options.heatRed)
    const speed = SPEED_FACTORS[options.speed]
    // The days of its durations, written as the 7-day gauge's label.
    const day = dayUnitOf(options.sevenDayLabel)

    // Top border: `╭─ ✻ Opus 5.5 ─ ▰▰▰▰▱ xhigh ───── ~\repo ⎇ dev ─ ✎ ⚙ ─╮`.
    const model = show.model ? status.model : ''
    const shownEffort = show.effort ? status.effort : undefined
    const rank = shownEffort === undefined ? undefined : effortRank(shownEffort)
    const meter = rank === undefined ? '' : '▰'.repeat(rank) + '▱'.repeat(5 - rank)
    const effortText = shownEffort === undefined ? '' : `${meter === '' ? '' : ' '}${shownEffort}`
    const separator = model !== '' && shownEffort !== undefined
    const left = `╭─ ✻ ${model}${separator ? ' ─ ' : ''}${meter}${effortText} `
    const branch = !show.branch || status.branch === undefined ? '' : ` ⎇ ${status.branch}`
    const ending = ` ─ ${options.notesIcon}  ${options.settingsIcon}  ─╮`
    const pathRoom = show.cwd ? Math.max(0, width - left.length - branch.length - ending.length - 2) : 0
    const path = truncateStart(status.cwd, pathRoom)
    const right = `${path === '' ? '' : ' '}${path}${branch}${ending}`
    const topFill = '─'.repeat(Math.max(1, width - left.length - right.length))

    // Bottom border: `╰──── durée 1m04 · fin 14:32 · total 1h12 · 24k/200k ─╯`,
    // its facts in the order set.
    const last = show.duration || show.end ? await read($, turn) : null
    // Read while the turn runs: a tick redraws its duration.
    if (show.duration && last !== null && last.endedAt === undefined) await read($, tick)
    const factOf: Record<BottomFact, string | undefined> = {
      duration: !show.duration || last === null ? undefined : `durée ${turnDuration(last.durationMs ?? now - last.startedAt)}`,
      end: !show.end || last?.endedAt === undefined ? undefined : `fin ${clockTime(last.endedAt)}`,
      total: show.total ? `total ${duration((now - status.startedAt) / 1000, day)}` : undefined,
      tokens: show.tokens && status.contextTokens !== undefined
        ? `${compactNumber(status.contextTokens)}/${compactNumber(status.contextWindow)}`
        : undefined,
    }
    const facts = options.bottomOrder.flatMap(fact => factOf[fact] ?? [])
    const info = facts.length === 0 ? '' : ` ${facts.join(' · ')}`
    // Its icons, one per subagent and background task: Buttons, since only a
    // press may change the view, drawn in the row itself as the top border's.
    const crew = await read($, activity)
    const crewList = show.crew ? crewItems(crew, options.maxAgentIcons, options.maxTaskIcons, options.monitorIcon) : []
    const crewColumns = crewWidth(crewList)
    // Read only while a spinner turns: every frame redraws the band.
    const spinning = options.animate.spinner && crewList.some(item => item.spin)
    const spinFrame = spinning ? await read($, spin) : 0
    const viewed = e.props.view.agentId
    const icons = crewList.flatMap((item, index) => {
      const glyph = item.spin && spinning ? (SPINNER[spinFrame % SPINNER.length] ?? '✻') : item.glyph
      // A pressable icon's Button takes the cell after its glyph too (crewLabel).
      const label = <Text color={item.color} dimColor={item.dim} underline={item.open !== undefined && item.open === viewed}>{crewLabel(glyph, item)}</Text>
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
    // The glints and the shuttle, at rest while nothing works (a setting); the
    // spinner turns only while its subagent works anyway.
    const crewWorks = crew.agents.some(agent => isWorking(agent.status)) || crew.tasks.length > 0
    const animating = !options.animateOnlyWorking || e.props.isWorking || (options.animateWithCrew && crewWorks)
    const bottomFill = '─'.repeat(Math.max(1, width - 1 - info.length - 3 - crewRoom))

    // The rows: the 5-hour one, while its window has not started, left out or
    // drawn empty (a setting).
    const fiveHourRow = show.fiveHour && (status.fiveHour !== undefined || (!options.hideIdleFiveHour && status.sevenDay !== undefined))
    const sevenDayRow = show.sevenDay && status.sevenDay !== undefined
    const gaugeRows = (show.context ? 1 : 0) + (fiveHourRow ? 1 : 0) + (sevenDayRow ? 1 : 0)

    // The frame's perimeter, clockwise from the top left corner, for its glint.
    const height = gaugeRows + 2
    const perimeter = 2 * (width - 1) + 2 * (height - 1)
    const leftAt = (line: number) => (2 * (width - 1) + 2 * (height - 1) - line) % perimeter
    const rightAt = (line: number) => width - 1 + line
    const bottomAt = (column: number) => width - 1 + height - 1 + (width - 1 - column)
    const piece = (key: string, runs: FrameRun[], start: number, step: 1 | -1) => {
      const props: FrameProps = { runs, start, step, perimeter, hex: frameHex, glints: options.animate.glints && animating, speed }
      const columns = runs.reduce((sum, run) => sum + Array.from(run.text).length, 0)
      return <Client key={key} module="./frame.tsx" props={props} width={columns} />
    }

    const row = (
      line: number,
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
        phase: (line - 1) * SHUTTLE_STAGGER_MS,
        shuttle: options.animate.shuttle && animating,
        solid,
        thresholds,
        speed,
      }
      const shown = percent === undefined ? '—' : `${Math.round(percent)}%`
      const exhaustion = resetsAt === undefined || window === undefined
        ? undefined
        : exhaustionOf(value, resetsAt, window.seconds, now)
      const reset = resetsAt === undefined
        ? ''
        : exhaustion === undefined
          ? `↻ ${countdown(resetsAt, now, day)}`
          : `⚠ ${duration(exhaustion, day)}`

      return (
        <Box key={label} flexShrink={0}>
          {piece(`frame-l-${label}`, [{ text: '│', color: frame, frame: true }, { text: ' ', color: frame }], leftAt(line), 1)}
          <Text>{label.padEnd(4)}</Text>
          <Text color={percent === undefined ? 'subtle' : (solid ?? heat(value, thresholds))} bold>
            {shown.padStart(4)}{' '}
          </Text>
          <Client key={`gauge-${label}`} module="./gauge.tsx" props={gaugeProps} width={barColumns} />
          {show.countdowns && (
            <Text color={exhaustion === undefined ? 'subtle' : 'error'} bold={exhaustion !== undefined}>
              {` ${reset.padStart(RESET_COLUMNS - 1)}`}
            </Text>
          )}
          {piece(`frame-r-${label}`, [{ text: ' ', color: frame }, { text: '│', color: frame, frame: true }], rightAt(line) - 1, 1)}
        </Box>
      )
    }
    const rows = [
      ...(show.context ? [(line: number) => row(line, 'ctx', status.context)] : []),
      ...(fiveHourRow
        ? [(line: number) => row(line, '5h', status.fiveHour?.percent, status.fiveHour && { resetsAt: status.fiveHour.resetsAt, seconds: FIVE_HOURS })]
        : []),
      ...(sevenDayRow
        ? [(line: number) => row(line, options.sevenDayLabel, status.sevenDay?.percent, { resetsAt: status.sevenDay?.resetsAt, seconds: SEVEN_DAYS })]
        : []),
    ]

    const top: FrameRun[] = [
      { text: '╭─ ', color: frame, frame: true },
      { text: '✻ ', color: e.props.isWorking ? 'claude' : 'subtle' },
      ...(model !== '' ? [{ text: model, color: 'text', bold: true as const }] : []),
      ...(separator ? [{ text: ' ─ ', color: frame, frame: true as const }] : []),
      ...(rank !== undefined ? [{ text: '▰'.repeat(rank), color: options.effortColor }, { text: '▱'.repeat(5 - rank), color: 'subtle' }] : []),
      ...(effortText !== '' ? [{ text: effortText, color: 'text', dim: true as const }] : []),
      { text: ` ${topFill}`, color: frame, frame: true },
      ...(path !== '' ? [{ text: ` ${path}`, color: 'text', dim: true as const }] : []),
      ...(branch !== '' ? [{ text: branch, color: options.branchColor }] : []),
      { text: ' ─ ', color: frame, frame: true },
    ]
    const bottomLeft: FrameRun[] = [{ text: crewColumns > 0 ? '╰─ ' : '╰', color: frame, frame: true }]
    const bottomRight: FrameRun[] = [
      ...(crewColumns > 0 ? [{ text: ' ', color: frame }] : []),
      { text: bottomFill, color: frame, frame: true },
      ...(info !== '' ? [options.infoColor === DIM_TEXT ? { text: info, color: 'text', dim: true as const } : { text: info, color: options.infoColor }] : []),
      { text: ' ─╯', color: frame, frame: true },
    ]
    const rightStart = (crewColumns > 0 ? 3 + crewColumns : 1)

    return (
      <Box flexDirection="column">
        <Box flexDirection="column" width={width}>
          <Box flexShrink={0}>
            {piece('frame-top', top, 0, 1)}
            <Button key="notes" plain onPress={() => toggleNotes($)}><Text color="subtle">{`${options.notesIcon} `}</Text></Button>
            <Text>{' '}</Text>
            <Button key="settings" plain onPress={() => toggleSettings($)}><Text color="subtle">{`${options.settingsIcon} `}</Text></Button>
            {piece('frame-tr', [{ text: ' ─╮', color: frame, frame: true }], width - 3, 1)}
          </Box>
          {rows.map((draw, index) => draw(index + 1))}
          <Box flexShrink={0}>
            {piece('frame-bl', bottomLeft, bottomAt(0), -1)}
            {icons}
            {piece('frame-br', bottomRight, bottomAt(rightStart), -1)}
          </Box>
        </Box>
      </Box>
    )
  })
}
