import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, RenderChildren, TurnStartInput } from 'claude-code'

import type { BandSettings, SettingsUnreadable } from '../../types'
import { keepTaskTabs, paneTabs } from '../activity/activity'
import { errorText } from '../shared/format'
import {
  ACCENTS,
  ANIMATE_LABELS,
  BOTTOM_LABELS,
  DEFAULT_SETTINGS,
  DIM_TEXT,
  FRAME_COLORS,
  GAUGE_COLORS,
  HEAT,
  HEAT_MAX,
  HEAT_MIN,
  HEAT_STEP,
  hexOf,
  INFO_COLORS,
  MAX_ICONS_RANGE,
  MONITOR_ICONS,
  NOTE_TABS,
  NOTES_ICONS,
  NOTES_OTHERS_RANGE,
  SETTINGS_ICONS,
  settingsOf,
  SEVEN_DAY_LABELS,
  SHOW_LABELS,
  SPEEDS,
  thresholdsOf,
} from '../shared/options'
import { PANEL, panelView, showPanel, togglePanel } from '../shared/panes'
import type { PressPart, PressStyle } from '../shared/press'
import { pressBoard } from '../shared/presses'
import { moved } from './order'
import { STEPPER_COLUMNS } from './stepper'
import type { StepperProps } from './stepper'

// The settings pane: what the band shows, animates and is colored with, kept
// in `$.store` across sessions and read into `$.state` for the drawings.
const settings = atom({ plugin: 'dx', key: 'settings' } as const, DEFAULT_SETTINGS, { shape: 'settings-3' })
// Why the settings this session holds were not saved, said in the pane until a
// save succeeds: at a later change or at the `⚙` icon.
const settingsUnsaved = atom({ plugin: 'dx', key: 'settingsUnsaved' } as const, null as string | null, {
  shape: 'settings-unsaved-1',
})
// Why the settings could not be read, the session having never read them: the
// defaults shown, or a change not applied. Said in the pane until a read of
// the store succeeds: at a change, at the `⚙` icon, at a main turn's start or
// at a reload of dx.
const settingsUnreadable = atom({ plugin: 'dx', key: 'settingsUnreadable' } as const, null as SettingsUnreadable | null, {
  shape: 'settings-unreadable-2',
})
// The hex field whose text is no color, by the key of its colors: said in red
// under it until its text changes or it applies a color.
const settingsBadHex = atom({ plugin: 'dx', key: 'settingsBadHex' } as const, null as string | null, { shape: 'settings-bad-hex-1' })

const STORE_KEY = 'settings'
// The toggles go in two columns from this inner width.
const TWO_COLUMNS_FROM = 44
// A color choice's cell: its mark, its swatch, the longest name.
const CHOICE_COLUMNS = 13
// An icon choice's cell: its mark, the glyph, the longest name.
const ICON_COLUMNS = 26

// Whether the settings this session holds are its own: read from the store,
// the key absent included, or carrying a change of its own the store lacks
// (`unsaved`). Until then, the defaults it holds are not the store's
// settings, and a change never writes them over those.
let settingsLoaded = false

// What this session holds of its settings, and the warnings said with them:
// kept in the hooks module's memory as in the state, since a `/clear` leaves
// the module (the process goes on, no `session.start` fires) while it may
// empty dx's state, the settings then read as the defaults. Never in the
// store, which every session reads.
type Held = { value: BandSettings; unsaved: string | null; unreadable: SettingsUnreadable | null }
let held: Held = { value: DEFAULT_SETTINGS, unsaved: null, unreadable: null }

// The writes of what this session holds into the state, one after the other.
let holding: Promise<void> = Promise.resolve()

// Takes `changes` into what this session holds, at once, and writes into the
// state what it lacks of it once the writes before are done: with no changes,
// puts back what a `/clear` emptied. Each write takes what this session holds
// as it runs, so the last one writes the last changes, whoever made them.
// Never run as a drawing, which may not write the state.
function hold($: EngineInterface, changes: Partial<Held>): Promise<void> {
  held = { ...held, ...changes }
  const written = holding.then(() => writeHeld($))
  holding = written.catch(() => undefined)
  return written
}

async function writeHeld($: EngineInterface): Promise<void> {
  if (JSON.stringify(await read($, settings)) !== JSON.stringify(held.value)) await update($, settings, () => held.value)
  if ((await read($, settingsUnsaved)) !== held.unsaved) await update($, settingsUnsaved, () => held.unsaved)
  if (JSON.stringify(await read($, settingsUnreadable)) !== JSON.stringify(held.unreadable)) await update($, settingsUnreadable, () => held.unreadable)
}

// The settings drawn and their warnings: as this session holds them, which the
// state matches but after a `/clear` emptied it. The state is read all the
// same, the pane drawn again as it changes.
async function shownSettings($: EngineInterface): Promise<Held> {
  await read($, settings)
  await read($, settingsUnsaved)
  await read($, settingsUnreadable)
  return held
}

// The settings as this session holds them, for the panel's tabs (../activity)
// and the notes (../notes) as for this pane (`shownSettings`).
export async function heldSettings($: EngineInterface): Promise<BandSettings> {
  return (await shownSettings($)).value
}

// The settings as the store holds them. A read that fails keeps the ones this
// session holds, which a change would otherwise write over the store's, and
// rejects; the settings never read, the pane says the defaults are shown
// (`settingsUnreadable`).
async function loadSettings($: EngineInterface): Promise<void> {
  let stored: unknown
  try {
    stored = await $.store.get(STORE_KEY)
  } catch (error) {
    if (!settingsLoaded) await hold($, { unreadable: { reason: errorText(error), isChangeRefused: false } })
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

// Called by ../register once the session has started, before the features
// that read the settings: a fresh load of the plugin, from what its state
// holds, once a change under way is done, its save included, which decides
// what is unsaved. A change of this session still unsaved, which the store
// lacks, is kept rather than read over, as the `⚙` icon does. A read that
// fails rejects, for ../register to write it to the debug log.
export async function startSettings($: EngineInterface): Promise<void> {
  const started = changing.then(async () => {
    held = {
      value: await read($, settings),
      unsaved: await read($, settingsUnsaved),
      unreadable: await read($, settingsUnreadable),
    }
    settingsLoaded = held.unsaved !== null
    if (!settingsLoaded) await loadSettings($)
  })
  changing = started.catch(() => undefined)
  await started
}

// Called by ../register as a turn starts: the settings a `/clear` emptied from
// the state are restored, for the band to draw them again; a subagent's turn
// leaves them. A change under way is not waited for, its save included: what
// it holds is written by its own `hold` or by this one, whichever runs last.
// The settings never read, they are read again, at each turn until a read
// succeeds; one that fails leaves the pane's warning as it stands.
export async function startSettingsTurn($: EngineInterface, e: TurnStartInput): Promise<void> {
  if (e.agentId !== undefined) return
  await hold($, {})
  if (settingsLoaded) return
  let stored: unknown
  try {
    stored = await $.store.get(STORE_KEY)
  } catch {
    return
  }
  // A change that read them meanwhile holds them already, its edit applied.
  if (!settingsLoaded) await takeStored($, stored)
}

// The settings a change starts from: as the store holds them, another
// session's changes included, the key absent read as the defaults as
// everywhere else; while a change of this session is unsaved, as this session
// holds them, so the next save writes that change too. A read that fails
// falls back on this session's settings, once read from the store; never
// read, it rejects: they are the defaults, not the store's.
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
// this session alone, and the pane says why (`settingsUnsaved`). A change
// with no settings to start from is not applied, and the pane says why
// (`settingsUnreadable`); each warning goes as its atom's comment says.
function change($: EngineInterface, edit: (value: BandSettings) => BandSettings): Promise<void> {
  changing = changing.then(async () => {
    await hold($, {})
    let base: BandSettings
    try {
      base = await changeBase($)
    } catch (error) {
      await hold($, { unreadable: { reason: errorText(error), isChangeRefused: true } })
      return
    }
    await hold($, { value: edit(base), unreadable: null })
    await save($)
  }).catch(() => undefined)

  return changing
}

// Writes the settings this session holds to the store; a write that fails is
// said in the pane (`settingsUnsaved`) until one saves.
async function save($: EngineInterface): Promise<void> {
  const unsaved = await $.store.set(STORE_KEY, held.value).then(() => null, (error: unknown) => errorText(error))
  await hold($, { unsaved })
}

export async function toggleSettings($: EngineInterface): Promise<void> {
  // Another session's changes shown, after this one's under way; a change of
  // this session still unsaved, which the store lacks, saved again instead.
  changing = changing.then(async () => {
    await hold($, {})
    if (held.unsaved === null) await loadSettings($)
    else await save($)
  }).catch(() => undefined)
  await changing
  await togglePanel($, 'settings')
}

// Says under the hex field of the colors `key` that its text is no color, or
// no longer: one field's at a time, the last submitted with no color.
async function markBadHex($: EngineInterface, key: string, isBad: boolean): Promise<void> {
  const current = await read($, settingsBadHex)
  if (isBad && current !== key) await update($, settingsBadHex, () => key)
  if (!isBad && current === key) await update($, settingsBadHex, () => null)
}

// What each stepper sets, from the number it posts.
const STEPPERS = {
  'max-agent-icons': (current, maxAgentIcons) => ({ ...current, maxAgentIcons }),
  'max-task-icons': (current, maxTaskIcons) => ({ ...current, maxTaskIcons }),
  'heat-orange': (current, heatOrange) => {
    const [orange, red] = thresholdsOf(heatOrange, Math.max(current.heatRed, heatOrange + HEAT_STEP))
    return { ...current, heatOrange: orange, heatRed: red }
  },
  'heat-red': (current, heatRed) => {
    const [orange, red] = thresholdsOf(current.heatOrange, heatRed)
    return { ...current, heatOrange: orange, heatRed: red }
  },
  'notes-others': (current, notesOthers) => ({ ...current, notesOthers }),
} satisfies Record<string, (current: BandSettings, picked: number) => BandSettings>
type Stepper = keyof typeof STEPPERS

function isStepper(value: unknown): value is Stepper {
  return typeof value === 'string' && Object.hasOwn(STEPPERS, value)
}

// What each press drawn in the pane (../shared/press.tsx) changes, by its key:
// set as the pane draws, applied to the settings as they stand when it lands.
// Rebuilt as the pane draws, it holds the drawn ones alone. Every key starts
// with `settings:`, which the press hook matches.
let pressActions = new Map<string, (current: BandSettings) => BandSettings>()
const BOLD: PressStyle = { bold: true }

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
    if ((await panelView($)) !== 'settings') await showPanel($, 'settings')

    return {}
  })

  // Each press in the pane.
  on('ui.message', { module: /press\.tsx$/, requestId: PANEL, element: /^settings:/ }, async ($, e) => {
    const edit = pressActions.get(e.element)
    if (edit !== undefined) await change($, edit)

    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e, next) => {
    // Input and Client are drawn there alone.
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    if ((await panelView($)) !== 'settings') return next(e)
    const { value, unsaved, unreadable } = await shownSettings($)
    const badHex = await read($, settingsBadHex)
    const { Box, Client, Input, Text } = $.ui.resolve(e)
    const { tabs, actions: paneActions } = await paneTabs($, e, 'settings', e.props.bodyColumns)
    // Inside a section's border and padding.
    const inner = Math.max(20, e.props.bodyColumns - 4)
    const half = inner >= TWO_COLUMNS_FROM ? Math.floor(inner / 2) : inner

    const section = (key: string, title: string, children: RenderChildren[]) => (
      <Box key={key} flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>
        <Text bold color="claude">{title}</Text>
        {children}
      </Box>
    )
    // A press that applies `edit` (../shared/presses). `width`: its cell's, the
    // label cut there.
    // Nothing is awaited from here on: the presses drawn replace the last ones.
    const board = pressBoard<(current: BandSettings) => BandSettings>(Client, 'settings:')
    pressActions = board.actions
    keepTaskTabs(paneActions)
    const press = (key: string, edit: (current: BandSettings) => BandSettings, parts: PressPart[], width?: number, hover = BOLD) =>
      board.press(key, edit, parts, hover, width)
    const mark = (checked: boolean): PressPart => ({ text: checked ? '◉ ' : '○ ', color: checked ? 'success' : 'subtle' })
    const toggle = (key: string, checked: boolean, label: string, edit: (current: BandSettings) => BandSettings, width = half) => (
      <Box key={`${key}-cell`} width={width}>
        {press(key, edit, [mark(checked), { text: label, dimColor: !checked }], width)}
      </Box>
    )
    // One of a few, side by side, the picked one inverse.
    const segments = <T extends string>(key: string, choices: readonly (readonly [T, string])[], current: T, edit: (current: BandSettings, picked: T) => BandSettings) => (
      <Box key={key} columnGap={1}>
        {choices.map(([choice, label]) => {
          const isPicked = choice === current
          return press(`${key}-${choice}`, current => edit(current, choice), [
            { text: ` ${label} `, color: isPicked ? 'claude' : 'subtle', inverse: isPicked, bold: isPicked },
          ])
        })}
      </Box>
    )
    // A number, a step down and up within bounds (one of STEPPERS), drawn by
    // ./stepper.tsx; its label whole, wrapped when the pane is narrow.
    const stepper = (setting: Stepper, label: string, current: number, suffix: string, [min, max]: readonly [number, number], step: number) => {
      const props: StepperProps = { setting, value: current, min, max, step, suffix }
      return (
        <Box key={setting} columnGap={1}>
          <Box key={`${setting}-label`} flexGrow={1} flexShrink={1}><Text wrap="wrap">{label}</Text></Box>
          <Client key={`${setting}-stepper`} module="./stepper.tsx" props={props} width={STEPPER_COLUMNS} height={1} />
        </Box>
      )
    }
    // The heat gradient's swatch: its two ends.
    const swatch = (color: string): PressPart[] =>
      color === HEAT ? [{ text: '█', color: 'success' }, { text: '█', color: 'error' }] : [{ text: '██', color: color === DIM_TEXT ? 'subtle' : color }]
    const colors = (
      key: string,
      title: string,
      choices: readonly (readonly [string, string])[],
      current: string,
      edit: (current: BandSettings, color: string) => BandSettings,
    ) => {
      const isCustom = !choices.some(([color]) => color === current)
      // A choice reads as a toggle does: its mark, its color, its name.
      const choice = (color: string, label: string, isPicked: boolean): PressPart[] => [
        mark(isPicked),
        ...swatch(color),
        { text: ` ${label}`, bold: isPicked, dimColor: !isPicked },
      ]
      return [
        <Text key={`${key}-title`} bold>{title}</Text>,
        <Box key={`${key}-choices`} flexWrap="wrap">
          {choices.map(([color, label]) => (
            <Box key={`${key}-${color.replace('#', '')}-cell`} width={CHOICE_COLUMNS}>
              {press(`${key}-${color.replace('#', '')}`, current => edit(current, color), choice(color, label, color === current), CHOICE_COLUMNS)}
            </Box>
          ))}
          {isCustom && (
            <Box key={`${key}-custom-cell`} width={CHOICE_COLUMNS}>
              <Text wrap="truncate-end">
                {choice(current, current, true).map(({ text, ...style }) => <Text {...style}>{text}</Text>)}
              </Text>
            </Box>
          )}
        </Box>,
        <Box key={`${key}-custom`} flexDirection="column" marginBottom={1}>
          <Input
            key={`${key}-hex`}
            label="Autre couleur"
            placeholder="#rrggbb"
            submitLabel="appliquer"
            onInput={() => void markBadHex($, key, false)}
            onSubmit={typed => {
              const hex = hexOf(typed)
              void markBadHex($, key, hex === undefined)
              if (hex !== undefined) void change($, current => edit(current, hex))
            }}
          />
          {badHex === key && (
            <Text key={`${key}-bad-hex`} color="error" wrap="wrap">⚠ couleur non appliquée : il faut une couleur hex à six chiffres, comme #d4a72c</Text>
          )}
        </Box>,
      ]
    }
    // The glyphs offered for an icon, each with its name: one the terminal's
    // font lacks draws as a blank or a box.
    const icons = (
      key: string,
      title: string,
      choices: readonly (readonly [string, string])[],
      current: string,
      edit: (current: BandSettings, glyph: string) => BandSettings,
    ) => [
      <Text key={`${key}-title`} bold>{title}</Text>,
      <Box key={`${key}-choices`} flexWrap="wrap" marginBottom={1}>
        {choices.map(([glyph, name], index) => (
          <Box key={`${key}-${index}-cell`} width={ICON_COLUMNS}>
            {press(`${key}-${index}`, current => edit(current, glyph), [
              mark(glyph === current),
              { text: `${glyph}  `, color: 'claude' },
              { text: name, dimColor: glyph !== current },
            ], ICON_COLUMNS)}
          </Box>
        ))}
      </Box>,
    ]

    const thresholds = thresholdsOf(value.heatOrange, value.heatRed)
    const order = value.bottomOrder

    return (
      <Box flexDirection="column">
        {tabs}
        {unreadable !== null && (
          <Text key="unreadable" color="error" wrap="wrap">
            {`⚠ réglages illisibles : ${unreadable.reason} (${unreadable.isChangeRefused ? 'changement non appliqué' : 'réglages par défaut affichés'})`}
          </Text>
        )}
        {unsaved !== null && <Text key="unsaved" color="error" wrap="wrap">{`⚠ réglages non enregistrés : ${unsaved}`}</Text>}
        {section('show', 'Affichage', [
          <Box key="show-grid" flexWrap="wrap">
            {SHOW_LABELS.map(([key, label]) =>
              toggle(`show-${key}`, value.show[key], label, current => ({ ...current, show: { ...current.show, [key]: !current.show[key] } })),
            )}
          </Box>,
          <Box key="seven-day-label" columnGap={1}>
            <Text>Libellé de la jauge 7 j</Text>
            {segments('seven-day-label', SEVEN_DAY_LABELS, value.sevenDayLabel, (current, sevenDayLabel) => ({ ...current, sevenDayLabel }))}
          </Box>,
        ])}
        {section('bottom', 'Bordure du bas', [
          ...order.map((fact, index) => (
            <Box key={`bottom-${fact}`} columnGap={1}>
              {press(`up-${fact}`, current => ({ ...current, bottomOrder: moved(current.bottomOrder, fact, -1) }), [
                { text: '↑', color: index > 0 ? 'claude' : 'subtle' },
              ])}
              {press(`down-${fact}`, current => ({ ...current, bottomOrder: moved(current.bottomOrder, fact, 1) }), [
                { text: '↓', color: index < order.length - 1 ? 'claude' : 'subtle' },
              ])}
              {toggle(`show-${fact}`, value.show[fact], BOTTOM_LABELS[fact], current => ({ ...current, show: { ...current.show, [fact]: !current.show[fact] } }), inner - 4)}
            </Box>
          )),
          <Box key="bottom-gap" height={1} />,
          stepper('max-agent-icons', 'Sous-agents affichés avant un compteur', value.maxAgentIcons, '', MAX_ICONS_RANGE, 1),
          stepper('max-task-icons', 'Terminaux affichés avant un compteur', value.maxTaskIcons, '', MAX_ICONS_RANGE, 1),
        ])}
        {section('animate', 'Animations', [
          <Box key="animate-grid" flexWrap="wrap">
            {ANIMATE_LABELS.map(([key, label]) =>
              toggle(`animate-${key}`, value.animate[key], label, current => ({ ...current, animate: { ...current.animate, [key]: !current.animate[key] } })),
            )}
          </Box>,
          <Box key="speed" columnGap={1}>
            <Text>Vitesse</Text>
            {segments('speed', SPEEDS, value.speed, (current, speed) => ({ ...current, speed }))}
          </Box>,
        ])}
        {section('colors', 'Couleurs', [
          ...colors('frame-color', 'Cadre', FRAME_COLORS, value.frameColor, (current, frameColor) => ({ ...current, frameColor })),
          ...colors('effort-color', 'Effort', ACCENTS, value.effortColor, (current, effortColor) => ({ ...current, effortColor })),
          ...colors('branch-color', 'Branche', ACCENTS, value.branchColor, (current, branchColor) => ({ ...current, branchColor })),
          ...colors('gauge-color', 'Jauges', GAUGE_COLORS, value.gaugeColor, (current, gaugeColor) => ({ ...current, gaugeColor })),
          ...colors('info-color', 'Texte de la bordure du bas', INFO_COLORS, value.infoColor, (current, infoColor) => ({ ...current, infoColor })),
        ])}
        {section('heat', 'Seuils des jauges', [
          stepper('heat-orange', 'Orange à partir de', thresholds[0], ' %', [HEAT_MIN, HEAT_MAX - HEAT_STEP], HEAT_STEP),
          stepper('heat-red', 'Rouge à partir de', thresholds[1], ' %', [thresholds[0] + HEAT_STEP, HEAT_MAX], HEAT_STEP),
          <Text key="heat-hint" dimColor>Dans le dégradé de chaleur : jaune à mi-chemin du seuil orange.</Text>,
        ])}
        {section('icons', 'Icônes', [
          ...icons('notes-icon', 'Notes', NOTES_ICONS, value.notesIcon, (current, notesIcon) => ({ ...current, notesIcon })),
          ...icons('settings-icon', 'Réglages', SETTINGS_ICONS, value.settingsIcon, (current, settingsIcon) => ({ ...current, settingsIcon })),
          ...icons('monitor-icon', 'Moniteurs', MONITOR_ICONS, value.monitorIcon, (current, monitorIcon) => ({ ...current, monitorIcon })),
        ])}
        {section('notes', 'Notes', [
          <Box key="notes-tab" columnGap={1}>
            <Text>Onglet à l'ouverture</Text>
            {segments('notes-tab', NOTE_TABS, value.notesTab, (current, notesTab) => ({ ...current, notesTab }))}
          </Box>,
          toggle('resume-notes-tab', value.resumeNotesTab, 'Reprendre le dernier onglet ouvert', current => ({
            ...current,
            resumeNotesTab: !current.resumeNotesTab,
          }), inner),
          stepper('notes-others', 'Autres sessions listées', value.notesOthers, '', NOTES_OTHERS_RANGE, 1),
        ])}
        {section('behavior', 'Comportement', [
          toggle('hide-idle-five-hour', value.hideIdleFiveHour, "Masquer la jauge 5 h tant que sa fenêtre n'a pas commencé", current => ({
            ...current,
            hideIdleFiveHour: !current.hideIdleFiveHour,
          }), inner),
          toggle('animate-only-working', value.animateOnlyWorking, 'Animer seulement pendant que Claude travaille', current => ({
            ...current,
            animateOnlyWorking: !current.animateOnlyWorking,
          }), inner),
          // Of use only with the one above: drawn under it, off without it; checked
          // then, it turns both on.
          <Box key="animate-with-crew-row" paddingLeft={2}>
            {toggle('animate-with-crew', value.animateWithCrew && value.animateOnlyWorking, "… ou qu'un sous-agent ou un shell est actif", current => ({
              ...current,
              animateWithCrew: current.animateOnlyWorking ? !current.animateWithCrew : true,
              animateOnlyWorking: true,
            }), inner - 2)}
          </Box>,
        ])}
        <Box key="footer" justifyContent="flex-end" paddingX={1}>
          {press('reset', () => DEFAULT_SETTINGS, [{ text: '[ ↺ Réinitialiser ]' }], undefined, { color: 'claude' })}
        </Box>
      </Box>
    )
  })
}
