import type { RenderChildren } from 'claude-code'

import type { BandSettings, PathsFound } from '../../types'
import { LINKS_INSTALL, LINKS_PLUGIN } from '../paths/herdr-model'
import { NOTE_TABS, NOTES_OTHERS_RANGE, REFRESHES } from '../shared/options'
import type { SettingsBlocks } from './blocks'

// What the settings pane offers beyond the band's looks, as the session
// found it: the copies for Remote Desktop on Windows alone (ADR 0008); the
// clickable paths inside herdr alone, with what they need (`paths`, null
// elsewhere; ADR 0009).
export type Offered = { hasRdp: boolean; paths: PathsFound | null }

// What the clickable paths' line says: what they lack, else whether they
// are on.
function pathsStatus(found: PathsFound, isOn: boolean): string {
  const missing = [
    found.plugin === 'missing' ? `plugin herdr ${LINKS_PLUGIN} introuvable : ${LINKS_INSTALL}` : undefined,
    found.plugin === 'failed' ? `herdr ne répond pas : plugin ${LINKS_PLUGIN} non vérifié (à la prochaine session)` : undefined,
    found.plugin === 'unchecked' ? `dossier du système inconnu (SystemRoot, windir) : plugin ${LINKS_PLUGIN} non vérifié` : undefined,
    found.hyperlinks
      ? undefined
      : found.isForcedOff
        ? 'FORCE_HYPERLINK désactive les hyperliens : le mettre à 1 dans env de settings.json'
        : 'FORCE_HYPERLINK=1 manquant dans env de settings.json',
  ].filter(reason => reason !== undefined)
  if (missing.length > 0) return missing.join(' ; ')
  if (found.plugin === 'checking') return `recherche du plugin herdr ${LINKS_PLUGIN}…`
  return isOn ? "ctrl+clic sur un chemin des réponses pour l'ouvrir" : 'désactivés'
}

// The settings of what dx does: the notes, the clipboard, the paths, how
// often the band refreshes and what its gauges measure.
export function functionsSections(blocks: SettingsBlocks, value: BandSettings, { hasRdp, paths }: Offered): RenderChildren[] {
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
    paths !== null &&
      section('paths', 'Chemins', [
        toggle('clickable-paths', value.clickablePaths, 'Chemins cliquables', current => ({
          ...current,
          clickablePaths: !current.clickablePaths,
        }), inner),
        <Text key="clickable-paths-status" dimColor wrap="wrap">
          {pathsStatus(paths, value.clickablePaths)}
        </Text>,
      ]),
    section('status-bar', "Barre d'état", [
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
    ]),
  ]
}
