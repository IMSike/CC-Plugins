import type { ClientProps, ElementConstructor, RenderElement } from 'claude-code'

import type { PressPart, PressProps, PressStyle } from './press'

// The presses one render draws with ./press.tsx, and what each does, by its
// key: the terminal selects nothing however the clicks come. A render builds
// its own board and, once nothing is awaited any more, hands `actions` to its
// press hook, so that they match the tree returned, never another render's.
// Every key starts with `prefix`, which that hook matches.
export function pressBoard<A>(Client: ElementConstructor<ClientProps>, prefix: string) {
  const actions = new Map<string, A>()
  // A press under `prefix` + `key`, doing `action` (undefined: nothing, as
  // the tab in front). `width`: the label cut there, else as wide as drawn.
  const press = (key: string, action: A | undefined, parts: PressPart[], hover: PressStyle, width?: number): RenderElement => {
    const full = `${prefix}${key}`
    if (action !== undefined) actions.set(full, action)
    const props: PressProps = { parts, hover, truncate: width !== undefined }
    return <Client key={full} module="./press.tsx" props={props} width={width} height={1} />
  }
  return { actions, press }
}
