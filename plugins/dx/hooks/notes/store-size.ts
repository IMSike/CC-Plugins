import type { EngineInterface } from 'claude-code'

import { NOTE_MAX_CHARS } from './editor-model'

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
// at each load of the notes, before a write is refused, and, the room short,
// as the pane polls (`storeRoom` called `fresh`).
let sizes: Map<string, number> | undefined
// When `sizes` was last measured, on the engine's clock.
let measuredAt = 0
// The last entry `fitsStore` measured: `storeWritten`, writing that very
// value, takes its size from here rather than turn a long note into JSON again.
let last: { key: string; value: unknown; size: number } | undefined
// The writes made while each measurement under way reads the store, by key
// (null for a deletion): it may have read an entry before its write.
const writesDuring = new Set<Map<string, number | null>>()

// How old a measurement may be for a refusal to stand on it. Near the limit,
// each key typed is refused: measuring the whole store again for each would
// read every entry per key. dx's own writes keep `sizes` up to date anyway;
// only another session's (a note deleted to make room) goes unseen, and is
// seen within this time, as often as the pane reads its note again.
const MEASURE_MS = 1000

// Measures the store and keeps the result as `sizes`, the writes made
// meanwhile laid over it: a save that lands during the reads is never lost.
async function measure($: EngineInterface): Promise<Map<string, number>> {
  const writes = new Map<string, number | null>()
  writesDuring.add(writes)
  try {
    const keys = await $.store.keys()
    const values = await Promise.all(keys.map(key => $.store.get(key)))
    const measured = new Map<string, number>()
    keys.forEach((key, index) => measured.set(key, entryBytes(key, values[index])))
    measuredAt = await $.clock.now()
    for (const [key, size] of writes) {
      if (size === null) measured.delete(key)
      else measured.set(key, size)
    }
    sizes = measured
    return measured
  } finally {
    writesDuring.delete(writes)
  }
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
    if (!over(sizes ?? (await measure($)))) return true
    if ((await $.clock.now()) - measuredAt < MEASURE_MS) return false
    return !over(await measure($))
  } catch {
    return true
  }
}

// The most UTF-8 bytes one UTF-16 code unit of a note's text takes in the
// store's JSON text, as `entryBytes` counts it: JSON.stringify writes a
// control character other than \b \f \n \r \t as `\u00XX`, and a lone
// surrogate as `\uDXXX`, six bytes each; `"` and `\` take two, a code unit
// under U+0080 one, under U+0800 two, any other three (U+2028 and U+2029
// among them, left as they are), a surrogate pair four for its two units.
export const UNIT_MAX_BYTES = 6

// What an entry adds beyond its text's characters, at the most: its key, the
// note's fields, and a time of as many digits as a number written plainly
// may take. Counted whole even for a note the store holds already.
function entryOverhead(key: string): number {
  return entryBytes(key, { text: '', updatedAt: Number.MAX_SAFE_INTEGER })
}

// Below this much room, the store may bound a note more closely than
// NOTE_MAX_CHARS does (a key's overhead well within the margin): the
// estimate is then measured again as the pane polls.
const SHORT_ROOM = NOTE_MAX_CHARS * UNIT_MAX_BYTES + 1024

// The room left in the store by the estimate, in bytes: the store measured
// only when it is not known yet (the first render after a load), never at
// each render. `fresh`, from the pane's poll: measured again too when the
// room is short and the measurement older than MEASURE_MS, so that another
// session's deletion is seen within a poll. Undefined when the store cannot
// be read: then it bounds nothing, as `fitsStore` refuses nothing.
export async function storeRoom($: EngineInterface, fresh = false): Promise<number | undefined> {
  try {
    let known = sizes ?? (await measure($))
    if (fresh && STORE_MAX_BYTES - total(known) < SHORT_ROOM && (await $.clock.now()) - measuredAt >= MEASURE_MS) {
      known = await measure($)
    }
    return STORE_MAX_BYTES - total(known)
  } catch {
    return undefined
  }
}

// The longest the note under `key`, `stored` characters long in the store,
// may grow to now: its length, plus as many characters as the room left
// holds at UNIT_MAX_BYTES each once its entry's overhead is set aside, and
// NOTE_MAX_CHARS at the most (an encoded length, never below the raw one: a
// bound on it too). Every character typed then fits, whatever it
// is. Only an edit that weighs more than its new characters (a letter
// replaced by a control character, a surrogate pair split apart) may not,
// which `fitsStore` still refuses at the save.
export function noteMax(key: string, stored: number, room: number | undefined): number {
  if (room === undefined) return NOTE_MAX_CHARS
  const growth = Math.max(0, Math.floor((room - entryOverhead(key)) / UNIT_MAX_BYTES))
  return Math.min(NOTE_MAX_CHARS, stored + growth)
}

// A write under `key` done: the estimate follows it, and so will each
// measurement under way; `null` for a deletion.
export function storeWritten(key: string, value: unknown): void {
  if (sizes === undefined && writesDuring.size === 0) return
  const size = value === null ? null : last !== undefined && last.key === key && last.value === value ? last.size : entryBytes(key, value)
  for (const writes of writesDuring) writes.set(key, size)
  if (sizes === undefined) return
  if (size === null) sizes.delete(key)
  else sizes.set(key, size)
}
