import type { ClientModule } from 'claude-code'

import { clicked, keyed, rowOf, rowsOf } from './editor-model'
import type { Editor } from './editor-model'

// The notes editor, drawn on the surface's own thread: a click gives it the
// keyboard (Escape hands it back), every key edits the text there, and each
// change is posted to the hooks module, which keeps it.

export type EditorProps = {
  // The note's text as the store holds it: taken when the editor opens, and
  // again when another session changed it; an echo of its own posts is not.
  text: string
  rows: number
  placeholder: string
  // Which note: echoed in every post.
  tab: string
  session: string
}
// `given`: the text the hooks last drew; `sent`: the texts posted since, not
// drawn back yet.
type EditorState = Editor & { active: boolean; given: string; sent: string[] }
// Posts kept to tell an echo from another session's text: redraws fold, so
// some never come back.
const SENT_KEPT = 200

// The text the hooks drew, taken in: the one shown, every post landed; one
// this editor posted, drawn back late, the keys since standing; any other,
// another session's, shown in place of this one's, the cursor kept within.
export function drawn(state: EditorState, text: string): EditorState {
  if (text === state.given) return state
  if (text === state.text) return { ...state, given: text, sent: [] }
  const echoed = state.sent.lastIndexOf(text)
  if (echoed >= 0) return { ...state, given: text, sent: state.sent.slice(echoed + 1) }
  const cursor = Math.min(state.cursor, text.length)
  return { ...state, text, cursor, top: Math.min(state.top, text.slice(0, cursor).split('\n').length - 1), given: text, sent: [] }
}

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
