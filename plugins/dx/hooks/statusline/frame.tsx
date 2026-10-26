import type { ClientModule } from 'claude-code'

import { lighten } from './format'

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
}
type FrameState = { lit: string }

// A lap of the frame, in milliseconds; a glint's tail and the fade ahead of
// it, in cells.
export const LAP_MS = 18_000
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

function headAt(perimeter: number): number {
  return ((Date.now() % LAP_MS) / LAP_MS) * perimeter
}

// The light of each frame cell, joined: what changes when a redraw is due.
function litOf(props: FrameProps): string {
  const head = headAt(props.perimeter)
  let offset = 0
  let lit = ''
  for (const run of props.runs) {
    const length = Array.from(run.text).length
    if (run.frame) {
      for (let cell = 0; cell < length; cell += 1) lit += lightAt(props.start + props.step * (offset + cell), head, props.perimeter)
    }
    offset += length
  }
  return lit
}

const Frame: ClientModule<FrameProps, FrameState> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    const latest = { props }
    surface.setState({ lit: litOf(props) })
    surface.every(TICK_MS, () => {
      const state = surface.state
      const lit = litOf(latest.props)
      if (state !== undefined && lit !== state.lit) surface.setState({ lit })
    })
    instances.set(surface, latest)
  }
  const latest = instances.get(surface)
  if (latest !== undefined) latest.props = props

  const head = headAt(props.perimeter)
  const cells: { text: string; color: string; bold?: true; dim?: true }[] = []
  let offset = 0
  for (const run of props.runs) {
    const chars = Array.from(run.text)
    chars.forEach((char, cell) => {
      const light = run.frame && char !== ' ' ? lightAt(props.start + props.step * (offset + cell), head, props.perimeter) : 0
      const color = light > 0 ? lighten(props.hex, light) : run.color
      const last = cells[cells.length - 1]
      if (last !== undefined && last.color === color && last.bold === run.bold && last.dim === run.dim) last.text += char
      else cells.push({ text: char, color, bold: run.bold, dim: run.dim })
    })
    offset += chars.length
  }

  return (
    <Box>
      {cells.map(cell => (
        <Text color={cell.color} bold={cell.bold} dimColor={cell.dim}>{cell.text}</Text>
      ))}
    </Box>
  )
}

// Each instance's latest props, for its clock.
const instances = new WeakMap<object, { props: FrameProps }>()

export default Frame
