import type { EngineInterface, Register } from 'claude-code'

import { registerActivity, startActivity } from './activity/activity'
import { registerNotes, startNotes, startNotesTurn } from './notes/notes'
import { registerSettings, startSettings, startSettingsTurn } from './settings/settings'
import { errorText } from './shared/format'
import { registerStatusline, startStatusline, startStatuslineTurn } from './statusline/statusline'

// Waits for one feature's start: one that fails leaves the next ones to
// start, rather than every feature after it never started, and the debug log
// says which and why.
async function started($: EngineInterface, feature: string, start: Promise<void>): Promise<void> {
  await start.catch((error: unknown) => $.ui.log(`dx : démarrage échoué, ${feature} (${errorText(error)})`, { to: 'debug' }))
}

// One hooks module per plugin: each feature of dx registers its own hooks here.
// The engine takes one hook per event without a matcher in the whole plugin:
// `session.start` and `turn.start` are registered here, calling each feature's
// start function in turn.
export const register: Register = on => {
  registerStatusline(on)
  registerActivity(on)
  registerSettings(on)
  registerNotes(on)

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    // The settings first: the notes read the tab a pane opens on, the band
    // what it shows. The notes then the activity, neither reading the other;
    // the band last, its first snapshot drawn with everything loaded.
    await started($, 'réglages', startSettings($))
    await started($, 'notes', startNotes($))
    await started($, 'activité', startActivity($))
    await started($, 'bandeau', startStatusline($))

    return result
  })

  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    // The band times the turn before the settings and the notes follow a
    // `/clear`.
    await started($, 'bandeau, tour', startStatuslineTurn($, e))
    await started($, 'réglages, tour', startSettingsTurn($))
    await started($, 'notes, tour', startNotesTurn($, e))

    return result
  })
}
