import type { RenderChildren } from 'claude-code'

import type { BandSettings } from '../../types'
import { NOTE_TABS, NOTES_OTHERS_RANGE, REFRESHES } from '../shared/options'
import type { SettingsBlocks } from './blocks'

// What the settings pane offers beyond the band's looks, as the session
// found it: the copies for Remote Desktop on Windows alone (ADR 0008).
export type Offered = { hasRdp: boolean }

// The settings of what dx does: the notes, the clipboard, how the band
// behaves.
export function functionsSections(blocks: SettingsBlocks, value: BandSettings, { hasRdp }: Offered): RenderChildren[] {
  const { elements, inner, section, toggle, segments, stepper } = blocks
  const { Box, Text } = elements

  return [
    section('notes', 'Notes', [
      <Box key="notes-tab" columnGap={1}>
        <Text>Onglet à l'ouverture</Text>
        {segments('notes-tab', NOTE_TABS, value.notesTab, (current, notesTab) => ({ ...current, notesTab }))}
      </Box>,
      toggle('resume-notes-tab', value.resumeNotesTab, 'Reprendre le dernier onglet ouvert', current => ({
        ...current,
        resumeNotesTab: !current.resumeNotesTab,
      }), inner),
      stepper('notes-others', 'Autres sessions listées', value.notesOthers, '', NOTES_OTHERS_RANGE, 1),
      toggle('copy-on-select', value.copyOnSelect, "Copier la sélection dès qu'elle est faite", current => ({
        ...current,
        copyOnSelect: !current.copyOnSelect,
      }), inner),
    ]),
    hasRdp &&
      section('clipboard', 'Presse-papiers', [
        toggle('rdp-clipboard', value.rdpClipboard, 'Réparer les copies pour le Bureau à distance (TSE)', current => ({
          ...current,
          rdpClipboard: !current.rdpClipboard,
        }), inner),
        <Text key="rdp-clipboard-hint" dimColor>
          Réécrit le presse-papiers 1 à 2 s après chaque copie vue (sélection, /copy) ; /dx-tse le fait à la demande.
        </Text>,
      ]),
    section('behavior', 'Comportement', [
      <Box key="refresh" columnGap={1}>
        <Text>Rafraîchissement</Text>
        {segments('refresh', REFRESHES, value.refresh, (current, refresh) => ({ ...current, refresh }))}
      </Box>,
      toggle('hide-idle-five-hour', value.hideIdleFiveHour, "Masquer la jauge 5 h tant que sa fenêtre n'a pas commencé", current => ({
        ...current,
        hideIdleFiveHour: !current.hideIdleFiveHour,
      }), inner),
      toggle('context-to-compact', value.contextToCompact, "Jauge du contexte rapportée au seuil d'auto-compactage", current => ({
        ...current,
        contextToCompact: !current.contextToCompact,
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
    ]),
  ]
}
