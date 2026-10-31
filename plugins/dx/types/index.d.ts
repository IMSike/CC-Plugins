// Values the dx plugin keeps in `$.state` for the session.

export type Gauge = {
  // 0 to 100.
  percent: number
  // ISO 8601, when the window resets.
  resetsAt?: string
}

// What the status band draws, read from the engine at each refresh.
export type StatusSnapshot = {
  model: string
  effort?: string
  cwd: string
  // Git branch of the directory, or a short commit when detached.
  branch?: string
  // Context window used, absent before the first response.
  context?: number
  contextTokens?: number
  contextWindow: number
  fiveHour?: Gauge
  sevenDay?: Gauge
  // `$.clock.now()` milliseconds.
  startedAt: number
  // `$.clock.now()` at the refresh: makes each refresh a new value, so the
  // countdowns are redrawn even when nothing else changed.
  refreshedAt: number
}

// What runs beside the main loop, shown on the band's bottom border.
export type CliAgent = 'claude' | 'cursor'

// A background shell or monitor, followed by its id.
export type Task = {
  id: string
  kind: 'shell' | 'monitor'
  // The command it runs, to find its process.
  command: string
  // Its shell's process, once found.
  pid?: number
  // The agent CLI found running under it.
  agent?: CliAgent
  // The file its output is written to.
  output?: string
  // Index of the next check in the schedule, and when it is due.
  step: number
  dueAt: number
}

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
  // The glyphs of the notes and settings icons.
  notesIcon: string
  settingsIcon: string
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
}

// What dx's side panel shows.
export type PanelView = 'notes' | 'settings' | 'task'

export type BottomFact = 'duration' | 'end' | 'total' | 'tokens'

// A note of the notes pane, kept in `$.store`.
export type Note = { text: string; updatedAt: number }

export type NoteTab = 'global' | 'project' | 'session'

// The notes, loaded from `$.store` when the session starts.
export type Notes = {
  global: Note | null
  project: Note | null
  // Every session's note, by session id.
  sessions: Record<string, Note>
  // The project's root and the session's id: the store keys of their notes.
  root: string
  session: string
}

// The notes pane's tab, and the other session whose note it shows, if any.
export type NotesView = { tab: NoteTab; other?: string }

declare module 'claude-code' {
  interface PluginState {
    dx: {
      statusline: Shaped<StatusSnapshot | null>
      activity: Shaped<Activity>
      taskView: Shaped<TaskView | null>
      spin: Shaped<number>
      turn: Shaped<TurnTime | null>
      tick: Shaped<number>
      settings: Shaped<BandSettings>
      notes: Shaped<Notes | null>
      notesView: Shaped<NotesView>
      panel: Shaped<PanelView>
    }
  }
}
