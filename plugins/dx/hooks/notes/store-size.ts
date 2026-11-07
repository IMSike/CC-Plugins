import type { EngineInterface } from 'claude-code'

// How large dx's store is, as JSON text, so that a note that would bring it
// near the engine's limit (`$.store.set` rejects past 4 MiB of JSON text in
// all) is refused with a reason before the engine refuses it, margin kept for
// the settings and the engine's own way of writing the file.
export const STORE_MAX_BYTES = Math.floor(3.8 * 1024 * 1024)

// UTF-8 bytes of `text`: a code point under U+0080 takes one, under U+0800
// two, a surrogate pair four, any other three.
export function utf8Length(text: string): number {
  let bytes = 0
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && at + 1 < text.length) {
      const next = text.charCodeAt(at + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        at++
      } else bytes += 3
    } else bytes += 3
  }
  return bytes
}

// What one entry adds to the store's JSON text: `"key":value,`.
export function entryBytes(key: string, value: unknown): number {
  return utf8Length(JSON.stringify(key)) + 1 + utf8Length(JSON.stringify(value) ?? '') + 1
}

// Every entry's size, by key: measured once (every key read), then kept up
// to date by the writes that go through `storeWritten`. Other sessions, and
// dx's other writes, change the store unseen: the estimate is measured again
// at each load of the notes, and before a write is refused.
let sizes: Map<string, number> | undefined
// When `sizes` was last measured, on the engine's clock.
let measuredAt = 0
// The last entry `fitsStore` measured: `storeWritten`, writing that very
// value, takes its size from here rather than turn a long note into JSON again.
let last: { key: string; value: unknown; size: number } | undefined

// How old a measurement may be for a refusal to stand on it. Near the limit,
// each key typed is refused: measuring the whole store again for each would
// read every entry per key. dx's own writes keep `sizes` up to date anyway;
// only another session's (a note deleted to make room) goes unseen, and is
// seen within this time, as often as the pane reads its note again.
const MEASURE_MS = 1000

async function measure($: EngineInterface): Promise<Map<string, number>> {
  const keys = await $.store.keys()
  const values = await Promise.all(keys.map(key => $.store.get(key)))
  const measured = new Map<string, number>()
  keys.forEach((key, index) => measured.set(key, entryBytes(key, values[index])))
  measuredAt = await $.clock.now()
  return measured
}

function total(of: Map<string, number>): number {
  let bytes = 2
  for (const size of of.values()) bytes += size
  return bytes
}

// The estimate dropped: the next write measures the store again.
export function forgetStoreSize(): void {
  sizes = undefined
}

// Whether `value` may be written under `key`, the store staying under
// STORE_MAX_BYTES; `null` stands for a deletion, always allowed. Near the
// limit, the store is measured again before a refusal, unless it was within
// MEASURE_MS. A store that cannot be read refuses nothing here: its own write
// says what fails.
export async function fitsStore($: EngineInterface, key: string, value: unknown): Promise<boolean> {
  if (value === null) return true
  const size = entryBytes(key, value)
  last = { key, value, size }
  const over = (of: Map<string, number>) => total(of) - (of.get(key) ?? 0) + size > STORE_MAX_BYTES
  try {
    sizes ??= await measure($)
    if (!over(sizes)) return true
    if ((await $.clock.now()) - measuredAt < MEASURE_MS) return false
    sizes = await measure($)
    return !over(sizes)
  } catch {
    return true
  }
}

// A write under `key` done: the estimate follows it, `null` for a deletion.
export function storeWritten(key: string, value: unknown): void {
  if (sizes === undefined) return
  if (value === null) sizes.delete(key)
  else sizes.set(key, last !== undefined && last.key === key && last.value === value ? last.size : entryBytes(key, value))
}
