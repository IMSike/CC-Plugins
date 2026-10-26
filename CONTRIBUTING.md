# Contributing

**English** · [Français](CONTRIBUTING.fr.md)

## Getting started

Requirements: Git and [Claude Code](https://code.claude.com) (a version with function hooks: 2.1.310 or later).

```sh
git clone https://github.com/IMSike/CC-Plugins.git
cd CC-Plugins
git config core.hooksPath .githooks       # checks commit messages locally
claude plugin validate .                  # the marketplace
claude plugin validate plugins/dx         # a plugin
claude plugin test plugins/dx             # its tests, no effect on the system
claude --plugin-dir plugins/dx            # a session with the plugin loaded from disk
```

A session started with `--plugin-dir` reloads the plugin each time a file is saved; nothing is installed. Read [Adding a plugin](docs/en/adding-plugins.md) first.

## Principles

- **No runtime dependency**: a plugin needs Claude Code and nothing else (no Node, no `jq`, no shell script); it reaches the session, the settings and the environment through `$`. Only a tool the system itself ships may be run, through `$.process.run`, when the API offers no other way and an ADR says why ([ADR 0003](docs/en/adr/0003-system-process-list.md)).
- **Quiet by default**: a plugin never blocks or slows the session; a failing hook is skipped by the engine, and a hook passes (`next(e)`) whenever it has nothing to add.
- **No secrets, no personal data, no machine-specific paths** in the repository.
- **Documented**: each feature explained (what it shows or does, implications, how to turn it off), in both languages.

## Code conventions

- Hooks modules in TypeScript (`.ts`, `.tsx` for JSX), strict mode; one module per plugin (`hooks/register.ts`), each feature in its own folder under `hooks/`, registering its own hooks.
- Pure logic (formatting, computations) in files of its own, without `$`, tested on their own.
- Values a drawing reads live in `$.state`, declared in the plugin's contract `types/index.d.ts`, with a `shape` tag changed whenever their fields change.
- 2-space indentation, single quotes, no semicolons, as the engine's own examples.
- Identifiers and comments in English; user-facing text in French for now.
- Encoding: UTF-8 without BOM, LF. Enforced by `.gitattributes` and `.editorconfig`.

## Documentation

The documentation exists in **English** (`docs/en/`) and **French** (`docs/fr/`), with the same file names. Any change in behavior updates the documentation **in the same commit**, in **both languages**.

## Commit messages

Commit messages and pull request titles follow the [Angular convention](https://github.com/angular/angular/blob/main/contributing-docs/commit-message-guidelines.md):

```
<type>(<scope>): <subject>
```

| Type | Use |
|---|---|
| `feat` | New feature (new plugin, new feature of a plugin) |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf` | Performance improvement |
| `test` | Tests only |
| `build` | Build, dependencies, tooling |
| `ci` | GitHub Actions workflows |
| `revert` | Reverts a previous commit |

Usual scopes: the plugin's name (`dx`), `marketplace`. The subject is in the imperative, lowercase, without a final period. One commit = one coherent change, about one plugin.

Messages are checked by the `.githooks/commit-msg` hook and by the [Commit messages](.github/workflows/commit-lint.yml) workflow; the [Plugins](.github/workflows/validate.yml) workflow validates and tests every plugin.

## Versions

Each push to `main` (direct or merged pull request) is tagged and released by the [Version](.github/workflows/release.yml) workflow, following [semantic versioning](https://semver.org):

| Commits since the last version | Bump |
|---|---|
| at least one `feat` | minor: `0.1.0` → `0.2.0` |
| anything else | patch: `0.1.0` → `0.1.1` |
| maintainer's decision only | major: run the workflow manually with `major` |

The first version is `v0.0.0`. There is no changelog for now. Plugins carry no `version` of their own: installed copies follow the commits of `main` ([ADR 0002](docs/en/adr/0002-plugin-versions.md)).

## Pull requests

1. Branch from `main`.
2. `claude plugin validate` and `claude plugin test` pass, and the change was tried in a `--plugin-dir` session.
3. Documentation updated in both languages.
4. Title following the commit convention (it becomes the commit message on squash merge).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
