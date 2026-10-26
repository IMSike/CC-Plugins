# ADR 0003 — Background tasks: followed from the engine, checked against the system's process list

- **Status**: accepted
- **Date**: 2026-10-26

## Context

dx shows an icon per background task (a shell started with `run_in_background`, a `Monitor`) and tells an agent CLI (Claude Code, Cursor) running in one. The function-hook API lists the session's agents (`$.agent.list()`) but not its background tasks: a mod sees a task start (the `Bash` result's `backgroundTaskId`, the `Monitor` result's `taskId`) and, most of the time, end (a `TaskStop` call, the notification row of a finished task), but nothing says what runs inside a task, and an end can go unnoticed (a notification row not drawn, a reload).

The hard rules allow no runtime dependency outside Claude Code: a hooks module reaches everything through `$`. `$.process.run(argv)` starts a program without a shell; what is always there is the system's own process listing: PowerShell and CIM on Windows, `ps` elsewhere.

Options studied:

| Option | Pros | Cons |
|---|---|---|
| Engine signals only | No process started; nothing to maintain per system | No agent CLI detection; a missed end leaves an icon forever |
| The system's process list, read on every tick | Exact | One PowerShell every few seconds on Windows: about 300 ms of CPU and 80 MB of memory each time |
| Engine signals, the process list read on a schedule | Agent CLIs told apart; missed ends caught; a read only when a task is due | One process listing per check; matching a task to its shell by its command |
| A script or a native helper | Faster reads | A runtime dependency, against the hard rules |

## Decision

A task is followed from the engine's signals: added on its start, removed on `TaskStop` or its notification row. The system's process list is read only when a task is due for a check: 2 s after it starts (to tell an agent CLI in it), then after 10 s, 1 min, 5 min, and every 15 min. One read serves every task due.

- **Windows**: `powershell -NoProfile -NonInteractive -EncodedCommand <script>`, the script readable in `tasks.ts` and encoded at run time. It lists the processes once (`Get-CimInstance Win32_Process`) and returns, as JSON, Claude Code's process (PowerShell's parent) and every process under it.
- **Elsewhere**: `sh -c 'echo $PPID; ps -A -o pid=,ppid=,args='`.

A task's shell is the direct child shell of Claude Code whose command line holds at least 60% of the task's command's words (ASCII words of three characters or more): a PreToolUse hook may rewrite the command, the shell quotes it its own way, Windows garbles what is not ASCII. Under that shell, `claude` or `@anthropic-ai/claude-code` makes it a Claude CLI, `cursor-agent` a Cursor CLI. A task whose shell was found and is gone has ended; a task whose shell was never found stays until the engine reports its end.

## Consequences

- Measured on Windows: about 320 ms per read (450 ms the first), about 300 ms of CPU on one core, about 80 MB of memory for the time of the read; the session does not wait for it. With no background task, nothing is read.
- When the read fails (no PowerShell, a policy), dx falls back to the engine's signals and pushes the next checks back.
- The process list holds other programs' command lines: dx keeps only the tasks' shell ids and whether an agent CLI runs under them, in the session's state, and sends nothing anywhere.
- To be reassessed when the API lists background tasks: the process list could then go.
