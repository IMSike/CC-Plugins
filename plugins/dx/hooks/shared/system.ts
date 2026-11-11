import type { EngineInterface } from 'claude-code'

// What the features that run a tool the system ships (ADR 0003, ADR 0006)
// share: which system it is, its environment, PowerShell's launch line.

// Whether the system is Windows, as its `OS` variable says. A refused read
// rejects: each caller says what it then takes the system for.
export async function isWindows($: EngineInterface): Promise<boolean> {
  return (await $.env.get('OS')) === 'Windows_NT'
}

// The values environment reads found: one that failed, or set empty, is
// unset, the others kept all the same. The reads are passed made, each
// `$.env.get` naming its variable literally, as the engine requires.
export async function envValues(reads: readonly Promise<string | undefined>[]): Promise<(string | undefined)[]> {
  const values = await Promise.all(reads.map(value => value.catch(() => undefined)))
  return values.map(value => (value === '' ? undefined : value))
}

// The command line running a PowerShell script: no profile, no prompt.
export function powershell(script: string): string[] {
  return ['powershell', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodeCommand(script)]
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// A script as PowerShell's `-EncodedCommand` takes it: UTF-16LE, in base64.
// No quoting to get right, since `$.process.run` hands arguments to no shell.
export function encodeCommand(script: string): string {
  const bytes: number[] = []
  for (let index = 0; index < script.length; index += 1) {
    const code = script.charCodeAt(index)
    bytes.push(code & 0xff, code >> 8)
  }
  let out = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const b = bytes[index + 1]
    const c = bytes[index + 2]
    const n = ((bytes[index] ?? 0) << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += BASE64[(n >> 18) & 63] ?? ''
    out += BASE64[(n >> 12) & 63] ?? ''
    out += b === undefined ? '=' : (BASE64[(n >> 6) & 63] ?? '')
    out += c === undefined ? '=' : (BASE64[n & 63] ?? '')
  }
  return out
}
