# ADR 0001 — Plugins as function-hook mods; the status band above the prompt

- **Status**: accepted
- **Date**: 2026-10-25

## Context

OS-Setup installs a Claude Code status line (`claude-statusline` item): a bash script, run by Git Bash, that reads the JSON Claude Code passes on stdin with `jq` and follows a `statusline-config.json` description. It costs two dependencies (`jq`, bash), two files to deploy and a merge into `settings.json`, and it cannot know the terminal's width. The goal is a replacement without `jq`, distributed as a plugin of this marketplace, drawing four lines: model and effort on the left, current directory on the right, then three gauges (context, 5-hour and 7-day limits) colored by level, the last two followed by the time left before they reset.

Options studied:

| Option | Pros | Cons |
|---|---|---|
| `statusLine` command shipped in a plugin (Node script) | Stays under the prompt, where the status line is; stable API | A plugin cannot set `statusLine`: OS-Setup would still have to merge it into `settings.json`; needs Node; no terminal width, so no full-width gauges and no right-aligned path |
| Mod, `$.ui.status(text)` | No setting to change; under the prompt | One line of plain text: no colors, no layout |
| Mod, `ui.render` on `AbovePrompt` | A tree of `Box`/`Text` laid out in the band's exact width (`bodyColumns`); theme colors; data straight from the engine (`$.session.usage()`, `$.session.model()`); nothing to deploy beyond installing the plugin | Above the prompt, not under it; early-access API that may change between releases; needs a recent Claude Code |

## Decision

- Plugins of this marketplace are **function-hook mods**: a TypeScript hooks module named by `hooks/hooks.json`, with no runtime dependency.
- The `dx` plugin draws the status band through **`ui.render` on `AbovePrompt`**, the only place that can lay out the four lines as designed.

## Consequences

- No `jq`, no bash, no file to copy: OS-Setup's `claude-statusline` item is replaced by `claude-dx`, which runs `claude plugin install dx --marketplace IMSike/CC-Plugins` (the command adds the marketplace and writes `extraKnownMarketplaces` and `enabledPlugins` into `settings.json`). Merging these two keys is not enough: Claude Code does not download the plugin for it. `jq` is no longer needed.
- The band sits **above** the prompt. The `statusLine` setting is left alone: whoever moves to the band removes it themselves to avoid showing the same figures twice.
- The person can fold the band (`ctrl+x ctrl+a`, or `[-]`); a survey takes the band's place while it is shown.
- The API is early access: each Claude Code update may require an adjustment. `claude plugin validate` and `claude plugin test` in CI catch what the new version refuses.
- Claude Code 2.1.310 or later is required; older versions ignore the hooks module.
