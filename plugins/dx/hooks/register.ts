import type { Register } from 'claude-code'

import { registerActivity } from './statusline/activity'
import { registerNotes } from './statusline/notes'
import { registerSettings } from './statusline/settings'
import { registerStatusline } from './statusline/statusline'

// One hooks module per plugin: each feature of dx registers its own hooks here.
export const register: Register = on => {
  registerStatusline(on)
  registerActivity(on)
  registerSettings(on)
  registerNotes(on)
}
