import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { PanelView } from '../../types'

// dx's side panel: one pane, whose content is the notes, the settings or a
// background task's terminal. Going from one to another redraws it in place,
// with no close and open, so nothing flickers and the surface draws no tabs
// of its own: the row of tabs atop it (activity's paneTabs) leads around.

export const PANEL = 'dx-panel'
const PANE_COLUMNS = 80
// What the panel shows, read by each content's render hook.
const panel = atom({ plugin: 'dx', key: 'panel' } as const, 'notes' as PanelView, { shape: 'panel-1' })

// The panel's name, drawn only while another plugin's pane is open beside it:
// one for every content, so that switching needs no new open.
const TITLE = 'dx'
// The contents' names, on the tabs atop the panel.
export const TITLES: Record<Exclude<PanelView, 'task'>, string> = { notes: 'Notes', settings: 'Réglages' }

async function isOpen($: EngineInterface): Promise<boolean> {
  const panes = await $.ui.panes().catch(() => [])
  return panes.some(pane => pane.id === PANEL)
}

export async function closePanel($: EngineInterface): Promise<void> {
  await $.ui.close({ id: PANEL }).catch(() => undefined)
}

// Shows `view` in the panel, opened when it is not. An open panel is redrawn,
// not opened again, so no `ui.open` hook sees the switch: what a content
// needs first, its feature does before calling this (../notes's showNotes).
export async function showPanel($: EngineInterface, view: PanelView): Promise<void> {
  await update($, panel, () => view)
  if (!(await isOpen($))) await $.ui.open({ id: PANEL, title: TITLE, columns: PANE_COLUMNS }).catch(() => undefined)
}

// A click on a view's icon: the view shown, or the panel closed when it
// already shows it.
export async function togglePanel($: EngineInterface, view: PanelView): Promise<void> {
  if (await isShowing($, view)) await closePanel($)
  else await showPanel($, view)
}

// Whether the panel is open on `view`.
export async function isShowing($: EngineInterface, view: PanelView): Promise<boolean> {
  return (await isOpen($)) && (await read($, panel)) === view
}

// What the panel shows: each content's render hook draws only its own.
export async function panelView($: EngineInterface): Promise<PanelView> {
  return read($, panel)
}
