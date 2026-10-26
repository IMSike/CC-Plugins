import type { Activity } from '../../types'

// The icons of the band's bottom border: one per subagent and per background
// task, up to MAX_ICONS of a kind, then a count.

export const MAX_ICONS = 5
// Nerd Font glyphs: a robot, a terminal.
export const ROBOT = '\u{F06A9}'
export const TERMINAL = '\u{F489}'
export const MONITOR = '◉'
export const CURSOR_GREY = '#8b949e'

// Claude Code's spinner, there and back; `*` where macOS draws ✳, which
// other terminals show as a green emoji.
const SPINNER_CHARS = ['·', '✢', '*', '✶', '✻', '✽']
export const SPINNER = [...SPINNER_CHARS, ...[...SPINNER_CHARS].reverse()]
export const SPIN_MS = 200

// One icon; a click on it opens the subagent's transcript (`open`) or the
// task's output (`tail`).
export type CrewItem = {
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

export function capped(items: CrewItem[]): CrewItem[] {
  if (items.length <= MAX_ICONS) return items
  const shown = items.slice(0, MAX_ICONS)
  const last = shown[shown.length - 1]
  return [...shown, { glyph: `+${items.length - MAX_ICONS}`, color: last?.color ?? 'subtle', dim: true }]
}

// Working subagents first, then waiting ones, agent CLIs, shells, monitors.
export function crewItems(crew: Activity): CrewItem[] {
  const working = crew.agents.filter(agent => isWorking(agent.status))
  const waiting = crew.agents.filter(agent => !isWorking(agent.status))
  const plain = (kind: string) => crew.tasks.filter(task => task.kind === kind && task.agent === undefined)
  const cli = (agent: string) => crew.tasks.filter(task => task.agent === agent)
  return [
    ...capped(working.map(agent => ({ glyph: '✻', color: 'claude', spin: true as const, open: agent.id }))),
    ...capped(waiting.map(agent => ({ glyph: '✻', color: 'claude', dim: true as const, open: agent.id }))),
    ...capped(cli('claude').map(task => ({ glyph: ROBOT, color: 'claude', tail: task.id }))),
    ...capped(cli('cursor').map(task => ({ glyph: ROBOT, color: CURSOR_GREY, tail: task.id }))),
    ...capped(plain('shell').map(task => ({ glyph: TERMINAL, color: 'subtle', tail: task.id }))),
    ...capped(plain('monitor').map(task => ({ glyph: MONITOR, color: 'subtle', tail: task.id }))),
  ]
}

// Columns the icons take, one space apart.
export function crewWidth(items: readonly CrewItem[]): number {
  return items.reduce((sum, item, index) => sum + Array.from(item.glyph).length + (index === 0 ? 0 : 1), 0)
}
