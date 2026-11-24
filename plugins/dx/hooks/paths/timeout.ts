import type { EngineInterface } from 'claude-code'

// `promise`'s value, or `fallback` when it rejects or has not settled within
// `ms`; the engine's timer stopped as soon as either comes.
export async function withTimeout<T, F>($: EngineInterface, promise: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  const timer = new AbortController()
  const timedOut = $.clock.sleep(ms, { signal: timer.signal }).then(
    () => fallback,
    () => fallback,
  )
  try {
    return await Promise.race([promise.catch(() => fallback), timedOut])
  } finally {
    timer.abort()
  }
}
