import type { ClientModule } from 'claude-code'

import { clicked, drawn, keyed, pasted, refusalOf, rowOf, rowsOf } from './editor-model'
import type { EditorState } from './editor-model'

// The notes editor, drawn on the surface's own thread: a click gives it the
// keyboard (Escape hands it back), every key edits the text there, and each
// change is posted to the hooks module, which keeps it. A paste in the
// terminal goes to the prompt: the pane's paste button reads the system
// clipboard, whose text reaches the editor through the hooks module (`paste`).

// A paste the hooks module read from the clipboard for this note: taken
// once, its `seq` past the last one the editor took.
export type EditorPaste = { seq: number; text: string }

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
  // The latest paste for this note, or null. One given as the editor opens
  // was meant for an editor before it: never taken.
  paste: EditorPaste | null
}
// Posts kept to tell an echo from another session's text: redraws fold, so
// some never come back.
const SENT_KEPT = 200

// An editor opened on `text`: the cursor at its end, the keyboard elsewhere,
// the paste given already taken.
function opened(text: string, paste: EditorPaste | null): EditorState {
  return { text, cursor: text.length, top: 0, active: false, given: text, sent: [], pasted: paste?.seq ?? 0 }
}

// Each instance's latest props, and how an edit is applied there, for its
// listeners and its redraws.
const instances = new WeakMap<object, { props: EditorProps; apply: (next: EditorState) => void }>()

const NoteEditor: ClientModule<EditorProps, EditorState> = (props, surface) => {
  const { Box, Text } = surface.elements
  const width = () => Math.max(1, surface.columns || 40)

  if (surface.state === undefined) {
    // Every post names the note and the last paste taken, which the hooks
    // module then lets go.
    const post = (data: { text: string } | { refused: string }, pasted: number) =>
      surface.post({ tab: latest.props.tab, session: latest.props.session, pasted, ...data })
    const apply = (next: EditorState) => {
      const state = surface.state
      if (state === undefined || next === state) return
      if (next.text === state.text) {
        surface.setState(next)
        return
      }
      // Too long, or past the store's room: not applied, the hooks module
      // told, which says why. A paste refused is taken all the same.
      const refused = refusalOf(state.text, next.text, latest.props.max)
      if (refused !== undefined) {
        if (state.active !== next.active || state.pasted !== next.pasted) surface.setState({ ...state, active: next.active, pasted: next.pasted })
        post({ refused }, next.pasted)
        return
      }
      surface.setState({ ...next, sent: [...next.sent, next.text].slice(-SENT_KEPT) })
      post({ text: next.text }, next.pasted)
    }
    const latest = { props, apply }
    instances.set(surface, latest)
    surface.setState(opened(props.text, props.paste))
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
    const state = drawn(surface.state, props.text)
    if (state !== surface.state) surface.setState(state)
    if (latest !== undefined) {
      latest.props = props
      // A new paste, at the cursor: the same limits as a key. The keyboard
      // stays where it was.
      const paste = props.paste
      if (paste !== null && paste.seq > state.pasted) {
        latest.apply({ ...state, ...pasted(state, paste.text, width(), props.rows), pasted: paste.seq })
      }
    }
  }

  const state = surface.state ?? opened(props.text, props.paste)
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
