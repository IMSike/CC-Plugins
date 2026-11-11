import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, TurnStartInput } from 'claude-code'

import type { Note, Notes, NotesPaste, NoteTab, NotesUnsaved, NotesView } from '../../types'
import { keepTaskTabs, paneTabs } from '../activity/activity'
import { heldSettings } from '../settings/settings'
import { dayTime, errorText } from '../shared/format'
import { NOTE_TABS } from '../shared/options'
import { closePanel, isShowing, PANEL, panelView, showPanel } from '../shared/panes'
import { pressBoard } from '../shared/presses'
import type { EditorPaste, EditorProps } from './editor'
import {
  CLIPBOARD_NO_TOOL,
  CLIPBOARD_REMOTE,
  CLIPBOARD_TIMED_OUT,
  CLIPBOARD_TIMEOUT_MS,
  clipboardCommands,
  clipboardText,
  clipboardUnreadable,
  failureOf,
  isClipboardError,
  isEmptyClipboard,
  isTimedOut,
} from './clipboard'
import { cleanPaste, encodedLength, fitsEditor, NOTE_MAX_CHARS, NOTE_MAX_SHOWN, thousands } from './editor-model'
import { clearedView, ensureNotes, forgetClear, forgetLinks, keyOf, knownKey, needsLoad, noteClear, noteOf, readNotes, shownNote, tryNotes } from './notes-load'
import { isTab, unsavedFor } from './notes-model'
import { firstLine, othersOf, othersStart } from './others'
import { fitsStore, noteMax, storeRoom, storeWritten } from './store-size'

// The notes pane: three notes of the person's own, one for every session, one
// for the project, one for this session, kept in `$.store` across sessions.
// The model never sees a pane, so the notes stay out of its context.
// The notes are loaded by ./notes-load, which keeps why its last load failed.
const notes = atom({ plugin: 'dx', key: 'notes' } as const, null as Notes | null, { shape: 'notes-2' })
const notesError = atom({ plugin: 'dx', key: 'notesError' } as const, null as string | null, { shape: 'notes-error-1' })
const notesView = atom({ plugin: 'dx', key: 'notesView' } as const, { tab: 'global' } as NotesView, { shape: 'notes-view-1' })
// The note shown, as the store last held it, and the longest it may grow to:
// drawn again when either changes there.
const notesSeen = atom({ plugin: 'dx', key: 'notesSeen' } as const, null as string | null, { shape: 'notes-seen-1' })
// Why the last save failed, or the last edit was refused, and which note:
// shown with that note alone, null once it saves (see `unsaved`).
const notesUnsaved = atom({ plugin: 'dx', key: 'notesUnsaved' } as const, null as NotesUnsaved | null, { shape: 'notes-unsaved-2' })
// The last paste read from the clipboard for a note, given to its editor.
const notesPaste = atom({ plugin: 'dx', key: 'notesPaste' } as const, null as NotesPaste | null, { shape: 'notes-paste-1' })
// The first of the other sessions' notes listed, the list scrolled.
const notesOthersAt = atom({ plugin: 'dx', key: 'notesOthersAt' } as const, 0, { shape: 'notes-others-at-1' })

// The last tab shown, taken up again by the next pane (a setting).
const TAB_KEY = 'notesTab'

// Every note, and the tab a pane opens on: once the session has started.
async function loadNotes($: EngineInterface): Promise<void> {
  forgetClear()
  await tryNotes($)
  await openingTab($)
}

// The tab a pane opens on: the last one shown, or the one set.
async function openingTab($: EngineInterface): Promise<void> {
  const { notesTab, resumeNotesTab } = await heldSettings($)
  const last = resumeNotesTab ? await $.store.get(TAB_KEY).catch(() => undefined) : undefined
  await update($, notesView, () => ({ tab: isTab(last) ? last : notesTab }))
}

// The saves in flight, one after another: each change the editor posts is a
// `ui.message` of its own, which the engine may run while an earlier one still
// waits on the store, its older text then written last.
let saving: Promise<void> = Promise.resolve()

// Runs `job` once the saves before it are done, a failed one too.
function queued(job: () => Promise<void>): Promise<void> {
  const run = saving.then(job)
  saving = run.catch(() => undefined)
  return run
}

// Keeps a note as it now reads, once the saves before it are done.
function save($: EngineInterface, tab: NoteTab, session: string, text: string): Promise<void> {
  return queued(() => write($, tab, session, text))
}

// Why a note was not saved, as the pane says it. Its length is counted as
// encodedLength counts it, which the documentation explains.
const TOO_LONG = `note trop longue (${NOTE_MAX_SHOWN} caractères au plus)`
const STORE_FULL = "store presque plein : supprimez d'anciennes notes"

// A save of the note under `key` failed, an edit of it was refused, or the
// notes did not load to keep it: the pane says why, with that note, until it
// saves; `reason` null, it saved. A `key` unknown (null) stands for any note:
// said with each, cleared by the next save. A handler's write, never a render's.
async function unsaved($: EngineInterface, key: string | null, reason: string | null): Promise<void> {
  const current = await read($, notesUnsaved)
  if (reason === null) {
    if (current !== null && (current.key === key || current.key === null)) await update($, notesUnsaved, () => null)
    return
  }
  if (current?.key !== key || current.reason !== reason) await update($, notesUnsaved, () => ({ key, reason }))
}

// Whether `text` may be kept under `key` for its length: within the limit, or
// past it no longer than the note stored there (one an older dx kept past
// it), as the editor lets it be shortened.
async function fitsLength($: EngineInterface, key: string, text: string): Promise<boolean> {
  const length = encodedLength(text)
  if (length <= NOTE_MAX_CHARS) return true
  const stored = noteOf(await $.store.get(key).catch(() => undefined))
  return stored !== null && length <= encodedLength(stored.text)
}

// Writes `note` under `key`, `null` deleting it: why it was not, or null.
async function kept($: EngineInterface, key: string, note: Note | null): Promise<string | null> {
  if (note !== null && !(await fitsLength($, key, note.text))) return TOO_LONG
  if (!(await fitsStore($, key, note))) return STORE_FULL
  try {
    await (note === null ? $.store.delete(key) : $.store.set(key, note))
  } catch (error) {
    return `store : ${errorText(error)}`
  }
  storeWritten(key, note)
  return null
}

// Keeps a note as it now reads, at once: an emptied one is deleted. A save
// refused or failed leaves the notes as they were, the editor's text shown.
async function write($: EngineInterface, tab: NoteTab, session: string, text: string): Promise<void> {
  const now = await $.clock.now()
  const note: Note | null = text === '' ? null : { text, updatedAt: now }
  // The pane may draw notes read afresh, not kept yet: kept first. Not
  // loaded, the key is not known: said, never dropped silently.
  await ensureNotes($)
  const value = await read($, notes)
  if (value === null) {
    const error = await read($, notesError)
    return unsaved($, knownKey(tab, session), `notes non chargées${error === null ? '' : ` : ${error}`}`)
  }
  const key = keyOf(value, tab, session)
  const reason = await kept($, key, note)
  await unsaved($, key, reason)
  if (reason !== null) return
  await update($, notes, current => {
    if (current === null) return current
    if (tab === 'global') return { ...current, global: note }
    if (tab === 'project') return { ...current, project: note }
    const { [session]: _, ...others } = current.sessions
    return { ...current, sessions: note === null ? others : { ...others, [session]: note } }
  })
}

// An edit of a note not applied, the note too long or the store's room
// short: said with that note, in its turn among the saves, which a later one
// of the note clears.
function refuse($: EngineInterface, tab: NoteTab, session: string, reason: string): Promise<void> {
  return queued(async () => {
    const value = await read($, notes)
    await unsaved($, value === null ? knownKey(tab, session) : keyOf(value, tab, session), reason)
  })
}

// The note a paste goes into: the one shown as the paste button was drawn.
type PasteTarget = { key: string; tab: NoteTab; session: string }

// The `seq` of the last paste taken, from the clock: never back, a reload
// of dx's code included.
let lastPaste = 0

// Whether the clipboard is being read: a press meanwhile does nothing, never
// pasting twice.
let isReading = false

// The system clipboard's text, read with the tools the system ships (ADR
// 0006), or why it was not. Under SSH, which sets one of these variables,
// the clipboard there is the remote host's: not read.
async function readClipboard($: EngineInterface): Promise<{ text: string } | { error: string }> {
  const unset = () => undefined
  const remote = await Promise.all([
    $.env.get('SSH_CONNECTION').catch(unset),
    $.env.get('SSH_CLIENT').catch(unset),
    $.env.get('SSH_TTY').catch(unset),
  ])
  if (remote.some(value => value !== undefined && value !== '')) return { error: CLIPBOARD_REMOTE }
  const isWindows = (await $.env.get('OS').catch(() => undefined)) === 'Windows_NT'
  // Why the first tool that started failed, timed out or exited in error: it
  // says more than the tools tried past it, as not installed, for they
  // could not start. Windows has one tool: why it could not start is said.
  let failure: string | undefined
  let unstarted: string | undefined
  for (const argv of clipboardCommands(isWindows)) {
    const startedAt = await $.clock.now()
    try {
      const ran = await $.process.run(argv, { timeoutMs: CLIPBOARD_TIMEOUT_MS })
      if (ran.exitCode === 0) return { text: clipboardText(isWindows, ran.stdout) }
      if (isEmptyClipboard(argv, ran.stderr)) return { text: '' }
      failure ??= failureOf(ran.exitCode, ran.stderr)
    } catch (error) {
      const message = errorText(error)
      if (isTimedOut((await $.clock.now()) - startedAt, message)) failure ??= CLIPBOARD_TIMED_OUT
      else unstarted ??= message
    }
  }
  if (failure !== undefined) return { error: clipboardUnreadable(failure) }
  return { error: isWindows && unstarted !== undefined ? clipboardUnreadable(unstarted) : CLIPBOARD_NO_TOOL }
}

// The paste button pressed: the clipboard's text into the note it was drawn
// with, at its editor's cursor. Why it could not be read is said with that
// note, as a refused edit is; an empty clipboard pastes nothing.
async function pasteClipboard($: EngineInterface, target: PasteTarget): Promise<void> {
  if (isReading) return
  isReading = true
  try {
    const clipboard = await readClipboard($)
    if ('error' in clipboard) return refuse($, target.tab, target.session, clipboard.error)
    await pasteNote($, target, clipboard.text)
  } finally {
    isReading = false
  }
}

// A paste into the note under `key`, given to its editor, which inserts it
// at its cursor as it does a key, within the same limits. One that would
// make the note too long whatever its editor holds is refused here: never
// sent, past what an editor's props may take.
async function pasteNote($: EngineInterface, target: PasteTarget, raw: string): Promise<void> {
  const text = cleanPaste(raw)
  if (text === '') return
  const stored = noteOf(await $.store.get(target.key).catch(() => undefined))
  if (encodedLength(stored?.text ?? '') + encodedLength(text) > NOTE_MAX_CHARS) return refuse($, target.tab, target.session, TOO_LONG)
  lastPaste = Math.max(await $.clock.now(), lastPaste + 1)
  const seq = lastPaste
  await update($, notesPaste, () => ({ key: target.key, seq, text }))
}

// The paste `seq` and those before it taken by their editor: let go, their
// text no longer given.
async function pasteTaken($: EngineInterface, seq: number): Promise<void> {
  const paste = await read($, notesPaste)
  if (paste !== null && paste.seq <= seq) await update($, notesPaste, current => (current !== null && current.seq <= seq ? null : current))
}

// How often the note shown is read again from the store while its pane is
// open: another session writing it shows here within that time.
const NOTES_POLL_MS = 1000

// Draws the pane again when another session changed the note it shows, or
// the room the store has left for it (the store near full, measured again):
// the store has no event of its own, and the editor takes the new text and
// limit. The pane reads `notesSeen`: writing it redraws the pane alone.
async function notesTick($: EngineInterface): Promise<void> {
  // The view first, a plain read: `isShowing` lists the panes.
  if ((await panelView($)) !== 'notes' || !(await isShowing($, 'notes'))) return
  const value = await read($, notes)
  if (value === null) return
  const { key } = shownNote(value, await read($, notesView))
  const stored = noteOf(await $.store.get(key).catch(() => undefined))
  const max = noteMax(key, stored?.text.length ?? 0, await storeRoom($, true))
  const seen = `${key} ${stored?.updatedAt ?? 0} ${max}`
  if ((await read($, notesSeen)) === seen) return
  await update($, notesSeen, () => seen)
}

// Called by ../register once the session has started, after the settings that
// name the tab a pane opens on: the notes, then the clock reading the note
// shown again. A load that fails is tried again as the pane is shown.
export async function startNotes($: EngineInterface): Promise<void> {
  await loadNotes($).catch(() => undefined)
  $.clock.every(NOTES_POLL_MS, () => notesTick($))
}

// Called by ../register as a turn starts: the main loop's first prompt after a
// `/clear` keeps the notes for its new session id.
export async function startNotesTurn($: EngineInterface, e: TurnStartInput): Promise<void> {
  if (e.agentId !== undefined) return
  await ensureNotes($, false).catch(() => undefined)
}

// The notes shown in the panel. An open panel is redrawn, not opened again, so
// no `ui.open` hook sees the switch: the notes, when their load failed, are
// loaded again here first.
async function showNotes($: EngineInterface): Promise<void> {
  await ensureNotes($)
  await showPanel($, 'notes')
}

// A click on the band's notes icon: the notes shown, or the panel closed when
// it already shows them.
export async function toggleNotes($: EngineInterface): Promise<void> {
  if (await isShowing($, 'notes')) await closePanel($)
  else await showNotes($)
}

// Shows a tab, or another session's note, and keeps it as the last one shown.
async function setView($: EngineInterface, shown: NotesView): Promise<void> {
  // Kept first: notes drawn afresh after a `/clear` show the tab it left.
  await ensureNotes($)
  await update($, notesView, () => shown)
  await $.store.set(TAB_KEY, shown.tab).catch(() => undefined)
}

// What each press drawn in the pane (../shared/press.tsx) does, by its key: a
// view to show, a retry of the load, another session's note to delete, the
// list of other sessions to move by a number of rows, or the clipboard to
// paste into the note shown. Rebuilt as the pane draws, it holds the drawn
// ones alone. Every key starts with `notes:`, which the press hook matches.
type NotesPress = { view: NotesView } | { retry: true } | { erase: string } | { scroll: number } | { paste: PasteTarget }
let pressActions = new Map<string, NotesPress>()

// Where the list of other sessions stands in the pane's tree, as last drawn:
// its title's row and the row past its last; `offset`, the pane's window then.
// Read by the wheel, which says the body's row it is over.
let othersList: { first: number; end: number; offset: number } | undefined

// The list of other sessions moved `by` rows, kept within it: whether it
// moved, which it cannot with every note shown, or at its end that way.
async function scrollOthers($: EngineInterface, by: number): Promise<boolean> {
  const value = await read($, notes)
  if (value === null) return false
  const { notesOthers } = await heldSettings($)
  const count = othersOf(value).length
  const stored = await read($, notesOthersAt)
  const from = othersStart(stored, count, notesOthers)
  const moved = othersStart(from + by, count, notesOthers)
  if (moved !== stored) await update($, notesOthersAt, () => moved)
  return moved !== from
}

async function pressed($: EngineInterface, action: NotesPress): Promise<void> {
  if ('retry' in action) return tryNotes($)
  if ('paste' in action) return pasteClipboard($, action.paste)
  if ('scroll' in action) {
    await scrollOthers($, action.scroll)
    return
  }
  if ('erase' in action) {
    await save($, 'session', action.erase, '')
    // Its links too, once it is gone: the current session's own note emptied
    // keeps them, written on again under the same session.
    await forgetLinks($, action.erase)
    return setView($, { tab: 'session' })
  }
  return setView($, action.view)
}

export function registerNotes(on: On): void {
  on('ui.open', async ($, e, next) => {
    if (e.id === PANEL && (await panelView($)) === 'notes') await openingTab($)

    return next(e)
  })

  // A `/clear` empties the conversation, not the session: its note goes on
  // under the new session id the engine gives. Any other end (a `/resume`
  // within the process among them) follows no `/clear`: one remembered is
  // forgotten, never linked to the session that comes next.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await noteClear($, e.sessionId).catch(() => undefined)
    else forgetClear()

    return next(e)
  })

  // Each change the editor posts, with the last paste it took.
  on('ui.message', { module: /editor\.tsx$/, requestId: PANEL }, async ($, e, next) => {
    const data = e.data as { tab?: unknown; session?: unknown; text?: unknown; refused?: unknown; pasted?: unknown }
    if (!isTab(data.tab) || typeof data.session !== 'string') return next(e)
    if (typeof data.pasted === 'number') await pasteTaken($, data.pasted)
    if (data.refused === 'too-long' || data.refused === 'store-full') {
      await refuse($, data.tab, data.session, data.refused === 'too-long' ? TOO_LONG : STORE_FULL)
      return {}
    }
    if (typeof data.text !== 'string') return next(e)
    await save($, data.tab, data.session, data.text)

    return {}
  })

  // The wheel over the list of other sessions scrolls it, `notesOthers` rows
  // shown still; elsewhere in the pane, or the list unable to move that way,
  // it moves the pane's window as ever.
  on('ui.scroll', { component: 'Pane', requestId: PANEL }, async ($, e, next) => {
    const list = othersList
    if (list === undefined || e.pointer === undefined || (await panelView($)) !== 'notes') return next(e)
    const row = e.pointer.row + list.offset
    if (row < list.first || row >= list.end) return next(e)
    if (!(await scrollOthers($, e.by).catch(() => false))) return next(e)

    return {}
  })

  // The notes' tab atop the panel (../activity's paneTabs): in front, it does
  // nothing.
  on('ui.message', { module: /press\.tsx$/, requestId: PANEL, element: 'pane-notes' }, async $ => {
    if ((await panelView($)) !== 'notes') await showNotes($)

    return {}
  })

  // Each press in the pane.
  on('ui.message', { module: /press\.tsx$/, requestId: PANEL, element: /^notes:/ }, async ($, e) => {
    const action = pressActions.get(e.element)
    if (action !== undefined) await pressed($, action)

    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e, next) => {
    // A Client is drawn there alone.
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    if ((await panelView($)) !== 'notes') return next(e)
    // Read so that notesTick, seeing the note changed in the store, redraws it.
    await read($, notesSeen)
    // Read afresh when not loaded, or loaded for another session id, as after
    // a `/clear` with the pane open: a render writes nothing, the next load
    // keeps them. A failed load waits for a retry.
    let value = await read($, notes)
    let reason = await read($, notesError)
    const id = await $.session.id().catch(() => value?.id)
    let restored: NotesView | undefined
    if (needsLoad(value, reason, id, false)) {
      try {
        value = await readNotes($, false)
        // The tab a `/clear` left, the emptied one standing until kept.
        restored = await clearedView($)
        reason = null
      } catch (error) {
        value = null
        reason = errorText(error)
      }
    }
    const { Box, Client, Text } = $.ui.resolve(e)
    const { tabs: panes, rows: panesRows, actions: paneActions } = await paneTabs($, e, 'notes', e.props.bodyColumns)
    // The presses drawn, whose actions take pressActions' place as the tree is
    // returned.
    const { actions: presses, press } = pressBoard<NotesPress>(Client, 'notes:')

    // Not loaded: what failed, and a retry, never a blank pane.
    if (value === null) {
      const unavailable = (
        <Box flexDirection="column">
          {panes}
          <Text key="unavailable" color="error" wrap="wrap">{`Notes indisponibles${reason === null ? '' : ` : ${reason}`}`}</Text>
          <Box key="retry-row" flexShrink={0}>
            {press('retry', { retry: true }, [{ text: '↻ Réessayer', color: 'claude' }], { underline: true })}
          </Box>
        </Box>
      )
      pressActions = presses
      keepTaskTabs(paneActions)
      othersList = undefined
      return unavailable
    }

    const view = restored ?? (await read($, notesView))
    const options = await heldSettings($)
    const unsavedNote = await read($, notesUnsaved)
    const othersAt = await read($, notesOthersAt)

    const other = view.tab === 'session' ? view.other : undefined
    const { session, key } = shownNote(value, view)
    // Why this note, and no other, is not saved.
    const failed = unsavedFor(unsavedNote, key)
    const known = view.tab === 'global' ? value.global : view.tab === 'project' ? value.project : (value.sessions[session] ?? null)
    // As the store holds it: another session may have written it since. The
    // editor takes it as it opens; the last one written wins.
    const note = await $.store.get(key).then(noteOf, () => known)
    // The longest it may grow to, from the store's size as last estimated
    // (measured here only when not known yet): kept up to date by dx's own
    // writes, measured again after each load and, the store near full, as
    // notesTick polls.
    const max = noteMax(key, note?.text.length ?? 0, await storeRoom($))
    // Every other session's note, `notesOthers` listed at a time from where
    // the list was scrolled.
    const all = othersOf(value)
    const start = othersStart(othersAt, all.length, options.notesOthers)
    const others = all.slice(start, start + options.notesOthers)
    const listed = view.tab === 'session' && other === undefined && others.length > 0
    const scrolls = listed && all.length > others.length
    const project = value.root.split(/[\\/]/).filter(Boolean).at(-1) ?? value.root
    const subtitle = view.tab === 'global'
      ? 'Toutes les sessions'
      : view.tab === 'project'
        ? `Projet ${project}`
        : other !== undefined
          ? `Session du ${note === null ? '?' : dayTime(note.updatedAt)}`
          : 'Cette session'
    // The row under the sheet: this hint, and at its right the button that
    // pastes the system clipboard into the note at its editor's cursor, a
    // paste in the terminal going to the prompt box (drawn with an editor
    // alone).
    const hint = `${subtitle} · Échap rend le clavier au prompt`
    // The panel's tabs and their margin, the notes' tabs, why a save failed,
    // the way back from another session's note, the sheet's border and
    // margin, its hint (one row, cut), and the list of other sessions with
    // its title and margin.
    const extra = panesRows + 5 + (failed !== null ? 1 : 0) + (other !== undefined ? 1 : 0) + (listed ? others.length + 2 : 0)
    const rows = Math.max(3, e.props.scroll.bodyRows - extra)
    // The list's title and rows, last in the tree.
    const end = rows + extra
    const othersRows = listed ? { first: end - others.length - 1, end, offset: e.props.scroll.offset } : undefined
    // A paste for this note its editor has not posted taken, given to the
    // editor shown, a new one too (a tab shown again, the pane reopened).
    // Read after the note: the post that takes a paste lets it go before its
    // text is saved, so a paste read here is never in the note read above.
    const pending = await read($, notesPaste)
    const paste: EditorPaste | null = pending?.key === key ? { seq: pending.seq, text: pending.text, isTooLong: false } : null
    const shownEditor: EditorProps = {
      text: note?.text ?? '',
      max,
      rows,
      placeholder: 'Cliquer pour écrire. Ces notes restent hors du contexte de Claude.',
      tab: view.tab,
      session,
      paste,
    }
    // Measured against the note as stored now, which another session may have
    // lengthened since the paste was read: past what the editor can take, the
    // paste is given without its text, for the editor to refuse it and post
    // it taken, the pane then saying the note too long (a render writes
    // nothing).
    const editor = paste === null || fitsEditor(shownEditor) ? shownEditor : { ...shownEditor, paste: { ...paste, text: '', isTooLong: true } }
    // A note the editor cannot take is said so in its place, kept as stored,
    // its length counted as NOTE_MAX_CHARS is: drawn, the Client would fail
    // the whole pane.
    const isEditable = fitsEditor(editor)
    const sheet = isEditable
      ? <Client key={`note-${view.tab}-${session}`} module="./editor.tsx" props={editor} height={rows} />
      : (
        <Box key="too-long" height={rows}>
          <Text color="warning" wrap="wrap">
            {`Note trop longue pour être modifiée ici (${thousands(encodedLength(editor.text))} caractères) : elle reste enregistrée telle quelle.`}
          </Text>
        </Box>
      )

    const tabs = NOTE_TABS.map(([tab, label]) => {
      const isShown = tab === view.tab
      return press(`tab-${tab}`, { view: { tab } }, [
        { text: ` ${label} `, color: isShown ? 'claude' : 'subtle', inverse: isShown, bold: isShown },
      ], { bold: true })
    })

    const tree = (
      <Box flexDirection="column">
        {panes}
        <Box key="tabs" flexShrink={0} justifyContent="space-between">
          <Box gap={1}>{tabs}</Box>
          {failed !== null
            ? <Text color="error" bold>{isClipboardError(failed) ? '⚠ collage impossible' : '⚠ non enregistré'}</Text>
            : <Text dimColor>{note === null ? 'vide' : `✓ ${dayTime(note.updatedAt)}`}</Text>}
        </Box>
        {failed !== null && <Text key="unsaved" color="error" wrap="truncate-end">{failed}</Text>}
        {other !== undefined && (
          <Box key="other" flexShrink={0} gap={2}>
            {press('back', { view: { tab: 'session' } }, [{ text: '← Session actuelle', color: 'claude' }], { underline: true })}
            {press('delete', { erase: other }, [{ text: '✕ Supprimer cette note', color: 'error' }], { underline: true })}
          </Box>
        )}
        <Box key="sheet" flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1} marginTop={1}>
          {sheet}
        </Box>
        <Box key="hint" flexShrink={0} justifyContent="space-between" gap={1}>
          <Box flexShrink={1}>
            <Text dimColor wrap="truncate-end">{hint}</Text>
          </Box>
          {isEditable && press('paste', { paste: { key, tab: view.tab, session } }, [{ text: 'Coller', color: 'claude' }], { underline: true })}
        </Box>
        {listed && (
          <Box key="others" flexDirection="column" marginTop={1}>
            <Box key="others-title" flexShrink={0} justifyContent="space-between">
              <Text bold color="claude">Autres sessions</Text>
              {scrolls && (
                <Box>
                  <Text dimColor>{`${start + 1}–${start + others.length} / ${all.length} `}</Text>
                  {press('others-up', { scroll: -others.length }, [
                    { text: ' ▲ ', color: start > 0 ? 'claude' : 'subtle' },
                  ], { inverse: true })}
                  {press('others-down', { scroll: others.length }, [
                    { text: ' ▼ ', color: start + others.length < all.length ? 'claude' : 'subtle' },
                  ], { inverse: true })}
                </Box>
              )}
            </Box>
            {others.map(([id, one]) =>
              press(`session-${id}`, { view: { tab: 'session', other: id } }, [
                { text: `${dayTime(one.updatedAt)}  `, dimColor: true },
                { text: firstLine(one.text, e.props.bodyColumns) },
              ], { backgroundColor: 'subtle' }, e.props.bodyColumns),
            )}
          </Box>
        )}
      </Box>
    )
    // What the presses and the wheel act on, taken up with nothing awaited any
    // more: it matches the tree returned, never mixed with another render's.
    pressActions = presses
    keepTaskTabs(paneActions)
    othersList = othersRows
    return tree
  })
}
