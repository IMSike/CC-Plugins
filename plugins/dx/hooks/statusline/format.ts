// Pure helpers of the status band: no `$`, so they are tested on their own.

// The heat scale of the gauges: green, yellow, orange, red, each blending
// into the next, halfway at the thresholds: yellow at half the orange one,
// then orange and red (25%, 50% and 75% by default). Mid-saturation tones,
// readable on dark and light themes alike.
type Rgb = readonly [number, number, number]
const GREEN: Rgb = [46, 160, 67]
const YELLOW: Rgb = [212, 167, 44]
const ORANGE: Rgb = [227, 116, 47]
const RED: Rgb = [248, 81, 73]
const CRIMSON: Rgb = [218, 54, 81]
export type Thresholds = readonly [orange: number, red: number]
const DEFAULT_THRESHOLDS: Thresholds = [50, 75]

function heatScale([orange, red]: Thresholds): readonly (readonly [number, Rgb])[] {
  const yellow = orange / 2
  return [
    [0, GREEN],
    [yellow / 2, GREEN],
    [(yellow + orange) / 2, YELLOW],
    [(orange + red) / 2, ORANGE],
    [(red + 100) / 2, RED],
    [100, CRIMSON],
  ]
}

// Hex color of the heat scale at `percent`, quantized to steps of 2.5% so that
// neighbouring cells share a color and are drawn as one run.
export function heat(percent: number, thresholds: Thresholds = DEFAULT_THRESHOLDS): string {
  const HEAT = heatScale(thresholds)
  const at = Math.round(Math.min(100, Math.max(0, percent)) / 2.5) * 2.5
  let index = 1
  while (index < HEAT.length - 1 && (HEAT[index]?.[0] ?? 100) < at) index += 1

  const [fromAt, from] = HEAT[index - 1] ?? HEAT[0]!
  const [toAt, to] = HEAT[index] ?? HEAT[HEAT.length - 1]!
  const t = toAt === fromAt ? 0 : (at - fromAt) / (toAt - fromAt)
  const channel = (i: 0 | 1 | 2) => Math.round(from[i] + (to[i] - from[i]) * t)

  return `#${[channel(0), channel(1), channel(2)].map(c => c.toString(16).padStart(2, '0')).join('')}`
}

// `hex` mixed with white: 0 keeps it, 1 is white.
export function lighten(hex: string, amount: number): string {
  const value = Number.parseInt(hex.slice(1), 16)
  const channel = (shift: number) => {
    const c = (value >> shift) & 0xff
    return Math.round(c + (255 - c) * amount).toString(16).padStart(2, '0')
  }

  return `#${channel(16)}${channel(8)}${channel(0)}`
}

// One run of identical glyphs in one style: what a gauge is drawn with.
export type Run = { text: string; color: string; dim?: true; bold?: true }

// A gauge is a string of beads: double circles for what is consumed, dotted
// circles for the gap to the pace (pale ahead of the consumption, in full
// color past it), small dots for the track.
export const USED = '◎'
export const GAP = '◉'
export const TRACK = '·'

// How much the shuttle lightens a cell `offset` cells behind it: a glow that
// fades in over the cell ahead and out over the three behind. Split between
// two cells by the shuttle's exact position, it moves by fractions of a cell.
const GLOW = 0.7
const TRAIL_CELLS = 3

export function glow(offset: number): number {
  if (offset < -1 || offset > TRAIL_CELLS) return 0
  const light = offset < 0 ? GLOW * (1 + offset) : GLOW * (1 - offset / TRAIL_CELLS)
  // Steps of 5%: neighbouring cells of one light are drawn as one run.
  return Math.round(light * 20) / 20
}

// Cells a gauge fills: at least one as soon as something is used.
export function filledCells(percent: number, width: number): number {
  const cells = Math.max(0, Math.floor(width))
  const clamped = Math.min(100, Math.max(0, percent))
  return clamped > 0 ? Math.max(1, Math.round((clamped / 100) * cells)) : 0
}

// Runs with neighbours of one style merged.
function merged(runs: Run[]): Run[] {
  const out: Run[] = []
  for (const run of runs) {
    const last = out[out.length - 1]
    if (last !== undefined && last.color === run.color && last.dim === run.dim && last.bold === run.bold) last.text += run.text
    else out.push({ ...run })
  }
  return out
}

// A gauge `width` cells wide, in the heat color of each cell's position. Up
// to `pace` (where a steady consumption would be), the gap between it and the
// consumption is marked: pale beads for the budget left, beads in full color
// for what is consumed ahead of it. `shuttle`, a position along the part
// consumed, in cells, lights the cells around it. The track's color is the
// caller's: the theme's.
// `solid` draws every cell in that color instead of the heat gradient.
export function gauge(
  percent: number,
  width: number,
  track: string,
  pace?: number,
  shuttle?: number,
  solid?: string,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): Run[] {
  const cells = Math.max(0, Math.floor(width))
  const filled = filledCells(percent, cells)
  const budget = pace === undefined ? -1 : filledCells(pace, cells)

  const runs: Run[] = []
  for (let cell = 0; cell < cells; cell += 1) {
    const color = solid ?? heat(((cell + 0.5) / cells) * 100, thresholds)
    if (cell < filled) {
      const light = shuttle === undefined ? 0 : glow(shuttle - cell)
      runs.push({
        text: budget >= 0 && cell >= budget ? GAP : USED,
        color: light > 0 ? lighten(color, light) : color,
        ...(light >= GLOW / 2 ? { bold: true as const } : {}),
      })
    } else if (cell < budget) {
      runs.push({ text: GAP, color, dim: true })
    } else {
      runs.push({ text: TRACK, color: track })
    }
  }

  return merged(runs)
}

// The shuttle's course: it glides from the first bead to the last consumed,
// easing in and out, in a time that grows with the distance, then rests.
export const SHUTTLE_REST_MS = 3500
const TRAVEL_BASE_MS = 400
const TRAVEL_MS_PER_CELL = 22
const TRAVEL_MAX_MS = 2600
// Fewer consumed cells than this leave no room for a shuttle.
const SHUTTLE_MIN_CELLS = 6

// The time the shuttle takes over `distance` cells.
export function travelMs(distance: number): number {
  return Math.min(TRAVEL_MAX_MS, TRAVEL_BASE_MS + TRAVEL_MS_PER_CELL * Math.max(0, distance))
}

// Sine easing: its top speed is only π/2 times the mean, so a long course
// stays smooth where a steeper curve would skip cells.
function easeInOutSine(t: number): number {
  return (1 - Math.cos(Math.PI * t)) / 2
}

// Where the shuttle is, in cells along `filled` consumed cells, `elapsedMs`
// into its cycles; undefined while it rests.
export function shuttleAt(elapsedMs: number, filled: number): number | undefined {
  if (filled < SHUTTLE_MIN_CELLS) return undefined

  const distance = filled - 1
  const travel = travelMs(distance)
  const cycle = travel + SHUTTLE_REST_MS
  const t = ((elapsedMs % cycle) + cycle) % cycle
  if (t >= travel) return undefined

  return easeInOutSine(t / travel) * distance
}

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

// A duration: `2j15h`, `3h24`, `12m`.
export function duration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)

  if (days > 0) return `${days}j${hours}h`
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

// The local time of day, `14:32`.
export function clockTime(ms: number): string {
  const date = new Date(ms)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

// The local day and time, `31/10 14:32`.
export function dayTime(ms: number): string {
  const date = new Date(ms)
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')} ${clockTime(ms)}`
}

// Time left until `resetsAt` (ISO 8601), as a duration.
export function countdown(resetsAt: string, nowMs: number): string {
  const target = Date.parse(resetsAt)
  if (Number.isNaN(target)) return ''

  return duration((target - nowMs) / 1000)
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

// The branch a `.git/HEAD` names, or a short commit when it is detached.
export function branchOf(head: string): string | undefined {
  const text = head.trim()
  const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(text)
  if (ref !== null) return ref[1]
  if (/^[0-9a-f]{40,64}$/i.test(text)) return text.slice(0, 7)
  return undefined
}
