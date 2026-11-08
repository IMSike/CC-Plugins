import { expect, test } from 'claude-code/testing'

import type { BottomFact } from '../../types'
import { moved } from './order'

const ORDER: BottomFact[] = ['duration', 'end', 'total', 'tokens']

test('a fact moves one place up or down', () => {
  expect(moved(ORDER, 'end', -1)).toEqual(['end', 'duration', 'total', 'tokens'])
  expect(moved(ORDER, 'end', 1)).toEqual(['duration', 'total', 'end', 'tokens'])
  // The order given is left as it was.
  expect(ORDER).toEqual(['duration', 'end', 'total', 'tokens'])
})

test('a fact at an end, or not listed, leaves the order as it was', () => {
  expect(moved(ORDER, 'duration', -1)).toEqual(ORDER)
  expect(moved(ORDER, 'tokens', 1)).toEqual(ORDER)
  expect(moved(['duration', 'end'], 'tokens', 1)).toEqual(['duration', 'end'])
})
