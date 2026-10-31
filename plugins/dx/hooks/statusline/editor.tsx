import type { ClientModule } from 'claude-code'

import { clicked, keyed, rowOf, rowsOf } from './editor-model'
import type { Editor } from './editor-model'

// The notes editor, drawn on the surface's own thread: a click gives it the
// keyboard (Escape hands it back), every key edits the text there, and each
// change is posted to the hooks module, which keeps it.

export type EditorProps = {
  // The note's text when the editor opens; the editor owns it afterwards.
  text: string
  rows: number
  placeholder: string
  // Which note: echoed in every post.
  tab: string
  session: string
}
type EditorState = Editor & { active: boolean }

// Each instance's latest props, for its listeners.
const instances = new WeakMap<object, { props: EditorProps }>()

const NoteEditor: ClientModule<EditorProps, EditorState> = (props, surface) => {
  const { Box, Text } = surface.elements
  const width = () => Math.max(1, surface.columns || 40)

  if (surface.state === undefined) {
    const latest = { props }
    instances.set(surface, latest)
    surface.setState({ text: props.text, cursor: props.text.length, top: 0, active: false })
    const apply = (next: EditorState) => {
      const state = surface.state
      if (state === undefined || next === state) return
      surface.setState(next)
      if (next.text !== state.text) surface.post({ tab: latest.props.tab, session: latest.props.session, text: next.text })
    }
    surface.onKey(event => {
      const state = surface.state
      if (state === undefined) return
      const next = keyed(state, event, width(), latest.props.rows)
      apply(next === state && state.active ? state : { ...next, active: true })
    })
    surface.onPointer(event => {
      const state = surface.state
      if (state === undefined || event.type !== 'down') return
      apply({ ...clicked(state, event.x, event.y, width()), active: true })
    })
  } else {
    const latest = instances.get(surface)
    if (latest !== undefined) latest.props = props
  }

  const state = surface.state ?? { text: props.text, cursor: props.text.length, top: 0, active: false }
  const rows = rowsOf(state.text, width())
  const at = rowOf(rows, state.cursor)
  const shown = rows.slice(state.top, state.top + props.rows)

  if (state.text === '' && !state.active) {
    return (
      <Box flexDirection="column" height={props.rows}>
        <Text dimColor italic>{props.placeholder}</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" height={props.rows}>
      {shown.map((row, index) => {
        const line = state.text.slice(row.start, row.end)
        if (!state.active || state.top + index !== at) return <Text>{line === '' ? ' ' : line}</Text>
        const column = state.cursor - row.start
        return (
          <Text>
            {line.slice(0, column)}
            <Text inverse>{line.charAt(column) || ' '}</Text>
            {line.slice(column + 1)}
          </Text>
        )
      })}
    </Box>
  )
}

export default NoteEditor
