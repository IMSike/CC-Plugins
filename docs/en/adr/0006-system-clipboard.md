# ADR 0006 — Pasting into a note: a button that reads the system clipboard

- **Status**: accepted
- **Date**: 2026-11-11

## Context

The notes' editor is a `Client` in the side panel. A paste made in the terminal (Ctrl+V, a right click) is no key: Claude Code sends it to the prompt box, even while a note holds the keyboard. The function-hook API writes the clipboard (`$.ui.copy`) but has no call that reads it.

A first attempt took the paste back from the prompt box with a `prompt.edit` hook, while the note was thought to hold the keyboard. It was rejected: a plugin cannot tell where the keyboard is. Nothing signals Escape handing it back to the prompt, nor a click in the prompt box; the engine's `isFocused` says the pane holds it, not which of its parts. A paste meant for the prompt could land in a note, or the reverse. And the paste visibly blinks in the prompt box before any hook answers.

The hard rules allow no runtime dependency outside Claude Code; a tool the system ships may be run through `$.process.run` when the API offers no other way, with an ADR saying why ([ADR 0003](0003-system-process-list.md)).

Options studied:

| Option | Pros | Cons |
|---|---|---|
| Take the paste back from the prompt box (`prompt.edit`) | Ctrl+V as anywhere else | Guesses where the keyboard is, wrong after Escape or a click in the prompt; the paste blinks in the prompt box |
| No paste into notes | Nothing to run, nothing to guess | Copying text into a note means typing it again |
| A **Coller** button reading the system clipboard with the system's own tools | Never guesses: the press says where the text goes; nothing runs until pressed | A process per press; Linux tools may be missing; under SSH, the clipboard is the remote host's |
| A script or a native helper | Faster reads | A runtime dependency, against the hard rules |

## Decision

A paste in the terminal stays the prompt's, as without dx. Under each note's sheet, at the bottom right, a **Coller** button (a press of `press.tsx`, [ADR 0005](0005-panel-presses.md)) reads the system clipboard and gives its text to the note's editor, which inserts it at its cursor with the same cleaning and limits as typing. It is drawn only with the editor.

- **Windows**: `powershell -NoProfile -NonInteractive -EncodedCommand <script>`, the script readable in `clipboard.ts` and encoded at run time as ADR 0003's. It prints `Get-Clipboard -Raw` as base64 of its UTF-8 bytes, so no console code page garbles an accent; dx decodes it (`atob`, `TextDecoder`). No text on the clipboard prints nothing. A failure (the clipboard held by another program) stops the script (`$ErrorActionPreference = 'Stop'`), which writes the error's message alone to stderr, in UTF-8, and exits 1; dx still reads the text of an error PowerShell would write as CLIXML.
- **Elsewhere**: these in turn, until one reads the clipboard: `pbpaste` (macOS), `wl-paste --no-newline --type text` (Wayland, text alone, never an image's bytes), `xclip -selection clipboard -o`, `xsel --clipboard --output` (X11). A tool that cannot start, or that starts and fails, is passed for the next. The errors that only say the clipboard is empty or holds no text (`wl-paste`'s `Nothing is copied`, `No selection`, `No suitable type of content copied`; `xclip`'s `target … not available`) paste nothing, without a message.
- **Under SSH** (`SSH_CONNECTION`, `SSH_CLIENT` or `SSH_TTY` set): nothing is read, and the pane says why, rather than pasting the remote host's clipboard.

Each tool may take 5 s at most; past that, it is given up and the next one tried. A press while a read runs does nothing. Why a read failed is said in the pane, with the note, as a refused edit is. Of several tools that fail, the first that started is the one reported: its message, or **délai dépassé (5 s)** when it timed out. Only when none started does the pane name what to install (on Windows, why PowerShell could not start). `$.process.run` rejects both a command that cannot start and one past its timeout, telling neither: a rejection that comes at the timeout, or says it timed out, is the timeout.

## Consequences

- Nothing runs until the button is pressed. On Windows, each press starts a PowerShell: about 0.3 to 0.5 s before the text shows; elsewhere, a few milliseconds.
- On Linux, `wl-clipboard`, `xclip` or `xsel` may be missing: the button then says so and pastes nothing. A tool that hangs holds the press 5 s before the next is tried.
- Over SSH, pasting into a note means typing the text: the clipboard of the machine you sit at is out of reach.
- The clipboard is read only at a press, kept nowhere but in the note it is pasted into, and sent nowhere.
- To be reassessed if the API reads the clipboard, or says which part of a pane holds the keyboard: the button could then give way to Ctrl+V.
