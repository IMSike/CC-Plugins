import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { Note, Notes, NoteTab, NotesView } from '../../types'
import { paneTabs } from './activity'
import type { EditorProps } from './editor'
import { dayTime } from './format'
import { DEFAULT_SETTINGS, NOTE_TABS } from './options'
import { clearedView, ensureNotes, GLOBAL_KEY, noteClear, noteOf, PROJECT_PREFIX, readNotes, SESSION_PREFIX, tryNotes } from './notes-load'
import { PANEL, panelView, togglePanel } from './panes'

// The notes pane: three notes of the person's own, one for every session, one
// for the project, one for this session, kept in `$.store` across sessions.
// The model never sees a pane, so the notes stay out of its context.
// The notes are loaded by ./notes-load, which keeps why its last load failed.
const notes = atom({ plugin: 'dx', key: 'notes' } as const, null as Notes | null, { shape: 'notes-2' })
const notesError = atom({ plugin: 'dx', key: 'notesError' } as const, null as string | null, { shape: 'notes-error-1' })
const notesView = atom({ plugin: 'dx', key: 'notesView' } as const, { tab: 'global' } as NotesView, { shape: 'notes-view-1' })
// What the band shows, set in ./settings: the notes' tab and list here.
const settings = atom({ plugin: 'dx', key: 'settings' } as const, DEFAULT_SETTINGS, { shape: 'settings-1' })

// The last tab shown, taken up again by the next pane (a setting).
const TAB_KEY = 'notesTab'

function isTab(value: unknown): value is NoteTab {
  return value === 'global' || value === 'project' || value === 'session'
}

// Called once the session has started: every note, and the tab a pane opens on.
export async function loadNotes($: EngineInterface): Promise<void> {
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

// Keeps a note as it now reads, at once: an emptied one is deleted.
async function save($: EngineInterface, tab: NoteTab, session: string, text: string): Promise<void> {
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

export async function toggleNotes($: EngineInterface): Promise<void> {
  await togglePanel($, 'notes')
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
    const { Box, Button, Client, Text } = $.ui.resolve(e)
    const { tabs: panes, rows: panesRows } = await paneTabs($, e, 'notes', e.props.bodyColumns)

    // Not loaded: what failed, and a retry, never a blank pane.
    if (value === null) {
      return (
        <Box flexDirection="column">
          {panes}
          <Text key="unavailable" color="error" wrap="wrap">{`Notes indisponibles${reason === null ? '' : ` : ${reason}`}`}</Text>
          <Box key="retry-row" flexShrink={0}>
            <Button key="retry" plain hover={{ underline: true }} onPress={() => tryNotes($)}>
              <Text color="claude">↻ Réessayer</Text>
            </Button>
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
    const setView = async (shown: NotesView) => {
      // Kept first: notes drawn afresh after a `/clear` show the tab it left.
      await ensureNotes($)
      await update($, notesView, () => shown)
      await $.store.set(TAB_KEY, shown.tab).catch(() => undefined)
    }
    const editor: EditorProps = {
      text: note?.text ?? '',
      rows,
      placeholder: 'Cliquer pour écrire. Ces notes restent hors du contexte de Claude.',
      tab: view.tab,
      session,
    }

    const tabs = NOTE_TABS.map(([tab, label]) => {
      const isShown = tab === view.tab
      return (
        <Button key={`tab-${tab}`} plain hover={{ bold: true }} onPress={() => setView({ tab })}>
          <Text color={isShown ? 'claude' : 'subtle'} inverse={isShown} bold={isShown}>{` ${label} `}</Text>
        </Button>
      )
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
            <Button key="back" plain hover={{ underline: true }} onPress={() => setView({ tab: 'session' })}>
              <Text color="claude">← Session actuelle</Text>
            </Button>
            <Button key="delete" plain hover={{ underline: true }} onPress={async () => {
              await save($, 'session', other, '')
              await setView({ tab: 'session' })
            }}>
              <Text color="error">✕ Supprimer cette note</Text>
            </Button>
          </Box>
        )}
        <Box key="sheet" flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1} marginTop={1}>
          <Client key={`note-${view.tab}-${session}`} module="./editor.tsx" props={editor} height={rows} />
        </Box>
        <Text dimColor wrap="truncate-end">{hint}</Text>
        {listed && (
          <Box key="others" flexDirection="column" marginTop={1}>
            <Text bold color="claude">Autres sessions</Text>
            {others.map(([id, one]) => (
              <Button key={`session-${id}`} plain hover={{ backgroundColor: 'subtle' }} onPress={() => setView({ tab: 'session', other: id })}>
                <Text wrap="truncate-end"><Text dimColor>{`${dayTime(one.updatedAt)}  `}</Text>{one.text.split('\n')[0]}</Text>
              </Button>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
