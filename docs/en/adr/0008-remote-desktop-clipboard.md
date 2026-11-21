# ADR 0008 — Copies for Remote Desktop: the clipboard written again, once, after each copy

- **Status**: accepted
- **Date**: 2026-11-21

## Context

On Windows, every copy Claude Code makes (a selection with the mouse, copied as it is made; Ctrl+Shift+C; `/copy`; a plugin's `$.ui.copy`) writes the clipboard twice: an OSC 52 sequence, which the terminal applies (Windows Terminal; herdr writes it itself through Win32, `OpenClipboard(GetConsoleWindow())`), then, about 0.2 s later, Windows PowerShell 5.1's `Set-Clipboard` (OLE: `OleSetClipboard`, `OleFlushClipboard`, then the process exits).

A paste into a Remote Desktop (RDP, TSE) session, Hyper-V's enhanced session included, then yields nothing, and keeps yielding nothing until the clipboard changes again. Reproduced without Claude Code (`own`: a Win32 write whose owner window stays alive, as a terminal's; `OLE`: PowerShell's `Set-Clipboard`; `Win32`: `OpenClipboard(NULL)`, `EmptyClipboard`, `SetClipboardData(CF_UNICODETEXT)`, `CloseClipboard` from a process that then exits):

| Test | Writes | Paste in the RDP session |
|---|---|---|
| T0 | `own` alone | works |
| T1 | `own`, 0.15 s later `OLE` (what Claude Code does) | **nothing** |
| T2 | `own`, 3 s later `OLE` | works |
| T4 | `own`, then `Win32` | works |
| O1 | `OLE` alone | works (10 out of 10) |
| T7 | `Win32`, about 0.22 s later `OLE` | **nothing** (3 out of 3) |
| T3 | T1, then, a second or two later, the text read back and written again by `Win32` | works |
| R1 | a real Claude Code copy, then the same rewrite about 1 s later | works (3 out of 3) |

An OLE write that comes less than about 3 s after another clipboard write breaks Remote Desktop's clipboard redirection, whatever made that first write: its owner window, alive (T1) or absent (T7), makes no difference. Neither write alone breaks it (T0, O1), nor two close Win32 writes (T4). One Win32 write after it, a second or so later, mends it. `clip.exe` was ruled out (it changed the text: line ends made CRLF, characters added), as was PowerShell 7 (not shipped with Windows) and `$.ui.copy` (it writes twice again).

The function-hook API raises no event for Claude Code's own copies: `ui.copy` is raised only for a plugin's `$.ui.copy` (`$.ui.copy`, `UiCopyArgs` in the declaration file). Nothing announces the end of a mouse selection, Ctrl+Shift+C, or the engine's "copied" notice: `ui.pointer` is the backdrop's alone, `ui.scroll` and `ui.focus` are a pane's, Claude Code's notices are not drawn through a hook (`PromptHint` is not asked while one shows), `ContextMenu` is the desktop app's alone, and a `Button`'s `action` does not take a chord the engine handles itself. What the API does offer: `$.ui.selection()`, the text the person last selected, as a copy would take it, an in-process call that starts no program; `command.run` hooks `/copy`; `$.config.list()` reads Claude Code's `copyOnSelect`.

The API reads no clipboard and writes it only through `$.ui.copy`; a tool the system ships may be run through `$.process.run` when the API offers no other way, with an ADR saying why ([ADR 0003](0003-system-process-list.md)).

Options studied:

| Option | Pros | Cons |
|---|---|---|
| Nothing; Windows Terminal's `"compatibility.allowOSC52": false` | No process; the terminal no longer writes, PowerShell's write alone stands | Not in herdr, which writes the clipboard itself; a setting of the terminal, not of dx; OSC 52 lost for every program in it |
| A command alone, `/dx-tse`, run after a copy | Nothing runs unasked | A command to type after each copy |
| The clipboard read every second through PowerShell, rewritten when it changed | Every copy caught, Claude Code's and others' | A PowerShell every second (about 300 ms of CPU, 80 MB each, ADR 0003): ruled out |
| **The copies dx can see followed by one rewrite**, the person's selection read every half second in process, `/copy` hooked, `/dx-tse` for the rest | No process until a copy; a selection costs one PowerShell | A selection made with the mouse held still over a second may be caught late or missed; a copy dx cannot see takes `/dx-tse` |
| A native helper or a script | Faster | A runtime dependency, against the hard rules |

## Decision

A setting, **Réparer les copies pour le Bureau à distance (TSE)**, off by default, offered on Windows alone (the settings pane's **Presse-papiers** section). When it is on, a second (`REPAIR_DELAY_MS`, 1000 ms) after each copy dx sees, dx starts writing the clipboard's text again, once, by the Win32 API alone:

- **A copy on selection**: while the setting is on, and only then, dx reads `$.ui.selection()` every 500 ms (`SELECTION_POLL_MS`), in process; the clock starts as the setting is turned on (or as the session starts with it on) and stops as it is turned off. A read is skipped while Claude Code does not draw in fullscreen, as the band last saw it (`viewport.isFullscreen`), as there is no selection there. A new selection, not empty, while Claude Code's `copyOnSelect` is on (absent or unreadable: on), is taken for a copy; a selection still being made puts the rewrite off, so the last one alone is rewritten. The selection standing as the setting is turned on, or as dx starts, is not one. The rewrite happens only if the clipboard then holds that text (compared with line ends as LF, without the blanks ending its lines or the newlines ending it); if not (the button still held, a copy not made yet), it is tried once more 2 s later (`RETRY_DELAY_MS`), then left.
- **`/copy`**: a `command.run` hook lets it run, then asks for the rewrite of whatever plain text the clipboard holds, as dx does not know the text copied. The command's answer is passed on as it came. The engine's `/copy` answers without text whether it copied or showed its picker of a reply's code blocks (its clipboard write comes before its answer), so the two cannot be told apart: after the picker, the clipboard's former text is written again, unchanged, and the copy made from the picker is not seen; `/dx-tse` serves for it.
- **A plugin's `$.ui.copy`** to the terminal (dx's notes' among them): rewritten if the clipboard then holds its text.
- **`/dx-tse`**, a command dx registers on Windows, setting on or off: rewrites the clipboard at once, and says what it did, for the person alone (not sent to the model). For the copies dx cannot see.

A later copy replaces a rewrite still waiting; rewrites run one after the other.

The rewrite: `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -NonInteractive -EncodedCommand <script>`, run with `%SystemRoot%` as its working directory, so that no `powershell.exe` of the session's folder runs in its place, given 10 s. The script, readable in `hooks/rdp/rewrite.ts`, declares the Win32 calls in memory (`DefineDynamicAssembly`, `DefinePInvokeMethod`: no C# compiled, no `csc.exe`, nothing written to `%TEMP%`, unlike `Add-Type`), opens the clipboard once with no owner window, and in that one opening reads `CF_UNICODETEXT` and writes it back with `EmptyClipboard` and `SetClipboardData`: the text never leaves the process and comes back to the UTF-16 unit, its line ends as they were. Its standard input holds the text expected, as base64 of its UTF-8 bytes, or nothing. It writes nothing when the clipboard holds anything other than plain text (an image, files, HTML, which the rewrite would drop: only `CF_TEXT`, `CF_OEMTEXT`, `CF_UNICODETEXT`, `CF_LOCALE`, OLE's `DataObject` and `Ole Private Data`, and .NET's `System.String` are allowed; a password manager's marks, such as `ExcludeClipboardContentFromMonitorProcessing` or `Clipboard Viewer Ignore`, are not, so its copies are left alone), holds no text, or holds another text than expected; the debug line then lists every format the clipboard held. A clipboard held by another program is tried for 1 s. A `GlobalLock` or an `EmptyClipboard` that fails stops the write, the memory freed. Microsoft's documentation warns that `SetClipboardData` may fail after `OpenClipboard(NULL)` and `EmptyClipboard`, with no window to own the clipboard; it worked in every trial above (T4, R1) and on the machine checked. Any failure goes to the debug log alone (`dx : sélection, presse-papiers non réécrit : …`).

## Consequences

- With the setting on, a paste into Remote Desktop works after a copy on selection, `/copy`, or a plugin's copy, once the rewrite is done, about 1.5 s after the copy (the second waited, then PowerShell's start), up to about 2 s for a selection (read every half second). A paste made sooner may still find nothing; `/dx-tse` mends it.
- Not seen, so not mended without `/dx-tse`: Ctrl+Shift+C when Claude Code does not copy on selection; a copy made from `/copy`'s picker; a second selection of the very same text; a selection made with the mouse held still more than about a second and released after the retry; the other copies Claude Code makes on its own (`/export` to the clipboard, the resume command it copies).
- Each copy seen starts one PowerShell (about 0.6 to 0.8 s from start to exit, the in-memory declarations taking tens of milliseconds, with the CPU and memory ADR 0003 measured), two when a selection's text is not there yet. Nothing runs and nothing is read with the setting off, nor off Windows; the selection is read every 500 ms in process while the setting is on and Claude Code draws in fullscreen, a call that starts nothing.
- PowerShell in Constrained Language Mode (AppLocker, WDAC) refuses the in-memory declarations: the rewrite then fails, said in the debug log alone, and the clipboard is left as it was.
- Windows' clipboard history (Win+V) gets one more entry per rewrite, the same text again.
- A copy made between the copy and its rewrite: a selection's or a plugin's rewrite is skipped (the text differs); `/copy`'s rewrites whatever plain text is there then, the same text written again, nothing lost.
- dx's own `ui.copy` hook sees the copies of every plugin above it; whether a plugin's own call reaches its own hook is the engine's: dx's notes' copies were seen in the test kit.
- Windows alone: on macOS and Linux the setting is not offered, nothing runs.
- Outside herdr, setting `"compatibility.allowOSC52": false` in Windows Terminal's settings (`settings.json`, profile defaults) makes the terminal ignore OSC 52: PowerShell's write alone stands, and the setting is not needed.
- To be reassessed when a copy writes the clipboard once (Claude Code writing it once, or herdr no longer writing it: [herdr#5687](https://github.com/herdrdev/herdr/issues/5687); herdr writing it otherwise, with no owner window for one, would not do, T7), or when the API raises an event for its copies or reads the clipboard.
