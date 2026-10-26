import type { Register } from 'claude-code'

import { registerActivity } from './statusline/activity'
import { registerStatusline } from './statusline/statusline'

// One hooks module per plugin: each feature of dx registers its own hooks here.
export const register: Register = on => {
  registerStatusline(on)
  registerActivity(on)
}
