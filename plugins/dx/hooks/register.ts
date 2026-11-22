import type { EngineInterface, Register } from 'claude-code'

import { registerActivity, startActivity } from './activity/activity'
import { registerNotes, startNotes, startNotesTurn } from './notes/notes'
import { registerRdp, startRdp } from './rdp/rdp'
import { registerSettings, startSettings, startSettingsTurn } from './settings/settings'
import { errorText } from './shared/format'
import { forgetSystemFolder, systemFolder } from './shared/system'
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
  registerRdp(on)

  on('session.start', async ($, e, next) => {
    // Started even when the start beneath dx fails: otherwise the band, the
    // activity and the notes would never start, nor the settings be read.
    try {
      return await next(e)
    } finally {
      // The notes after the settings: they read the tab a pane opens on. The
      // activity and the band read no settings to start, drawing them from the
      // state as they change: they start meanwhile, never waiting on a settings
      // save under way, which the settings' start waits for at a reload. The
      // clipboard's rewrite for Remote Desktop starts once the settings are
      // read, as it reads the selection only while its setting is on. The
      // system's folder, which several of them use, is looked for anew first,
      // and at once: the settings pane offers what needs it (the copies for
      // Remote Desktop, the configuration folder button) only once it is
      // found, and would otherwise leave them out until a feature asks for it.
      forgetSystemFolder()
      void systemFolder($)
      await Promise.all([
        started($, 'réglages', startSettings($)).then(() =>
          Promise.all([started($, 'notes', startNotes($)), started($, 'presse-papiers TSE', startRdp($))]),
        ),
        started($, 'activité', startActivity($)),
        started($, 'bandeau', startStatusline($)),
      ])
    }
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
