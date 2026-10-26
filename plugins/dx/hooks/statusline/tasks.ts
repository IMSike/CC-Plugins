import type { CliAgent } from '../../types'

// The background tasks' processes, read from the system (ADR 0003): which
// shell runs a task, and whether an agent CLI runs under it.

export type Proc = { pid: number; ppid: number; name: string; cmd: string }
export type ProcessTree = { self: number; procs: Proc[] }

// Lists this session's process (the parent of the PowerShell `$.process.run`
// starts) and every process under it, as JSON: `{ self, procs: [{p, pp, n, c}] }`.
export const WINDOWS_TREE = String.raw`$ProgressPreference = 'SilentlyContinue'
$all = Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,CommandLine
$me = ($all | Where-Object { $_.ProcessId -eq $PID }).ParentProcessId
$kids = @{}
foreach ($p in $all) { $k = [string]$p.ParentProcessId; if (-not $kids.ContainsKey($k)) { $kids[$k] = New-Object System.Collections.ArrayList }; [void]$kids[$k].Add($p) }
$out = New-Object System.Collections.ArrayList
$seen = @{}
$queue = New-Object System.Collections.Queue
$queue.Enqueue([string]$me)
while ($queue.Count -gt 0) {
  $id = $queue.Dequeue()
  if ($kids.ContainsKey($id)) {
    foreach ($c in $kids[$id]) {
      $cid = [string]$c.ProcessId
      if ($c.ProcessId -ne $PID -and -not $seen.ContainsKey($cid)) {
        $seen[$cid] = $true
        [void]$out.Add(@{ p = $c.ProcessId; pp = $c.ParentProcessId; n = $c.Name; c = $c.CommandLine })
        $queue.Enqueue($cid)
      }
    }
  }
}
ConvertTo-Json -Compress -Depth 3 @{ self = $me; procs = @($out) }`

// Prints the session's process id (the parent of `sh`), then every process.
export const POSIX_TREE = 'echo $PPID; ps -A -o pid=,ppid=,args='

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

export function parseWindowsTree(stdout: string): ProcessTree {
  const parsed = JSON.parse(stdout) as { self: number; procs: { p: number; pp: number; n: string; c: string | null }[] }
  return {
    self: parsed.self,
    procs: parsed.procs.map(proc => ({ pid: proc.p, ppid: proc.pp, name: proc.n.toLowerCase(), cmd: proc.c ?? '' })),
  }
}

export function parsePosixTree(stdout: string): ProcessTree {
  const [first = '', ...lines] = stdout.split('\n')
  const self = Number(first.trim())
  const all = lines.flatMap(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    if (match === null) return []
    const cmd = match[3] ?? ''
    const name = (cmd.split(' ')[0] ?? '').split('/').pop()?.toLowerCase() ?? ''
    return [{ pid: Number(match[1]), ppid: Number(match[2]), name, cmd }]
  })
  return { self, procs: descendants(all, self) }
}

export function descendants(procs: readonly Proc[], root: number): Proc[] {
  const out: Proc[] = []
  const queue = [root]
  const seen = new Set<number>([root])
  while (queue.length > 0) {
    const parent = queue.shift()
    for (const proc of procs) {
      if (proc.ppid === parent && !seen.has(proc.pid)) {
        seen.add(proc.pid)
        out.push(proc)
        queue.push(proc.pid)
      }
    }
  }
  return out
}

export const SHELLS = new Set(['bash.exe', 'bash', 'sh', 'sh.exe', 'zsh', 'cmd.exe'])

// The share of a command's words its shell's command line must hold.
const MIN_MATCH = 0.6

// The shell running a command: the one whose command line holds most of its
// words. Not an exact match, since a PreToolUse hook may rewrite the command
// (`rtk ping` for `ping`), the shell quotes it its own way, and Windows may
// garble what is not ASCII.
export function shellOf(command: string, shells: readonly Proc[]): Proc | undefined {
  const words = [...new Set(command.match(/[A-Za-z0-9_./:=-]{3,}/g) ?? [])]
  if (words.length === 0) return undefined
  let best: { shell: Proc; score: number } | undefined
  for (const shell of shells) {
    const score = words.filter(word => shell.cmd.includes(word)).length / words.length
    if (score >= MIN_MATCH && (best === undefined || score > best.score)) best = { shell, score }
  }
  return best?.shell
}

// The agent CLI running somewhere under a shell, from the processes alone.
export function cliAgentUnder(procs: readonly Proc[], shell: number): CliAgent | undefined {
  for (const proc of descendants(procs, shell)) {
    if (SHELLS.has(proc.name)) continue
    if (proc.name === 'claude.exe' || proc.name === 'claude' || proc.cmd.includes('@anthropic-ai/claude-code')) return 'claude'
    if (/cursor-agent/i.test(proc.cmd)) return 'cursor'
  }
  return undefined
}

// The output file a tool's result names, wherever in it: `…/<id>.output`.
export function outputOf(result: unknown, id: string): string | undefined {
  const text = JSON.stringify(result ?? '').replace(/\\\\/g, '\\')
  return new RegExp(`[A-Za-z]:[\\\\/][^"'<>\\n]*?[\\\\/]${id}\\.output|/[^"'<>\\s]*?/${id}\\.output`).exec(text)?.[0]
}

// The folder the engine writes a session's background output to:
// `<temp>/claude/<project>/<session>/tasks`, the project its directory with
// every character but letters and digits turned into `-`.
export function tasksDirOf(temp: string, cwd: string, session: string): string {
  return `${temp.replace(/[\\/]+$/, '')}/claude/${cwd.replace(/[^A-Za-z0-9]/g, '-')}/${session}/tasks`
}
