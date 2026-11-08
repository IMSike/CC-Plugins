import type { ClientModule } from 'claude-code'

import { lighten, merged } from './gauge-model'

// One piece of the band's frame, two slow glints going round it, half a
// lap apart: every piece knows where its cells sit along the frame's perimeter
// and reads the glints' position off the wall clock, so pieces drawn apart
// move as one.

export type FrameRun = { text: string; color: string; bold?: true; dim?: true; frame?: true }
export type FrameProps = {
  runs: FrameRun[]
  // Perimeter index of the first cell, and the way the next cells go along it.
  start: number
  step: 1 | -1
  perimeter: number
  // The frame's color as hex: what the glints lighten.
  hex: string
  // Whether the glints run, and how much faster than normal (settings).
  glints: boolean
  speed: number
}
type FrameState = { lit: string }

// A lap of the frame, in milliseconds; a glint's tail and the fade ahead of
// it, in cells.
const LAP_MS = 18_000
const TAIL = 10
const LEAD = 4
const GLOW = 0.9
const TICK_MS = 80

// How lit perimeter cell `index` is by one glint at `head`.
function lightOf(index: number, head: number, perimeter: number): number {
  const behind = (((head - index) % perimeter) + perimeter) % perimeter
  const ahead = perimeter - behind
  if (behind < TAIL) return Math.round(GLOW * (1 - behind / TAIL) * 10) / 10
  if (ahead < LEAD) return Math.round(GLOW * (1 - ahead / LEAD) * 10) / 10
  return 0
}

// How lit perimeter cell `index` is: two glints chase each other half a lap apart.
export function lightAt(index: number, head: number, perimeter: number): number {
  return Math.max(lightOf(index, head, perimeter), lightOf(index, head + perimeter / 2, perimeter))
}

function headAt(perimeter: number, speed: number): number {
  const lap = LAP_MS / speed
  return ((Date.now() % lap) / lap) * perimeter
}

// The light of each cell of the runs, the glints where they are now: none off
// the frame, on its spaces, or while the glints rest.
function lightsOf(props: FrameProps): number[] {
  if (!props.glints) return []
  const head = headAt(props.perimeter, props.speed)
  const lights: number[] = []
  for (const run of props.runs) {
    for (const char of Array.from(run.text)) {
      lights.push(run.frame && char !== ' ' ? lightAt(props.start + props.step * lights.length, head, props.perimeter) : 0)
    }
  }
  return lights
}

// The lights joined: what changes when a redraw is due.
function litOf(lights: readonly number[]): string {
  return lights.join(',')
}

// Each instance's latest props, for its clock, and the lights last found, with
// the props they were found for: the redraw the clock asks for draws them
// rather than finding them again.
type Instance = { props: FrameProps; lights: { props: FrameProps; values: number[] } }
const instances = new WeakMap<object, Instance>()

const Frame: ClientModule<FrameProps, FrameState> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    const values = lightsOf(props)
    const latest: Instance = { props, lights: { props, values } }
    surface.setState({ lit: litOf(values) })
    surface.every(TICK_MS, () => {
      const state = surface.state
      const next = lightsOf(latest.props)
      const lit = litOf(next)
      if (state === undefined || lit === state.lit) return
      latest.lights = { props: latest.props, values: next }
      surface.setState({ lit })
    })
    instances.set(surface, latest)
  }
  const latest = instances.get(surface)
  if (latest !== undefined) latest.props = props
  if (latest !== undefined && latest.lights.props !== props) latest.lights = { props, values: lightsOf(props) }
  // The first call records the instance: the lights are found afresh only if
  // that record were missing.
  const lights = latest?.lights.values ?? lightsOf(props)

  // Each cell in its run's style, lit where a glint is, then merged in runs.
  let index = 0
  const cells = merged(props.runs.flatMap(run => Array.from(run.text, char => {
    const light = lights[index] ?? 0
    index += 1
    return { text: char, color: light > 0 ? lighten(props.hex, light) : run.color, bold: run.bold, dim: run.dim }
  })))

  return (
    <Box>
      {cells.map(cell => (
        <Text color={cell.color} bold={cell.bold} dimColor={cell.dim}>{cell.text}</Text>
      ))}
    </Box>
  )
}

export default Frame
