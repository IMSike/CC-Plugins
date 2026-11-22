# ADR 0007 — Opening Claude Code's configuration folder from the settings pane

- **Status**: accepted
- **Date**: 2026-11-22

## Context

dx's settings pane holds dx's own settings. Claude Code's (`settings.json`, the agents, the commands…) live in its configuration folder, `CLAUDE_CONFIG_DIR` when set, else `.claude` in the home folder, which people often look for. The function-hook API reads Claude Code's settings (`$.settings.read`) but opens no file or folder in another program.

The hard rules allow no runtime dependency outside Claude Code; a tool the system ships may be run through `$.process.run` when the API offers no other way, with an ADR saying why ([ADR 0003](0003-system-process-list.md)).

Claude Code refuses a plugin's run of a program whose argument names one of its settings files: an argument holding `settings.json` under a `.claude` folder or under `CLAUDE_CONFIG_DIR` is denied (its built-in policy, not documented, as observed in Claude Code 2.1.330).

Options studied:

| Option | Pros | Cons |
|---|---|---|
| Nothing: the folder found by hand | Nothing to run | The folder is hidden (`.claude`), or set elsewhere by `CLAUDE_CONFIG_DIR` |
| Open `settings.json` with the program Windows associates with it | One click to the file | Claude Code refuses it; working around its refusal is out of the question |
| Show the folder's path in the pane | Nothing to run | Still to be copied and opened by hand |
| **Open the folder in the File Explorer** | One click; the file a double click away; no file named | A process per press; Windows alone |

Ways to open it studied, Claude Code starting a plugin's programs with their window hidden (`windowsHide`, as observed in Claude Code 2.1.330):

| Way | Pros | Cons |
|---|---|---|
| `explorer.exe <folder>` | One process, no script | The File Explorer takes the hidden window for its own: the folder opens in a hidden window, nothing seen and nothing said; its command line is split at commas |
| `cmd.exe /c start "" <folder>` | No script | `cmd`'s quoting: a folder holding `&`, `^` or `%` must be escaped |
| **Windows PowerShell, `Invoke-Item`** | Opens the folder as a double click does, in a window shown; the folder handed over in a variable of the environment, no quoting | PowerShell's start, about 0.3 s |

## Decision

On Windows, the pane's footer draws **`[ 📁 dossier .claude ]`** (the folder's own name when `CLAUDE_CONFIG_DIR` sets another), left of **Réinitialiser**, on both tabs. A press opens the folder in the File Explorer:

- the folder is `CLAUDE_CONFIG_DIR`, set and not empty, else `.claude` in the home folder (`USERPROFILE`, else `HOME`), made an absolute Windows path (slashes, Git Bash's `/c/…`, `~`, a folder relative to the working directory taken);
- it must be a folder;
- Windows PowerShell (`%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`, by its full path, with `%SystemRoot%` as its working directory, so that no program of the same name in the session's folder runs in its place) opens it with `Invoke-Item -LiteralPath`, the folder handed over in the variable `DX_OPEN_FOLDER`; given 15 s. It exits with 1, its first error line said, when the folder does not open;
- the folder alone is ever named, never a file in it: dx does not work around Claude Code's refusal.

A press while an opening is under way does nothing. Why the folder did not open is said in red in the pane until it opens or the pane is shown anew. dx never writes in the folder.

## Consequences

- Nothing runs until the button is pressed; each press starts Windows PowerShell, which hands the folder to the File Explorer (or to the program Windows opens folders with).
- Off Windows, and before Windows' folder is known at the session's start, the button is not drawn.
- `settings.json` is a double click away in the File Explorer, never opened by dx.
- The tests reproduce Claude Code's refusal on their own, so that dx naming a settings file to a program fails them, and its hidden window, so that dx running `explorer.exe` directly fails them.
- To be reassessed if the API opens a file or a folder, if Claude Code's refusal changes, or if it shows a plugin's programs' windows.
