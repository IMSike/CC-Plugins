import type { ClientModule } from 'claude-code'

// A number with a step down and a step up, drawn on the surface's own thread:
// a click there selects no text, however fast the clicks come, where a Button
// would let a double click select the word, then the line. Each click posts
// the number it lands on; the settings pane keeps it.

export type StepperProps = {
  // Which setting: echoed in every post.
  setting: string
  value: number
  min: number
  max: number
  step: number
  suffix: string
}
// `given`: the number the hooks last drew; `sent`: the numbers posted since,
// not drawn back yet; `quiet`: the checks since the last click.
type StepperState = { value: number; given: number; sent: number[]; quiet: number }

// The cells of each part: ` − `, the number, ` + `.
const BUTTON = 3
export const STEPPER_COLUMNS = 2 * BUTTON + 6
// Two checks after the last click (0.5 to 1 s), nothing posted is still on its
// way: the hooks' redraws, merged into the number shown, may never draw the rest.
const CHECK_MS = 500
const SETTLED = 2

// Each instance's latest props, for its listeners.
const latestOf = new WeakMap<object, StepperProps>()

const Stepper: ClientModule<StepperProps, StepperState> = (props, surface) => {
  const { Box, Text } = surface.elements
  const state = surface.state
  if (state === undefined) {
    surface.setState({ value: props.value, given: props.value, sent: [], quiet: 0 })
    surface.onPointer(event => {
      const current = surface.state
      if (current === undefined || event.type !== 'down') return
      const latest = latestOf.get(surface) ?? props
      const by = event.x < BUTTON ? -latest.step : event.x >= STEPPER_COLUMNS - BUTTON ? latest.step : 0
      const value = Math.min(latest.max, Math.max(latest.min, current.value + by))
      if (value === current.value) return
      surface.setState({ ...current, value, sent: [...current.sent, value], quiet: 0 })
      surface.post({ setting: latest.setting, value })
    })
    surface.every(CHECK_MS, () => {
      const current = surface.state
      const latest = latestOf.get(surface)
      if (current === undefined || latest === undefined || current.sent.length === 0) return
      const quiet = current.quiet + 1
      surface.setState(
        quiet >= SETTLED && latest.value === current.value ? { ...current, given: latest.value, sent: [], quiet } : { ...current, quiet },
      )
    })
  } else if (state.given !== props.value) {
    // A number the hooks drew (not a redraw after setState): the one shown,
    // every post landed; one this instance posted, drawn back late, the
    // clicks since standing; any other (a reset), it wins.
    const echoed = state.sent.indexOf(props.value)
    surface.setState(
      props.value === state.value
        ? { ...state, given: props.value, sent: [] }
        : echoed >= 0
          ? { ...state, given: props.value, sent: state.sent.slice(echoed + 1) }
          : { value: props.value, given: props.value, sent: [], quiet: 0 },
    )
  }
  latestOf.set(surface, props)

  const value = surface.state?.value ?? props.value
  return (
    <Box width={STEPPER_COLUMNS}>
      <Text color={value > props.min ? 'claude' : 'subtle'} bold>{' − '}</Text>
      <Text bold>{`${value}${props.suffix}`.padStart(6)}</Text>
      <Text color={value < props.max ? 'claude' : 'subtle'} bold>{' + '}</Text>
    </Box>
  )
}

export default Stepper
