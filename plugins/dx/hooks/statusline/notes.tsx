import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { Note, Notes, NoteTab, NotesView } from '../../types'
import { paneTabs } from './activity'
import type { EditorProps } from './editor'
import { dayTime } from './format'
import { DEFAULT_SETTINGS, NOTE_TABS } from './options'
import { PANEL, panelView, togglePanel } from './panes'

// The notes pane: three notes of the person's own, one for every session, one
// for the project, one for this session, kept in `$.store` across sessions.
// The model never sees a pane, so the notes stay out of its context.
const notes = atom({ plugin: 'dx', key: 'notes' } as const, null as Notes | null, { shape: 'notes-1' })
const notesView = atom({ plugin: 'dx', key: 'notesView' } as const, { tab: 'global' } as NotesView, { shape: 'notes-view-1' })
// What the band shows, set in ./settings: the notes' tab and list here.
const settings = atom({ plugin: 'dx', key: 'settings' } as const, DEFAULT_SETTINGS, { shape: 'settings-1' })

const GLOBAL_KEY = 'notes.global'
const PROJECT_PREFIX = 'notes.project.'
const SESSION_PREFIX = 'notes.session.'
// The last tab shown, taken up again by the next pane (a setting).
const TAB_KEY = 'notesTab'

function noteOf(stored: unknown): Note | null {
  const value = stored as Partial<Note> | undefined
  return typeof value?.text === 'string' && value.text !== '' && typeof value.updatedAt === 'number'
    ? { text: value.text, updatedAt: value.updatedAt }
    : null
}

function isTab(value: unknown): value is NoteTab {
  return value === 'global' || value === 'project' || value === 'session'
}

// Called once the session has started: every note, this session's included
// when the session is a resumed one.
export async function loadNotes($: EngineInterface): Promise<void> {
  const [root, session, keys] = await Promise.all([
    $.session.root(),
    $.session.id(),
    $.store.keys().catch(() => [] as string[]),
  ])
  const get = (key: string) => $.store.get(key).then(noteOf).catch(() => null)
  const sessions: Record<string, Note> = {}
  for (const key of keys.filter(one => one.startsWith(SESSION_PREFIX))) {
    const note = await get(key)
    if (note !== null) sessions[key.slice(SESSION_PREFIX.length)] = note
  }
  const value: Notes = { global: await get(GLOBAL_KEY), project: await get(PROJECT_PREFIX + root), sessions, root, session }
  await update($, notes, () => value)
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

  // Each change the editor posts.
  on('ui.message', { module: /editor\.tsx$/ }, async ($, e, next) => {
    if (e.requestId !== PANEL) return next(e)
    const data = e.data as { tab?: unknown; session?: unknown; text?: unknown }
    if (!isTab(data.tab) || typeof data.session !== 'string' || typeof data.text !== 'string') return next(e)
    await save($, data.tab, data.session, data.text)

    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e, next) => {
    const value = await read($, notes)
    // A Client is drawn there alone.
    if (value === null || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e)
    if ((await panelView($)) !== 'notes') return next(e)
    const view = await read($, notesView)
    const options = await read($, settings)
    const { Box, Button, Client, Text } = $.ui.resolve(e)
    const { tabs: panes, rows: panesRows } = await paneTabs($, e, 'notes', e.props.bodyColumns)

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
