# CC-Plugins

**English** · [Français](README.fr.md)

A [Claude Code](https://code.claude.com) plugin marketplace: the plugins [OS-Setup](https://github.com/IMSike/OS-Setup) offers to install, usable on their own too.

> **Status: early stage.** The plugins are function-hook mods, an early-access Claude Code API: they need Claude Code 2.1.310 or later. Displayed text is in French for now.

## Plugins

| Plugin | Contents |
|---|---|
| [`dx`](docs/en/plugins/dx.md) | Developer experience: a status band above the prompt with the model, the effort, the current directory, and gauges for the context and the 5-hour and 7-day usage limits, colored by level; an icon per subagent and background task, a click away from its transcript or output; the turn's duration; personal notes and settings panes |

## Installation

In a Claude Code session:

```text
/plugin marketplace add IMSike/CC-Plugins
/plugin install dx@cc-plugins
```

Or from a shell:

```sh
claude plugin marketplace add IMSike/CC-Plugins
claude plugin install dx@cc-plugins
```

Updates: `/plugin marketplace update cc-plugins`, or turn on auto-update for the marketplace under **Marketplaces** in `/plugin`.

## Documentation

| | |
|---|---|
| [Plugins](docs/en/README.md) | What each plugin shows or does, implications, how to turn it off |
| [Adding a plugin](docs/en/adding-plugins.md) | Layout, manifest, hooks module, tests |
| [Architecture decisions](docs/en/adr/) | Why mods, why no plugin version, why read the process list |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md): conventions, commit messages, tests.

## License

[MIT](LICENSE)
