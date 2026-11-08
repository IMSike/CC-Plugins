// Values the dx plugin keeps in `$.state` for the session.

export type Gauge = {
  // 0 to 100.
  percent: number
  // ISO 8601, when the window resets.
  resetsAt?: string
}

// What the status band draws, read from the engine at each refresh.
export type StatusSnapshot = {
  // As the band writes it: `Opus 5.5`.
  model: string
  // The effort the last main-loop request was sent with, else the one set.
  effort?: string
  // The working directory, the home directory written `~`.
  cwd: string
  // Git branch of the directory, or a short commit when detached.
  branch?: string
  // Context window used, in percent, and in tokens: absent before the first
  // response (and after a compaction, until the next one).
  context?: number
  contextTokens?: number
  // The model's context window, in tokens.
  contextWindow: number
  fiveHour?: Gauge
  sevenDay?: Gauge
  // When the session began (`$.session.usage()`), in `$.clock.now()` milliseconds.
  startedAt: number
  // `$.clock.now()` at the refresh: makes each refresh a new value, so the
  // countdowns are redrawn even when nothing else changed.
  refreshedAt: number
}

// An agent CLI found running in a background task.
export type CliAgent = 'claude' | 'cursor'

// A background shell or monitor, followed by its id.
export type Task = {
  id: string
  kind: 'shell' | 'monitor'
  // The command it runs: shown on its tab and in its terminal, and matched to
  // find its process.
  command: string
  // Its shell's process, once found.
  pid?: number
  // The agent CLI found running under it.
  agent?: CliAgent
  // The file its output is written to.
  output?: string
  // Index of the next check in the schedule, and when it is due
  // (`$.clock.now()` milliseconds).
  step: number
  dueAt: number
}

// What runs beside the main loop, shown on the band's bottom border.
export type Activity = {
  agents: { id: string; type: string; status: string }[]
  tasks: Task[]
}

// The task shown in dx's terminal pane: its command, the last lines of its output.
export type TaskView = { id: string; command: string; output?: string; lines: string[] }

// The main loop's last turn: running while it has no end.
export type TurnTime = {
  // `$.clock.now()` milliseconds.
  startedAt: number
  // Once it ends: its duration as the engine measured it, and when.
  durationMs?: number
  endedAt?: number
}

// What the settings pane lets the person change, kept in `$.store`.
export type BandSettings = {
  show: {
    model: boolean
    effort: boolean
    cwd: boolean
    branch: boolean
    context: boolean
    fiveHour: boolean
    sevenDay: boolean
    countdowns: boolean
    duration: boolean
    end: boolean
    total: boolean
    tokens: boolean
    crew: boolean
  }
  animate: { glints: boolean; shuttle: boolean; spinner: boolean }
  // `warning` (the theme's) or `#rrggbb`; the glints lighten its hex.
  frameColor: string
  // A theme key or `#rrggbb`: the effort meter, the branch.
  effortColor: string
  branchColor: string
  // `heat` for the heat gradient, or `#rrggbb` for the gauges in one color.
  gaugeColor: string
  // `text` (dim), or `#rrggbb`: the facts of the bottom border.
  infoColor: string
  // Where the heat gradient turns orange, then red, in percent.
  heatOrange: number
  heatRed: number
  // The glints' and the shuttle's pace.
  speed: 'slow' | 'normal' | 'fast'
  // The facts of the bottom border, in their order.
  bottomOrder: BottomFact[]
  // Icons of subagents, and of background tasks, in the bottom border before
  // a count stands for the rest of a kind.
  maxAgentIcons: number
  maxTaskIcons: number
  // The glyphs of the notes and settings icons, and of a monitor's.
  notesIcon: string
  settingsIcon: string
  monitorIcon: string
  // The notes tab a pane opens on, unless the last one shown is taken up again.
  notesTab: NoteTab
  resumeNotesTab: boolean
  // Other sessions' notes listed under the session tab.
  notesOthers: number
  // Leave out the 5-hour row while its window has not started.
  hideIdleFiveHour: boolean
  // The glints and the shuttle run only while Claude works; with
  // `animateWithCrew`, also while a subagent works or a background task runs.
  animateOnlyWorking: boolean
  animateWithCrew: boolean
  // The 7-day gauge's label: `7j` (jours, the default) or `7d` (days). It sets
  // the letter of days in the band's durations too: `1j15h` or `1d15h`.
  sevenDayLabel: '7j' | '7d'
}

// What dx's side panel shows.
export type PanelView = 'notes' | 'settings' | 'task'

export type BottomFact = 'duration' | 'end' | 'total' | 'tokens'

// A note of the notes pane, kept in `$.store`.
export type Note = { text: string; updatedAt: number }

export type NoteTab = 'global' | 'project' | 'session'

// The notes, loaded from `$.store` when the session starts, and again when
// their pane is shown, a tab chosen, a note written or a prompt sent while
// they are not loaded, or loaded for another session id (after a `/clear`).
export type Notes = {
  global: Note | null
  project: Note | null
  // Every session's note, by session id.
  sessions: Record<string, Note>
  // The project's root and the session whose note is this one's: the store
  // keys of their notes; `id`, the engine's session id, which a `/clear` changes.
  root: string
  session: string
  id: string
}

// The notes pane's tab, and the other session whose note it shows, if any.
export type NotesView = { tab: NoteTab; other?: string }

// A note not saved: its store key, null when it could not be known (the
// notes not loaded, the project's root unknown), and why.
export type NotesUnsaved = { key: string | null; reason: string }

declare module 'claude-code' {
  interface PluginState {
    dx: {
      statusline: Shaped<StatusSnapshot | null>
      activity: Shaped<Activity>
      taskView: Shaped<TaskView | null>
      // The subagents' spinner frame, advanced while one works.
      spin: Shaped<number>
      turn: Shaped<TurnTime | null>
      // Counted up each second while the turn runs, so its duration is redrawn.
      tick: Shaped<number>
      settings: Shaped<BandSettings>
      // Why the last change of the settings was not saved, shown in their
      // pane; null once a change saves.
      settingsUnsaved: Shaped<string | null>
      // Why the settings could not be read, the session having never read
      // them: a change was not applied. Shown in their pane; null once a read
      // succeeds.
      settingsUnreadable: Shaped<string | null>
      notes: Shaped<Notes | null>
      // Why the notes could not be loaded, shown in their pane; null once loaded.
      notesError: Shaped<string | null>
      notesView: Shaped<NotesView>
      // The note the notes pane shows, as the store last held it: key, time,
      // and the longest it may grow to.
      notesSeen: Shaped<string | null>
      // Why the last save of a note failed (the notes not loaded to keep it
      // among the reasons), or an edit was refused, and which note; null once
      // that note saves.
      notesUnsaved: Shaped<NotesUnsaved | null>
      // The first of the other sessions' notes listed, the list scrolled.
      notesOthersAt: Shaped<number>
      panel: Shaped<PanelView>
    }
  }
}
