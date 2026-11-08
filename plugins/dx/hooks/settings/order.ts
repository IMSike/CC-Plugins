import type { BottomFact } from '../../types'

// `order` with `fact` moved one place up (-1) or down (+1): unchanged at
// either end, or when `fact` is not in it.
export function moved(order: readonly BottomFact[], fact: BottomFact, by: -1 | 1): BottomFact[] {
  const from = order.indexOf(fact)
  const to = from + by
  if (from < 0 || to < 0 || to >= order.length) return [...order]
  const next = [...order]
  next[from] = next[to] as BottomFact
  next[to] = fact
  return next
}
