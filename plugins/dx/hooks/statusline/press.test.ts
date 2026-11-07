import { expect, test } from 'claude-code/testing'

import Press from './press'
import type { PressProps } from './press'

// A surface as the engine runs one, 10 columns by 1 row: the module is called
// again after each setState; `drawn` is the last tree it returned.
function mount(props: PressProps) {
  let state: unknown
  let pointer: (event: { type: string; x: number; y: number }) => void = () => undefined
  let drawn: unknown
  const posts: unknown[] = []
  const surface = {
    elements: { Text: (p: unknown) => p },
    get state() {
      return state
    },
    setState(next: unknown) {
      state = next
      render()
    },
    columns: 10,
    rows: 1,
    every: () => () => undefined,
    onPointer: (fn: typeof pointer) => {
      pointer = fn
      return () => undefined
    },
    onKey: () => () => undefined,
    post: (data: unknown) => posts.push(data),
  }
  const render = () => {
    drawn = (Press as unknown as (p: PressProps, s: typeof surface) => unknown)(props, surface)
  }
  render()

  return {
    posts,
    drawn: () => drawn as { bold?: boolean; color?: string },
    at: (type: string, x: number, y = 0) => pointer({ type, x, y }),
  }
}

const LABEL: PressProps = { parts: [{ text: ' Notes ', color: 'subtle' }], hover: { bold: true } }

test('a press released over it is posted', () => {
  const press = mount(LABEL)
  press.at('down', 2)
  expect(press.posts).toEqual([])
  press.at('up', 3)
  expect(press.posts).toEqual([{}])
})

test('a press released off it is not', () => {
  const press = mount(LABEL)
  press.at('down', 2)
  press.at('up', 12)
  press.at('up', 2)
  expect(press.posts).toEqual([])
})

test('the pointer over it draws it in its hover style', () => {
  const press = mount(LABEL)
  expect(press.drawn()).toMatchObject({ color: 'subtle' })
  expect(press.drawn().bold).toBeUndefined()
  press.at('enter', 1)
  expect(press.drawn()).toMatchObject({ color: 'subtle', bold: true })
  press.at('leave', 11)
  expect(press.drawn().bold).toBeUndefined()
})
