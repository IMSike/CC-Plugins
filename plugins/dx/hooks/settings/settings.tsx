import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, TurnStartInput } from 'claude-code'

import type { BandSettings, HeldSettings, SettingsTab, SettingsUnreadable } from '../../types'
import { keepTaskTabs, paneTabs } from '../activity/activity'
import { followRdp, isRdpOffered } from '../rdp/rdp'
import { errorText } from '../shared/format'
import { DEFAULT_SETTINGS, hexOf, settingsOf } from '../shared/options'
import { PANEL, panelView, showPanel, togglePanel } from '../shared/panes'
import { appearanceSections } from './appearance'
import { isStepper, settingsBlocks, STEPPERS } from './blocks'
import type { SettingsPress } from './blocks'
import { functionsSections } from './functions'

// The settings pane: what the band shows, animates and is colored with, kept
// in `$.store` across sessions and read into `$.state` for the drawings, one
// record with the warnings the pane says with them, written whole. Why they
// were not saved, said until a save succeeds: at a later change or at the `⚙`
// icon. Why they could not be read, the session having never read them: the
// defaults shown, or those the state held as dx's code was loaded anew, or a
// change not applied; said until a read of the store succeeds: at a change,
// at the `⚙` icon, at a main turn's start or at a reload of dx.
const settings = atom(
  { plugin: 'dx', key: 'settings' } as const,
  { value: DEFAULT_SETTINGS, unsaved: null, unreadable: null } as HeldSettings,
  { shape: 'settings-13' },
)
// The hex field whose text is no color, by the key of its colors: said in red
// under it until its text changes, a color is applied for it, typed, picked
// or by the reset, or the pane is shown anew or turned to its other tab, or
// dx starts again.
const settingsBadHex = atom({ plugin: 'dx', key: 'settingsBadHex' } as const, null as string | null, { shape: 'settings-bad-hex-1' })
// The pane's tab in front: the last one shown, kept in the store as the
// notes' last tab is, so the next opening shows it again: in this session,
// and in another from dx's next start, which reads it (`loadTab`).
const settingsTab = atom({ plugin: 'dx', key: 'settingsTab' } as const, 'appearance' as SettingsTab, { shape: 'settings-tab-1' })

const STORE_KEY = 'settings'
const TAB_KEY = 'settingsTab'
// The pane's tabs, in their order, with their names.
const SETTINGS_TABS: readonly (readonly [SettingsTab, string])[] = [
  ['appearance', 'Apparence'],
  ['functions', 'Fonctions'],
]

// The tab in front as this session holds it: kept in the hooks module's
// memory as in the state, which a `/clear` may empty, as `held` is.
let tab: SettingsTab = settingsTab.initial

function isSettingsTab(value: unknown): value is SettingsTab {
  return SETTINGS_TABS.some(([known]) => known === value)
}

// Whether the settings this session holds are its own: read from the store
// by this hooks module, the key absent included, or carrying a change of its
// own the store lacks (`unsaved`). Until then, the settings it holds, the
// defaults or those taken up from the state (`isStateShown`), are not the
// store's, and a change never writes them over those.
let settingsLoaded = false

// Whether the settings this session holds, never read by this hooks module,
// are those the state held as it was loaded, rather than the defaults: shown
// by an earlier load of its code as this session's own. Shown, but no change
// builds on them until the store is read.
let isStateShown = false

// What this session holds of its settings, and the warnings said with them:
// kept in the hooks module's memory as in the state, since a `/clear` leaves
// the module (the process goes on, no `session.start` fires) while it may
// empty dx's state, the settings then read as the defaults. Never in the
// store, which every session reads.
let held: HeldSettings = settings.initial

// Whether `takeUp` has decided what this session holds, once in this hooks
// module. Until then, the state is left as it stands: written by an earlier
// load of this module's code, it may hold what the take-up keeps.
let isTakenUp = false

// The writes of what this session holds into the state, one after the other.
let holding: Promise<void> = Promise.resolve()

// Takes `changes` into what this session holds, at once, and writes the whole
// record into the state once the writes before are done, which puts back
// what a `/clear` emptied. Never skipped on a read that finds it already
// there: every read of one dispatch answers one moment, and a write queued
// under an older dispatch's `$` would read the state from before a `/clear`
// emptied it. Each write takes what this session holds as it runs, so the
// last one writes the last changes, whoever made them. Never run as a
// drawing, which may not write the state.
function hold($: EngineInterface, changes: Partial<HeldSettings>): Promise<void> {
  held = { ...held, ...changes }
  const written = holding.then(async () => {
    await update($, settings, () => held)
  })
  holding = written.catch(() => undefined)
  return written
}

// The settings as this session holds them, and their warnings: what the state
// holds but after a `/clear` emptied it. The state is read all the same, so
// this pane, the panel's tabs (../activity) and the notes (../notes) are
// drawn again as it changes.
async function shownSettings($: EngineInterface): Promise<HeldSettings> {
  await read($, settings)
  return held
}

export async function heldSettings($: EngineInterface): Promise<BandSettings> {
  return (await shownSettings($)).value
}

// What the state holds of the settings, written by this shape of them; none
// when it holds nothing: never written, emptied by a `/clear`, or written by
// a dx whose record had another shape (an update), which the atom would read
// as the defaults.
async function stateHeld($: EngineInterface): Promise<HeldSettings | undefined> {
  const { value } = await $.state.get({ plugin: 'dx', key: 'settings' })
  return value !== undefined && value.shape === settings.shape ? value.value : undefined
}

// Once in this hooks module, before what this session holds is written: run
// in `changing` by the first of the start, a change and the `⚙` icon, which
// may come before the start, the session's own start still under way. With
// the module loaded anew, a change of this session still unsaved, which
// the store lacks, is taken up from the state (`stateHeld`), to be kept
// rather than read over; otherwise the change is lost and the store read.
// Settings the state holds that were shown as this session's own, read from
// the store, changed, or taken up so by an earlier load of the module's code,
// are taken up to be shown; not those held with the warning that the
// defaults were shown. A state that cannot be read holds nothing: the store
// is read as at a first start.
async function takeUp($: EngineInterface): Promise<void> {
  if (isTakenUp) return
  const left = await stateHeld($).catch(() => undefined)
  if (left !== undefined && left.unsaved !== null) {
    held = { ...left, unreadable: null }
    settingsLoaded = true
  } else if (left !== undefined && (left.unreadable === null || left.unreadable.isSessionShown)) {
    held = { ...held, value: left.value }
    isStateShown = true
  }
  isTakenUp = true
}

// The settings as the store holds them. A read that fails keeps the ones this
// session holds, which a change would otherwise write over the store's, and
// rejects; the settings never read, the pane says which are shown, the
// defaults or the state's (`unreadable`).
async function loadSettings($: EngineInterface): Promise<void> {
  let stored: unknown
  try {
    stored = await $.store.get(STORE_KEY)
  } catch (error) {
    if (!settingsLoaded) await hold($, { unreadable: { reason: errorText(error), isChangeRefused: false, isSessionShown: isStateShown } })
    throw error
  }
  await takeStored($, stored)
}

// Takes the settings read from the store, the warning that they could not be
// read gone.
async function takeStored($: EngineInterface, stored: unknown): Promise<void> {
  settingsLoaded = true
  await hold($, { value: settingsOf(stored), unreadable: null })
}

// The changes under way, one after the other, and the `⚙` icon's and a
// reload's reads of the settings among them.
let changing: Promise<void> = Promise.resolve()

// Called by ../register as the session starts, as at a reload of the plugin,
// even when the start beneath dx failed; the notes' start waits for it, the
// band's and the activity's run alongside. It runs once a change under way is
// done, its save included, which decides what is unsaved. A change of this
// session still unsaved, which the store lacks, is kept rather than read
// over, as the `⚙` icon does: from the hooks module's memory, which a
// `/clear` may have left alone with it, put back into the state; with the
// module loaded anew, from the state (`takeUp`). A read that fails keeps the
// settings read before by this module, silently, as the `⚙` icon does. With
// none, it rejects, for ../register to write it to the debug log, and the
// pane says which settings are shown: those `takeUp` took from the state, or
// the defaults this module holds. Neither is the store's: a change is
// refused until a read succeeds. A hex field's warning ends meanwhile: with
// the module loaded anew, it would outlive the text it was about, which no
// keystroke or color of this module then knows to clear. The tab shown last
// is read meanwhile (`loadTab`). All are waited for; the clearing's or the
// tab's failure is thrown only when the settings' start did not fail.
export async function startSettings($: EngineInterface): Promise<void> {
  const started = changing.then(async () => {
    await takeUp($)
    if (held.unsaved !== null) {
      await hold($, {})
      return
    }
    try {
      await loadSettings($)
    } catch (error) {
      if (!settingsLoaded) throw error
      await hold($, {})
    }
  })
  changing = started.catch(() => undefined)
  const [loaded, cleared, tabbed] = await Promise.allSettled([started, clearBadHex($), loadTab($)])
  if (loaded.status === 'rejected') throw loaded.reason
  if (cleared.status === 'rejected') throw cleared.reason
  if (tabbed.status === 'rejected') throw tabbed.reason
}

// The tab shown last, as the store holds it, put in front. A read that fails,
// or finds no tab, keeps the one this session holds.
async function loadTab($: EngineInterface): Promise<void> {
  const stored = await $.store.get(TAB_KEY).catch(() => undefined)
  if (isSettingsTab(stored)) tab = stored
  await update($, settingsTab, () => tab)
}

// Puts `picked` in front and keeps it as the last tab shown; a save that
// fails leaves it in front for this session alone, unsaid, as the notes' tab.
async function showTab($: EngineInterface, picked: SettingsTab): Promise<void> {
  if (picked === tab) return
  tab = picked
  await update($, settingsTab, () => tab)
  await $.store.set(TAB_KEY, tab).catch(() => undefined)
}

// The tab in front: what the state holds but after a `/clear` emptied it,
// read all the same so the pane is drawn again as it changes.
async function shownTab($: EngineInterface): Promise<SettingsTab> {
  await read($, settingsTab)
  return tab
}

// Called by ../register as a turn starts: the settings a `/clear` emptied from
// the state are restored, for the band to draw them again, and the pane's tab
// in front with them; a subagent's turn leaves them. A change under way is
// not waited for, its save included: what it holds is written by its own
// `hold` or by this one, whichever runs last.
// The settings never read, they are read again, at each turn until a read
// succeeds; one that fails leaves the pane's warning as it stands. Before
// `takeUp` decided what this session holds, nothing: the defaults this
// module holds then would be written over what it takes up from the state,
// and the start, under way, reads the store itself.
export async function startSettingsTurn($: EngineInterface, e: TurnStartInput): Promise<void> {
  if (e.agentId !== undefined || !isTakenUp) return
  await hold($, {})
  await update($, settingsTab, () => tab)
  if (settingsLoaded) return
  let stored: unknown
  try {
    stored = await $.store.get(STORE_KEY)
  } catch {
    return
  }
  // A change that read them meanwhile holds them already, its edit applied,
  // and followed the copies for Remote Desktop.
  if (settingsLoaded) return
  await takeStored($, stored)
  // Unread as the session started, the copies for Remote Desktop were
  // followed as off: followed now as the store holds them.
  await followRdp($)
}

// The settings a change starts from: as the store holds them, another
// session's changes included, the key absent read as the defaults as
// everywhere else; while a change of this session is unsaved, as this session
// holds them, so the next save writes that change too. A read that fails
// falls back on this session's settings, once read from the store; never
// read, it rejects: they are the defaults or the state's, not the store's.
async function changeBase($: EngineInterface): Promise<BandSettings> {
  if (held.unsaved !== null) return held.value
  let stored: unknown
  try {
    stored = await $.store.get(STORE_KEY)
  } catch (error) {
    if (!settingsLoaded) throw error
    return held.value
  }
  settingsLoaded = true
  return settingsOf(stored)
}

// Applies `edit` to the settings (`changeBase`) and keeps the result; two
// changes in a row both land. A save that fails leaves the change applied to
// this session alone, and the pane says why (`unsaved`). A change with no
// settings to start from is not applied, and the pane says why
// (`unreadable`); each warning goes as the atom's comment says. The settings
// written at once, for the band to show them, then again with the save's
// outcome, which puts back what a `/clear` emptied meanwhile.
function change($: EngineInterface, edit: (value: BandSettings) => BandSettings): Promise<void> {
  changing = changing.then(async () => {
    await takeUp($)
    let base: BandSettings
    try {
      base = await changeBase($)
    } catch (error) {
      await hold($, { unreadable: { reason: errorText(error), isChangeRefused: true, isSessionShown: isStateShown } })
      return
    }
    await hold($, { value: edit(base), unreadable: null })
    await save($)
  }).catch(() => undefined)

  return changing
}

// Writes the settings this session holds to the store; a write that fails is
// said in the pane (`unsaved`) until one saves.
async function save($: EngineInterface): Promise<void> {
  const unsaved = await $.store.set(STORE_KEY, held.value).then(() => null, (error: unknown) => errorText(error))
  await hold($, { unsaved })
}

export async function toggleSettings($: EngineInterface): Promise<void> {
  // Another session's changes shown, after this one's under way; a change of
  // this session still unsaved, which the store lacks, saved again instead.
  changing = changing.then(async () => {
    await takeUp($)
    await hold($, {})
    if (held.unsaved === null) await loadSettings($)
    else await save($)
  }).catch(() => undefined)
  await changing
  // Another session may have turned the copies for Remote Desktop on or off.
  await followRdp($)
  await clearBadHex($)
  await togglePanel($, 'settings')
}

// The hex field said to hold no color, as `settingsBadHex` last had it
// written: decided here, as each handler runs, one at a time, so a keystroke
// writes the state only when the warning goes. Each write takes this value as
// it runs: the last one decided lands, whatever the order the writes end in.
let badHex: string | null = null

// The pane shown anew, from the `⚙` icon or its tab, or dx started again, no
// hex field's warning outlives the text it was about. Written whatever
// `badHex` says, as is a submit with no color: a `/clear` may have emptied
// the state, a fresh load forgotten what it holds.
async function clearBadHex($: EngineInterface): Promise<void> {
  badHex = null
  await update($, settingsBadHex, () => badHex)
}

// Says under the hex field of the colors `key` that its text is no color, or
// no longer: one field's at a time, the last submitted with no color. Its
// text changed, or a color applied for it, nothing is written unless it was
// the field said.
async function markBadHex($: EngineInterface, key: string, isBad: boolean): Promise<void> {
  if (!isBad && badHex !== key) return
  badHex = isBad ? key : null
  await update($, settingsBadHex, () => badHex)
}

// What followed the settings unreadable, as the pane says it after the reason.
function unreadableOutcome({ isChangeRefused, isSessionShown }: SettingsUnreadable): string {
  if (isChangeRefused) return 'changement non appliqué'
  return isSessionShown ? "changement refusé tant qu'ils ne sont pas relus" : 'réglages par défaut affichés'
}

// What each press drawn in the pane (../shared/press.tsx) changes, by its key:
// set as the pane draws, applied to the settings as they stand when it lands.
// Rebuilt as the pane draws, it holds the drawn ones alone. Every key starts
// with `settings:`, which the press hook matches.
let pressActions = new Map<string, SettingsPress>()

export function registerSettings(on: On): void {
  // Each number a stepper posts.
  on('ui.message', { module: /stepper\.tsx$/, requestId: PANEL }, async ($, e, next) => {
    const data = e.data as { setting?: unknown; value?: unknown }
    if (!isStepper(data.setting) || typeof data.value !== 'number') return next(e)
    const set = STEPPERS[data.setting]
    const picked = data.value
    await change($, current => set(current, picked))

    return {}
  })

  // The settings' tab atop the panel (../activity's paneTabs): in front, it
  // does nothing.
  on('ui.message', { module: /press\.tsx$/, requestId: PANEL, element: 'pane-settings' }, async $ => {
    if ((await panelView($)) === 'settings') return {}
    await clearBadHex($)
    await showPanel($, 'settings')

    return {}
  })

  // Each press in the pane: a tab, whose switch drops the hex fields drawn
  // and so their warning, or a change of the settings.
  on('ui.message', { module: /press\.tsx$/, requestId: PANEL, element: /^settings:/ }, async ($, e) => {
    const action = pressActions.get(e.element)
    if (action === undefined) return {}
    if ('tab' in action) {
      if (action.tab !== tab) await clearBadHex($)
      await showTab($, action.tab)
      return {}
    }
    if (action.isReset) await clearBadHex($)
    else if (action.colors !== undefined) await markBadHex($, action.colors, false)
    await change($, action.edit)
    // The selection read for Remote Desktop's copies, or no longer.
    await followRdp($)

    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e, next) => {
    // Input and Client are drawn there alone.
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    if ((await panelView($)) !== 'settings') return next(e)
    const { value, unsaved, unreadable } = await shownSettings($)
    const shown = await shownTab($)
    const badHex = await read($, settingsBadHex)
    // On Windows alone, where Claude Code's copies write the clipboard twice
    // (ADR 0008).
    const hasRdp = await isRdpOffered($)
    const { Box, Client, Input, Text } = $.ui.resolve(e)
    const { tabs, actions: paneActions } = await paneTabs($, e, 'settings', e.props.bodyColumns)
    // Nothing is awaited from here on: the presses drawn replace the last ones.
    const blocks = settingsBlocks({ Box, Client, Input, Text }, e.props.bodyColumns, {
      badHex,
      onInput: key => void markBadHex($, key, false).catch(() => undefined),
      onSubmit: (key, typed, edit) => {
        const hex = hexOf(typed)
        void markBadHex($, key, hex === undefined).catch(() => undefined)
        if (hex !== undefined) void change($, current => edit(current, hex))
      },
    })
    pressActions = blocks.actions
    keepTaskTabs(paneActions)
    // The pane's own tabs, as the notes draw theirs: the one in front inverse.
    const settingsTabs = SETTINGS_TABS.map(([key, label]) => {
      const isShown = key === shown
      return blocks.board.press(`tab-${key}`, { tab: key }, [
        { text: ` ${label} `, color: isShown ? 'claude' : 'subtle', inverse: isShown, bold: isShown },
      ], { bold: true })
    })

    return (
      <Box flexDirection="column">
        {tabs}
        <Box key="settings-tabs" flexShrink={0} gap={1}>{settingsTabs}</Box>
        {unreadable !== null && (
          <Text key="unreadable" color="error" wrap="wrap">
            {`⚠ réglages illisibles : ${unreadable.reason} (${unreadableOutcome(unreadable)})`}
          </Text>
        )}
        {unsaved !== null && <Text key="unsaved" color="error" wrap="wrap">{`⚠ réglages non enregistrés : ${unsaved}`}</Text>}
        {shown === 'appearance' ? appearanceSections(blocks, value) : functionsSections(blocks, value, { hasRdp })}
        <Box key="footer" justifyContent="flex-end" paddingX={1}>
          {/* Every setting, those of the other tab too. */}
          {blocks.board.press('reset', { edit: () => DEFAULT_SETTINGS, isReset: true }, [{ text: '[ ↺ Réinitialiser ]' }], { color: 'claude' })}
        </Box>
      </Box>
    )
  })
}
