import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { Note, Notes, NoteTab, NotesView } from '../../types'
import { paneTabs } from '../activity/activity'
import { dayTime } from '../shared/format'
import { DEFAULT_SETTINGS, NOTE_TABS } from '../shared/options'
import { isShowing, PANEL, panelView, togglePanel } from '../shared/panes'
import type { PressPart, PressProps, PressStyle } from '../shared/press'
import type { EditorProps } from './editor'
import { NOTE_MAX_CHARS } from './editor-model'
import { clearedView, ensureNotes, forgetClear, forgetLinks, keyOf, needsLoad, noteClear, noteOf, readNotes, shownNote, tryNotes } from './notes-load'
import { fitsStore, storeWritten } from './store-size'

// The notes pane: three notes of the person's own, one for every session, one
// for the project, one for this session, kept in `$.store` across sessions.
// The model never sees a pane, so the notes stay out of its context.
// The notes are loaded by ./notes-load, which keeps why its last load failed.
const notes = atom({ plugin: 'dx', key: 'notes' } as const, null as Notes | null, { shape: 'notes-2' })
const notesError = atom({ plugin: 'dx', key: 'notesError' } as const, null as string | null, { shape: 'notes-error-1' })
const notesView = atom({ plugin: 'dx', key: 'notesView' } as const, { tab: 'global' } as NotesView, { shape: 'notes-view-1' })
// What the band shows, set in ../settings/settings: the notes' tab and list here.
const settings = atom({ plugin: 'dx', key: 'settings' } as const, DEFAULT_SETTINGS, { shape: 'settings-3' })
// The note shown, as the store last held it: drawn again when it changes there.
const notesSeen = atom({ plugin: 'dx', key: 'notesSeen' } as const, null as string | null, { shape: 'notes-seen-1' })
// Why the last save failed, or the last edit was refused: null once a save
// succeeds.
const notesUnsaved = atom({ plugin: 'dx', key: 'notesUnsaved' } as const, null as string | null, { shape: 'notes-unsaved-1' })
// The first of the other sessions' notes listed, the list scrolled.
const notesOthersAt = atom({ plugin: 'dx', key: 'notesOthersAt' } as const, 0, { shape: 'notes-others-at-1' })

// The last tab shown, taken up again by the next pane (a setting).
const TAB_KEY = 'notesTab'

function isTab(value: unknown): value is NoteTab {
  return value === 'global' || value === 'project' || value === 'session'
}

// Called once the session has started: every note, and the tab a pane opens on.
export async function loadNotes($: EngineInterface): Promise<void> {
  forgetClear()
  await tryNotes($)
  await openingTab($)
}

// The tab a pane opens on: the last one shown, or the one set.
async function openingTab($: EngineInterface): Promise<void> {
  const { notesTab, resumeNotesTab } = await read($, settings)
  const last = resumeNotesTab ? await $.store.get(TAB_KEY).catch(() => undefined) : undefined
  await update($, notesView, () => ({ tab: isTab(last) ? last : notesTab }))
}

// The saves in flight, one after another: each change the editor posts is a
// `ui.message` of its own, which the engine may run while an earlier one still
// waits on the store, its older text then written last.
let saving: Promise<void> = Promise.resolve()

// Keeps a note as it now reads, once the saves before it are done.
function save($: EngineInterface, tab: NoteTab, session: string, text: string): Promise<void> {
  const run = saving.then(() => write($, tab, session, text))
  saving = run.catch(() => undefined)
  return run
}

// Why a note was not saved, as the pane says it.
export const TOO_LONG = 'note trop longue (95 000 caractères au plus)'
export const STORE_FULL = "store presque plein : supprimez d'anciennes notes"

// A save failed, or an edit was refused: the pane says why until a save
// succeeds. A handler's write, never a render's.
async function unsaved($: EngineInterface, reason: string | null): Promise<void> {
  if ((await read($, notesUnsaved)) !== reason) await update($, notesUnsaved, () => reason)
}

// Writes `note` under `key`, `null` deleting it: why it was not, or null.
async function kept($: EngineInterface, key: string, note: Note | null): Promise<string | null> {
  if (note !== null && note.text.length > NOTE_MAX_CHARS) return TOO_LONG
  if (!(await fitsStore($, key, note))) return STORE_FULL
  try {
    await (note === null ? $.store.delete(key) : $.store.set(key, note))
  } catch (error) {
    return `store : ${error instanceof Error ? error.message : String(error)}`
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
    return unsaved($, `notes non chargées${error === null ? '' : ` : ${error}`}`)
  }
  const key = keyOf(value, tab, session)
  const reason = await kept($, key, note)
  await unsaved($, reason)
  if (reason !== null) return
  await update($, notes, current => {
    if (current === null) return current
    if (tab === 'global') return { ...current, global: note }
    if (tab === 'project') return { ...current, project: note }
    const { [session]: _, ...others } = current.sessions
    return { ...current, sessions: note === null ? others : { ...others, [session]: note } }
  })
}

// How often the note shown is read again from the store while its pane is
// open: another session writing it shows here within that time.
export const NOTES_POLL_MS = 1000

// Draws the pane again when another session changed the note it shows: the
// store has no event of its own, and the editor takes the new text. The pane
// reads `notesSeen`: writing it redraws the pane alone.
export async function notesTick($: EngineInterface): Promise<void> {
  // The view first, a plain read: `isShowing` lists the panes.
  if ((await panelView($)) !== 'notes' || !(await isShowing($, 'notes'))) return
  const value = await read($, notes)
  if (value === null) return
  const { key } = shownNote(value, await read($, notesView))
  const stored = noteOf(await $.store.get(key).catch(() => undefined))
  const seen = `${key} ${stored?.updatedAt ?? 0}`
  if ((await read($, notesSeen)) === seen) return
  await update($, notesSeen, () => seen)
}

export async function toggleNotes($: EngineInterface): Promise<void> {
  await togglePanel($, 'notes')
}

// Shows a tab, or another session's note, and keeps it as the last one shown.
async function setView($: EngineInterface, shown: NotesView): Promise<void> {
  // Kept first: notes drawn afresh after a `/clear` show the tab it left.
  await ensureNotes($)
  await update($, notesView, () => shown)
  await $.store.set(TAB_KEY, shown.tab).catch(() => undefined)
}

// What each press drawn in the pane (../shared/press.tsx) does, by its key: a
// view to show, a retry of the load, or another session's note to delete.
// Rebuilt as the pane draws, it holds the drawn ones alone. Every key starts
// with `notes:`, which the press hook matches.
type NotesPress = { view: NotesView } | { retry: true } | { erase: string } | { scroll: number }
let PRESSES = new Map<string, NotesPress>()

// The other sessions' notes, latest first.
function othersOf(value: Notes): [string, Note][] {
  return Object.entries(value.sessions)
    .filter(([id]) => id !== value.session)
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
}

// The first of `count` notes listed, `shown` rows at a time from `at`: kept
// within the list, its last row at the window's last.
export function othersStart(at: number, count: number, shown: number): number {
  return Math.max(0, Math.min(at, count - shown))
}

// Where the list of other sessions stands in the pane's tree, as last drawn:
// its title's row and the row past its last; `offset`, the pane's window then.
// Read by the wheel, which says the body's row it is over.
let OTHERS_ROWS: { first: number; end: number; offset: number } | undefined

// The list of other sessions moved `by` rows, kept within it: whether it
// moved, which it cannot with every note shown, or at its end that way.
async function scrollOthers($: EngineInterface, by: number): Promise<boolean> {
  const value = await read($, notes)
  if (value === null) return false
  const { notesOthers } = await read($, settings)
  const count = othersOf(value).length
  const stored = await read($, notesOthersAt)
  const from = othersStart(stored, count, notesOthers)
  const moved = othersStart(from + by, count, notesOthers)
  if (moved !== stored) await update($, notesOthersAt, () => moved)
  return moved !== from
}

async function pressed($: EngineInterface, action: NotesPress): Promise<void> {
  if ('retry' in action) return tryNotes($)
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

  // Each change the editor posts.
  on('ui.message', { module: /editor\.tsx$/ }, async ($, e, next) => {
    if (e.requestId !== PANEL) return next(e)
    const data = e.data as { tab?: unknown; session?: unknown; text?: unknown; refused?: unknown }
    if (!isTab(data.tab) || typeof data.session !== 'string') return next(e)
    // An edit the editor did not apply, the note too long: said in its turn
    // among the saves, which a later one clears.
    if (data.refused === 'too-long') {
      const run = saving.then(() => unsaved($, TOO_LONG))
      saving = run.catch(() => undefined)
      await run
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
    const list = OTHERS_ROWS
    if (list === undefined || e.pointer === undefined || (await panelView($)) !== 'notes') return next(e)
    const row = e.pointer.row + list.offset
    if (row < list.first || row >= list.end) return next(e)
    if (!(await scrollOthers($, e.by).catch(() => false))) return next(e)

    return {}
  })

  // Each press in the pane.
  on('ui.message', { module: /press\.tsx$/, requestId: PANEL, element: /^notes:/ }, async ($, e) => {
    const action = PRESSES.get(e.element)
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
        reason = error instanceof Error ? error.message : String(error)
      }
    }
    const { Box, Client, Text } = $.ui.resolve(e)
    const { tabs: panes, rows: panesRows } = await paneTabs($, e, 'notes', e.props.bodyColumns)
    // A press drawn by ../shared/press.tsx: the terminal selects nothing however
    // the clicks come. `width`: the label cut there. Kept in `presses`, which
    // takes PRESSES' place as the tree is returned.
    const presses = new Map<string, NotesPress>()
    const press = (key: string, action: NotesPress, parts: PressPart[], hover: PressStyle, width?: number) => {
      presses.set(`notes:${key}`, action)
      const props: PressProps = { parts, hover, truncate: width !== undefined }
      return <Client key={`notes:${key}`} module="../shared/press.tsx" props={props} width={width} height={1} />
    }

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
      PRESSES = presses
      OTHERS_ROWS = undefined
      return unavailable
    }

    const view = restored ?? (await read($, notesView))
    const options = await read($, settings)
    const failed = await read($, notesUnsaved)
    const othersAt = await read($, notesOthersAt)

    const other = view.tab === 'session' ? view.other : undefined
    const { session, key } = shownNote(value, view)
    const known = view.tab === 'global' ? value.global : view.tab === 'project' ? value.project : (value.sessions[session] ?? null)
    // As the store holds it: another session may have written it since. The
    // editor takes it as it opens; the last one written wins.
    const note = await $.store.get(key).then(noteOf, () => known)
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
    const hint = `${subtitle} · Échap rend le clavier au prompt`
    // The panel's tabs and their margin, the notes' tabs, why a save failed,
    // the sheet's border and margin, its hint (one row, cut), and the list of
    // other sessions.
    const extra = panesRows + 5 + (failed !== null ? 1 : 0) + (other !== undefined ? 1 : 0) + (listed ? others.length + 2 : 0)
    const rows = Math.max(3, e.props.scroll.bodyRows - extra)
    // The list's title and rows, last in the tree.
    const end = rows + extra
    const othersRows = listed ? { first: end - others.length - 1, end, offset: e.props.scroll.offset } : undefined
    const editor: EditorProps = {
      text: note?.text ?? '',
      rows,
      placeholder: 'Cliquer pour écrire. Ces notes restent hors du contexte de Claude.',
      tab: view.tab,
      session,
    }

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
            ? <Text color="error" bold>⚠ non enregistré</Text>
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
          <Client key={`note-${view.tab}-${session}`} module="./editor.tsx" props={editor} height={rows} />
        </Box>
        <Text dimColor wrap="truncate-end">{hint}</Text>
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
                { text: one.text.split('\n')[0] ?? '' },
              ], { backgroundColor: 'subtle' }, e.props.bodyColumns),
            )}
          </Box>
        )}
      </Box>
    )
    // What the presses and the wheel act on, taken up with nothing awaited any
    // more: it matches the tree returned, never mixed with another render's.
    PRESSES = presses
    OTHERS_ROWS = othersRows
    return tree
  })
}
