// How many rows the panel's tabs take (./activity's paneTabs).

// The rows a row of labels takes, wrapped in `columns` with a cell between:
// a label wider than `columns` takes a row of its own, cut there.
export function wrappedRows(labels: readonly string[], columns: number): number {
  let rows = 1
  let used = 0
  for (const label of labels) {
    const width = Math.min(columns, Array.from(label).length)
    if (used > 0 && used + 1 + width > columns) {
      rows += 1
      used = width
    } else {
      used += (used > 0 ? 1 : 0) + width
    }
  }
  return rows
}
