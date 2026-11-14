import type { ClientModule } from 'claude-code'

import { drawn, keyed, pasted, pointed, refusalOf, rowOf, rowRuns, rowsOf, selectedText } from './editor-model'
import type { EditorState } from './editor-model'

// The notes editor, drawn on the surface's own thread: a click gives it the
// keyboard (Escape hands it back), every key edits the text there, and each
// change is posted to the hooks module, which keeps it. A paste in the
// terminal goes to the prompt: the pane's paste button reads the system
// clipboard, whose text reaches the editor through the hooks module (`paste`).
// The editor holds the pointer, so the terminal selects nothing there: the
// editor selects itself, by a drag or ctrl+a, and posts what it selected
// (`selected`) once the selection is made or dropped, for the hooks module
// to draw Couper and Copier: Claude Code keeps ctrl+c and ctrl+x for itself.

// A paste the hooks module read from the clipboard for this note: taken
// once, its `seq` past the last one the editor took. `isTooLong`, it no
// longer fits with the note as stored now: given without its text, it is
// refused, and taken all the same. An empty one, Couper's, erases the
// selection.
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

// Each instance's latest props, how a paste is taken there, and how a
// selection a redraw dropped is posted, for its listeners and its redraws.
type Instance = {
  props: EditorProps
  take: (state: EditorState, paste: EditorPaste | null) => void
  announce: (state: EditorState) => void
}
const instances = new WeakMap<object, Instance>()

const NoteEditor: ClientModule<EditorProps, EditorState> = (props, surface) => {
  const { Box, Text } = surface.elements
  const width = () => Math.max(1, surface.columns || 40)

  if (surface.state === undefined) {
    // The selection the hooks module was last told of; null before any post.
    let posted: string | null = null
    // Every post names the note and the last paste taken, which the hooks
    // module then lets go, and the selection when it changed since the last
    // post: a later post in the same frame replaces an undelivered one.
    const post = (data: { text: string } | { refused: string } | Record<string, never>, from: EditorState) => {
      const selection = selectedText(from)
      const selected: { selected: string } | Record<string, never> = selection === posted ? {} : { selected: selection }
      surface.post({ tab: latest.props.tab, session: latest.props.session, pasted: from.pasted, ...selected, ...data })
      posted = selection
    }
    // The selection posted, when it changed.
    const announce = (state: EditorState) => {
      if (selectedText(state) !== posted) post({}, state)
    }
    // An edit from `state`, the editor's state unless it is being opened;
    // `isDragging`, the selection still being made: posted as the button
    // comes up.
    const apply = (next: EditorState, state = surface.state, isDragging = false) => {
      if (state === undefined || next === state) return
      if (next.text === state.text) {
        surface.setState(next)
        // A paste with nothing left once cleaned: taken all the same.
        if (next.pasted !== state.pasted) post({}, next)
        else if (!isDragging) announce(next)
        return
      }
      // Too long, or past the store's room: not applied, the hooks module
      // told, which says why. A paste refused is taken all the same.
      const refused = refusalOf(state.text, next.text, latest.props.max)
      if (refused !== undefined) {
        const kept = { ...state, active: next.active, pasted: next.pasted }
        if (state.active !== next.active || state.pasted !== next.pasted) surface.setState(kept)
        post({ refused }, kept)
        return
      }
      surface.setState({ ...next, sent: [...next.sent, next.text].slice(-SENT_KEPT) })
      post({ text: next.text }, next)
    }
    // A paste not taken yet, at the cursor: the same limits as a key, the
    // keyboard left where it was. One too long now is refused unseen.
    const take = (state: EditorState, paste: EditorPaste | null) => {
      if (paste === null || paste.seq <= state.pasted) return
      if (paste.isTooLong) {
        const kept = { ...state, pasted: paste.seq }
        surface.setState(kept)
        post({ refused: 'too-long' }, kept)
        return
      }
      apply({ ...state, ...pasted(state, paste.text, width(), latest.props.rows), pasted: paste.seq }, state)
    }
    const latest: Instance = { props, take, announce }
    instances.set(surface, latest)
    const first = opened(props.text)
    surface.setState(first)
    take(first, props.paste)
    // Opened with nothing selected: a selection kept for this note is gone.
    announce(first)
    surface.onKey(event => {
      const state = surface.state
      if (state === undefined) return
      const next = keyed(state, event, width(), latest.props.rows)
      apply(next === state && state.active ? state : { ...state, ...next, active: true }, state)
    })
    surface.onPointer(event => {
      const state = surface.state
      if (state === undefined || event.button === 'middle' || event.button === 'right') return
      if (event.type === 'down' || (event.type === 'move' && event.button === 'left') || event.type === 'up') {
        const next = { ...state, ...pointed(state, event.type, event.x, event.y, width(), latest.props.rows), active: true }
        apply(next, state, event.type !== 'up')
      }
    })
  } else {
    const latest = instances.get(surface)
    const state = drawn(surface.state, props.text)
    const isRedrawn = state !== surface.state
    if (isRedrawn) surface.setState(state)
    if (latest !== undefined) {
      latest.props = props
      latest.take(state, props.paste)
      // Another session's text drops the selection.
      if (isRedrawn) latest.announce(state)
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
        const runs = rowRuns(state, row, state.active && state.top + index === at)
        const [only] = runs
        if (runs.length === 1 && only !== undefined && only.inverse === undefined) return <Text>{only.text}</Text>
        return <Text>{runs.map(run => (run.inverse ? <Text inverse>{run.text}</Text> : run.text))}</Text>
      })}
    </Box>
  )
}

export default NoteEditor
