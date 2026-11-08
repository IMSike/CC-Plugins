import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

// What dx's integration tests share: the engine beneath the plugin, the
// drawings they mount and the acts they repeat. Imported by the *.test.tsx
// files alone, never by the hooks module.

export const NOW = Date.parse('2026-10-25T10:00:00Z')

export const BAND = {
  plugin: 'dx',
  component: 'AbovePrompt',
  surface: 'terminal',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 60,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

// The engine beneath the plugin: a session on Opus started an hour ago, in a
// repository on `dev`; context at 12%, 5-hour window at 20% resetting in 3h24,
// 7-day window at 90% resetting in 1j15h. Each option changes that.
type EngineOptions = {
  // false: no rate limits reported.
  rateLimits?: boolean
  // The session's agents.
  agents?: unknown[]
  // More files to read, by the end of their path.
  files?: Record<string, string>
  // What dx's store holds.
  stored?: Record<string, unknown>
  // false: the 5-hour window has not started.
  fiveHour?: boolean
  // Calls refused, as by a session not there yet; `store.set <key>`, the
  // store's writes under that key.
  refused?: ReadonlySet<string>
  // `session.id` and its start, which a test changes as a `/clear` does.
  session?: { id: string; startedAt?: number }
}

export function engine(on: On, options: EngineOptions = {}) {
  const {
    rateLimits = true,
    agents = [],
    files = {},
    stored = {},
    fiveHour = true,
    refused = new Set<string>(),
    session = { id: 's1' },
  } = options
  // dx's store, read back by the tests.
  const store = new Map(Object.entries(stored))
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    // A full store refuses the notes.
    if (refused.has('store.set') && e.key.startsWith('notes.')) return { deny: 'store over 4 MiB' }
    // A write refused under that key alone.
    if (refused.has(`store.set ${e.key}`)) return { deny: 'disk full' }
    store.set(e.key, e.value)

    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    store.delete(e.key)

    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('session.root', () => (refused.has('session.root') ? { deny: 'session not ready' } : { value: String.raw`C:\Users\dev\repo\app` }))
  mock.env(on, { USERPROFILE: String.raw`C:\Users\dev`, TEMP: String.raw`C:\Users\dev\AppData\Local\Temp` })
  on('session.id', () => (refused.has('session.id') ? { deny: 'session not ready' } : { value: session.id }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.cwd', () => ({ value: String.raw`C:\Users\dev\repo\app` }))
  on('settings.read', () => ({ value: { effortLevel: 'xhigh' } }))
  // Off Windows, the engine resolves the path against its own directory first.
  on('fs.read', (_, e) => {
    const path = e.path.replace(/\\/g, '/')
    if (path.endsWith('C:/Users/dev/repo/app/.git/HEAD')) return { value: 'ref: refs/heads/dev\n' }
    const file = Object.keys(files).find(end => path.endsWith(end))

    return file === undefined ? { deny: 'ENOENT' } : { value: files[file] ?? '' }
  })
  // The repository's `.git`, and the files above.
  on('fs.exists', (_, e) => {
    const path = e.path.replace(/\\/g, '/')
    return { value: path.endsWith('C:/Users/dev/repo/app/.git') || Object.keys(files).some(end => path.endsWith(end)) }
  })
  on('session.usage', () => ({
    value: {
      startedAt: session.startedAt ?? NOW - 3600_000,
      context: { window: 200000, tokens: 24000, percent: 12 },
      rateLimits: rateLimits
        ? [
            ...(fiveHour ? [{ kind: 'five_hour', percentUsed: 20, resetsAt: '2026-10-25T13:24:00Z' }] : []),
            { kind: 'seven_day', percentUsed: 90, resetsAt: '2026-10-27T01:00:00Z' },
          ]
        : [],
    },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('agent.list', () => ({ value: agents as never }))
  // No process list: tasks are followed from the engine's signals alone.
  on('process.run', () => ({ deny: 'no process in tests' }))

  return store
}

// A click on a pressable: a press and a release over a Client of ./press.tsx,
// which the terminal draws for what is pressed inside the panel; a press on a
// Button, which the band keeps.
type Pointed = { type: 'down' | 'up'; x: number; y: number; button: 'left'; in: string }
type Clickable = {
  find: (query: { key: string }) => Promise<{ type: string } | undefined>
  press: (target: { key: string }) => Promise<unknown>
  pointer?: (event: Pointed) => Promise<void>
}
export async function click(drawn: Clickable, key: string): Promise<void> {
  if ((await drawn.find({ key }))?.type !== 'Client' || drawn.pointer === undefined) {
    await drawn.press({ key })
    return
  }
  await drawn.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: key })
  await drawn.pointer({ type: 'up', x: 0, y: 0, button: 'left', in: key })
}

// The views the band asks for.
export function views(on: On) {
  const views: { agentId?: string }[] = []
  on('ui.view', (_, e) => {
    views.push(e)

    return { value: {} }
  })

  return views
}

// Where the engine writes the background shell `b1`'s output, in the session's
// tasks folder.
export const OUTPUT = { '/claude/C--Users-dev-repo-app/s1/tasks/b1.output': 'ready\nlistening on 3000\n' }

// A background shell `b1`, and the panes the band opens: dx's one panel.
export function shell(on: On) {
  const panes: string[] = []
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' } as never }))
  on('tool.call', { tool: 'TaskStop' }, () => ({ result: { message: 'stopped' } as never }))
  // The last opened is the tab in front.
  on('ui.panes', () => ({ value: panes.map((id, index) => ({ id, isShown: index === panes.length - 1 })) as never }))
  on('ui.open', (_, e) => {
    if (!panes.includes(e.id)) panes.push(e.id)

    return { value: { isPlaced: true } as never }
  })
  on('ui.close', (_, e) => {
    panes.splice(panes.indexOf(e.id), 1)

    return { value: undefined }
  })

  return panes
}

export const PANE = {
  plugin: 'dx',
  component: 'Pane',
  surface: 'terminal',
  requestId: 'dx-panel',
  props: { title: 'Terminal', isFocused: false, bodyColumns: 60, placement: 'inline', scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

export type Mounted = {
  findAll: (query: { type: string; text: RegExp; in: string }) => Promise<{ props: { color?: string; bold?: boolean } }[]>
}

// The colors of the top border's line, but where a glint lights it.
export async function frameColors(ui: Mounted) {
  return (await ui.findAll({ type: 'Text', text: /─/, in: 'frame-top' })).map(text => text.props.color)
}

export const SETTINGS_PANE = { ...PANE, props: { ...PANE.props, title: 'Réglages', scroll: { offset: 0, bodyRows: 40 } } } as const
export const NOTES_PANE = { ...PANE, props: { ...PANE.props, title: 'Notes', scroll: { offset: 0, bodyRows: 20 } } } as const

// The band's settings icon pressed: the panel on the settings.
export async function showSettings($: Engine) {
  const band = await $.ui.mount(BAND)
  await click(band, 'settings')
  await band.unmount()

  return $.ui.mount(SETTINGS_PANE)
}
