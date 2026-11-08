// The band's gauges, without `$`: the heat colors, the beads and the shuttle
// that runs along them (./gauge), and the lightening and run merging the
// frame's glints share (./frame).

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

type HeatScale = readonly (readonly [number, Rgb])[]

function heatScale([orange, red]: Thresholds): HeatScale {
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

// Hex color of `scale` at `percent`, quantized to steps of 2.5% so that
// neighbouring cells share a color and are drawn as one run.
function heatOn(scale: HeatScale, percent: number): string {
  const at = Math.round(Math.min(100, Math.max(0, percent)) / 2.5) * 2.5
  let index = 1
  while (index < scale.length - 1 && (scale[index]?.[0] ?? 100) < at) index += 1

  const [fromAt, from] = scale[index - 1] ?? scale[0]!
  const [toAt, to] = scale[index] ?? scale[scale.length - 1]!
  const t = toAt === fromAt ? 0 : (at - fromAt) / (toAt - fromAt)
  const channel = (i: 0 | 1 | 2) => Math.round(from[i] + (to[i] - from[i]) * t)

  return `#${[channel(0), channel(1), channel(2)].map(c => c.toString(16).padStart(2, '0')).join('')}`
}

// Hex color of the heat scale at `percent`.
export function heat(percent: number, thresholds: Thresholds = DEFAULT_THRESHOLDS): string {
  return heatOn(heatScale(thresholds), percent)
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
type Run = { text: string; color: string; dim?: true; bold?: true }

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
// consumed, in cells, lights the cells around it. The track is drawn in the
// theme's subtle color.
// `solid` draws every cell in that color instead of the heat gradient.
export function gauge(
  percent: number,
  width: number,
  pace?: number,
  shuttle?: number,
  solid?: string,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): Run[] {
  const cells = Math.max(0, Math.floor(width))
  const filled = filledCells(percent, cells)
  const budget = pace === undefined ? -1 : filledCells(pace, cells)
  // Built once for every cell.
  const scale = heatScale(thresholds)

  const runs: Run[] = []
  for (let cell = 0; cell < cells; cell += 1) {
    const color = solid ?? heatOn(scale, ((cell + 0.5) / cells) * 100)
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
      runs.push({ text: TRACK, color: 'subtle' })
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
