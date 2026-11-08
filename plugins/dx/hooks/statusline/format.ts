// The band's figures as text, without `$`: the windows' pace and exhaustion,
// durations and countdowns, numbers, the model, the effort and the path.

import type { DayUnit } from '../shared/format'

// Where a steady consumption would stand in a window `windowSeconds` long
// that resets at `resetsAt`, in percent; undefined when it cannot be told.
export function paceOf(resetsAt: string, windowSeconds: number, nowMs: number): number | undefined {
  const target = Date.parse(resetsAt)
  if (Number.isNaN(target)) return undefined

  const remaining = (target - nowMs) / 1000
  if (remaining < 0 || remaining > windowSeconds) return undefined

  return (1 - remaining / windowSeconds) * 100
}

// Seconds before a window is used up at the rate it has been used so far, or
// undefined when that comes after its reset (or too little is known yet).
export function exhaustionOf(percent: number, resetsAt: string, windowSeconds: number, nowMs: number): number | undefined {
  const target = Date.parse(resetsAt)
  if (Number.isNaN(target) || percent <= 0) return undefined

  const remaining = (target - nowMs) / 1000
  const elapsed = windowSeconds - remaining
  // Under 2% of the window gone, a rate is noise.
  if (remaining <= 0 || elapsed < windowSeconds * 0.02) return undefined
  if (percent >= 100) return 0

  const left = ((100 - percent) / percent) * elapsed
  return left < remaining ? left : undefined
}

// A duration: `2j15h` (`2d15h` with `d` days), `3h24`, `12m`.
export function duration(seconds: number, day: DayUnit): string {
  const total = Math.max(0, Math.floor(seconds))
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)

  if (days > 0) return `${days}${day}${hours}h`
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, '0')}`
  return `${minutes}m`
}

// A turn's duration, to the second under an hour: `0m42`, `1m04`, `1h05`.
export function turnDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60

  if (hours > 0) return `${hours}h${String(minutes).padStart(2, '0')}`
  return `${minutes}m${String(seconds).padStart(2, '0')}`
}

// Time left until `resetsAt` (ISO 8601), as a duration with `day` days.
export function countdown(resetsAt: string, nowMs: number, day: DayUnit): string {
  const target = Date.parse(resetsAt)
  if (Number.isNaN(target)) return ''

  return duration((target - nowMs) / 1000, day)
}

// `950`, `24k`, `1.2M`.
export function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`
  return String(Math.round(value))
}

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

// Rank of an effort level, 1 (`low`) to 5 (`max`); undefined for another value.
export function effortRank(effort: string): number | undefined {
  const index = EFFORTS.indexOf(effort as (typeof EFFORTS)[number])
  return index < 0 ? undefined : index + 1
}

// `claude-opus-5-5` → `Opus 5.5`, `claude-sonnet-5-5[1m]` → `Sonnet 5.5 (1M)`;
// anything else (a display name already, an alias) is kept as given.
export function modelLabel(model: string): string {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?$/i.exec(model.trim())
  if (match === null) return model.trim()

  const [, family = '', major, minor, longContext] = match
  const name = family.charAt(0).toUpperCase() + family.slice(1).toLowerCase()
  const version = minor === undefined ? major : `${major}.${minor}`

  return `${name} ${version}${longContext === undefined ? '' : ' (1M)'}`
}

// `cwd` with the home directory shown as `~`; compared without regard to case
// or slash direction, as Windows paths are.
export function shortenPath(cwd: string, home: string | undefined): string {
  if (home === undefined || home === '') return cwd

  const normalize = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const base = normalize(home)
  const current = normalize(cwd)

  if (current === base) return '~'
  if (current.startsWith(`${base}/`)) return `~${cwd.slice(home.replace(/[\\/]+$/, '').length)}`
  return cwd
}

// `path` cut from the left to `width` characters, an ellipsis in front.
export function truncateStart(path: string, width: number): string {
  if (path.length <= width) return path
  if (width <= 1) return '…'.slice(0, Math.max(0, width))
  return `…${path.slice(path.length - width + 1)}`
}
