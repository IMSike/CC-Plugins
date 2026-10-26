# ADR 0002 — Plugin versions: none, installed copies follow the commits

- **Status**: accepted
- **Date**: 2026-10-25

## Context

Claude Code hands a user a new copy of an installed plugin only when its computed version changes: the `version` of its `plugin.json`, else that of its marketplace entry, else the commit of the marketplace repository. The repository itself is versioned like OS-Setup: each push to `main` is tagged from the commit messages (`v0.0.0`, then minor for a `feat`, patch otherwise).

Options studied:

| Option | Pros | Cons |
|---|---|---|
| A `version` in each `plugin.json`, bumped by hand | Explicit; users see a version number | A forgotten bump keeps users on their old copy; a second version scheme beside the repository's tags |
| A `version` written by the release workflow | Automatic | The workflow commits to `main`; the bump covers every plugin, changed or not |
| No `version` | Every push to `main` reaches users; a single version scheme, the repository's tags | `claude plugin validate` warns; the version users see is a commit |

## Decision

No `version` in `plugin.json` nor in the marketplace entries. `main` only receives what is released, so its commits are the plugins' versions; the repository's tags name the releases.

## Consequences

- `claude plugin validate` reports `No version specified` for each plugin: expected, not to be "fixed".
- Users receive changes through `/plugin marketplace update cc-plugins`, `claude plugin update dx@cc-plugins`, or auto-update once turned on for the marketplace.
- To be reassessed if another plugin comes to depend on one of ours: a version range resolves against `<plugin>--v<version>` tags.
