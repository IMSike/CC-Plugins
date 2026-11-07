# ADR 0005 — Presses in the side panel: drawn by a Client, so a click selects no text

- **Status**: accepted
- **Date**: 2026-11-07

## Context

The side panel's tabs, the notes' tabs and links and the settings' controls were `Button`s. The terminal handles a `Button` press itself: when the pointer slips between press and release, or two clicks come fast, it selects text instead, which replaces the clipboard and the click must be made again.

A `Client` (a module drawn on the surface's own thread) holds the pointer from press to release: the terminal selects nothing over it. But what a `Client` posts reaches the hooks module on nobody's behalf (origin `client`): what the API grants only to a person's press is refused to it, namely changing the main view (`$.ui.view`) and opening a pane unasked at any width (`$.ui.open` places an unasked pane only from 144 columns, 110 if it was opened before).

Options studied:

| Option | Pros | Cons |
|---|---|---|
| Keep `Button`s | Keyboard activation; no extra module | A click may select text instead |
| Every press drawn by a `Client`, band included | No selection anywhere | The band's icons could no longer open the panel on a narrow terminal |
| Only the panel's presses drawn by a `Client` | No selection where the clicks are many; the band keeps opening the panel at any width | The band's icons stay `Button`s |

## Decision

Every press inside the side panel (its tabs, the notes' tabs, **← Session actuelle**, **Supprimer cette note**, the other sessions' notes, **↻ Réessayer**, and every control of the settings but the two below) is drawn by one module, `press.tsx`: a label in the given style, the pointer over it adding a hover style; a release over it, after a press over it, posts `{}`. Each pane answers by the instance's key, which it maps to an action when drawing.

Two controls of the settings are exceptions: the number steppers are drawn by a module of their own, `stepper.tsx`, which holds the pointer too but steps on the press itself and posts the number it lands on; the custom hex color is an `Input`, typed on the keyboard. On a surface with no `Client`, the panel's tabs fall back to `Button`s.

The band's icons (notes, settings, subagents, agent CLIs, shells, monitors) stay `Button`s: they open the panel or change the main view, which only a person's press may do.

## Consequences

- A click in the panel never selects text, however the pointer moves or the clicks come.
- The panel's presses are no longer reached with the keyboard (Tab, Enter): the pointer alone presses them. The notes' sheet and the hex color field keep their keyboard.
- A press is acted on at its release over the label, as a `Button` is; a release outside does nothing. A stepper acts on the press.
- To be reassessed if the API lets a `Button` hold the pointer, or treats a `Client`'s post as the person's.
