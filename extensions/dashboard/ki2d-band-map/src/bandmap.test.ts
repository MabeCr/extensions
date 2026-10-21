// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBandMap } from './bandmap.ts'
import { bandEdges } from './bands.ts'

const colors: Record<string, string> = {}
for (const k of ['surface', 'surfaceContainer', 'onSurface', 'onSurfaceVariant', 'primary', 'secondary', 'outline', 'error']) colors[k] = '#123456'
const env = (width: number, height: number) => ({ version: 1, width, height, safeInsets: { left: 0, top: 0, right: 0, bottom: 0 }, colors, typography: { mono: { fontFamily: 'RobotoMono' } } })
const spots = [{ their: { call: 'K1A' }, freq: 14250, band: '20m', mode: 'SSB', spot: { timeInMillis: 1e12 } }]

function bandMap(overrides: Record<string, unknown> = {}): { hook: any; tuned: unknown[] } {
  const tuned: unknown[] = []
  const host = {
    readRadio: async () => ({ id: 'r', frequencyHz: 14074000, mode: 'USB', modes: ['USB'] }),
    setRadio: async (a: unknown) => (tuned.push(a), { accepted: true }),
    setRadioSpectrum: async () => ({ accepted: true }),
    suggestQso: async () => ({ accepted: false }),
    ...overrides,
  }
  return { hook: createBandMap(host as any), tuned }
}

async function render(hook: any, width: number, height: number, band?: string) {
  const ctx = { getSpots: async () => spots }
  const { scene } = await hook.render({ environment: env(width, height), clock: { nowMillis: 1e12 }, instanceId: 'a', config: band ? { band } : {}, operation: {} }, ctx)
  // The frequency in the middle of what the pane shows, from the line's ends and the scroll.
  const vertical = height > width, pane = vertical ? height : width
  const [a0, a1] = vertical ? [scene.height - 8, 8] : [8, scene.width - 8]
  const [lo, hi] = bandEdges[band ?? '20m']
  return { scene, middle: lo + ((scene.values.scroll + pane / 2 - a0) / (a1 - a0)) * (hi - lo) }
}

const event = (action: string, extra: Record<string, unknown> = {}) => ({ instanceId: 'a', event: { action, controlId: action, phase: 'activate', ...extra } })

// The offset is in scene units: a pane laid out anew at another size or the other way up puts the
// same offset on another frequency, and the operator's place on the band moves under them.
test('a resized or turned pane keeps the frequency in the middle of the view', async () => {
  const { hook } = bandMap()
  await render(hook, 900, 220)
  await hook.onEvent(event('zoom-in'))
  await render(hook, 900, 220)
  await hook.onEvent(event('zoom-in'))
  await render(hook, 900, 220)
  await hook.onEvent(event('scrolled', { value: 2400 }))
  const { middle } = await render(hook, 900, 220)
  assert.ok(Math.abs((await render(hook, 1400, 220)).middle - middle) < 2, 'wider')
  assert.ok(Math.abs((await render(hook, 300, 900)).middle - middle) < 2, 'turned tall')
})

// Another band's offset is a place on the old band: carried over, it lands somewhere arbitrary.
// Zoomed four times, so the radio at 14074 can sit in the middle without the band's edge stopping it.
test('another band starts its view afresh, on the radio', async () => {
  const { hook } = bandMap()
  await render(hook, 900, 220)
  for (let i = 0; i < 2; i++) {
    await hook.onEvent(event('zoom-in'))
    await render(hook, 900, 220)
  }
  await hook.onEvent(event('scrolled', { value: 2400 }))
  await render(hook, 900, 220)
  await render(hook, 900, 220, '40m')
  assert.ok(Math.abs((await render(hook, 900, 220, '20m')).middle - 14074) < 2)
})

// A spot's id is its station's: by its place in the list, a click on the picture painted before a
// new spot arrived would reach whichever spot moved into that place.
test('a spot is clicked by its station, and a refused retune is an error, not a quiet success', async () => {
  const { hook, tuned } = bandMap({ setRadio: async () => ({ accepted: false, reason: 'transmitting' }) })
  const { scene } = await render(hook, 900, 220)
  assert.ok(scene.controls.some((c: { id: string }) => c.id === 'spot:K1A'))
  await assert.rejects(hook.onEvent(event('spot', { controlId: 'spot:K1A' })), /transmitting/)
  assert.deepEqual(tuned, [])
})

// Swallowed, a refusal — no grant, called from the wrong place — would turn every click into a
// bare retune, the logging fields never filled and nothing said why.
test('a refused suggestion is an error, and does not fall back to tuning', async () => {
  const { hook, tuned } = bandMap({ suggestQso: async () => { throw new Error('suggestQso blocked') } })
  await render(hook, 900, 220)
  await assert.rejects(hook.onEvent(event('spot', { controlId: 'spot:K1A' })), /blocked/)
  assert.deepEqual(tuned, [])
})

test('an action the map does not draw is an error', async () => {
  const { hook } = bandMap()
  await render(hook, 900, 220)
  await assert.rejects(hook.onEvent(event('tnue')), /tnue/)
})
