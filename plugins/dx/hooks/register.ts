import type { Register } from 'claude-code'

import { registerActivity, startActivity } from './activity/activity'
import { registerNotes, startNotes, startNotesTurn } from './notes/notes'
import { registerSettings, startSettings } from './settings/settings'
import { registerStatusline, startStatusline, startStatuslineTurn } from './statusline/statusline'

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
    const started = await next(e)
    // The settings first: the notes read the tab a pane opens on, the band
    // what it shows. The notes then the activity, neither reading the other;
    // the band last, its first snapshot drawn with everything loaded.
    await startSettings($)
    await startNotes($)
    await startActivity($)
    await startStatusline($)

    return started
  })

  on('turn.start', async ($, e, next) => {
    const started = await next(e)
    // The band times the turn before the notes follow a `/clear`.
    await startStatuslineTurn($, e)
    await startNotesTurn($, e)

    return started
  })
}
