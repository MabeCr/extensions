// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBandMap, mapSpots } from './bandmap.ts'
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
  const [a0, a1] = vertical ? [8, scene.height - 8] : [8, scene.width - 8]
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

const resetLabel = (scene: any) => scene.controls.find((c: { id: string }) => c.id === 'zoom-reset').label

// Phone at 14074: the plan's phone stretch, then 50 kHz on the radio, then the whole band again.
test('the reset button steps through the whole band, the mode’s segment and the radio’s neighbourhood', async () => {
  const { hook } = bandMap()
  let { scene } = await render(hook, 900, 220)
  assert.equal(resetLabel(scene), 'This mode’s segment')
  await hook.onEvent(event('zoom-reset'))
  ;({ scene } = await render(hook, 900, 220))
  assert.equal(resetLabel(scene), 'Around the radio')
  await hook.onEvent(event('zoom-reset'))
  const around = await render(hook, 900, 220)
  assert.ok(Math.abs(around.scene.width / 900 - 350 / 50) < 0.01, `${around.scene.width}`)
  assert.ok(Math.abs(around.middle - 14074) < 1, `${around.middle}`)
  assert.equal(resetLabel(around.scene), 'The whole band')
  await hook.onEvent(event('zoom-reset'))
  ;({ scene } = await render(hook, 900, 220))
  assert.equal(scene.width, 900)
  // A zoom of the operator's own starts the round again from the whole band.
  await hook.onEvent(event('zoom-in'))
  assert.equal(resetLabel((await render(hook, 900, 220)).scene), 'The whole band')
})

// The scope is drawn over the stretch of the line its sweep covers; the map keeps its own zoom,
// and leaves the radio's span as it is.
test("over the panadapter the map zooms as it does without one, and never the radio's span", async () => {
  const spans: unknown[] = []
  const { hook } = bandMap({
    readRadio: async () => ({ id: 'r', frequencyHz: 14025000, mode: 'CW', modes: ['CW'], spectrum: { mode: 'center', spanHz: 100000, spansHz: [2500, 100000] } }),
    setRadioSpectrum: async (a: { spanHz: number }) => (spans.push(a.spanHz), { accepted: true }),
  })
  const first = (await render(hook, 900, 220)).scene
  assert.equal(first.width, 900)
  await hook.onEvent(event('zoom-in'))
  const { scene } = await render(hook, 900, 220)
  assert.equal(scene.width, 1800)
  assert.deepEqual(spans, [])
})

// A FlexRadio's pan stays put when its slice retunes inside it: taken for centred on the dial, the
// waterfall would be drawn as far off the scale as the radio had tuned.
test('over a panadapter the radio places apart from the dial, the scope is drawn between its edges', async () => {
  const { hook } = bandMap({
    readRadio: async () => ({ id: 'r', frequencyHz: 14320000, mode: 'USB', modes: ['USB'], spectrum: { mode: 'center', spanHz: 42000, lowHz: 14251000, highHz: 14335000, spansHz: [42000] } }),
  })
  const { scene } = await render(hook, 220, 900)
  const scope = scene.controls.find((c: { id: string }) => c.id === 'scope')
  assert.ok(scope, 'the scope is drawn')
  // The whole band, 14000–14350, down 8 to 892.
  const at = (khz: number) => 8 + ((khz - 14000) / 350) * 884
  assert.ok(Math.abs(scope.y - at(14251)) < 1e-6 && Math.abs(scope.y + scope.height - at(14335)) < 1e-6, `${scope.y} ${scope.height}`)
  // All the map shows, asked of a scope the app sizes to its displays.
  assert.equal(scope.span, 350000)
  // At most the 10 MHz the app takes, though 70 cm is 30 MHz wide.
  const { hook: uhf } = bandMap({
    readRadio: async () => ({ id: 'r', frequencyHz: 432100000, mode: 'USB', modes: ['USB'], spectrum: { mode: 'center', spanHz: 50000, lowHz: null, highHz: null, spansHz: [50000] } }),
  })
  assert.equal((await render(uhf, 220, 900, '70cm')).scene.controls.find((c: { id: string }) => c.id === 'scope').span, 1e7)
  const labels = scene.layers.filter((l: { id: string }) => /^tick-.*-khz$/.test(l.id)).map((l: { text: { literal: string } }) => Number(l.text.literal.slice(1)))
  assert.ok(Math.min(...labels) === 0 && Math.max(...labels) >= 340, `${labels}`)
})

// The app starts a radio's scope only for a control that shows it, and reports none of its
// settings until then: a map that waited for them would never ask for the scope at all.
test('a scope not yet running is drawn about the radio, which starts it', async () => {
  const { hook } = bandMap({
    readRadio: async () => ({ id: 'r', frequencyHz: 21242000, mode: 'USB', modes: ['USB'], spectrum: { problem: null, mode: null, spanHz: null, lowHz: null, highHz: null, spansHz: [] } }),
  })
  const { scene } = await render(hook, 220, 900, '15m')
  const scope = scene.controls.find((c: { id: string }) => c.id === 'scope')
  assert.ok(scope, 'the scope is drawn')
  // 21000–21450 down 8 to 892, 25 kHz either side of 21242: the scope's first span that wide, or 25 kHz.
  const at = (khz: number) => 8 + ((khz - 21000) / 450) * 884
  assert.ok(Math.abs(scope.y - at(21217)) < 1e-6 && Math.abs(scope.y + scope.height - at(21267)) < 1e-6, `${scope.y} ${scope.height}`)
})

async function renderFor(stationCall: string | undefined, width: number, height: number, band: string, config: Record<string, unknown> = {}) {
  const { hook } = bandMap()
  const ctx = { getSpots: async () => spots }
  const operation = stationCall ? { stationCall } : {}
  const { scene } = await hook.render({ environment: env(width, height), clock: { nowMillis: 1e12 }, instanceId: 'a', config: { band, ...config }, operation }, ctx)
  return scene
}
const markLabels = (scene: any) => scene.controls.filter((c: { id: string }) => c.id.startsWith('mark:')).map((c: { label: string }) => c.label)

// The license-class edge is the US's alone, and each region keeps its own emergency frequencies.
test('a station sees the markers for its entity and region, and an unknown one sees them all', async () => {
  assert.ok(markLabels(await renderFor('KI2D', 900, 220, '20m')).includes('US Extra/General'))
  assert.ok(!markLabels(await renderFor('EA4ABC', 900, 220, '20m')).includes('US Extra/General'))
  const emergencies = async (call?: string) => (await renderFor(call, 900, 220, '40m')).controls
    .filter((c: { label: string }) => c.label === 'Emergency').length
  assert.equal(await emergencies('KI2D'), 2)
  assert.equal(await emergencies('EA4ABC'), 1)
  assert.equal(await emergencies(undefined), 3)
})

// Hovering an emoji lights only its own label: each marker's lit layers answer `mark` at its number.
// Upright the scale is on the right and the markers on the left; wide, the scale along the top and
// the markers along the bottom. Inverted, each swaps.
test('a marker is its emoji at the far edge, with its label shown only under the pointer', async () => {
  for (const [width, height, direction] of [[900, 220, 'normal'], [360, 640, 'normal'], [900, 220, 'inverted'], [360, 640, 'inverted']] as const) {
    const scene = await renderFor('KI2D', width, height, '20m', { direction })
    const vertical = height > width, nearStart = vertical === (direction === 'normal')
    const marks = scene.controls.filter((c: { id: string }) => c.id.startsWith('mark:'))
    assert.equal(marks.length, 9)
    for (const [i, c] of marks.entries()) {
      assert.equal(c.event, undefined)
      assert.deepEqual(c.hoverSet, { value: 'mark', to: c.hoverSet.to })
      const icon = scene.layers.find((l: { id: string }) => l.id === `mark-${c.hoverSet.to}-icon`)
      const edge = vertical ? icon.x : icon.y, end = (vertical ? width : height) - 8 - 16
      assert.equal(edge, nearStart ? 8 : end, `${i} at the edge, ${direction}`)
      const label = scene.layers.find((l: { id: string }) => l.id === `mark-${c.hoverSet.to}-label`)
      assert.equal(label.opacity.value, 'mark')
      assert.deepEqual(label.opacity.samples, [0, 1, 0])
    }
    assert.equal(scene.values.mark, -1)
    // The spots' labels stop short of the emoji's strip.
    const spot = scene.controls.find((c: { id: string }) => c.id === 'spot:K1A')
    const [from, to] = vertical ? [spot.x, spot.x + spot.width] : [spot.y, spot.y + spot.height]
    assert.ok(nearStart ? from >= 8 + 20 : to <= (vertical ? width : height) - 8 - 20, direction)
  }
})

// The waterfall across the field, flowing away from the line; the panadapter in the scale's strip,
// under its labels, from the line to the pane's edge. Each can be turned off, and with both off
// there is no scope, and the map runs across the band.
test('the scope takes the waterfall and the panadapter as set, flowing away from the scale', async () => {
  const { hook } = bandMap({
    readRadio: async () => ({ id: 'r', frequencyHz: 14074000, mode: 'USB', modes: ['USB'], spectrum: { mode: 'center', spanHz: 50000, spansHz: [50000] } }),
  })
  const ctx = { getSpots: async () => spots }
  const scopesFor = async (width: number, height: number, config: Record<string, unknown> = {}) => {
    const { scene } = await hook.render({ environment: env(width, height), clock: { nowMillis: 1e12 }, instanceId: 'a', config, operation: {} }, ctx)
    const find = (id: string) => scene.controls.find((c: { id: string }) => c.id === id)
    return { falls: find('scope'), pan: find('scope-pan') }
  }
  // Tall, 220 wide: the line at 212 − 58, the field from 8 to it, the strip from it to 212.
  let { falls, pan } = await scopesFor(220, 900)
  assert.deepEqual([falls.display, falls.flow, falls.x, falls.width], ['waterfall', 'left', 8, 146])
  assert.deepEqual([pan.display, pan.flow, pan.x, pan.width], ['pan', 'left', 154, 58])
  assert.deepEqual([falls.rising, pan.rising], ['down', 'down'], 'frequency down the page, as the scale runs')
  ;({ falls, pan } = await scopesFor(220, 900, { direction: 'inverted' }))
  assert.deepEqual([falls.flow, falls.x, falls.width, pan.x, pan.width], ['right', 66, 146, 8, 58])
  assert.deepEqual([falls.rising, pan.rising], ['down', 'down'])
  ;({ falls, pan } = await scopesFor(220, 900, { waterfall: false }))
  assert.deepEqual([falls, pan.display], [undefined, 'pan'])
  ;({ falls, pan } = await scopesFor(220, 900, { pan: false }))
  assert.deepEqual([falls.display, pan], ['waterfall', undefined])
  assert.deepEqual(await scopesFor(220, 900, { waterfall: false, pan: false }), { falls: undefined, pan: undefined })
  // The menu before these toggles, whose Off was no scope at all, and a toggle set since wins over it.
  assert.deepEqual(await scopesFor(220, 900, { panadapter: 'off' }), { falls: undefined, pan: undefined })
  assert.equal((await scopesFor(220, 900, { panadapter: 'off', pan: true })).pan.display, 'pan')
  // Wide, 220 high: the scale along the top, 8 to 26, or inverted along the bottom.
  ;({ falls, pan } = await scopesFor(900, 220))
  assert.deepEqual([falls.flow, falls.y, falls.height, pan.y, pan.height, falls.rising], ['down', 26, 186, 8, 18, 'right'])
  assert.equal((await scopesFor(900, 220, { direction: 'inverted' })).falls.flow, 'up')
})

// The label's pill takes in its emoji, which a copy of sits on, and the label sits beside it there.
test("a marker's label pill takes in its emoji", async () => {
  for (const [width, height] of [[900, 220], [360, 640]]) {
    const scene = await renderFor('KI2D', width, height, '20m')
    const find = (id: string) => scene.layers.find((l: { id: string }) => l.id === id)
    for (const c of scene.controls.filter((c: { id: string }) => c.id.startsWith('mark:'))) {
      const n = c.hoverSet.to, icon = find(`mark-${n}-icon`), label = find(`mark-${n}-label`), copy = find(`mark-${n}-lit-icon`)
      const [x, y, w, h] = find(`mark-${n}-lit`).svg.match(/<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)"/).slice(1).map(Number)
      const inside = (l: { x: number; y: number; width: number; height: number }) =>
        l.x >= x - 1 && l.x + l.width <= x + w + 1 && l.y >= y - 1 && l.y + l.height <= y + h + 1
      assert.ok(inside(icon), `${c.label}: its emoji`)
      assert.ok(inside(label), `${c.label}: its label`)
      assert.ok(label.x + label.width <= icon.x || label.x >= icon.x + icon.width, `${c.label}: beside the emoji`)
      assert.deepEqual([copy.x, copy.y, copy.text], [icon.x, icon.y, icon.text])
      assert.equal(copy.opacity.value, 'mark')
      assert.ok(scene.layers.indexOf(copy) > scene.layers.indexOf(find(`mark-${n}-lit`)))
    }
    // Every pill and its emoji over every plain emoji, a neighbour's included.
    const firstLit = scene.layers.findIndex((l: { id: string }) => /^mark-\d+-lit$/.test(l.id))
    assert.ok(scene.layers.every((l: { id: string }, k: number) => !/^mark-\d+-icon$/.test(l.id) || k < firstLit))
  }
})

// A crowd — FT8 and FT4 six kHz apart, a QRP and an emergency frequency on the same one — spreads
// its emoji along the edge rather than piling them on each other.
test('crowded markers spread their emoji along the edge', async () => {
  const scene = await renderFor(undefined, 900, 220, '40m')
  const icons = scene.layers.filter((l: { id: string }) => /^mark-\d+-icon$/.test(l.id)).map((l: { x: number }) => l.x).sort((a: number, b: number) => a - b)
  for (let k = 1; k < icons.length; k++) assert.ok(icons[k] - icons[k - 1] >= 16 - 1e-9, `${icons[k - 1]} and ${icons[k]}`)
})

// An edge is a boundary, not a place to go: it reads as one only drawn apart from the others.
test('an edge marker is a solid line, two pixels wide, and the rest are dashed', async () => {
  const scene = await renderFor('KI2D', 900, 220, '20m')
  for (const c of scene.controls.filter((c: { id: string }) => c.id.startsWith('mark:'))) {
    const line = scene.layers.find((l: { id: string }) => l.id === `mark-${c.hoverSet.to}-line`).svg
    if (c.label === 'US Extra/General') assert.match(line, /stroke-width="2"(?![^>]*dasharray)/)
    else assert.match(line, /stroke-width="1" stroke-dasharray/)
  }
})

// On phone, a CW spot is one the operator is not after just now: still there, but quieter.
test("spots of another kind than the radio's mode are fainter, until it leaves the band", async () => {
  const mixed = [
    { their: { call: 'K1A' }, freq: 14250, band: '20m', mode: 'SSB', spot: { timeInMillis: 1e12 } },
    { their: { call: 'W1CW' }, freq: 14030, band: '20m', mode: 'CW', spot: { timeInMillis: 1e12 } },
  ]
  const rest = async (radio: Record<string, unknown>) => {
    const { hook } = bandMap({ readRadio: async () => ({ id: 'r', modes: ['USB', 'CW'], ...radio }) })
    const { scene } = await hook.render({ environment: env(900, 220), clock: { nowMillis: 1e12 }, instanceId: 'a', config: { band: '20m' }, operation: {} }, { getSpots: async () => mixed })
    const call = (literal: string) => scene.layers.find((l: { text?: { literal: string } }) => l.text?.literal === literal).opacity.output[0]
    return [call('K1A'), call('W1CW')]
  }
  assert.deepEqual(await rest({ frequencyHz: 14250000, mode: 'USB' }), [1, 0.45])
  assert.deepEqual(await rest({ frequencyHz: 14030000, mode: 'CW' }), [0.45, 1])
  assert.deepEqual(await rest({ frequencyHz: 7030000, mode: 'CW' }), [1, 1])
})

// The board answers each source's reports apart, newest first: a cluster spot after the POTA one
// is the station's latest, but it is the POTA one that knows the park.
test("a spot's suggestion carries the refs and mode from all its station's reports", async () => {
  const reports = [
    { their: { call: 'K1P' }, freq: 14062, band: '20m', spot: { timeInMillis: 1e12, source: 'cluster' }, icon: 'radio-tower' },
    { their: { call: 'K1P' }, freq: 14062.2, band: '20m', mode: 'CW', refs: [{ type: 'potaActivation', ref: 'US-1234', name: 'A Park' }], spot: { timeInMillis: 1e12 - 6e5, source: 'pota' }, display: { icon: 'pine-tree' } },
  ]
  const suggested: any[] = []
  const { hook } = bandMap({ suggestQso: async (a: any) => (suggested.push(a.qso), { accepted: true }) })
  const { scene } = await hook.render({ environment: env(900, 220), clock: { nowMillis: 1e12 }, instanceId: 'a', config: { band: '20m' }, operation: {} }, { getSpots: async () => reports })
  assert.equal(scene.layers.find((l: { id: string; icon?: unknown }) => /^spot-\d+-icon$/.test(l.id)).icon.name, 'pine-tree')
  await hook.onEvent(event('spot', { controlId: 'spot:K1P' }))
  assert.deepEqual(suggested, [{ their: { call: 'K1P' }, freq: 14062, band: '20m', mode: 'CW', refs: [{ type: 'potaActivation', ref: 'US-1234', name: 'A Park' }] }])
})

// The board stands a tower in for a source with no icon; on the map the cluster's spots go without.
test('a cluster spot has no icon unless a reference gives it one', async () => {
  const reports = [
    { their: { call: 'K1C' }, freq: 14025, band: '20m', mode: 'CW', spot: { timeInMillis: 1e12, source: 'cluster' }, display: { icon: 'radio-tower' } },
    { their: { call: 'K1P' }, freq: 14062, band: '20m', mode: 'CW', refs: [{ type: 'potaActivation', ref: 'US-1234' }], spot: { timeInMillis: 1e12, source: 'cluster' }, display: { icon: 'pine-tree' } },
  ]
  const { hook } = bandMap()
  const { scene } = await hook.render({ environment: env(900, 220), clock: { nowMillis: 1e12 }, instanceId: 'a', config: { band: '20m' }, operation: {} }, { getSpots: async () => reports })
  const icons = scene.layers.filter((l: { id: string }) => /^spot-\d+-icon$/.test(l.id)).map((l: { icon: { name: string } }) => l.icon.name)
  assert.deepEqual(icons, ['pine-tree'])
  const call = scene.layers.find((l: { text?: { literal: string } }) => l.text?.literal === 'K1C')
  const box = scene.controls.find((c: { id: string }) => c.id === 'spot:K1C')
  assert.equal(call.x, box.x + 6)
})

// With no radio to read, the logging controls are where the operator is: their frequency picks the
// band and their mode the kind of spots shown at full strength.
test('with no radio, the map follows the logging controls', async () => {
  const { hook } = bandMap({ readRadio: async () => null })
  const rest = async (qso: Record<string, unknown>) => {
    const { scene } = await hook.render({ environment: env(900, 220), clock: { nowMillis: 1e12 }, instanceId: 'a', config: {}, operation: {}, qso }, { getSpots: async () => spots })
    return scene.layers.find((l: { text?: { literal: string } }) => l.text?.literal === 'K1A').opacity.output[0]
  }
  assert.equal(await rest({ freq: 14030, band: '20m', mode: 'CW' }), 0.45)
  assert.equal(await rest({ freq: 14250, band: '20m', mode: 'SSB' }), 1)
})

// The host says how far along the line the click landed; the map tunes there, to its finest marks.
test('a click on the scale tunes to the frequency under it, rounded to the marks shown', async () => {
  const { hook, tuned } = bandMap()
  const { scene } = await render(hook, 900, 220)
  const axis = scene.controls.find((c: { id: string }) => c.id === 'axis')
  assert.equal(axis.tapAt, true)
  await hook.onEvent(event('axis', { value: 0.123 }))
  const [{ frequencyHz }] = tuned as { frequencyHz: number }[]
  assert.equal(frequencyHz % 1000, 0, `${frequencyHz} on a whole kHz`)
  assert.ok(Math.abs(frequencyHz - (14000 + 0.123 * 350) * 1000) <= 5000, `${frequencyHz}`)
  // A key or screen reader activates it without a place: nothing is tuned.
  await hook.onEvent(event('axis'))
  assert.equal(tuned.length, 1)
})

// A portable operator with no CAT picks the band and mode and types no frequency: still their band.
test('with no radio and no frequency typed, the map takes the logging controls\' band, and nothing to tune', async () => {
  const { hook } = bandMap({ readRadio: async () => null })
  const { scene, title } = await hook.render({ environment: env(900, 220), clock: { nowMillis: 1e12 }, instanceId: 'a', config: {}, operation: {}, qso: { band: '40m', mode: 'CW' } }, { getSpots: async () => [] })
  assert.match(title, /40m/)
  assert.ok(!scene.controls.some((c: { id: string }) => c.id === 'axis'), 'no scale to click with no radio')
})

// A station that has moved off the window is not drawn where it was heard before.
test('a station whose newest report is outside the window is not shown at an older one', () => {
  const at = (freq: number, minutesAgo: number) => ({ their: { call: 'K1ABC' }, freq, band: '20m', mode: 'SSB', spot: { timeInMillis: 1e12 - minutesAgo * 6e4, source: 'cluster' } })
  assert.deepEqual(mapSpots([at(14250, 1), at(14074, 20)] as any, 1e12, [14049, 14099]), [])
  assert.deepEqual(mapSpots([at(14250, 1), at(14074, 20)] as any, 1e12, [14000, 14350]).map(s => s.khz), [14250])
})

// A render comes 750 ms after the last at the soonest: a pointer drawn only where the render put it
// trails a turn of the radio's knob by that much. Bound to the live frequency, it moves with the
// report, along the same linear scale the render places it on.
test("the radio's pointer follows its live frequency between renders, and hides off the window", async () => {
  const { hook } = bandMap()
  const { scene } = await render(hook, 900, 220, '20m')
  assert.deepEqual(scene.radio, {})
  const [lo, hi] = bandEdges['20m'], [a0, a1] = [8, scene.width - 8]
  const vfo = scene.layers.find((l: { id: string }) => l.id === 'vfo')
  const p = a0 + ((14074 - lo) / (hi - lo)) * (a1 - a0)
  assert.deepEqual(vfo.translateX, { value: 'radio.frequencyHz', input: [lo * 1000, hi * 1000], output: [a0 - p, a1 - p] })
  assert.deepEqual(vfo.when, { value: 'radio.frequencyHz', min: lo * 1000, max: hi * 1000 })
  // At the rendered frequency the binding moves it nowhere.
  const shift = (hz: number) => vfo.translateX.output[0] + ((hz - vfo.translateX.input[0]) / (hi * 1000 - lo * 1000)) * (vfo.translateX.output[1] - vfo.translateX.output[0])
  assert.ok(Math.abs(shift(14074000)) < 1e-6)
  assert.ok(Math.abs(shift(14174000) - (100 / (hi - lo)) * (a1 - a0)) < 1e-6)
  assert.deepEqual(scene.layers.find((l: { id: string }) => l.id === 'radio')?.translateX, vfo.translateX)

  // With no radio the pointer is the logging controls' frequency, which the host does not feed.
  const draft = bandMap({ readRadio: async () => null }).hook
  const { scene: typed } = await draft.render({ environment: env(900, 220), clock: { nowMillis: 1e12 }, instanceId: 'a', config: {}, operation: {}, qso: { freq: 14074, band: '20m', mode: 'USB' } }, { getSpots: async () => spots })
  assert.equal(typed.radio, undefined)
  assert.ok(typed.layers.some((l: { id: string }) => l.id === 'vfo'))
  assert.ok(!typed.layers.some((l: { translateX?: unknown; when?: unknown }) => l.translateX && l.when))
})

test('the map asks to be rendered when the dial moves, to scroll and redraw about it', async () => {
  const [descriptor] = await bandMap().hook.getPanels({}, { locale: 'en' })
  assert.ok(descriptor.on.includes('radio'))
})
