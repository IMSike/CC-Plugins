# dx — developer experience

**English** · [Français](../../fr/plugins/dx.md)

Install: `/plugin install dx@cc-plugins` (after `/plugin marketplace add IMSike/CC-Plugins`). Requires Claude Code 2.1.310 or later.

## Status band

```text
╭─ ✻ Opus 5.5 ─ ▰▰▰▰▱ xhigh ────────── ~/repo/app ⎇ dev ─ ✎  ⚙  ─╮
│ ctx  22% ◎◎◎◎◎◎◎◎◎◎···································         │
│ 5h   12% ◎◎◎◎◎◉◉◉◉◉◉◉◉◉·······························  ↻ 3h24 │
│ 7d   71% ◎◎◎◎◎◎◎◎◎◎◎◎◎◎◎◎◎◎◎◎◉◉◉◉◉◉◉◉◉◉◉◉············· ↻ 1j15h │
╰─ ✻ ✻ ▣ ▣ ───── durée 1m04 · fin 14:32 · total 1h12 · 24k/200k ─╯
```

On screen, colors tell apart what plain text cannot: on `5h`, the `◉` are the pale budget; on `7d`, they are consumed ahead of the pace, in full color. In the bottom border, `▣` stands for the terminal icon, a Nerd Font glyph; in the top border, `✎` and `⚙` stand for the notes and settings icons, two more (nf-fa-edit and nf-oct-gear by default).

- **Effect**: an instrument panel directly above the prompt, framed and laid out in the terminal's width.
  - **Top border**: the spark `✻`, lit in Claude's color while Claude works and grey at rest; the model (`claude-opus-5-5` reads `Opus 5.5`, a 1M context window adds `(1M)`); the reasoning effort as a five-step meter (`low` ▰▱▱▱▱ to `max` ▰▰▰▰▰) and its name; the current directory, the home folder shown as `~`, cut from the left when space runs out; the Git branch after `⎇` (a short commit when detached); at the right end, `✎` and `⚙` open the notes and settings panes (below).
  - **Gauges**: `ctx`, share of the context window used by the last request; `5h` and `7d`, share of the 5-hour and 7-day usage limits used. Each gauge is a string of beads: double circles `◎` for what is consumed, on a track of small dots `·`, drawn in a **heat gradient**: every cell takes the color of its position, green, yellow, orange, then red, each color blending into the next and halfway between them at 25%, 50% and 75%, so a gauge reddens as it lengthens. The percentage takes the color its value reaches.
  - **Pace** on `5h` and `7d`: the pace is where a steady consumption would stand at this point of the window (the share of the window already gone). The gap between it and the consumption is drawn in dotted circles `◉`. Behind the consumption, pale `◉` follow it: the budget, what can still be used without running ahead. Ahead of it, the consumed beads past the pace turn into `◉` in full color: usage is faster than the window allows on average, by that many beads.
  - **Shuttle**: a glow, fading out over the beads behind it, glides along the consumed beads from the first to the last, easing in and out, in 0.4 s plus 22 ms per bead (2.6 s at most: a short gauge is a quick course), then rests 3.5 s; the three gauges take turns. It moves by fractions of a bead, its light shared between two neighbours. It is drawn by the terminal itself (a `Client` element and its frame clock): the band is not recomputed for it, and nothing moves while it rests.
  - **Countdown**: `↻ 3h24`, time left before the window resets. When the window will run out before then at the rate it has been used since it started, the countdown gives way to `⚠ 1h10` in red: the time left before it runs out (no forecast during the first 2% of the window).
  - **Frame**: yellow. Two glints go round it, half a lap apart, a lap every 18 s, each a brighter stretch of the line, fading in over 4 cells ahead of it and out over 10 cells behind it; like the shuttle, they are drawn by the terminal itself.
  - **Bottom border**: on the left, what runs beside the conversation (below); on the right, the last turn's duration (`durée`, counting while Claude works) and the time it ended (`fin`), the session's total duration (`total`), and context tokens over the window size.
- **Data**: read from Claude Code itself (`$.session.usage()`, `$.session.model()`, the `effortLevel` setting, the effort each request is really sent with), the main loop's turns (`turn.start`, `turn.complete`), and the `.git/HEAD` file of the repository (read only); nothing is sent anywhere. Refreshed at the end of each turn and every 30 seconds; the turn's duration every second while it runs.
- **Implications**:
  - The `5h` and `7d` lines only appear with a Claude subscription (the API reports no limits otherwise); `ctx` shows `—` until the first response.
  - The band takes five rows. It is drawn in the terminal and the desktop app; other surfaces (VS Code, mobile) do not show it.
  - It is not the status line: it sits **above** the prompt, and a `statusLine` configured in `settings.json` keeps being shown under it. Remove `statusLine` to avoid seeing the same figures twice.
  - The frame, the gauges, the effort meter and the branch use characters (`╭ ◎ ◉ ▰ ⎇`) present in common terminal fonts (Cascadia, Nerd Fonts); the robot and terminal icons, and the default notes and settings icons, need a [Nerd Font](https://www.nerdfonts.com).
  - While Claude Code shows a survey in that band, the survey takes its place.
- **Fold / unfold**: `ctrl+x ctrl+a`, or click `[-]`.

## Subagents and background tasks

The left of the bottom border holds an icon for each subagent and background task of the session, up to five of a kind, then a count (`+3`).

- **Effect**:
  - **Subagent**: `✻` in Claude's color, turning like Claude Code's own spinner (`· ✢ * ✶ ✻ ✽`, there and back, 200 ms a step) while it works, still and dim while it waits.
  - **Agent CLI** run in a background shell: a robot, in Claude's color for Claude Code, grey for Cursor.
  - **Background shell** (`run_in_background`): a terminal icon, grey; a `Monitor`: `◉`.
  - **Click a subagent**: its transcript takes the main view, as from the tasks list; its icon is underlined meanwhile. Click it again to come back to the main conversation.
  - **Click a shell or an agent CLI**: the side panel shows its command, whole, wrapped over as many lines as it needs, then the end of its output, read again every second. Click the icon again to close the side panel.
  - An icon leaves the border when its subagent finishes, or its task is stopped or ends.
- **Data**: the session's agents (`$.agent.list()`); the background tasks, from the tool calls that start and stop them and from Claude Code's notification rows; their output, read from the file Claude Code writes it to. To tell an agent CLI in a shell and to catch an end Claude Code did not report, dx reads the system's process list ([ADR 0003](../adr/0003-system-process-list.md)): PowerShell on Windows, `ps` elsewhere, run without a shell, only while a task is due for a check (2 s after it starts, then after 10 s, 1 min, 5 min, then every 15 min). It keeps only the shells' ids and whether an agent CLI runs under them; nothing is sent anywhere.
- **Implications**:
  - On Windows, a check costs about 0.3 s of CPU on one core and 80 MB of memory for its duration, in the background; with no background task, nothing is read. Should the read fail, the icons follow Claude Code's signals alone.
  - A shell is recognised by the words of its command: two background shells running the same command can each be matched to the other's process, the agent CLI or the end it reveals then being the other one's; the output shown stays right.
  - While a subagent works, the band is redrawn on each spinner step; while a turn runs, every second.
  - Reloading the plugin forgets the tasks under way: only the tasks started afterwards get an icon.
## Settings

The `⚙` icon shows the settings in the side panel; a second click closes it. A change applies at once and is kept across sessions.

- **Effect**:
  - **Display**: each element of the band on or off: model, effort, directory, Git branch, each gauge, countdowns, subagents and tasks.
  - **Bottom border**: the turn's duration, its end time, the session's total and context tokens, each on or off and moved up or down with `↑` `↓`; how many subagent icons, and how many terminal icons, of a kind before a `+N` count (5 each by default).
  - **Animations**: the frame's glints, the gauges' shuttle, the subagents' spinner; their speed (slow, normal, fast).
  - **Colors**, each picked from a list of named colors or typed as hex (`#58a6ff`): the frame (the theme's warning color, yellow, by default), the effort meter and the branch (Claude's color by default), the gauges (the heat gradient by default, or one color), the bottom border's text (dim by default). The band shows a change at once.
  - **Gauge thresholds**: where the heat gradient turns orange (50% by default) and red (75%), by steps of 5; yellow sits halfway to orange.
  - **Icons**: the glyphs of the notes and settings icons (nf-fa-edit and nf-oct-gear by default), among a few Unicode and Nerd Font ones; one the terminal's font lacks draws as a blank or a box.
  - **Notes**: the tab the pane opens on; whether it takes up the last tab shown instead (on by default); how many other sessions' notes are listed (8 by default).
  - **Behavior**: hide the `5h` gauge while its window has not started (on by default); off, its row is drawn empty. Animate only while Claude works (off by default): the glints and the shuttles rest otherwise; with **… ou qu'un sous-agent ou un shell est actif** (checked along with it by default), they also run while a subagent works or a background task runs. The subagents' spinner turns only while its subagent works in any case.
  - **Réinitialiser** puts every setting back to its default.
- **Data**: kept in dx's own store, a file under `~/.claude/plugins/store/` ([ADR 0004](../adr/0004-settings-and-notes.md)).
- **Implications**:
  - The side panel sits beside the transcript in fullscreen mode, above the prompt otherwise. It is one pane whose content changes (notes, settings or a terminal) without closing, so nothing flickers; a row of tabs atop it leads from one to another and to each background task's terminal.
  - A change made in one session is shown in another the next time its settings are opened.
  - Each copy of the plugin (installed, loaded with `--plugin-dir`) keeps its own settings.

## Notes

The `✎` icon shows the notes in the side panel, for you alone, with three tabs: **Global** (every session), **Projet** (the session's project) and **Session**.

- **Effect**: a sheet per tab, written as in a plain notepad: click it to type, Enter starts a new line, the arrows, Home, End and Page Up/Down move the cursor, Escape gives the keyboard back to the prompt. What is written stays shown and is saved on every change. Under the session tab, the other sessions' notes, latest first (as many as set): click one to open it, then **Supprimer cette note** to delete it, or **← Session actuelle** to come back.
- **Data**: kept in dx's store ([ADR 0004](../adr/0004-settings-and-notes.md)) on every change; the project note under the session's project root, the session note under the session's id. An emptied note is deleted; nothing is deleted otherwise.
- **Implications**:
  - The notes are not sent to Claude: what a pane shows never reaches its context. They are not hidden from it either: the store is a plain-text file under `~/.claude`, which Claude could read if it went looking for it.
  - A note opened in two sessions at once: the last one written wins. Each session shows the note as it is stored whenever its sheet opens.
  - They stay on the machine, follow you elsewhere only if `~/.claude` is synced, and belong to the copy of the plugin that wrote them.

## Turn off

`/plugin` > Installed > `dx` > Disable, or `claude plugin disable dx@cc-plugins`; uninstall with `claude plugin uninstall dx@cc-plugins`.
