import type { EngineInterface, Register } from 'claude-code'

import { registerActivity, startActivity } from './activity/activity'
import { registerNotes, startNotes, startNotesTurn } from './notes/notes'
import { registerSettings, startSettings, startSettingsTurn } from './settings/settings'
import { errorText } from './shared/format'
import { registerStatusline, startStatusline, startStatuslineTurn } from './statusline/statusline'

// Waits for one feature's start: one that fails never keeps another from
// starting, and the debug log says which and why.
async function started($: EngineInterface, feature: string, start: Promise<void>): Promise<void> {
  await start.catch((error: unknown) => $.ui.log(`dx : démarrage échoué, ${feature} (${errorText(error)})`, { to: 'debug' }))
}

// One hooks module per plugin: each feature of dx registers its own hooks here.
// The engine takes one hook per event without a matcher in the whole plugin:
// `session.start` and `turn.start` are registered here, calling each feature's
// start function.
export const register: Register = on => {
  registerStatusline(on)
  registerActivity(on)
  registerSettings(on)
  registerNotes(on)

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    // The notes after the settings: they read the tab a pane opens on. The
    // activity and the band read no settings to start, drawing them from the
    // state as they change: they start meanwhile, never waiting on a settings
    // save under way, which the settings' start waits for at a reload.
    await Promise.all([
      started($, 'réglages', startSettings($)).then(() => started($, 'notes', startNotes($))),
      started($, 'activité', startActivity($)),
      started($, 'bandeau', startStatusline($)),
    ])

    return result
  })

  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    // The band times the turn, the settings and the notes follow a `/clear`:
    // none reads what another writes.
    await Promise.all([
      started($, 'bandeau, tour', startStatuslineTurn($, e)),
      started($, 'réglages, tour', startSettingsTurn($, e)),
      started($, 'notes, tour', startNotesTurn($, e)),
    ])

    return result
  })
}
