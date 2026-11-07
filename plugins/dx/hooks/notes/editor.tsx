import type { ClientModule } from 'claude-code'

import { clicked, drawn, keyed, refusalOf, rowOf, rowsOf } from './editor-model'
import type { EditorState } from './editor-model'

// The notes editor, drawn on the surface's own thread: a click gives it the
// keyboard (Escape hands it back), every key edits the text there, and each
// change is posted to the hooks module, which keeps it.

export type EditorProps = {
  // The note's text as the store holds it: taken when the editor opens, and
  // again when another session changed it; an echo of its own posts is not.
  text: string
  // The longest the note may grow to now: NOTE_MAX_CHARS, or less when the
  // store's room left holds less. Given again at each draw, the room changed.
  max: number
  rows: number
  placeholder: string
  // Which note: echoed in every post.
  tab: string
  session: string
}
// Posts kept to tell an echo from another session's text: redraws fold, so
// some never come back.
const SENT_KEPT = 200

// An editor opened on `text`: the cursor at its end, the keyboard elsewhere.
function opened(text: string): EditorState {
  return { text, cursor: text.length, top: 0, active: false, given: text, sent: [] }
}

// Each instance's latest props, for its listeners.
const instances = new WeakMap<object, { props: EditorProps }>()

const NoteEditor: ClientModule<EditorProps, EditorState> = (props, surface) => {
  const { Box, Text } = surface.elements
  const width = () => Math.max(1, surface.columns || 40)

  if (surface.state === undefined) {
    const latest = { props }
    instances.set(surface, latest)
    surface.setState(opened(props.text))
    const apply = (next: EditorState) => {
      const state = surface.state
      if (state === undefined || next === state) return
      if (next.text === state.text) {
        surface.setState(next)
        return
      }
      // Too long, or past the store's room: not applied, the hooks module
      // told, which says why.
      const refused = refusalOf(state.text, next.text, latest.props.max)
      if (refused !== undefined) {
        if (!state.active) surface.setState({ ...state, active: true })
        surface.post({ tab: latest.props.tab, session: latest.props.session, refused })
        return
      }
      surface.setState({ ...next, sent: [...next.sent, next.text].slice(-SENT_KEPT) })
      surface.post({ tab: latest.props.tab, session: latest.props.session, text: next.text })
    }
    surface.onKey(event => {
      const state = surface.state
      if (state === undefined) return
      const next = keyed(state, event, width(), latest.props.rows)
      apply(next === state && state.active ? state : { ...state, ...next, active: true })
    })
    surface.onPointer(event => {
      const state = surface.state
      if (state === undefined || event.type !== 'down') return
      apply({ ...state, ...clicked(state, event.x, event.y, width()), active: true })
    })
  } else {
    const latest = instances.get(surface)
    if (latest !== undefined) latest.props = props
    const next = drawn(surface.state, props.text)
    if (next !== surface.state) surface.setState(next)
  }

  const state = surface.state ?? opened(props.text)
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
