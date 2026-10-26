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

declare module 'claude-code' {
  interface PluginState {
    dx: {
      statusline: Shaped<StatusSnapshot | null>
      activity: Shaped<Activity>
      taskView: Shaped<TaskView | null>
      spin: Shaped<number>
    }
  }
}
