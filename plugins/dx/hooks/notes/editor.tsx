import type { ClientModule } from 'claude-code'

import { clicked, drawn, keyed, pasted, refusalOf, rowOf, rowsOf } from './editor-model'
import type { EditorState } from './editor-model'

// The notes editor, drawn on the surface's own thread: a click gives it the
// keyboard (Escape hands it back), every key edits the text there, and each
// change is posted to the hooks module, which keeps it. A paste in the
// terminal goes to the prompt: the pane's paste button reads the system
// clipboard, whose text reaches the editor through the hooks module (`paste`).

// A paste the hooks module read from the clipboard for this note: taken
// once, its `seq` past the last one the editor took. `isTooLong`, it no
// longer fits with the note as stored now: given without its text, it is
// refused, and taken all the same.
export type EditorPaste = { seq: number; text: string; isTooLong: boolean }

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
  // The paste for this note the hooks module has not seen taken, or null.
  // The hooks module is the authority: it lets a paste go as soon as an
  // editor posts it taken, before any later draw, so an editor opened while
  // one is given (the tab changed, the pane shown again during the read)
  // takes it, and no other editor ever does after.
  paste: EditorPaste | null
}
// Posts kept to tell an echo from another session's text: redraws fold, so
// some never come back.
const SENT_KEPT = 200

// An editor opened on `text`: the cursor at its end, the keyboard elsewhere,
// no paste taken yet.
function opened(text: string): EditorState {
  return { text, cursor: text.length, top: 0, active: false, given: text, sent: [], pasted: 0 }
}

// Each instance's latest props, and how a paste is taken there, for its
// listeners and its redraws.
const instances = new WeakMap<object, { props: EditorProps; take: (state: EditorState, paste: EditorPaste | null) => void }>()

const NoteEditor: ClientModule<EditorProps, EditorState> = (props, surface) => {
  const { Box, Text } = surface.elements
  const width = () => Math.max(1, surface.columns || 40)

  if (surface.state === undefined) {
    // Every post names the note and the last paste taken, which the hooks
    // module then lets go.
    const post = (data: { text: string } | { refused: string } | Record<string, never>, pasted: number) =>
      surface.post({ tab: latest.props.tab, session: latest.props.session, pasted, ...data })
    // An edit from `state`, the editor's state unless it is being opened.
    const apply = (next: EditorState, state = surface.state) => {
      if (state === undefined || next === state) return
      if (next.text === state.text) {
        surface.setState(next)
        // A paste with nothing left once cleaned: taken all the same.
        if (next.pasted !== state.pasted) post({}, next.pasted)
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
    // A paste not taken yet, at the cursor: the same limits as a key, the
    // keyboard left where it was. One too long now is refused unseen.
    const take = (state: EditorState, paste: EditorPaste | null) => {
      if (paste === null || paste.seq <= state.pasted) return
      if (paste.isTooLong) {
        surface.setState({ ...state, pasted: paste.seq })
        post({ refused: 'too-long' }, paste.seq)
        return
      }
      apply({ ...state, ...pasted(state, paste.text, width(), latest.props.rows), pasted: paste.seq }, state)
    }
    const latest = { props, take }
    instances.set(surface, latest)
    const first = opened(props.text)
    surface.setState(first)
    take(first, props.paste)
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
      latest.take(state, props.paste)
    }
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
