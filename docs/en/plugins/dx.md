# dx — developer experience

**English** · [Français](../../fr/plugins/dx.md)

Install: `/plugin install dx@cc-plugins` (after `/plugin marketplace add IMSike/CC-Plugins`). Requires Claude Code 2.1.310 or later.

## Status band

```text
╭─ ✻ Opus 5.5 ─ ▰▰▰▰▱ xhigh ────────────────── ~/repo/app ⎇ dev ─╮
│ ctx  22% ◎◎◎◎◎◎◎◎◎◎···································         │
│ 5h   12% ◎◎◎◎◎◉◉◉◉◉◉◉◉◉·······························  ↻ 3h24 │
│ 7d   71% ◎◎◎◎◎◎◎◎◎◎◎◎◎◎◎◎◎◎◎◎◉◉◉◉◉◉◉◉◉◉◉◉············· ↻ 1j15h │
╰─ ✻ ✻ ▣ ▣ ──────────────────────────── 24k/200k · session 1h12 ─╯
```

On screen, colors tell apart what plain text cannot: on `5h`, the `◉` are the pale budget; on `7d`, they are consumed ahead of the pace, in full color. In the bottom border, `▣` stands for the terminal icon, a Nerd Font glyph.

- **Effect**: an instrument panel directly above the prompt, framed and laid out in the terminal's width.
  - **Top border**: the spark `✻`, lit in Claude's color while Claude works and grey at rest; the model (`claude-opus-5-5` reads `Opus 5.5`, a 1M context window adds `(1M)`); the reasoning effort as a five-step meter (`low` ▰▱▱▱▱ to `max` ▰▰▰▰▰) and its name; the current directory, the home folder shown as `~`, cut from the left when space runs out; the Git branch after `⎇` (a short commit when detached).
  - **Gauges**: `ctx`, share of the context window used by the last request; `5h` and `7d`, share of the 5-hour and 7-day usage limits used. Each gauge is a string of beads: double circles `◎` for what is consumed, on a track of small dots `·`, drawn in a **heat gradient**: every cell takes the color of its position, green, yellow, orange, then red, each color blending into the next and halfway between them at 25%, 50% and 75%, so a gauge reddens as it lengthens. The percentage takes the color its value reaches.
  - **Pace** on `5h` and `7d`: the pace is where a steady consumption would stand at this point of the window (the share of the window already gone). The gap between it and the consumption is drawn in dotted circles `◉`. Behind the consumption, pale `◉` follow it: the budget, what can still be used without running ahead. Ahead of it, the consumed beads past the pace turn into `◉` in full color: usage is faster than the window allows on average, by that many beads.
  - **Shuttle**: a glow, fading out over the beads behind it, glides along the consumed beads from the first to the last, easing in and out, in 0.4 s plus 22 ms per bead (2.6 s at most: a short gauge is a quick course), then rests 3.5 s; the three gauges take turns. It moves by fractions of a bead, its light shared between two neighbours. It is drawn by the terminal itself (a `Client` element and its frame clock): the band is not recomputed for it, and nothing moves while it rests.
  - **Countdown**: `↻ 3h24`, time left before the window resets. When the window will run out before then at the rate it has been used since it started, the countdown gives way to `⚠ 1h10` in red: the time left before it runs out (no forecast during the first 2% of the window).
  - **Frame**: yellow. Two glints go round it, half a lap apart, a lap every 18 s, each a brighter stretch of the line, fading in over 4 cells ahead of it and out over 10 cells behind it; like the shuttle, they are drawn by the terminal itself.
  - **Bottom border**: on the left, what runs beside the conversation (below); on the right, context tokens over the window size, and the session's duration.
- **Data**: read from Claude Code itself (`$.session.usage()`, `$.session.model()`, the `effortLevel` setting, the effort each request is really sent with) and from the `.git/HEAD` file of the repository (read only); nothing is sent anywhere. Refreshed at the end of each turn and every 30 seconds.
- **Implications**:
  - The `5h` and `7d` lines only appear with a Claude subscription (the API reports no limits otherwise); `ctx` shows `—` until the first response.
  - The band takes five rows. It is drawn in the terminal and the desktop app; other surfaces (VS Code, mobile) do not show it.
  - It is not the status line: it sits **above** the prompt, and a `statusLine` configured in `settings.json` keeps being shown under it. Remove `statusLine` to avoid seeing the same figures twice.
  - The frame, the gauges, the effort meter and the branch use characters (`╭ ◎ ◉ ▰ ⎇`) present in common terminal fonts (Cascadia, Nerd Fonts); the robot and terminal icons need a [Nerd Font](https://www.nerdfonts.com).
  - While Claude Code shows a survey in that band, the survey takes its place.
- **Fold / unfold**: `ctrl+x ctrl+a`, or click `[-]`.

## Subagents and background tasks

The left of the bottom border holds an icon for each subagent and background task of the session, up to five of a kind, then a count (`+3`).

- **Effect**:
  - **Subagent**: `✻` in Claude's color, turning like Claude Code's own spinner (`· ✢ * ✶ ✻ ✽`, there and back, 200 ms a step) while it works, still and dim while it waits.
  - **Agent CLI** run in a background shell: a robot, in Claude's color for Claude Code, grey for Cursor.
  - **Background shell** (`run_in_background`): a terminal icon, grey; a `Monitor`: `◉`.
  - **Click a subagent**: its transcript takes the main view, as from the tasks list; its icon is underlined meanwhile. Click it again to come back to the main conversation.
  - **Click a shell or an agent CLI**: a pane opens with its command, whole, wrapped over as many lines as it needs, then the end of its output, read again every second. Click the icon again to close the pane.
  - An icon leaves the border when its subagent finishes, or its task is stopped or ends.
- **Data**: the session's agents (`$.agent.list()`); the background tasks, from the tool calls that start and stop them and from Claude Code's notification rows; their output, read from the file Claude Code writes it to. To tell an agent CLI in a shell and to catch an end Claude Code did not report, dx reads the system's process list ([ADR 0003](../adr/0003-system-process-list.md)): PowerShell on Windows, `ps` elsewhere, run without a shell, only while a task is due for a check (2 s after it starts, then after 10 s, 1 min, 5 min, then every 15 min). It keeps only the shells' ids and whether an agent CLI runs under them; nothing is sent anywhere.
- **Implications**:
  - On Windows, a check costs about 0.3 s of CPU on one core and 80 MB of memory for its duration, in the background; with no background task, nothing is read. Should the read fail, the icons follow Claude Code's signals alone.
  - A shell is recognised by the words of its command: two background shells running the same command can each be matched to the other's process, the agent CLI or the end it reveals then being the other one's; the output shown stays right.
  - While a subagent works, the band is redrawn on each spinner step.
  - Reloading the plugin forgets the tasks under way: only the tasks started afterwards get an icon.
- **Turn off**: `/plugin` > Installed > `dx` > Disable, or `claude plugin disable dx@cc-plugins`; uninstall with `claude plugin uninstall dx@cc-plugins`.
