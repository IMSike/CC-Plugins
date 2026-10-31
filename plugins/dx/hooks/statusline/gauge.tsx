import type { ClientModule } from 'claude-code'

import { filledCells, gauge, shuttleAt } from './format'
import type { Thresholds } from './format'

// A gauge drawn on the surface's own thread, so that its shuttle moves without
// the band being redrawn: the frame clock ticks here, and the hooks module only
// hands new props when a figure changes.

export type GaugeProps = {
  percent: number
  pace: number | null
  width: number
  // Milliseconds the shuttle's cycle is shifted by, so that the gauges of the
  // band do not move together.
  phase: number
  // Whether the shuttle runs (a setting).
  shuttle: boolean
  // One color for every cell instead of the heat gradient, or null.
  solid: string | null
  // Where the heat gradient turns orange, then red.
  thresholds: Thresholds
  // How much faster than normal the shuttle runs.
  speed: number
}

type GaugeState = {
  shuttle: number | null
  // Mutated by the frame clock between redraws: the time its ticks have
  // counted, and the props of the latest call (a redraw may change them).
  clock: { elapsed: number; props: GaugeProps }
}

export const FRAME_MS = 33

// The shuttle's position kept to tenths of a cell: finer moves draw nothing new.
function rounded(position: number | undefined): number | null {
  return position === undefined ? null : Math.round(position * 10) / 10
}

const Gauge: ClientModule<GaugeProps, GaugeState> = (props, surface) => {
  const { Box, Text } = surface.elements

  if (surface.state === undefined) {
    const clock = { elapsed: props.phase, props }
    surface.setState({ shuttle: null, clock })
    surface.every(FRAME_MS, () => {
      const state = surface.state
      if (state === undefined) return

      state.clock.elapsed += FRAME_MS * state.clock.props.speed
      const { percent, width, shuttle: runs } = state.clock.props
      const shuttle = runs ? rounded(shuttleAt(state.clock.elapsed, filledCells(percent, width))) : null
      // Resting, nothing moves: no redraw.
      if (shuttle !== state.shuttle) surface.setState({ ...state, shuttle })
    })
  } else {
    surface.state.clock.props = props
  }

  const shuttle = surface.state?.shuttle ?? undefined
  const runs = gauge(props.percent, props.width, 'subtle', props.pace ?? undefined, props.shuttle ? shuttle : undefined, props.solid ?? undefined, props.thresholds)

  return (
    <Box>
      {runs.map(run => (
        <Text color={run.color} dimColor={run.dim} bold={run.bold}>
          {run.text}
        </Text>
      ))}
    </Box>
  )
}

export default Gauge
