import type { EngineInterface, On, Timer } from 'claude-code'

import { heldSettings } from '../settings/settings'
import { errorText } from '../shared/format'
import { failureOf, systemFolder } from '../shared/system'
import {
  expectedInput,
  outcomeLog,
  outcomeOf,
  outcomeText,
  RDP_COMMAND,
  REPAIR_DELAY_MS,
  RETRY_DELAY_MS,
  rewriteCommand,
  REWRITE_TIMEOUT_MS,
  SELECTION_POLL_MS,
} from './rewrite'
import type { Outcome } from './rewrite'

// Copies made for Remote Desktop (ADR 0008). On Windows, each copy of Claude
// Code writes the clipboard twice: the terminal's OSC 52 write, then
// PowerShell's `Set-Clipboard` about 0.2 s later. That second write, so soon
// after the first, keeps a paste into a Remote Desktop session from finding
// the text. With the setting on, dx writes the text again, once, a second or
// two after each copy it can see, by the Win32 API alone: a copy on
// selection (the person's selection read every half second), `/copy`, a
// plugin's `$.ui.copy`. `/dx-tse` rewrites the clipboard at once, for the
// copies dx cannot see.

// Whether the setting is on, where it is offered: on Windows alone, its
// folder known (../shared/system's systemFolder).
async function isOn($: EngineInterface): Promise<boolean> {
  return (await systemFolder($)) !== undefined && (await heldSettings($)).rdpClipboard
}

// A rewrite asked for: what asked (for the debug log), the text the copy
// left when dx knows it, and how many more tries a text not there yet gets.
type Request = { source: string; expected?: string; retries: number }

// The rewrite waiting for its time: a later copy replaces it.
let timer: Timer | undefined
// The rewrites under way, one after the other.
let running: Promise<unknown> = Promise.resolve()

// The clock reading the selection, running while the setting is on alone.
let poll: Timer | undefined
// Whether Claude Code draws in fullscreen, as the band last saw it: outside,
// there is no selection to read. Unknown until drawn, then read.
let isFullscreen: boolean | undefined

// The selection last read, and whether one was read since the setting was
// turned on: the selection standing then was copied before, not after.
let lastSelection: string | undefined
let isSelectionSeen = false
// Whether a read of the selection is under way: a slow one skips the ticks.
let isTicking = false

// Called by ../register as the session starts, as at a reload, once the
// settings are read: on Windows, its folder known (looked for anew at each
// start), the command registered, and the selection read if the setting is
// on. Elsewhere, nothing.
export async function startRdp($: EngineInterface): Promise<void> {
  isFullscreen = undefined
  poll?.cancel()
  poll = undefined
  timer?.cancel()
  timer = undefined
  const root = await systemFolder($)
  $.ui.log(`dx : presse-papiers pour le Bureau à distance, ${root === undefined ? 'pas Windows' : `Windows, dossier système ${root}`}`, { to: 'debug' })
  if (root === undefined) return
  await $.command.register({
    name: RDP_COMMAND,
    description: 'dx : réécrit le presse-papiers pour le coller dans le Bureau à distance (TSE)',
    immediate: true,
  })
  await followRdp($)
}

// The selection read every half second while the setting is on, on
// Windows; nothing read, nor waiting, while it is off. Called as the session
// starts and as the setting changes (../settings).
export async function followRdp($: EngineInterface): Promise<void> {
  if (!(await isOn($))) {
    poll?.cancel()
    poll = undefined
    timer?.cancel()
    timer = undefined
    return
  }
  if (poll !== undefined) return
  isSelectionSeen = false
  poll = $.clock.every(SELECTION_POLL_MS, () => {
    selectionTick($).catch(() => undefined)
  })
}

// Whether Claude Code draws in fullscreen, told by the band (../statusline)
// as it draws; an unknown answer keeps the last.
export function seeFullscreen(fullscreen: boolean | undefined): void {
  if (fullscreen !== undefined) isFullscreen = fullscreen
}

// Reads the person's selection: a new one, not empty, is a copy when Claude
// Code copies on selection (its `copyOnSelect`, on unless set off), and the
// clipboard is rewritten after it, if it then holds that text. The setting
// off, the selection is forgotten.
async function selectionTick($: EngineInterface): Promise<void> {
  if (isTicking || isFullscreen === false) return
  isTicking = true
  try {
    if (!(await isOn($))) {
      isSelectionSeen = false
      return
    }
    const text = (await $.ui.selection().catch(() => undefined))?.text
    if (!isSelectionSeen) {
      isSelectionSeen = true
      lastSelection = text
      return
    }
    if (text === lastSelection) return
    lastSelection = text
    if (text === undefined || text.trim() === '' || !(await copiesOnSelect($))) return
    schedule($, { source: 'sélection', expected: text, retries: 1 })
  } finally {
    isTicking = false
  }
}

// Whether Claude Code copies a selection as it is made: its `copyOnSelect`
// row of `/config`, on when absent or unreadable.
async function copiesOnSelect($: EngineInterface): Promise<boolean> {
  const rows = await $.config.list().catch(() => [])
  return rows.find(row => row.key === 'copyOnSelect')?.value !== false
}

// The rewrite asked for, `delay` from now, in place of one still waiting.
function schedule($: EngineInterface, request: Request, delay = REPAIR_DELAY_MS): void {
  timer?.cancel()
  const due = $.clock.after(delay, () => {
    if (timer === due) timer = undefined
    repairLater($, request).catch(() => undefined)
  })
  timer = due
}

// A rewrite at its time, the setting on still. A selection whose text the
// clipboard does not hold yet is tried once more, while it is still the
// last read and no later copy is waiting.
async function repairLater($: EngineInterface, request: Request): Promise<void> {
  if (!(await isOn($))) return
  const outcome = await rewrite($, request.expected)
  $.ui.log(`dx : ${request.source}, ${outcomeLog(outcome)}`, { to: 'debug' })
  const isRetried = outcome.kind === 'skipped' && outcome.reason === 'changed' && request.retries > 0
  if (isRetried && request.expected === lastSelection && timer === undefined) {
    schedule($, { ...request, retries: request.retries - 1 }, RETRY_DELAY_MS)
  }
}

// Called after a copy dx sees, other than a selection: rewritten after it
// when the setting is on.
async function copied($: EngineInterface, source: string, expected?: string): Promise<void> {
  if (await isOn($)) schedule($, { source, retries: 0, ...(expected === undefined ? {} : { expected }) })
}

// The clipboard rewritten now, after the rewrites under way, by Windows
// PowerShell from the system's folder, so that no `powershell.exe` of the
// session's folder runs in its place. Never rejects.
function rewrite($: EngineInterface, expected?: string): Promise<Outcome> {
  const done = running.then(() => runRewrite($, expected))
  running = done.catch(() => undefined)
  return done
}

async function runRewrite($: EngineInterface, expected?: string): Promise<Outcome> {
  const root = await systemFolder($)
  if (root === undefined) return { kind: 'failed', reason: 'pas sous Windows' }
  try {
    const { exitCode, stdout, stderr } = await $.process.run(rewriteCommand(root), {
      cwd: root,
      stdin: expectedInput(expected),
      timeoutMs: REWRITE_TIMEOUT_MS,
    })
    return exitCode === 0 ? outcomeOf(stdout) : { kind: 'failed', reason: failureOf(exitCode, stderr) }
  } catch (error) {
    return { kind: 'failed', reason: errorText(error) }
  }
}

export function registerRdp(on: On): void {
  // `/copy`: the clipboard rewritten after it, whatever plain text it then
  // holds, as dx does not know the text copied. The engine's `/copy` answers
  // with no text, its copy made or not: nothing tells its picker of a reply's
  // code blocks apart, after which the clipboard's former text is written
  // again, unchanged, and the copy made from the picker is not seen
  // (`/dx-tse` serves for it). The command's answer passed on as it came.
  on('command.run', { command: 'copy' }, async ($, e, next) => {
    const result = await next(e)
    await copied($, 'commande /copy').catch(() => undefined)
    return result
  })

  // A plugin's copy (dx's notes' among them) to the terminal's clipboard:
  // rewritten after it, if the clipboard then holds its text.
  on('ui.copy', async ($, e, next) => {
    const result = await next(e)
    if ('value' in result && result.value?.isCopied === true && e.surface === 'terminal') {
      await copied($, 'copie par un plugin', e.text).catch(() => undefined)
    }
    return result
  })

  // `/dx-tse`: the clipboard rewritten at once, the setting on or off, in
  // place of a rewrite still waiting. Its answer is for the person alone.
  on('command.run', { command: RDP_COMMAND }, async $ => {
    timer?.cancel()
    timer = undefined
    const outcome = await rewrite($)
    $.ui.log(`dx : /${RDP_COMMAND}, ${outcomeLog(outcome)}`, { to: 'debug' })
    return { text: `dx : ${outcomeText(outcome)}`, isTextDisplayOnly: true }
  })
}
