import { expect, test } from 'claude-code/testing'

import Stepper from './stepper'
import type { StepperProps } from './stepper'

// A surface as the engine runs one: the module is called again after each
// setState, with the props it last had; the hooks' redraws bring new props.
function mount(value: number) {
  let props: StepperProps = { setting: 'heat-red', value, min: 10, max: 95, step: 5, suffix: ' %' }
  let state: unknown
  let pointer: (event: { type: string; x: number }) => void = () => undefined
  let check: () => void = () => undefined
  const posts: number[] = []
  const surface = {
    elements: { Box: (p: unknown) => p, Text: (p: unknown) => p },
    get state() {
      return state
    },
    setState(next: unknown) {
      state = next
      render()
    },
    columns: 12,
    rows: 1,
    every: (_: number, fn: () => void) => {
      check = fn
      return () => undefined
    },
    onPointer: (fn: typeof pointer) => {
      pointer = fn
      return () => undefined
    },
    onKey: () => () => undefined,
    post: (data: { value: number }) => posts.push(data.value),
  }
  const render = () => {
    ;(Stepper as unknown as (p: StepperProps, s: typeof surface) => unknown)(props, surface)
  }
  render()

  return {
    posts,
    now: () => (state as { value: number }).value,
    plus: () => pointer({ type: 'down', x: 11 }),
    minus: () => pointer({ type: 'down', x: 0 }),
    draw: (next: number) => {
      props = { ...props, value: next }
      render()
    },
    check: () => check(),
  }
}

test('a late echo of a click shows no step back', () => {
  const stepper = mount(75)
  stepper.plus()
  stepper.minus()
  expect(stepper.posts).toEqual([80, 75])
  stepper.draw(80)
  expect(stepper.now()).toBe(75)
  stepper.draw(75)
  expect(stepper.now()).toBe(75)
})

test('redraws merged into the last click leave nothing waiting', () => {
  const stepper = mount(75)
  stepper.plus()
  stepper.plus()
  stepper.minus()
  stepper.draw(80)
  // Another setting pushes this one: not taken for an echo.
  stepper.draw(85)
  expect(stepper.now()).toBe(85)
})

test('clicks back to the number drawn settle after a while', () => {
  const stepper = mount(75)
  stepper.plus()
  stepper.minus()
  // Their redraws merged into 75, which the hooks had drawn already: one check
  // later they may still come, two later they will not.
  stepper.check()
  stepper.draw(80)
  expect(stepper.now()).toBe(75)
  const settled = mount(75)
  settled.plus()
  settled.minus()
  settled.check()
  settled.check()
  // Another setting pushes this one: not taken for an echo.
  settled.draw(80)
  expect(settled.now()).toBe(80)
})

test('a reset wins over clicks under way', () => {
  const stepper = mount(75)
  stepper.plus()
  stepper.draw(50)
  expect(stepper.now()).toBe(50)
  stepper.plus()
  expect(stepper.posts).toEqual([80, 55])
})
