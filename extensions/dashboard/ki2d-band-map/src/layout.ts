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
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]
  return steps.find(step => (length * step) / spanKHz >= spacing) ?? steps[steps.length - 1]
}

/**
 * `stack`, over `count` side-by-side columns, nearest first: each label takes the nearest column
 * with room for it right at its point, so a lone label stays beside the line and only a crowd
 * spreads outward. One with no room anywhere goes to the column holding fewest, to be stacked.
 * Labels claim their columns in `priority` order (indices into `desired`), first nearest.
 */
export function columns(desired: number[], count: number, size: number, min: number, max: number, priority = desired.map((_, i) => i)): { column: number; top: number }[] {
  const claimed = lanes(priority.map(i => [desired[i] - size / 2, desired[i] + size / 2]), count, 0)
  const chosen: (number | null)[] = []
  priority.forEach((i, k) => { chosen[i] = claimed[k] })
  const load = Array.from({ length: count }, (_, column) => chosen.filter(c => c === column).length)
  const assigned = chosen.map(c => {
    if (c != null) return c
    const column = load.indexOf(Math.min(...load))
    load[column]++
    return column
  })
  const placed: { column: number; top: number }[] = []
  for (let column = 0; column < count; column++) {
    const mine = desired.map((d, i) => [d, i] as const).filter(([, i]) => assigned[i] === column)
    stack(mine.map(([d]) => d), size, min, max).forEach((top, k) => { placed[mine[k][1]] = { column, top } })
  }
  return placed
}
