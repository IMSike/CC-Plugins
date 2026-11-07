import type { Activity } from '../../types'

// The icons of the band's bottom border: one per subagent and per background
// task, up to a number of a kind (MAX_ICONS by default), then a count.

export const MAX_ICONS = 5
// Nerd Font glyphs: a robot, a terminal, a pulse (a monitor's by default).
export const ROBOT = '\u{F06A9}'
export const TERMINAL = '\u{F489}'
export const MONITOR = '\u{F469}'
export const CURSOR_GREY = '#8b949e'

// What follows an icon in a label, before its text: a Nerd Font glyph (one of
// Unicode's private use areas) is counted one cell but drawn over two, so the
// cell after it is left to it, then a space; any other icon, a space.
export function iconGap(glyph: string): string {
  const code = glyph.codePointAt(0) ?? 0
  return (code >= 0xe000 && code <= 0xf8ff) || code >= 0xf0000 ? '  ' : ' '
}

// Claude Code's spinner, there and back; `*` where macOS draws ✳, which
// other terminals show as a green emoji.
const SPINNER_CHARS = ['·', '✢', '*', '✶', '✻', '✽']
export const SPINNER = [...SPINNER_CHARS, ...[...SPINNER_CHARS].reverse()]
export const SPIN_MS = 200

// One icon; a click on it opens the subagent's transcript (`open`) or the
// task's output (`tail`).
type CrewItem = {
  glyph: string
  color: string
  dim?: true
  // Turns like Claude Code's spinner while true.
  spin?: true
  open?: string
  tail?: string
}

export function isWorking(status: string): boolean {
  return status === 'running' || status === 'pending'
}

function capped(items: CrewItem[], max = MAX_ICONS): CrewItem[] {
  if (items.length <= max) return items
  const shown = items.slice(0, max)
  const last = shown[shown.length - 1]
  return [...shown, { glyph: `+${items.length - max}`, color: last?.color ?? 'subtle', dim: true }]
}

// Working subagents first, then waiting ones, agent CLIs, shells, monitors.
// Up to `agents` subagent icons of a kind, `tasks` task icons of a kind; a
// monitor drawn as `monitor`.
export function crewItems(crew: Activity, agents = MAX_ICONS, tasks = MAX_ICONS, monitor = MONITOR): CrewItem[] {
  const working = crew.agents.filter(agent => isWorking(agent.status))
  const waiting = crew.agents.filter(agent => !isWorking(agent.status))
  const plain = (kind: string) => crew.tasks.filter(task => task.kind === kind && task.agent === undefined)
  const cli = (agent: string) => crew.tasks.filter(task => task.agent === agent)
  return [
    ...capped(working.map(agent => ({ glyph: '✻', color: 'claude', spin: true as const, open: agent.id })), agents),
    ...capped(waiting.map(agent => ({ glyph: '✻', color: 'claude', dim: true as const, open: agent.id })), agents),
    ...capped(cli('claude').map(task => ({ glyph: ROBOT, color: 'claude', tail: task.id })), tasks),
    ...capped(cli('cursor').map(task => ({ glyph: ROBOT, color: CURSOR_GREY, tail: task.id })), tasks),
    ...capped(plain('shell').map(task => ({ glyph: TERMINAL, color: 'subtle', tail: task.id })), tasks),
    ...capped(plain('monitor').map(task => ({ glyph: monitor, color: 'subtle', tail: task.id })), tasks),
  ]
}

// Whether a click on the icon does something: a subagent's or a task's.
function isPressable(item: CrewItem): boolean {
  return item.open !== undefined || item.tail !== undefined
}

// What an icon draws: a pressable one, its glyph and the cell after it. The
// layout counts these glyphs one cell, but a terminal may draw them over two
// (a Nerd Font glyph, a ✻ from a fallback font): with that cell in its Button,
// a click on either half lands, whatever the glyph or the spinner's frame.
export function crewLabel(glyph: string, item: CrewItem): string {
  return isPressable(item) ? `${glyph} ` : glyph
}

// Columns the icons take, one space apart.
export function crewWidth(items: readonly CrewItem[]): number {
  return items.reduce((sum, item, index) => sum + Array.from(crewLabel(item.glyph, item)).length + (index === 0 ? 0 : 1), 0)
}
