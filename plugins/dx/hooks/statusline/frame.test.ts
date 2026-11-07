import { expect, test } from 'claude-code/testing'

import { lightAt } from './frame'

test('two glints go round the frame half a lap apart, each fading in ahead and out behind', () => {
  const perimeter = 100
  expect(lightAt(40, 40, perimeter)).toBeGreaterThan(0.8)
  expect(lightAt(90, 40, perimeter)).toBeGreaterThan(0.8)
  expect(lightAt(35, 40, perimeter)).toBeLessThan(lightAt(38, 40, perimeter))
  expect(lightAt(42, 40, perimeter)).toBeGreaterThan(0)
  expect(lightAt(42, 40, perimeter)).toBeLessThan(lightAt(41, 40, perimeter))
  expect(lightAt(44, 40, perimeter)).toBe(0)
  expect(lightAt(65, 40, perimeter)).toBe(0)
})
