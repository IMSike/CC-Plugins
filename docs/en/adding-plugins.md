# Adding a plugin

**English** · [Français](../fr/adding-plugins.md)

A plugin of this marketplace is a function-hook mod ([ADR 0001](adr/0001-function-hook-mods.md)): a folder under `plugins/`, listed in `.claude-plugin/marketplace.json`.

## Layout

```text
plugins/<name>/
├── .claude-plugin/
│   └── plugin.json          manifest
├── hooks/
│   ├── hooks.json           { "modules": ["./register.ts"] }
│   ├── register.ts          the hooks module: calls each feature's register function
│   └── <feature>/
│       ├── <feature>.tsx    the feature's hooks
│       ├── format.ts        its pure logic, without $
│       └── *.test.ts(x)     its tests
├── types/
│   └── index.d.ts           contract: the values kept in $.state
└── README.md                short summary, linking to docs/{en,fr}/plugins/<name>.md
```

A plugin has **one** hooks module: a new feature is a folder under `hooks/` whose register function `register.ts` calls, not a new plugin. A new plugin is for a separate theme that people would install on its own.

## Manifest

`plugin.json` holds `name` (the install id, identical to the marketplace entry's), `description`, `author`, `homepage` (its documentation page), `repository`, `license`, `keywords` and, when the plugin keeps values in `$.state`, `types`. **No `version`** ([ADR 0002](adr/0002-plugin-versions.md)).

## Hooks module

- `export const register: Register = on => { ... }`, the type imported from `'claude-code'`.
- Every hook is `($, e, next)`: return `next(e)` when there is nothing to add. A streaming event (`turn.step`) takes an async generator: `async function* ($, e, next) { return yield* next(e) }`.
- `$` is only passed to functions declared at the top level of a file (or imported): `claude plugin validate` refuses a closure that receives it.
- No DOM, no Node: the session, the settings, the environment, the clock go through `$`. A path is never written down: it is read (`$.session.cwd()`, `$.env.get('USERPROFILE')`).
- Values a drawing reads are atoms in `$.state` (`atom`, `read`, `update`), declared in `types/index.d.ts` under the plugin's name, with a `shape` tag changed whenever their fields change.

The full API (events, `$` nouns, element props) is the declaration file the engine writes into `plugins/<name>/.claude-plugin/types/` when it loads the plugin from disk (ignored by Git).

## Tests

```sh
claude plugin validate plugins/<name>    # manifest, hooks module, contract
claude plugin test plugins/<name>        # *.test.ts(x), with the engine beneath mocked
claude --plugin-dir plugins/<name>       # try it in a real session, reloaded on each save
```

A test mounts what the plugin draws on the surface it names (`$.ui.mount`) and answers the engine's calls itself (`on('session.usage', () => ({ value: ... }))`, `mock.clock`, `mock.env`).

## Marketplace entry and documentation

1. Add the entry to `.claude-plugin/marketplace.json`: `name`, `source` (`./plugins/<name>`), `description`, `category`.
2. Write `docs/en/plugins/<name>.md` and `docs/fr/plugins/<name>.md`: each feature, what it shows or does, its implications, how to turn it off.
3. Add the plugin to the tables of `README.md`, `README.fr.md` and `docs/{en,fr}/README.md`.
4. `claude plugin validate .` passes.
