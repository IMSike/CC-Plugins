# dx

Developer experience for Claude Code. Displayed text is in French for now.

**Status band**, an instrument panel above the prompt, laid out in the terminal's width:

```text
╭─ ✻ Opus 5.5 ─ ▰▰▰▰▱ xhigh ────────────────── ~/repo/app ⎇ dev ─╮
│ ctx  22% ◎◎◎◎◎◎◎◎◎◎···································         │
│ 5h   12% ◎◎◎◎◎◉◉◉◉◉◉◉◉◉·······························  ↻ 3h24 │
│ 7d   71% ◎◎◎◎◎◎◎◎◎◎◎◎◎◎◎◎◎◎◎◎◉◉◉◉◉◉◉◉◉◉◉◉············· ↻ 1j15h │
╰────────────────────────────────────── 24k/200k · session 1h12 ─╯
```

Model, effort meter, directory and Git branch; bead gauges for the context window and the 5-hour and 7-day usage limits, in a green, yellow, orange and red heat gradient, a glow gliding along each one; the gap to a steady consumption marked with other beads, pale for the budget left, in full color for what is consumed ahead of it; a countdown to each reset, turning into a red `⚠` forecast when a limit will run out first; a yellow frame, two glints going round it. In the bottom border, an icon per subagent (turning like Claude Code's spinner while it works) and per background task (a robot for a Claude or Cursor CLI): a click shows the subagent's transcript or the task's command and output, a second click puts it away. No dependency: no `jq`, no script, nothing to configure; background tasks are checked against the system's own process list (PowerShell, `ps`).

Requires Claude Code 2.1.310 or later (function hooks, early access).

```text
/plugin marketplace add IMSike/CC-Plugins
/plugin install dx@cc-plugins
```

Documentation: [English](../../docs/en/plugins/dx.md) · [Français](../../docs/fr/plugins/dx.md)
