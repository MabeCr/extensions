// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MPL-2.0

/**
 * Tops for labels `size` tall that each want to be centred on its `desired` point (ascending),
 * kept between `min` and `max` and never overlapping: a crowd spreads evenly around its middle
 * rather than piling up on one side of it. The caller keeps the crowd small enough to fit.
 */
export function stack(desired: number[], size: number, min: number, max: number): number[] {
  const groups: { first: number; count: number; sum: number; top: number }[] = []
  const place = (g: (typeof groups)[number]) => {
    g.top = Math.min(Math.max(g.sum / g.count - (g.count * size) / 2, min), max - g.count * size)
  }
  desired.forEach((d, i) => {
    const g = { first: i, count: 1, sum: d, top: 0 }
    place(g)
    groups.push(g)
    while (groups.length > 1) {
      const [a, b] = groups.slice(-2)
      if (a.top + a.count * size <= b.top) break
      groups.splice(-2, 2, { first: a.first, count: a.count + b.count, sum: a.sum + b.sum, top: 0 })
      place(groups[groups.length - 1])
    }
  })
  const tops: number[] = []
  for (const g of groups) for (let k = 0; k < g.count; k++) tops.push(g.top + k * size)
  return tops
}

/**
 * The lane, 0 nearest the axis, for each label's `[start, end]` span, given in priority order:
 * the first lane where it clears every label already there by `gap`, or null when none does.
 */
export function lanes(spans: [number, number][], count: number, gap: number): (number | null)[] {
  const taken: [number, number][][] = Array.from({ length: count }, () => [])
  return spans.map(([start, end]) => {
    const lane = taken.findIndex(row => row.every(([s, e]) => end + gap <= s || start >= e + gap))
    if (lane < 0) return null
    taken[lane].push([start, end])
    return lane
  })
}

/** The step between the scale's labels: the finest that keeps them `spacing` apart over `length`. */
export function tickStep(spanKHz: number, length: number, spacing: number): number {
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]
  return steps.find(step => (length * step) / spanKHz >= spacing) ?? steps[steps.length - 1]
}

/**
 * `stack`, over `count` side-by-side columns, keeping the order of `desired` (ascending) down the
 * whole map: each label sits at least `size / count` below the one before, in the nearest column
 * clear of those above it — so a lone label stays beside the line, and a crowd steps outward and
 * back, reading in order across the columns. One of the last `count` labels' columns is always
 * clear. The caller keeps the crowd small enough to fit: `size + (n − 1) · size / count` tall.
 */
export function columns(desired: number[], count: number, size: number, min: number, max: number): { column: number; top: number }[] {
  const pitch = size / count
  // Stacked at the pitch, a label's box is its top `pitch`: centred on the same point, it shifts by the rest.
  const tops = stack(desired.map(d => d - (size - pitch) / 2), pitch, min, max - (size - pitch))
  const clearBelow = Array.from({ length: count }, () => -Infinity)
  const placed = tops.map(top => {
    const column = Math.max(0, clearBelow.findIndex(bottom => bottom <= top + 1e-6))
    clearBelow[column] = top + size
    return { column, top }
  })
  // Then each label back onto its own point wherever that keeps the order and its column clear:
  // the stacking spaces labels in other columns apart that need not be. Twice, as one moved can
  // make room for another.
  for (let pass = 0; pass < 2; pass++) {
    placed.forEach((p, i) => {
      const top = desired[i] - size / 2
      if (top <= (placed[i - 1]?.top ?? -Infinity) || top >= (placed[i + 1]?.top ?? Infinity) || top < min || top > max - size) return
      if (placed.every((q, j) => j === i || q.column !== p.column || q.top + size <= top + 1e-6 || q.top >= top + size - 1e-6)) p.top = top
    })
  }
  return placed
}
