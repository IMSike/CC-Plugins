import type { Register } from 'claude-code'

import { registerActivity } from './activity/activity'
import { registerNotes } from './notes/notes'
import { registerSettings } from './settings/settings'
import { registerStatusline } from './statusline/statusline'

// One hooks module per plugin: each feature of dx registers its own hooks here.
export const register: Register = on => {
  registerStatusline(on)
  registerActivity(on)
  registerSettings(on)
  registerNotes(on)
}
