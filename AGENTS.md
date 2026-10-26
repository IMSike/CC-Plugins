# AGENTS.md

Instructions for coding agents (Claude Code, Codex, Copilot…) working on this repository. Humans: see [CONTRIBUTING.md](CONTRIBUTING.md).

## Project

A Claude Code plugin marketplace: the plugins [OS-Setup](https://github.com/IMSike/OS-Setup) offers to install. The repository is **public** (MIT).

Read before changing anything:

- [Adding a plugin](docs/en/adding-plugins.md): layout, manifest, hooks module, tests.
- [Architecture decisions](docs/en/adr/): why plugins are function-hook mods and why they carry no version.
- [CONTRIBUTING.md](CONTRIBUTING.md): code conventions, commit messages, versions.

## Hard rules

1. **Never change the maintainer's Claude Code configuration** (`~/.claude/settings.json`, installed plugins and marketplaces) without explicit consent. Try a plugin with `claude --plugin-dir plugins/<name>`, which changes nothing.
2. **Never install global tools** (npm packages, TypeScript…) "to test" without asking. `npx` in a temporary folder is fine for a one-off type check.
3. **No secrets, personal data or machine-specific paths** in the repository: it is public. A path is read from the engine (`$.session.cwd()`, `$.env.get('USERPROFILE')`), never written down.
4. **Do not settle open design questions alone**: present the mechanism, the alternatives and a recommendation, then let the maintainer decide. Significant decisions go in an ADR (`docs/{en,fr}/adr/NNNN-title.md`: context, decision, consequences).
5. **No runtime dependency** outside Claude Code itself: a hooks module reaches everything through `$` (no Node, no `jq`, no shell script). The one exception is what the system itself ships, run through `$.process.run` when the API offers no other way, as dx's process list ([ADR 0003](docs/en/adr/0003-system-process-list.md)): a new use needs an ADR.
6. The function-hook API is **early access**: the declaration file written by the engine (`plugins/<name>/.claude-plugin/types/claude-code/index.d.ts`, or the one the `plugin-authoring` skill names) is the authority, not memory.

## Documentation

- English (`docs/en/`) and French (`docs/fr/`) trees have the **same files**. Any page you change is changed **in both languages, in the same commit** as the code change. `README.md` / `README.fr.md` and `CONTRIBUTING.md` / `CONTRIBUTING.fr.md` likewise.
- Every plugin has its page, `docs/{en,fr}/plugins/<name>.md`: what each feature shows or does, its implications, how to turn it off. The plugin's own `README.md` is a short summary linking to it.

## Maintainer notes

Work in progress, to-do lists and verification reports live in `.maintainer/` (ignored by Git), never in the documentation.

## Conventions

- Language: identifiers and code comments in English; user-facing text (what a plugin draws, its messages) in French for now; documentation in both languages. Talk to the maintainer in French.
- TypeScript: see [CONTRIBUTING.md](CONTRIBUTING.md#code-conventions).
- Encoding: UTF-8 without BOM, LF.

## Tests

Before proposing a change, for each plugin touched:

```sh
claude plugin validate .                 # the marketplace
claude plugin validate plugins/<name>    # the plugin: manifest, hooks, state contract
claude plugin test plugins/<name>        # its *.test.ts(x), no effect on the system
```

## Git

- Maintainer's own work happens on the `dev` branch: never commit or push to `main` for them, they merge `dev` into `main`, which publishes a version. External contributions are pull requests to `main`. Commit messages and PR titles follow the **Angular convention** (`feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `revert`); there is no `chore`. The scope is the plugin's name (`feat(dx): ...`) or `marketplace`.
- One commit = one coherent change; one plugin per commit.
- Keep this file up to date when a convention changes.
