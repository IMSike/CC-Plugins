import type { ClientModule } from 'claude-code'

// A pressable label drawn on the surface's own thread: from a press to its
// release the instance holds the pointer, so the terminal selects no text, as
// it does over a Button when the pointer slips or two clicks come fast. A
// release over it posts `{}`; the hooks module answers by the instance's key.
//
// A post is code's, not the person's: what only their press may do (change
// the main view, open a pane at any width) stays with a Button.

export type PressStyle = {
  color?: string
  backgroundColor?: string
  bold?: boolean
  dimColor?: boolean
  inverse?: boolean
  underline?: boolean
}
// One run of the label, in its style.
export type PressPart = PressStyle & { text: string }
export type PressProps = {
  parts: PressPart[]
  // What the pointer over it adds to every part.
  hover?: PressStyle
  // Cut at the region's end, else wrapped.
  truncate?: boolean
}
type PressState = { hovered: boolean; down: boolean }

const Press: ClientModule<PressProps, PressState> = (props, surface) => {
  const { Text } = surface.elements
  if (surface.state === undefined) {
    surface.setState({ hovered: false, down: false })
    surface.onPointer(event => {
      const state = surface.state
      if (state === undefined) return
      // Over the region; a size the surface does not give (0) bounds nothing.
      const inside = event.x >= 0 && event.y >= 0 && (!surface.columns || event.x < surface.columns) && (!surface.rows || event.y < surface.rows)
      if (event.type === 'enter' || event.type === 'leave') {
        const hovered = event.type === 'enter'
        if (hovered !== state.hovered) surface.setState({ ...state, hovered })
      } else if (event.type === 'down') {
        surface.setState({ hovered: true, down: true })
      } else if (event.type === 'up') {
        surface.setState({ hovered: inside, down: false })
        if (state.down && inside) surface.post({})
      }
    })
  }

  const hover = surface.state?.hovered ? (props.hover ?? {}) : {}
  const wrap = props.truncate ? 'truncate-end' : 'wrap'
  const [only] = props.parts
  if (props.parts.length === 1 && only !== undefined) {
    const { text, ...style } = only
    return <Text {...style} {...hover} wrap={wrap}>{text}</Text>
  }
  return (
    <Text wrap={wrap}>
      {props.parts.map(({ text, ...style }) => (
        <Text {...style} {...hover}>{text}</Text>
      ))}
    </Text>
  )
}

export default Press
