import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { Note, Notes, NoteTab, NotesView } from '../../types'
import { paneTabs } from './activity'
import type { EditorProps } from './editor'
import { dayTime } from './format'
import { DEFAULT_SETTINGS, NOTE_TABS } from './options'
import { clearedView, ensureNotes, forgetClear, GLOBAL_KEY, noteClear, noteOf, PROJECT_PREFIX, readNotes, SESSION_PREFIX, tryNotes } from './notes-load'
import { isShowing, PANEL, panelView, togglePanel } from './panes'
import type { PressPart, PressProps, PressStyle } from './press'

// The notes pane: three notes of the person's own, one for every session, one
// for the project, one for this session, kept in `$.store` across sessions.
// The model never sees a pane, so the notes stay out of its context.
// The notes are loaded by ./notes-load, which keeps why its last load failed.
const notes = atom({ plugin: 'dx', key: 'notes' } as const, null as Notes | null, { shape: 'notes-2' })
const notesError = atom({ plugin: 'dx', key: 'notesError' } as const, null as string | null, { shape: 'notes-error-1' })
const notesView = atom({ plugin: 'dx', key: 'notesView' } as const, { tab: 'global' } as NotesView, { shape: 'notes-view-1' })
// What the band shows, set in ./settings: the notes' tab and list here.
const settings = atom({ plugin: 'dx', key: 'settings' } as const, DEFAULT_SETTINGS, { shape: 'settings-2' })
// The note shown, as the store last held it: drawn again when it changes there.
const notesSeen = atom({ plugin: 'dx', key: 'notesSeen' } as const, null as string | null, { shape: 'notes-seen-1' })

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

// Where a note is kept.
function keyOf(value: Notes, tab: NoteTab, session: string): string {
  return tab === 'global' ? GLOBAL_KEY : tab === 'project' ? PROJECT_PREFIX + value.root : SESSION_PREFIX + session
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

// Keeps a note as it now reads, at once: an emptied one is deleted.
async function write($: EngineInterface, tab: NoteTab, session: string, text: string): Promise<void> {
  const now = await $.clock.now()
  const note: Note | null = text === '' ? null : { text, updatedAt: now }
  // The pane may draw notes read afresh, not kept yet: kept first.
  await ensureNotes($)
  const value = await read($, notes)
  if (value === null) return
  const key = keyOf(value, tab, session)
  await update($, notes, current => {
    if (current === null) return current
    if (tab === 'global') return { ...current, global: note }
    if (tab === 'project') return { ...current, project: note }
    const { [session]: _, ...others } = current.sessions
    return { ...current, sessions: note === null ? others : { ...others, [session]: note } }
  })
  await (note === null ? $.store.delete(key) : $.store.set(key, note)).catch(() => undefined)
}

// How often the note shown is read again from the store while its pane is
// open: another session writing it shows here within that time.
export const NOTES_POLL_MS = 1000

// Draws the pane again when another session changed the note it shows: the
// store has no event of its own, and the editor takes the new text.
export async function notesTick($: EngineInterface): Promise<void> {
  if (!(await isShowing($, 'notes'))) return
  const value = await read($, notes)
  if (value === null) return
  const view = await read($, notesView)
  const session = view.tab === 'session' ? (view.other ?? value.session) : value.session
  const key = keyOf(value, view.tab, session)
  const stored = noteOf(await $.store.get(key).catch(() => undefined))
  const seen = `${key} ${stored?.updatedAt ?? 0}`
  if ((await read($, notesSeen)) === seen) return
  await update($, notesSeen, () => seen)
  $.ui.invalidate('ui.render')
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

// What each press drawn in the pane (./press.tsx) does, by its key: a view to
// show, a retry of the load, or another session's note to delete.
type NotesPress = { view: NotesView } | { retry: true } | { erase: string }
const PRESSES = new Map<string, NotesPress>()

async function pressed($: EngineInterface, action: NotesPress): Promise<void> {
  if ('retry' in action) return tryNotes($)
  if ('erase' in action) {
    await save($, 'session', action.erase, '')
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
  // under the new session id the engine gives.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await noteClear($, e.sessionId).catch(() => undefined)

    return next(e)
  })

  // Each change the editor posts.
  on('ui.message', { module: /editor\.tsx$/ }, async ($, e, next) => {
    if (e.requestId !== PANEL) return next(e)
    const data = e.data as { tab?: unknown; session?: unknown; text?: unknown }
    if (!isTab(data.tab) || typeof data.session !== 'string' || typeof data.text !== 'string') return next(e)
    await save($, data.tab, data.session, data.text)

    return {}
  })

  // Each press in the pane.
  on('ui.message', { module: /press\.tsx$/ }, async ($, e, next) => {
    if (e.requestId !== PANEL) return next(e)
    const action = PRESSES.get(e.element)
    if (action === undefined) return next(e)
    await pressed($, action)

    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e, next) => {
    // A Client is drawn there alone.
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    if ((await panelView($)) !== 'notes') return next(e)
    // Read afresh when not loaded, or loaded for another session id, as after
    // a `/clear` with the pane open: a render writes nothing, the next load
    // keeps them. A failed load waits for a retry.
    let value = await read($, notes)
    let reason = await read($, notesError)
    const id = await $.session.id().catch(() => value?.id)
    let restored: NotesView | undefined
    if (value === null ? reason === null : id !== value.id) {
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
    // A press drawn by ./press.tsx: the terminal selects nothing however the
    // clicks come. `width`: the label cut there.
    const press = (key: string, action: NotesPress, parts: PressPart[], hover: PressStyle, width?: number) => {
      PRESSES.set(key, action)
      const props: PressProps = { parts, hover, truncate: width !== undefined }
      return <Client key={key} module="./press.tsx" props={props} width={width} height={1} />
    }

    // Not loaded: what failed, and a retry, never a blank pane.
    if (value === null) {
      return (
        <Box flexDirection="column">
          {panes}
          <Text key="unavailable" color="error" wrap="wrap">{`Notes indisponibles${reason === null ? '' : ` : ${reason}`}`}</Text>
          <Box key="retry-row" flexShrink={0}>
            {press('retry', { retry: true }, [{ text: '↻ Réessayer', color: 'claude' }], { underline: true })}
          </Box>
        </Box>
      )
    }

    const view = restored ?? (await read($, notesView))
    const options = await read($, settings)

    const other = view.tab === 'session' ? view.other : undefined
    const session = other ?? value.session
    const known = view.tab === 'global' ? value.global : view.tab === 'project' ? value.project : (value.sessions[session] ?? null)
    // As the store holds it: another session may have written it since. The
    // editor takes it as it opens; the last one written wins.
    const note = await $.store.get(keyOf(value, view.tab, session)).then(noteOf, () => known)
    const others = Object.entries(value.sessions)
      .filter(([id]) => id !== value.session)
      .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
      .slice(0, options.notesOthers)
    const listed = view.tab === 'session' && other === undefined && others.length > 0
    const project = value.root.split(/[\\/]/).filter(Boolean).at(-1) ?? value.root
    const subtitle = view.tab === 'global'
      ? 'Toutes les sessions'
      : view.tab === 'project'
        ? `Projet ${project}`
        : other !== undefined
          ? `Session du ${note === null ? '?' : dayTime(note.updatedAt)}`
          : 'Cette session'
    const hint = `${subtitle} · Échap rend le clavier au prompt`
    // The panel's tabs and their margin, the notes' tabs, the sheet's border
    // and margin, its hint (one row, cut), and the list of other sessions.
    const extra = panesRows + 5 + (other !== undefined ? 1 : 0) + (listed ? others.length + 2 : 0)
    const rows = Math.max(3, e.props.scroll.bodyRows - extra)
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

    return (
      <Box flexDirection="column">
        {panes}
        <Box key="tabs" flexShrink={0} justifyContent="space-between">
          <Box gap={1}>{tabs}</Box>
          <Text dimColor>{note === null ? 'vide' : `✓ ${dayTime(note.updatedAt)}`}</Text>
        </Box>
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
            <Text bold color="claude">Autres sessions</Text>
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
  })
}
