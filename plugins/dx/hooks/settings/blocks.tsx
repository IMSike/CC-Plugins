import type { Elements, RenderChildren } from 'claude-code'

import type { BandSettings } from '../../types'
import { DIM_TEXT, HEAT, HEAT_STEP, thresholdsOf } from '../shared/options'
import type { PressPart, PressStyle } from '../shared/press'
import { pressBoard } from '../shared/presses'
import { STEPPER_COLUMNS } from './stepper'
import type { StepperProps } from './stepper'

// The building blocks the settings pane's tabs are drawn with: a section, a
// toggle, segments, a stepper, the colors and icons pickers, a press. Built
// once per render by ./settings, each tab's file (./appearance, ./functions)
// drawing its sections with them.

// The toggles go in two columns from this inner width.
const TWO_COLUMNS_FROM = 44
// A color choice's cell: its mark, its swatch, the longest name.
const CHOICE_COLUMNS = 13
// An icon choice's cell: its mark, the glyph, the longest name.
const ICON_COLUMNS = 26

const BOLD: PressStyle = { bold: true }

export type Edit = (current: BandSettings) => BandSettings

// What each stepper sets, from the number it posts.
export const STEPPERS = {
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
export type Stepper = keyof typeof STEPPERS

export function isStepper(value: unknown): value is Stepper {
  return typeof value === 'string' && Object.hasOwn(STEPPERS, value)
}

// A press's change; a color's, also the key of its colors, whose hex field's
// warning it ends; the reset's, applying a color to each, ends any (`isReset`).
export type SettingsPress = { edit: Edit; colors?: string; isReset?: true }

// The elements the blocks draw with, as the pane's render resolves them.
export type SettingsElements = Pick<Elements['terminal'], 'Box' | 'Client' | 'Input' | 'Text'>

// The hex fields: the key of the colors whose field holds no color, said
// under it; a keystroke in a field; a text submitted, with what a color
// applies.
export type HexFields = {
  badHex: string | null
  onInput: (key: string) => void
  onSubmit: (key: string, typed: string, edit: (current: BandSettings, hex: string) => BandSettings) => void
}

export type SettingsBlocks = ReturnType<typeof settingsBlocks>

// The blocks for a pane `columns` wide. Nothing is awaited from the moment
// they are built: the presses drawn (`actions`) replace the last ones.
export function settingsBlocks(elements: SettingsElements, columns: number, hex: HexFields) {
  const { Box, Client, Input, Text } = elements
  // Inside a section's border and padding.
  const inner = Math.max(20, columns - 4)
  const half = inner >= TWO_COLUMNS_FROM ? Math.floor(inner / 2) : inner

  const section = (key: string, title: string, children: RenderChildren[]) => (
    <Box key={key} flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>
      <Text bold color="claude">{title}</Text>
      {children}
    </Box>
  )
  // A press that applies `edit` (../shared/presses). `width`: its cell's, the
  // label cut there.
  const board = pressBoard<SettingsPress>(Client, 'settings:')
  const press = (key: string, edit: Edit, parts: PressPart[], width?: number, hover = BOLD) => board.press(key, { edit }, parts, hover, width)
  const mark = (checked: boolean): PressPart => ({ text: checked ? '◉ ' : '○ ', color: checked ? 'success' : 'subtle' })
  const toggle = (key: string, checked: boolean, label: string, edit: Edit, width = half) => (
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
            {board.press(
              `${key}-${color.replace('#', '')}`,
              { edit: current => edit(current, color), colors: key },
              choice(color, label, color === current),
              BOLD,
              CHOICE_COLUMNS,
            )}
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
          onInput={() => hex.onInput(key)}
          onSubmit={typed => hex.onSubmit(key, typed, edit)}
        />
        {hex.badHex === key && (
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

  return { elements, inner, half, board, actions: board.actions, section, press, toggle, segments, stepper, colors, icons }
}
