# dx

Developer experience for Claude Code. Displayed text is in French for now.

**Status band**, an instrument panel above the prompt, laid out in the terminal's width:

```text
╭─ ✻ Opus 5.5 ─ ▰▰▰▰▱ xhigh ────────── ~/repo/app ⎇ dev ─ ✎  ⚙  ─╮
│ ctx  22% ◎◎◎◎◎◎◎◎◎◎···································         │
│ 5h   12% ◎◎◎◎◎◉◉◉◉◉◉◉◉◉·······························  ↻ 3h24 │
│ 7j   71% ◎◎◎◎◎◎◎◎◎◎◎◎◎◎◎◎◎◎◎◎◉◉◉◉◉◉◉◉◉◉◉◉············· ↻ 1j15h │
╰─ ✻  ✻  ▣  ▣  ─ durée 1m04 · fin 14:32 · total 1h12 · 24k/200k ─╯
```

Model, effort meter, directory and Git branch; bead gauges for the context window and the 5-hour and 7-day usage limits, in a green, yellow, orange and red heat gradient, a glow gliding along each one; the gap to a steady consumption marked with other beads, pale for the budget left, in full color for what is consumed ahead of it; a countdown to each reset, turning into a red `⚠` forecast when a limit will run out first; a yellow frame, two glints going round it; the last turn's duration and end time, the session's total. In the bottom border, an icon per subagent (turning like Claude Code's spinner while it works) and per background task (a robot for a Claude or Cursor CLI): a click shows the subagent's transcript or the task's command and output, a second click brings back the main conversation or closes the side panel. In the top border, `✎` opens notes of your own (global, project, session), kept out of Claude's context, and `⚙` the settings: what to show and animate, the colors. On Windows, an optional setting writes the clipboard again after each copy, so that it pastes into a Remote Desktop session. Inside herdr on Windows, the paths of Claude's replies become links a ctrl+click opens through herdr's `imsike.links` plugin. The settings' footer opens Claude Code's configuration folder in the File Explorer. No dependency: no `jq`, no script, nothing to configure for the rest (the clickable paths alone need `"FORCE_HYPERLINK": "1"` in the `env` of Claude Code's settings, the herdr plugin installed, and Windows Terminal's `experimental.detectURLs` off for safety: see the page); background tasks are checked against the system's own process list (PowerShell, `ps`), the notes' **Coller** button reads the clipboard with the system's own tools, the clipboard is written again by Windows PowerShell, and the configuration folder is opened by Windows PowerShell; inside herdr, herdr's list of its plugins is read as the session starts (up to four more times within five minutes, should herdr fail).

Requires Claude Code 2.1.330 or later (function hooks, early access).

```text
/plugin marketplace add IMSike/CC-Plugins
/plugin install dx@cc-plugins
```

Documentation: [English](../../docs/en/plugins/dx.md) · [Français](../../docs/fr/plugins/dx.md)
