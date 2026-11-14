import type { EngineInterface } from 'claude-code'

import type { BandSettings } from '../../types'

// The refreshes the settings pace (`refresh`): the activity's and the band's.

// How much longer than normal each pace waits between two refreshes.
export const REFRESH_FACTORS: Record<BandSettings['refresh'], number> = { slow: 2, normal: 1, fast: 0.5 }
const FASTEST = Math.min(...Object.values(REFRESH_FACTORS))

// Runs `fn` every `ms` times the factor of the pace set, read at each step,
// so a change applies at once: a clock at the fastest pace, each step passed
// over until that long has gone since the last run (half a step's leeway for
// a clock a little early). A run that fails is left to the next.
export async function everyRefresh(
  $: EngineInterface,
  ms: number,
  pace: () => Promise<BandSettings['refresh']>,
  fn: () => Promise<void>,
): Promise<void> {
  const step = ms * FASTEST
  let last = await $.clock.now()
  const run = async () => {
    const now = await $.clock.now()
    if (now - last + step / 2 < ms * REFRESH_FACTORS[await pace()]) return
    last = now
    await fn()
  }
  $.clock.every(step, () => {
    run().catch(() => undefined)
  })
}
