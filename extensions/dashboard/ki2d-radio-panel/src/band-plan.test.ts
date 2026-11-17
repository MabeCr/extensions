// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planLayers, type PlanSegment } from './band-plan.ts'

// 20 m as the app's library has it for the US: data broken by the FT8 and FT4 windows, a hole
// between two segments, and beyond the band, nothing.
const twenty: PlanSegment[] = [
  { from: 13900, to: 14000, mode: false },
  { from: 14000, to: 14070, mode: 'CW' },
  { from: 14070, to: 14074, mode: 'RTTY' },
  { from: 14074, to: 14077, mode: 'FT8' },
  { from: 14077, to: 14080, mode: 'RTTY' },
  { from: 14080, to: 14083, mode: 'FT4' },
  { from: 14083, to: 14095, mode: 'RTTY' },
  { from: 14095, to: 14100, mode: 'CW' },
  { from: 14100, to: 14101, mode: '' },
  { from: 14101, to: 14150, mode: 'CW' },
  { from: 14150, to: 14350, mode: 'SSB' },
  { from: 14350, to: 14450, mode: false },
]
const layout = { hzPerPx: 250, top: 'spectrum', window: [13900, 14450] as [number, number], height: 200 }

test('the band\'s edges are barriers, and what lies past them is dimmed', () => {
  const layers = planLayers(twenty, layout)
  assert.deepEqual(layers.filter(l => l.id.startsWith('plan:edge:')).map(l => l.x), ['freq:14000000-1.5px', 'freq:14350000-1.5px'])
  assert.deepEqual(layers.filter(l => l.id.startsWith('plan:out:')).map(l => [l.x, l.x2]), [['freq:0', 'freq:14000000'], ['freq:14350000', 'freq:28900000']])
})

test('each kind of mode is labelled where it starts, once, and the FT8 and FT4 windows split nothing', () => {
  const layers = planLayers(twenty, layout)
  // Read as changes of mode, Data would be labelled three times between 14070 and 14095, and the
  // hole at 14100 would start a second CW stretch.
  assert.deepEqual(layers.filter(l => l.id.startsWith('plan:mode-label:')).map(l => [l.x, l.text]), [
    ['freq:14000000+8px', 'CW'],
    ['freq:14070000+8px', 'Data'],
    ['freq:14095000+8px', 'CW'],
    ['freq:14150000+8px', 'Phone'],
  ])
  // Edges and modes only: no window's box or label.
  assert.ok(!layers.some(l => /FT[48]/.test(l.id) || l.id.startsWith('plan:box:') || l.id.startsWith('plan:area:')))
  // The band's edge already marks where CW starts; every other start gets its line.
  assert.deepEqual(layers.filter(l => l.kind === 'line').map(l => l.x), ['freq:14070000', 'freq:14095000', 'freq:14150000'])
})

test('edges only leaves out every mode\'s line and label', () => {
  const layers = planLayers(twenty, { ...layout, edgesOnly: true })
  assert.deepEqual(layers.map(l => l.id.split(':')[1]), ['out', 'out', 'edge', 'edge'])
})

test('a label too close to the one before drops to the second row, and with no room there, is left out', () => {
  // At 1 kHz a pixel, Data's tag would cover CW's start 25 kHz on.
  const crowded: PlanSegment[] = [
    { from: 14000, to: 14010, mode: 'RTTY' }, { from: 14010, to: 14020, mode: 'CW' }, { from: 14020, to: 14350, mode: 'SSB' },
  ]
  const rows = planLayers(crowded, { ...layout, hzPerPx: 1000 }).filter(l => l.kind === 'text').map(l => [l.text, l.y])
  assert.deepEqual(rows, [['Data', 'spectrum+2px'], ['CW', 'spectrum+19px']])
})

test('only what falls in the window is drawn', () => {
  const layers = planLayers(twenty, { ...layout, window: [14140, 14200] })
  assert.deepEqual(layers.filter(l => l.kind === 'text').map(l => l.text), ['CW', 'Phone'])
  assert.ok(!layers.some(l => l.id.startsWith('plan:edge:')))
})
