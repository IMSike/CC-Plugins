import type { RenderChildren } from 'claude-code'

import type { BandSettings } from '../../types'
import {
  ACCENTS,
  ANIMATE_LABELS,
  BOTTOM_LABELS,
  FRAME_COLORS,
  GAUGE_COLORS,
  HEAT_MAX,
  HEAT_MIN,
  HEAT_STEP,
  INFO_COLORS,
  MAX_ICONS_RANGE,
  MONITOR_ICONS,
  NOTES_ICONS,
  SETTINGS_ICONS,
  SEVEN_DAY_LABELS,
  SHOW_LABELS,
  SPEEDS,
  thresholdsOf,
} from '../shared/options'
import type { SettingsBlocks } from './blocks'
import { moved } from './order'

// The settings of what the band looks like: what it shows, in what order,
// how and when it moves, its colors, its gauges' thresholds, its icons.
export function appearanceSections(blocks: SettingsBlocks, value: BandSettings): RenderChildren[] {
  const { elements, inner, section, press, toggle, segments, stepper, colors, icons } = blocks
  const { Box, Text } = elements
  const thresholds = thresholdsOf(value.heatOrange, value.heatRed)
  const order = value.bottomOrder

  return [
    section('show', 'Affichage', [
      <Box key="show-grid" flexWrap="wrap">
        {SHOW_LABELS.map(([key, label]) =>
          toggle(`show-${key}`, value.show[key], label, current => ({ ...current, show: { ...current.show, [key]: !current.show[key] } })),
        )}
      </Box>,
      <Box key="seven-day-label" columnGap={1}>
        <Text>Libellé de la jauge 7 j</Text>
        {segments('seven-day-label', SEVEN_DAY_LABELS, value.sevenDayLabel, (current, sevenDayLabel) => ({ ...current, sevenDayLabel }))}
      </Box>,
    ]),
    section('bottom', 'Bordure du bas', [
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
    ]),
    section('animate', 'Animations', [
      <Box key="animate-grid" flexWrap="wrap">
        {ANIMATE_LABELS.map(([key, label]) =>
          toggle(`animate-${key}`, value.animate[key], label, current => ({ ...current, animate: { ...current.animate, [key]: !current.animate[key] } })),
        )}
      </Box>,
      <Box key="speed" columnGap={1}>
        <Text>Vitesse</Text>
        {segments('speed', SPEEDS, value.speed, (current, speed) => ({ ...current, speed }))}
      </Box>,
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
    ]),
    section('colors', 'Couleurs', [
      ...colors('frame-color', 'Cadre', FRAME_COLORS, value.frameColor, (current, frameColor) => ({ ...current, frameColor })),
      ...colors('effort-color', 'Effort', ACCENTS, value.effortColor, (current, effortColor) => ({ ...current, effortColor })),
      ...colors('branch-color', 'Branche', ACCENTS, value.branchColor, (current, branchColor) => ({ ...current, branchColor })),
      ...colors('gauge-color', 'Jauges', GAUGE_COLORS, value.gaugeColor, (current, gaugeColor) => ({ ...current, gaugeColor })),
      ...colors('info-color', 'Texte de la bordure du bas', INFO_COLORS, value.infoColor, (current, infoColor) => ({ ...current, infoColor })),
    ]),
    section('heat', 'Seuils des jauges', [
      stepper('heat-orange', 'Orange à partir de', thresholds[0], ' %', [HEAT_MIN, HEAT_MAX - HEAT_STEP], HEAT_STEP),
      stepper('heat-red', 'Rouge à partir de', thresholds[1], ' %', [thresholds[0] + HEAT_STEP, HEAT_MAX], HEAT_STEP),
      <Text key="heat-hint" dimColor>Dans le dégradé de chaleur : jaune à mi-chemin du seuil orange.</Text>,
    ]),
    section('icons', 'Icônes', [
      ...icons('notes-icon', 'Notes', NOTES_ICONS, value.notesIcon, (current, notesIcon) => ({ ...current, notesIcon })),
      ...icons('settings-icon', 'Réglages', SETTINGS_ICONS, value.settingsIcon, (current, settingsIcon) => ({ ...current, settingsIcon })),
      ...icons('monitor-icon', 'Moniteurs', MONITOR_ICONS, value.monitorIcon, (current, monitorIcon) => ({ ...current, monitorIcon })),
    ]),
  ]
}
