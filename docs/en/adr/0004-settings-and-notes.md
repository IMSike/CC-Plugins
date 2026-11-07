# ADR 0004 — Settings and notes: panes, kept in the plugin's store

- **Status**: accepted
- **Date**: 2026-10-31

## Context

dx gains a settings pane (what the band shows, animates and is colored with) and a notes pane for the person alone, with three notes: global, project and session. Both must outlive the session, and the notes must stay out of the model's context.

The function-hook API offers two places to keep values across sessions: the plugin's `$.store`, a JSON file of its own under the user's Claude Code configuration directory (`~/.claude/plugins/store/`), and the `userConfig` fields of the manifest, kept in `settings.json` under `pluginConfigs` and listed in `/config`. A pane is drawn for the person: the model never sees what it shows.

Options studied:

| Option | Pros | Cons |
|---|---|---|
| `userConfig` | Also editable in `/config`; a change reloads the module | Flat fields only; written to the person's `settings.json`; unfit for notes |
| `$.store` | Any JSON value; nothing written to `settings.json`; one place for settings and notes | Only dx's panes edit it; one file per copy of the plugin |
| Files in the project (`.dx/notes.md`) | Readable and versioned with the project | Written into the person's repository; the model reads it as any file |

## Decision

Settings and notes are kept in `$.store`, and read into `$.state` when the session starts, so the band and the panes draw from them. Another session may write them meanwhile: a settings change starts from what the store holds and the settings pane reloads them as it opens; a note is read from the store as its sheet opens, the last one written winning. Since then, the note shown is also read again every second while the notes pane is open, so another session's change shows within about a second.

- **Settings**: one key, `settings`. A value stored by an earlier version is read field by field: a missing or invalid field takes its default.
- **Notes**: `notes.global`, `notes.project.<project root>`, `notes.session.<session id>`, each `{ text, updatedAt }`. The notes are edited in a `Client` of the pane (a plain notepad: Enter starts a new line, where an `Input` would submit and clear itself), which posts each change to the hooks module; each one is written at once. An emptied note deletes its key; nothing is deleted on its own, session notes included: the session tab lists the other sessions' notes, to open or delete. One more key, `notesTab`, keeps the last tab shown, which the next pane takes up when the setting says so. Since then, a `/clear` adds a key, `notes.link.<session id>`, which holds the session whose note the new session id goes on with; **Supprimer cette note** deletes the links to the session it deletes.
- The notes are neither injected into the conversation nor guarded: the model does not see them, but may read the store file should it go looking for it.

## Consequences

- The notes are kept on the machine, in plain text; they follow the person to another machine only if `~/.claude` is synced.
- The store file is named after the plugin's copy: the installed dx, a copy loaded with `--plugin-dir` and a mod in development each keep their own settings and notes.
- The file grows with the session notes, a few kilobytes each, and is written whole at each save. Since then, it is capped: a note holds at most 95,000 characters and the store at most 3.8 MiB of JSON text (Claude Code refuses to write past 4 MiB); an edit that would pass either is refused as it is typed, a save past the store's limit too, the pane saying why.
- To be reassessed if the API offers storage shared across copies of a plugin, or syncing.
