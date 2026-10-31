import type { BandSettings, BottomFact, NoteTab } from '../../types'

// The settings pane's model: defaults, choices, and the reading of what
// `$.store` holds.

// The gauges' heat gradient, as a gauge color.
export const HEAT = 'heat'
// The theme's warning color, the frame's by default, and the hex its glints
// lighten: the default theme's yellow, since a theme's colors cannot be read.
export const THEME_FRAME = 'warning'
export const THEME_FRAME_HEX = '#d4a72c'
// The bottom border's facts drawn in the dim text color.
export const DIM_TEXT = 'text'

// The icons offered for the notes and settings panes: plain Unicode, and Nerd
// Font glyphs (a gear: U+2699 is drawn as an emoji on Windows).
export const NOTES_ICONS: readonly (readonly [string, string])[] = [
  ['\u{F044}', 'nf-fa-edit'],
  ['\u{F040}', 'nf-fa-pencil'],
  ['✎', 'U+270E'],
  ['✐', 'U+2710'],
  ['\u{F249}', 'nf-fa-sticky_note'],
  ['\u{EB26}', 'nf-cod-note'],
]
export const SETTINGS_ICONS: readonly (readonly [string, string])[] = [
  ['\u{F423}', 'nf-oct-gear'],
  ['\u{F013}', 'nf-fa-cog'],
  ['\u{F085}', 'nf-fa-cogs'],
  ['\u{F1DE}', 'nf-fa-sliders'],
  ['\u{EB51}', 'nf-cod-settings_gear'],
  ['☰', 'U+2630'],
]

const BOTTOM_FACTS: readonly BottomFact[] = ['duration', 'end', 'total', 'tokens']

// Bounds and steps of the numbers the pane sets.
export const HEAT_STEP = 5
export const HEAT_MIN = 10
export const HEAT_MAX = 95
export const MAX_ICONS_RANGE = [1, 10] as const
export const NOTES_OTHERS_RANGE = [0, 20] as const

export const DEFAULT_SETTINGS: BandSettings = {
  show: {
    model: true,
    effort: true,
    cwd: true,
    branch: true,
    context: true,
    fiveHour: true,
    sevenDay: true,
    countdowns: true,
    duration: true,
    end: true,
    total: true,
    tokens: true,
    crew: true,
  },
  animate: { glints: true, shuttle: true, spinner: true },
  frameColor: THEME_FRAME,
  effortColor: 'claude',
  branchColor: 'claude',
  gaugeColor: HEAT,
  infoColor: DIM_TEXT,
  heatOrange: 50,
  heatRed: 75,
  speed: 'normal',
  bottomOrder: [...BOTTOM_FACTS],
  maxAgentIcons: 5,
  maxTaskIcons: 5,
  notesIcon: '\u{F044}',
  settingsIcon: '\u{F423}',
  notesTab: 'global',
  resumeNotesTab: true,
  notesOthers: 8,
  hideIdleFiveHour: true,
  animateOnlyWorking: false,
  animateWithCrew: true,
}

// The settings pane's rows, in order, with their labels.
export const SHOW_LABELS: readonly (readonly [Exclude<keyof BandSettings['show'], BottomFact>, string])[] = [
  ['model', 'Modèle'],
  ['effort', 'Effort'],
  ['cwd', 'Répertoire'],
  ['branch', 'Branche Git'],
  ['context', 'Jauge du contexte'],
  ['fiveHour', 'Jauge 5 h'],
  ['sevenDay', 'Jauge 7 j'],
  ['countdowns', 'Comptes à rebours'],
  ['crew', 'Sous-agents et tâches'],
]

export const BOTTOM_LABELS: Record<BottomFact, string> = {
  duration: 'Durée du tour',
  end: 'Heure de fin du tour',
  total: 'Durée totale de la session',
  tokens: 'Tokens du contexte',
}

export const ANIMATE_LABELS: readonly (readonly [keyof BandSettings['animate'], string])[] = [
  ['glints', 'Reflets du cadre'],
  ['shuttle', 'Navette des jauges'],
  ['spinner', 'Spinner des sous-agents'],
]

export const SPEEDS: readonly (readonly [BandSettings['speed'], string])[] = [
  ['slow', 'Lente'],
  ['normal', 'Normale'],
  ['fast', 'Rapide'],
]

// How much faster than normal each speed runs.
export const SPEED_FACTORS: Record<BandSettings['speed'], number> = { slow: 0.5, normal: 1, fast: 2 }

export const NOTE_TABS: readonly (readonly [NoteTab, string])[] = [
  ['global', 'Global'],
  ['project', 'Projet'],
  ['session', 'Session'],
]

// Mid-saturation tones, readable on dark and light themes alike.
export const PALETTE: readonly (readonly [string, string])[] = [
  ['#d4a72c', 'Jaune'],
  ['#e3742f', 'Orange'],
  ['#f85149', 'Rouge'],
  ['#db61a2', 'Rose'],
  ['#a371f7', 'Violet'],
  ['#58a6ff', 'Bleu'],
  ['#39c5cf', 'Cyan'],
  ['#3fb950', 'Vert'],
  ['#8b949e', 'Gris'],
]

export const FRAME_COLORS: readonly (readonly [string, string])[] = [[THEME_FRAME, 'Thème'], ...PALETTE]

export const ACCENTS: readonly (readonly [string, string])[] = [['claude', 'Claude'], ...PALETTE]

export const GAUGE_COLORS: readonly (readonly [string, string])[] = [[HEAT, 'Chaleur'], ...PALETTE]

export const INFO_COLORS: readonly (readonly [string, string])[] = [[DIM_TEXT, 'Discret'], ...PALETTE]

const HEX = /^#[0-9a-f]{6}$/i

// `#rrggbb` from what the person typed (`#D4A72C`, `d4a72c`), or undefined.
export function hexOf(text: string): string | undefined {
  const value = text.trim().replace(/^#?/, '#').toLowerCase()
  return HEX.test(value) ? value : undefined
}

function flags<T extends Record<string, boolean>>(defaults: T, stored: unknown): T {
  const value = typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {}
  const result = { ...defaults }
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    const flag = value[key as string]
    if (typeof flag === 'boolean') result[key] = flag as T[keyof T]
  }
  return result
}

// A stored color: one of `named` (a theme key, `heat`), else hex, else none.
function colorOf(stored: unknown, named: readonly string[]): string | undefined {
  if (typeof stored !== 'string') return undefined
  return named.includes(stored) ? stored : hexOf(stored)
}

// A stored whole number within bounds, else none.
function numberOf(stored: unknown, [min, max]: readonly [number, number]): number | undefined {
  return typeof stored === 'number' && Number.isInteger(stored) && stored >= min && stored <= max ? stored : undefined
}

function oneOf<T extends string>(stored: unknown, choices: readonly (readonly [T, string])[]): T | undefined {
  return choices.find(([value]) => value === stored)?.[0]
}

// A stored order of the bottom facts: each once, the missing ones after.
function orderOf(stored: unknown): BottomFact[] {
  const listed = Array.isArray(stored) ? stored.filter((fact): fact is BottomFact => BOTTOM_FACTS.includes(fact as BottomFact)) : []
  const unique = [...new Set(listed)]
  return [...unique, ...BOTTOM_FACTS.filter(fact => !unique.includes(fact))]
}

// The heat thresholds, orange below red by a step at least.
export function thresholdsOf(orange: number, red: number): [number, number] {
  const shownOrange = Math.min(Math.max(orange, HEAT_MIN), HEAT_MAX - HEAT_STEP)
  return [shownOrange, Math.min(Math.max(red, shownOrange + HEAT_STEP), HEAT_MAX)]
}

// What `$.store` holds as settings, each field checked: a missing or invalid
// one takes its default.
export function settingsOf(stored: unknown): BandSettings {
  const value = typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {}
  const [heatOrange, heatRed] = thresholdsOf(
    numberOf(value.heatOrange, [HEAT_MIN, HEAT_MAX]) ?? DEFAULT_SETTINGS.heatOrange,
    numberOf(value.heatRed, [HEAT_MIN, HEAT_MAX]) ?? DEFAULT_SETTINGS.heatRed,
  )
  return {
    show: flags(DEFAULT_SETTINGS.show, value.show),
    animate: flags(DEFAULT_SETTINGS.animate, value.animate),
    frameColor: colorOf(value.frameColor, [THEME_FRAME]) ?? DEFAULT_SETTINGS.frameColor,
    effortColor: colorOf(value.effortColor, ['claude']) ?? DEFAULT_SETTINGS.effortColor,
    branchColor: colorOf(value.branchColor, ['claude']) ?? DEFAULT_SETTINGS.branchColor,
    gaugeColor: colorOf(value.gaugeColor, [HEAT]) ?? DEFAULT_SETTINGS.gaugeColor,
    infoColor: colorOf(value.infoColor, [DIM_TEXT]) ?? DEFAULT_SETTINGS.infoColor,
    heatOrange,
    heatRed,
    speed: oneOf(value.speed, SPEEDS) ?? DEFAULT_SETTINGS.speed,
    bottomOrder: orderOf(value.bottomOrder),
    maxAgentIcons: numberOf(value.maxAgentIcons, MAX_ICONS_RANGE) ?? DEFAULT_SETTINGS.maxAgentIcons,
    maxTaskIcons: numberOf(value.maxTaskIcons, MAX_ICONS_RANGE) ?? DEFAULT_SETTINGS.maxTaskIcons,
    notesIcon: oneOf(value.notesIcon, NOTES_ICONS) ?? DEFAULT_SETTINGS.notesIcon,
    settingsIcon: oneOf(value.settingsIcon, SETTINGS_ICONS) ?? DEFAULT_SETTINGS.settingsIcon,
    notesTab: oneOf(value.notesTab, NOTE_TABS) ?? DEFAULT_SETTINGS.notesTab,
    resumeNotesTab: typeof value.resumeNotesTab === 'boolean' ? value.resumeNotesTab : DEFAULT_SETTINGS.resumeNotesTab,
    notesOthers: numberOf(value.notesOthers, NOTES_OTHERS_RANGE) ?? DEFAULT_SETTINGS.notesOthers,
    hideIdleFiveHour: typeof value.hideIdleFiveHour === 'boolean' ? value.hideIdleFiveHour : DEFAULT_SETTINGS.hideIdleFiveHour,
    animateOnlyWorking: typeof value.animateOnlyWorking === 'boolean' ? value.animateOnlyWorking : DEFAULT_SETTINGS.animateOnlyWorking,
    animateWithCrew: typeof value.animateWithCrew === 'boolean' ? value.animateWithCrew : DEFAULT_SETTINGS.animateWithCrew,
  }
}
