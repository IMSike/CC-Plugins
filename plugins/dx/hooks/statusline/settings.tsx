import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, RenderChildren } from 'claude-code'

import type { BandSettings, BottomFact } from '../../types'
import { paneTabs } from './activity'
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
  NOTE_TABS,
  NOTES_ICONS,
  NOTES_OTHERS_RANGE,
  SETTINGS_ICONS,
  settingsOf,
  SHOW_LABELS,
  SPEEDS,
  thresholdsOf,
} from './options'
import { PANEL, panelView, togglePanel } from './panes'
import { STEPPER_COLUMNS } from './stepper'
import type { StepperProps } from './stepper'

// The settings pane: what the band shows, animates and is colored with, kept
// in `$.store` across sessions and read into `$.state` for the drawings.
export const settings = atom({ plugin: 'dx', key: 'settings' } as const, DEFAULT_SETTINGS, { shape: 'settings-1' })

const STORE_KEY = 'settings'
// The toggles go in two columns from this inner width.
const TWO_COLUMNS_FROM = 44
// A color choice's cell: its mark, its swatch, the longest name.
const CHOICE_COLUMNS = 13
// An icon choice's cell: its mark, the glyph, the longest name.
const ICON_COLUMNS = 26

// Called once the session has started.
export async function loadSettings($: EngineInterface): Promise<void> {
  const stored = await $.store.get(STORE_KEY).catch(() => undefined)
  await update($, settings, () => settingsOf(stored))
}

// The changes under way, one after the other.
let changing: Promise<void> = Promise.resolve()

// Applies `edit` to the settings as the store holds them, another session's
// changes included, and keeps the result; two changes in a row both land.
function change($: EngineInterface, edit: (value: BandSettings) => BandSettings): Promise<void> {
  changing = changing.then(async () => {
    const stored = await $.store.get(STORE_KEY).catch(() => undefined)
    const next = edit(stored === undefined ? await read($, settings) : settingsOf(stored))
    await update($, settings, () => next)
    await $.store.set(STORE_KEY, next).catch(() => undefined)
  }).catch(() => undefined)

  return changing
}

export async function toggleSettings($: EngineInterface): Promise<void> {
  // Another session's changes shown, after this one's under way.
  changing = changing.then(() => loadSettings($)).catch(() => undefined)
  await changing
  await togglePanel($, 'settings')
}

// What each stepper sets, from the number it posts.
const STEPPERS: Record<string, (current: BandSettings, picked: number) => BandSettings> = {
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
}

// `order` with `fact` moved one place up (-1) or down (+1).
function moved(order: readonly BottomFact[], fact: BottomFact, by: -1 | 1): BottomFact[] {
  const from = order.indexOf(fact)
  const to = from + by
  if (from < 0 || to < 0 || to >= order.length) return [...order]
  const next = [...order]
  next[from] = next[to] as BottomFact
  next[to] = fact
  return next
}

export function registerSettings(on: On): void {
  // Each number a stepper posts.
  on('ui.message', { module: /stepper\.tsx$/ }, async ($, e, next) => {
    if (e.requestId !== PANEL) return next(e)
    const data = e.data as { setting?: unknown; value?: unknown }
    const set = typeof data.setting === 'string' ? STEPPERS[data.setting] : undefined
    if (set === undefined || typeof data.value !== 'number') return next(e)
    const picked = data.value
    await change($, current => set(current, picked))

    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e, next) => {
    // Input and Client are drawn there alone.
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    if ((await panelView($)) !== 'settings') return next(e)
    const value = await read($, settings)
    const { Box, Button, Client, Input, Text } = $.ui.resolve(e)
    const { tabs } = await paneTabs($, e, 'settings', e.props.bodyColumns)
    // Inside a section's border and padding.
    const inner = Math.max(20, e.props.bodyColumns - 4)
    const half = inner >= TWO_COLUMNS_FROM ? Math.floor(inner / 2) : inner

    const section = (key: string, title: string, children: RenderChildren[]) => (
      <Box key={key} flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>
        <Text bold color="claude">{title}</Text>
        {children}
      </Box>
    )
    const mark = (checked: boolean) => <Text color={checked ? 'success' : 'subtle'}>{checked ? '◉ ' : '○ '}</Text>
    const toggle = (key: string, checked: boolean, label: string, edit: (current: BandSettings) => BandSettings, width = half) => (
      <Box key={`${key}-cell`} width={width}>
        <Button key={key} plain hover={{ bold: true }} onPress={() => change($, edit)}>
          <Text wrap="truncate-end">
            {mark(checked)}
            <Text dimColor={!checked}>{label}</Text>
          </Text>
        </Button>
      </Box>
    )
    // One of a few, side by side, the picked one inverse.
    const segments = <T extends string>(key: string, choices: readonly (readonly [T, string])[], current: T, edit: (current: BandSettings, picked: T) => BandSettings) => (
      <Box key={key} columnGap={1}>
        {choices.map(([choice, label]) => {
          const isPicked = choice === current
          return (
            <Button key={`${key}-${choice}`} plain hover={{ bold: true }} onPress={() => change($, current => edit(current, choice))}>
              <Text color={isPicked ? 'claude' : 'subtle'} inverse={isPicked} bold={isPicked}>{` ${label} `}</Text>
            </Button>
          )
        })}
      </Box>
    )
    // A number, a step down and up within bounds (one of STEPPERS), drawn by
    // ./stepper.tsx; its label whole, wrapped when the pane is narrow.
    const stepper = (setting: string, label: string, current: number, suffix: string, [min, max]: readonly [number, number], step: number) => {
      const props: StepperProps = { setting, value: current, min, max, step, suffix }
      return (
        <Box key={setting} columnGap={1}>
          <Box key={`${setting}-label`} flexGrow={1} flexShrink={1}><Text wrap="wrap">{label}</Text></Box>
          <Client key={`${setting}-stepper`} module="./stepper.tsx" props={props} width={STEPPER_COLUMNS} height={1} />
        </Box>
      )
    }
    // The heat gradient's swatch: its two ends.
    const swatch = (color: string) =>
      color === HEAT ? [<Text color="success">█</Text>, <Text color="error">█</Text>] : [<Text color={color === DIM_TEXT ? 'subtle' : color}>██</Text>]
    const colors = (
      key: string,
      title: string,
      choices: readonly (readonly [string, string])[],
      current: string,
      edit: (current: BandSettings, color: string) => BandSettings,
    ) => {
      const isCustom = !choices.some(([color]) => color === current)
      // A choice reads as a toggle does: its mark, its color, its name.
      const choice = (color: string, label: string, isPicked: boolean) => (
        <Text wrap="truncate-end">
          {mark(isPicked)}
          {swatch(color)}
          <Text bold={isPicked} dimColor={!isPicked}>{` ${label}`}</Text>
        </Text>
      )
      return [
        <Text key={`${key}-title`} bold>{title}</Text>,
        <Box key={`${key}-choices`} flexWrap="wrap">
          {choices.map(([color, label]) => (
            <Box key={`${key}-${color.replace('#', '')}-cell`} width={CHOICE_COLUMNS}>
              <Button key={`${key}-${color.replace('#', '')}`} plain hover={{ bold: true }} onPress={() => change($, current => edit(current, color))}>
                {choice(color, label, color === current)}
              </Button>
            </Box>
          ))}
          {isCustom && <Box key={`${key}-custom-cell`} width={CHOICE_COLUMNS}>{choice(current, current, true)}</Box>}
        </Box>,
        <Box key={`${key}-custom`} marginBottom={1}>
          <Input
            key={`${key}-hex`}
            label="Autre couleur"
            placeholder="#rrggbb"
            submitLabel="appliquer"
            onSubmit={typed => {
              const hex = hexOf(typed)
              if (hex === undefined) $.ui.toast('dx : une couleur hex à six chiffres, comme #d4a72c.')
              else void change($, current => edit(current, hex))
            }}
          />
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
            <Button key={`${key}-${index}`} plain hover={{ bold: true }} onPress={() => change($, current => edit(current, glyph))}>
              <Text wrap="truncate-end">
                {mark(glyph === current)}
                <Text color="claude">{`${glyph}  `}</Text>
                <Text dimColor={glyph !== current}>{name}</Text>
              </Text>
            </Button>
          </Box>
        ))}
      </Box>,
    ]

    const thresholds = thresholdsOf(value.heatOrange, value.heatRed)
    const order = value.bottomOrder

    return (
      <Box flexDirection="column">
        {tabs}
        {section('show', 'Affichage', [
          <Box key="show-grid" flexWrap="wrap">
            {SHOW_LABELS.map(([key, label]) =>
              toggle(`show-${key}`, value.show[key], label, current => ({ ...current, show: { ...current.show, [key]: !current.show[key] } })),
            )}
          </Box>,
        ])}
        {section('bottom', 'Bordure du bas', [
          ...order.map((fact, index) => (
            <Box key={`bottom-${fact}`} columnGap={1}>
              <Button key={`up-${fact}`} plain hover={{ bold: true }} onPress={() => change($, current => ({ ...current, bottomOrder: moved(current.bottomOrder, fact, -1) }))}>
                <Text color={index > 0 ? 'claude' : 'subtle'}>↑</Text>
              </Button>
              <Button key={`down-${fact}`} plain hover={{ bold: true }} onPress={() => change($, current => ({ ...current, bottomOrder: moved(current.bottomOrder, fact, 1) }))}>
                <Text color={index < order.length - 1 ? 'claude' : 'subtle'}>↓</Text>
              </Button>
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
          <Button key="reset" variant="secondary" onPress={() => change($, () => DEFAULT_SETTINGS)}>
            <Text>↺ Réinitialiser</Text>
          </Button>
        </Box>
      </Box>
    )
  })
}
