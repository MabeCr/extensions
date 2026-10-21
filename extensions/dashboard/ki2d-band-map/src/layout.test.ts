// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { columns, lanes, stack, tickStep } from './layout.ts'

const overlaps = (tops: number[], size: number) => tops.some((t, i) => i > 0 && t < tops[i - 1] + size - 1e-9)

// A crowd piled up below its first label would put every call after it far from its frequency.
test('a crowd spreads evenly about its middle, never overlapping, within its bounds', () => {
  const tops = stack([100, 100, 100], 20, 0, 400)
  assert.deepEqual(tops, [70, 90, 110])
  assert.equal(overlaps(stack([5, 6, 7, 390, 395], 20, 0, 400), 20), false)
  const pinned = stack([0, 0, 0], 20, 0, 400)
  assert.equal(pinned[0], 0)
})

test('labels with room stay centred on their points', () => {
  assert.deepEqual(stack([50, 150, 250], 20, 0, 400), [40, 140, 240])
})

// Lanes are claimed in the order given: the band map passes the newest spots first, to sit nearest the line.
test('a label takes the first lane it fits in, in the order given, or none', () => {
  const spans: [number, number][] = [[0, 50], [10, 60], [100, 150], [20, 70]]
  assert.deepEqual(lanes(spans, 2, 4), [0, 1, 0, null])
})

// Dealt round-robin, a lone label would land in a far column, its line drawn across the others.
test('a lone label stays in the nearest column, and only a crowd spreads outward', () => {
  // Lone labels before and after a crowd of three: dealt in turn, the last would land in the middle column.
  const placed = columns([50, 300, 300, 300, 380], 3, 20, 0, 400)
  assert.equal(placed[0].column, 0)
  assert.equal(placed[4].column, 0)
  assert.deepEqual(placed.slice(1, 4).map(p => p.column).sort(), [0, 1, 2])
})

test('newer labels claim the nearer columns where they crowd', () => {
  // The third label is the newest: given first, it takes the column beside the line.
  const placed = columns([100, 100, 100], 3, 20, 0, 400, [2, 0, 1])
  assert.equal(placed[2].column, 0)
})

test('the scale labels are as fine as their spacing allows', () => {
  assert.equal(tickStep(350, 700, 36), 20)
  assert.equal(tickStep(350, 7000, 36), 2)
  assert.equal(tickStep(350, 10, 36), 2000)
})
