// Pure helpers several features share (times of day, errors as text): no
// `$`, so they are tested on their own.

// The letter a duration writes days with: `j` (jours) or `d` (days).
export type DayUnit = 'j' | 'd'

// The local time of day, `14:32`.
export function clockTime(ms: number): string {
  const date = new Date(ms)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

// The local day and time, `31/10 14:32`.
export function dayTime(ms: number): string {
  const date = new Date(ms)
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')} ${clockTime(ms)}`
}

// What went wrong, as text: an Error's message, anything else as a string.
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
