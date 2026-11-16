// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBandMap, mapSpots, noteSpots } from './bandmap.ts'

const colors: Record<string, string> = {}
for (const k of ['surface', 'surfaceContainer', 'onSurface', 'onSurfaceVariant', 'primary', 'secondary', 'outline', 'outlineVariant', 'error']) colors[k] = '#123456'
const env = (width: number, height: number, brightness = 'light') =>
  ({ version: 1, width, height, brightness, safeInsets: { left: 0, top: 0, right: 0, bottom: 0 }, colors, typography: { mono: { fontFamily: 'RobotoMono' } } })
const spots = [{ their: { call: 'K1A' }, freq: 14250, band: '20m', mode: 'SSB', spot: { timeInMillis: 1e12 } }]
const at = (call: string, freq: number, extra: Record<string, unknown> = {}) =>
  ({ their: { call }, freq, band: '20m', mode: 'CW', spot: { timeInMillis: 1e12, source: 'pota' }, ...extra })

/** The map, its host standing in for a radio at 14074 kHz USB, and what it was asked to do. */
function bandMap(overrides: Record<string, unknown> = {}, kept = new Map<string, unknown>()) {
  const tuned: unknown[] = [], suggested: any[] = [], removed: unknown[] = []
  const host = {
    bandAnnotations: { remove: async (keys: string[], options: unknown) => void removed.push([keys, options]) },
    readRadio: async () => ({ id: 'r', frequencyHz: 14074000, mode: 'USB', modes: ['USB', 'CW'] }),
    setRadio: async (a: unknown) => (tuned.push(a), { accepted: true }),
    suggestQso: async (a: any) => (suggested.push(a.qso), { accepted: true }),
    kvGet: async (key: string) => kept.get(key) ?? null,
    kvSet: async (key: string, value: unknown) => void kept.set(key, value),
    ...overrides,
  }
  return { hook: createBandMap(host as any) as any, tuned, suggested, kept, removed }
}

type Rendered = { scene: any; title: string; scope: any; annotation: (id: string) => any; layer: (id: string) => any }
async function render(hook: any, { size = [900, 220] as [number, number], config = {} as Record<string, unknown>, board = spots as unknown[], ctx = {} as Record<string, unknown>, operation = {} as Record<string, unknown>, qso, brightness }: {
  size?: [number, number]; config?: Record<string, unknown>; board?: unknown[]; ctx?: Record<string, unknown>; operation?: Record<string, unknown>; qso?: Record<string, unknown>; brightness?: string
} = {}): Promise<Rendered> {
  const { scene, title } = await hook.render(
    { environment: env(...size, brightness), clock: { nowMillis: 1e12 }, instanceId: 'a', config, operation, ...(qso ? { qso } : {}) },
    { getSpots: async () => board, ...ctx },
  )
  const scope = scene.controls.find((c: { id: string }) => c.id === 'map')
  return {
    scene, title, scope,
    annotation: (id: string) => scope.annotations.find((a: { id: string }) => a.id === id),
    layer: (id: string) => scope.layers.find((l: { id: string }) => l.id === id),
  }
}
const event = (action: string, extra: Record<string, unknown> = {}) => ({ instanceId: 'a', event: { action, controlId: 'map', phase: 'activate', ...extra } })
const spotIds = (r: Rendered) => r.scope.annotations.map((a: { id: string }) => a.id).filter((id: string) => id.startsWith('spot:')).sort()

// With no sweep the app's band scope draws the window alone; zoomed out or panned, the map lets it
// run a quarter of the band past each edge, shaded there.
test('the map is the app’s band scope over the band, its window a quarter past each edge', async () => {
  const { scope, layer } = await render(bandMap().hook)
  assert.equal(scope.kind, 'bandScope')
  assert.deepEqual(scope.window, { lowHz: 14000000 - 87500, highHz: 14350000 + 87500 })
  assert.deepEqual([scope.span, scope.maxWidthHz, scope.centerHz], [350000, 525000, undefined])
  assert.deepEqual([layer('below').x2, layer('above').x], ['freq:14000000', 'freq:14350000'])
  // The radio's own band: its scope; another, the band alone.
  assert.equal(scope.radio, 'r')
  assert.equal((await render(bandMap().hook, { config: { band: '40m' } })).scope.radio, 'none')
})

// The picture as the form asks, and the axis and the spectrum on the other side inverted.
test('the scope shows the waterfall and the spectrum as set, flowing away from the axis', async () => {
  const shown = async (size: [number, number], config: Record<string, unknown> = {}) => {
    const { scope } = await render(bandMap().hook, { size, config })
    return [scope.display, scope.flow, scope.rising]
  }
  assert.deepEqual(await shown([900, 220]), ['both', 'down', 'right'])
  assert.deepEqual(await shown([900, 220], { direction: 'inverted' }), ['both', 'up', 'right'])
  assert.deepEqual(await shown([300, 900]), ['both', 'right', 'down'])
  assert.deepEqual(await shown([300, 900], { direction: 'inverted' }), ['both', 'left', 'down'])
  assert.equal((await shown([900, 220], { waterfall: false }))[0], 'spectrum')
  assert.equal((await shown([900, 220], { pan: false }))[0], 'waterfall')
  // The menu before these toggles, whose Off was no scope at all, and a toggle set since wins over it.
  assert.equal((await shown([900, 220], { panadapter: 'off' }))[0], 'waterfall')
  assert.equal((await shown([900, 220], { panadapter: 'off', pan: true }))[0], 'spectrum')
})

// A spot's id is its station's: by its place in the list, a click on the picture painted before a
// new spot arrived would reach whichever spot moved into that place.
test('a spot is a label by its station, its box over its dot and passband, and a click suggests it', async () => {
  const { hook, suggested } = bandMap()
  const { annotation, layer } = await render(hook)
  const k1a = annotation('spot:K1A')
  assert.deepEqual([k1a.text, k1a.event, k1a.baseline, k1a.align, k1a.part], ['K1A', 'spot', true, 'center', 'waterfall'])
  // SSB above the dial: the box from the dot's low side to the passband's top.
  assert.ok(k1a.stretch.to - k1a.stretch.from > 2700, JSON.stringify(k1a.stretch))
  assert.ok(layer('dot:K1A') && layer('heard:K1A'))
  await hook.onEvent(event('spot', { annotation: 'spot:K1A' }))
  assert.deepEqual(suggested, [{ their: { call: 'K1A' }, freq: 14250, band: '20m', mode: 'SSB', refs: [] }])
})

// Not accepted is no operation open: the radio alone, which may refuse, and say so.
test('with no operation to suggest it to, a spot tunes the radio, and a refusal is an error, not a quiet success', async () => {
  const { hook, tuned } = bandMap({ suggestQso: async () => ({ accepted: false }), setRadio: async () => ({ accepted: false, reason: 'transmitting' }) })
  await render(hook)
  await assert.rejects(hook.onEvent(event('spot', { annotation: 'spot:K1A' })), /transmitting/)
  assert.deepEqual(tuned, [])
})

// Swallowed, a refusal — no grant, called from the wrong place — would turn every click into a
// bare retune, the logging fields never filled and nothing said why.
test('a refused suggestion is an error, and does not fall back to tuning', async () => {
  const { hook, tuned } = bandMap({ suggestQso: async () => { throw new Error('suggestQso blocked') } })
  await render(hook)
  await assert.rejects(hook.onEvent(event('spot', { annotation: 'spot:K1A' })), /blocked/)
  assert.deepEqual(tuned, [])
})

test('an action the map does not draw is an error', async () => {
  const { hook } = bandMap()
  await render(hook)
  await assert.rejects(hook.onEvent(event('tnue')), /tnue/)
})

// Labels a few kHz apart on the whole band all but cover each other: one label with a count, the
// rest listed under it, and a click on a listed line is that station's.
test('labels that overlap by more than a fifth are one, with a count, listing the rest', async () => {
  const { hook, suggested } = bandMap()
  const { annotation, scope } = await render(hook, { board: [at('K1AA', 14030), at('K2BB', 14031), at('K3CC', 14032)] })
  assert.deepEqual(spotIds({ scope } as Rendered), ['spot:K1AA'])
  const group = annotation('spot:K1AA')
  assert.equal(group.badge.text, '+2')
  assert.deepEqual(group.more.map((m: { text: string }) => m.text), ['K2BB', 'K3CC'])
  assert.ok(group.openBorder && group.openBackground)
  await hook.onEvent(event('spot', { annotation: 'spot:K1AA', at: { line: 2 } }))
  await hook.onEvent(event('spot', { annotation: 'spot:K1AA' }))
  assert.deepEqual(suggested.map(q => q.their.call), ['K3CC', 'K1AA'])
})

// Labels overlapping less stay apart, the later a step further from the axis.
test('labels that overlap by less than a fifth are stacked, a step out from the axis', async () => {
  // Each 24 kHz long on the whole band, its icon before its call.
  const { annotation } = await render(bandMap().hook, { board: [at('K1AA', 14030), at('K2BB', 14050)] })
  const [first, second] = [annotation('spot:K1AA'), annotation('spot:K2BB')]
  assert.ok(first && second && !first.badge && !second.badge)
  assert.equal(second.offset - first.offset, 10)
})

// Every FT8 spot is somewhere in the same 3 kHz: a bar for each would mark no one station.
test('an FT8 or FT4 spot draws no passband bar', async () => {
  const { layer } = await render(bandMap().hook, { board: [at('K1FT', 14074, { mode: 'FT8' }), at('K1CW', 14030)] })
  assert.ok(!layer('heard:K1FT') && layer('dot:K1FT'))
  assert.ok(layer('heard:K1CW'))
})

// The Spots panel's accents: something new to work it for in green, a new multiplier in its own
// orange over that; a new DXCC alone is about the call being typed, and on a band would light most.
test('a spot is accented as the Spots panel accents it, in the theme’s shade', async () => {
  const notes = (notices: string[]) => ({ annotations: { worked: false, isSelf: false, notices } })
  const board = [
    at('K1NEW', 14010, notes(['newBand'])), at('K1MULT', 14060, notes(['newMult', 'newBand'])), at('K1DX', 14110, notes(['newDXCC'])),
    at('K1CHASE', 14160, notes(['chase:pota:newRef:alert'])), at('K1QUIET', 14210, notes(['chase:pota:newRef'])),
  ]
  const ink = (r: Rendered, call: string) => r.annotation(`spot:${call}`).color
  // No radio, so no mode to fade the rest by.
  const { hook } = bandMap({ readRadio: async () => null })
  const light = await render(hook, { board })
  assert.deepEqual(['K1NEW', 'K1MULT', 'K1DX', 'K1CHASE', 'K1QUIET'].map(call => ink(light, call)), ['#ff1aa01a', '#ffc2500f', '#ff123456', '#ff1aa01a', '#ff123456'])
  const dark = await render(hook, { board, brightness: 'dark' })
  assert.deepEqual([ink(dark, 'K1NEW'), ink(dark, 'K1MULT')], ['#ff1ac81a', '#ffff8a4c'])
})

// On phone, a CW spot is one the operator is not after just now: still there, but quieter.
test("spots of another kind than the radio's mode are fainter, until it leaves the band", async () => {
  const board = [at('K1A', 14250, { mode: 'SSB' }), at('W1CW', 14030)]
  const inks = async (frequencyHz: number, mode: string) => {
    const { hook } = bandMap({ readRadio: async () => ({ id: 'r', frequencyHz, mode, modes: ['USB', 'CW'] }) })
    const r = await render(hook, { board, config: { band: '20m' } })
    return [r.annotation('spot:K1A').color, r.annotation('spot:W1CW').color]
  }
  assert.deepEqual(await inks(14250000, 'USB'), ['#ff123456', '#80123456'])
  assert.deepEqual(await inks(14030000, 'CW'), ['#80123456', '#ff123456'])
  assert.deepEqual(await inks(7030000, 'CW'), ['#ff123456', '#ff123456'])
})

// The board answers each source's reports apart, newest first: a cluster spot after the POTA one
// is the station's latest, but it is the POTA one that knows the park.
test("a spot's suggestion carries the refs and mode from all its station's reports", async () => {
  const reports = [
    { their: { call: 'K1P' }, freq: 14062, band: '20m', spot: { timeInMillis: 1e12, source: 'cluster' }, icon: 'radio-tower' },
    { their: { call: 'K1P' }, freq: 14062.2, band: '20m', mode: 'CW', refs: [{ type: 'potaActivation', ref: 'US-1234', name: 'A Park' }], spot: { timeInMillis: 1e12 - 6e5, source: 'pota' }, display: { icon: 'pine-tree' } },
  ]
  const { hook, suggested } = bandMap()
  const { annotation } = await render(hook, { board: reports })
  assert.equal(annotation('spot:K1P').icon.name, 'pine-tree')
  await hook.onEvent(event('spot', { annotation: 'spot:K1P' }))
  assert.deepEqual(suggested, [{ their: { call: 'K1P' }, freq: 14062, band: '20m', mode: 'CW', refs: [{ type: 'potaActivation', ref: 'US-1234', name: 'A Park' }] }])
})

// The board stands a tower in for a source with no icon; on the map the cluster's spots go without.
test('a cluster spot has no icon unless a reference gives it one', async () => {
  const reports = [
    { their: { call: 'K1C' }, freq: 14025, band: '20m', mode: 'CW', spot: { timeInMillis: 1e12, source: 'cluster' }, display: { icon: 'radio-tower' } },
    { their: { call: 'K1P' }, freq: 14262, band: '20m', mode: 'CW', refs: [{ type: 'potaActivation', ref: 'US-1234' }], spot: { timeInMillis: 1e12, source: 'cluster' }, display: { icon: 'pine-tree' } },
  ]
  const { annotation } = await render(bandMap().hook, { board: reports })
  assert.deepEqual([annotation('spot:K1C').icon, annotation('spot:K1P').icon?.name], [undefined, 'pine-tree'])
})

// "W1A?" names no one station: two of them are two places on the band.
test('a call not fully copied is a spot at each place it was heard', async () => {
  const r = await render(bandMap().hook, { board: [at('W1A?', 14010), at('W1A?', 14100), at('K1A', 14200), at('K1A', 14201)] })
  assert.deepEqual(spotIds(r), ['spot:K1A', 'spot:W1A?@14010', 'spot:W1A?@14100'])
})

// Phone at 14074: the plan's phone stretch, then 25 kHz either side of the radio, then the whole band
// again; the button drawn as where the map is, and a zoom by hand leaves every preset.
test('the preset button steps through the whole band, the mode’s segment and the radio’s neighbourhood', async () => {
  const { hook } = bandMap()
  const step = async () => {
    const before = await render(hook)
    assert.equal(before.layer('preset').event, 'preset')
    await hook.onEvent(event('preset'))
    return render(hook)
  }
  let r = await render(hook)
  assert.match(r.layer('preset').svg, /M13 9V17/, 'the whole band')
  r = await step()
  assert.match(r.layer('preset').svg, /M8 13H18/, 'the segment')
  assert.ok(r.scope.span < 350000 && r.scope.centerHz > 14150000, `${r.scope.span} ${r.scope.centerHz}`)
  r = await step()
  assert.deepEqual([r.scope.span, r.scope.centerHz], [50000, 14074000])
  r = await step()
  assert.deepEqual([r.scope.span, r.scope.centerHz], [350000, undefined])
  await hook.onEvent(event('scope', { gesture: 'zoom', value: 100000 }))
  r = await render(hook)
  assert.match(r.layer('preset').svg, /<circle cx="11.5"/, 'a magnifier for a view set by hand')
})

// Where the operator zoomed and panned, kept for the band they did it on and between launches; a
// zoom of 0 is the whole band back.
test('the operator’s zoom and pan are kept for their band, and another band starts afresh', async () => {
  const kept = new Map<string, unknown>()
  const { hook } = bandMap({}, kept)
  await render(hook)
  await hook.onEvent(event('scope', { gesture: 'zoom', value: 60000 }))
  await hook.onEvent(event('scope', { gesture: 'pan', value: 14100000 }))
  let { scope } = await render(hook)
  assert.deepEqual([scope.span, scope.centerHz], [60000, 14100000])
  // Another launch, with the same placement.
  ;({ scope } = await render(bandMap({}, kept).hook))
  assert.deepEqual([scope.span, scope.centerHz], [60000, 14100000])
  await render(hook, { config: { band: '40m' } })
  ;({ scope } = await render(hook))
  assert.deepEqual([scope.span, scope.centerHz], [350000, undefined])
  await hook.onEvent(event('scope', { gesture: 'zoom', value: 60000 }))
  await hook.onEvent(event('scope', { gesture: 'zoom', value: 0 }))
  assert.equal((await render(hook)).scope.span, 350000)
})

// The license-class edge is the US's alone, and each region keeps its own emergency frequencies.
test('a station sees the markers for its entity and region, and an unknown one sees them all', async () => {
  const marks = async (stationCall: string | undefined, band: string) => (await render(bandMap().hook, { config: { band }, operation: stationCall ? { stationCall } : {} }))
    .scope.layers.filter((l: { id: string }) => /^mark:\d+$/.test(l.id)).map((l: { menu: { label: string }[] }) => l.menu[0].label)
  assert.ok((await marks('KI2D', '20m')).includes('US Extra/General'))
  assert.ok(!(await marks('EA4ABC', '20m')).includes('US Extra/General'))
  const emergencies = async (call?: string) => (await marks(call, '40m')).filter((label: string) => label === 'Emergency').length
  assert.deepEqual([await emergencies('KI2D'), await emergencies('EA4ABC'), await emergencies(undefined)], [2, 1, 3])
})

// With no radio to read, the logging controls are where the operator is: their frequency picks the
// band, is marked as the dial would be, and their mode the kind of spots shown at full strength.
test('with no radio, the map follows the logging controls', async () => {
  const { hook } = bandMap({ readRadio: async () => null })
  const ink = async (qso: Record<string, unknown>) => {
    const r = await render(hook, { qso })
    assert.equal(r.scope.radio, 'none')
    assert.equal(r.layer('draft').x, `freq:${Math.round(Number(qso.freq) * 1000)}`)
    return r.annotation('spot:K1A').color
  }
  assert.equal(await ink({ freq: 14030, band: '20m', mode: 'CW' }), '#80123456')
  assert.equal(await ink({ freq: 14250, band: '20m', mode: 'SSB' }), '#ff123456')
})

// A portable operator with no CAT picks the band and mode and types no frequency: still their band.
test('with no radio and no frequency typed, the map takes the logging controls’ band', async () => {
  const { title } = await render(bandMap({ readRadio: async () => null }).hook, { board: [], qso: { band: '40m', mode: 'CW' } })
  assert.match(title, /40m/)
})

// A station that has moved off the window is not drawn where it was heard before.
test('a station whose newest report is outside the window is not shown at an older one', () => {
  const report = (freq: number, minutesAgo: number) => ({ their: { call: 'K1ABC' }, freq, band: '20m', mode: 'SSB', spot: { timeInMillis: 1e12 - minutesAgo * 6e4, source: 'cluster' } })
  assert.deepEqual(mapSpots([report(14250, 1), report(14074, 20)] as any, 1e12, [14049, 14099]), [])
  assert.deepEqual(mapSpots([report(14250, 1), report(14074, 20)] as any, 1e12, [14000, 14350]).map(s => s.khz), [14250])
})

test('the map asks to be rendered when the dial moves', async () => {
  const [descriptor] = await bandMap().hook.getPanels({}, { locale: 'en' })
  assert.ok(descriptor.on.includes('radio'))
})

// What is marked on the band — the operator's band tags, what extensions say — among the spots:
// labelled, over the stretch it covers, in the ink it suggests; a click tunes the radio alone.
test('the band’s general annotations are among the spots, and a click on one tunes the radio there', async () => {
  const said = [
    { type: 'general', fromHz: 14100000, toHz: 14110000, label: 'NET!', color: '#cc3300', source: 'user', band: '20m', importance: 'primary' },
    { type: 'known', fromHz: 14074000, toHz: 14077000, label: 'FT8', source: 'band-plan', band: '20m', importance: 'secondary' },
  ]
  const asked: unknown[] = []
  const getBandAnnotations = async (options: unknown) => (asked.push(options), said)
  const { hook, tuned, suggested } = bandMap()
  const r = await render(hook, { config: { band: '20m' }, ctx: { getBandAnnotations } })
  assert.deepEqual(asked, [{ band: '20m' }])
  // The band plan's own annotations are not spots: the map draws its own plan and markers.
  assert.deepEqual(spotIds(r), ['spot:K1A', 'spot:note:user:14100000'])
  const net = r.annotation('spot:note:user:14100000')
  assert.equal(net.color, '#ffcc3300')
  // Over the 10 kHz it covers.
  assert.deepEqual(r.layer('heard:note:user:14100000'), { ...r.layer('heard:note:user:14100000'), x: 'freq:14100000', x2: 'freq:14110000' })
  await hook.onEvent(event('spot', { annotation: net.id }))
  assert.deepEqual([suggested, tuned], [[], [{ id: 'r', frequencyHz: 14105000 }]])
  const off = await render(bandMap().hook, { config: { band: '20m', notes: false }, ctx: { getBandAnnotations } })
  assert.deepEqual(spotIds(off), ['spot:K1A'])
})

// With no radio there is nothing to tune, and nothing to log at a note: it is only something to read.
test('with no radio, a note sends nothing', async () => {
  const said = [{ type: 'general', fromHz: 14200000, label: 'QRM!', source: 'user', band: '20m', importance: 'primary' }]
  const { annotation } = await render(bandMap({ readRadio: async () => null }).hook, {
    config: { band: '20m' }, qso: { freq: 14200, band: '20m', mode: 'SSB' }, ctx: { getBandAnnotations: async () => said },
  })
  assert.equal(annotation('spot:note:user:14200000').event, undefined)
  assert.equal(annotation('spot:K1A').event, 'spot')
})

// By its place among the notes, a note added before another would move a click on the picture
// painted before onto it; a stretch whose middle is off the window shows where the window holds it.
test('a note is named by its key or its place on the band, and shows where the window holds it', () => {
  const note = (fromHz: number, extra: Record<string, unknown> = {}) => ({ type: 'general', fromHz, label: 'X', source: 'ext', band: '20m', importance: 'primary', ...extra }) as any
  const keys = (list: any[]) => noteSpots(list, [14000, 14350]).map(s => s.key)
  assert.deepEqual(keys([note(14100000), note(14200000)]), ['note:ext:14100000', 'note:ext:14200000'])
  assert.deepEqual(keys([note(14050000), note(14100000), note(14200000)]).slice(1), ['note:ext:14100000', 'note:ext:14200000'])
  assert.deepEqual(keys([note(14100000), note(14100000)]), ['note:ext:14100000', 'note:ext:14100000#1'])
  // 7200–7300 seen through a window of 7180–7230: its middle there is 7215.
  const [wide] = noteSpots([{ ...note(7200000, { toHz: 7300000 }), band: '40m' }], [7180, 7230])
  assert.deepEqual([wide.khz, wide.heard], [7215, [-15000, 85000]])
  assert.deepEqual(noteSpots([note(7300000, { toHz: 7310000 })], [7180, 7230]), [])
})

// A long label would take a station's room on the band.
test('a long note label is cut short', () => {
  const said = [{ type: 'general', fromHz: 14300000, label: 'Maritime Mobile Service Net', source: 'user', band: '20m', importance: 'primary' }]
  assert.equal(noteSpots(said as any, [14000, 14350])[0].call, 'Maritime Mo…')
})

// The host keeps ten keys an extension: a key for each placement would refuse the eleventh.
test('every placement’s view is kept under one key, the oldest let go, and a kept view is read for what it is', async () => {
  const kept = new Map<string, unknown>()
  const { hook } = bandMap({}, kept)
  for (let n = 0; n < 20; n++) {
    await hook.render({ environment: env(900, 220), clock: { nowMillis: 1e12 }, instanceId: `p${n}`, config: {}, operation: {} }, { getSpots: async () => spots })
    await hook.onEvent({ instanceId: `p${n}`, event: { action: 'scope', controlId: 'map', phase: 'commit', gesture: 'zoom', value: 60000 } })
  }
  assert.deepEqual([...kept.keys()], ['views'])
  const views = kept.get('views') as Record<string, unknown>
  assert.equal(Object.keys(views).length, 16)
  assert.ok(!('p0' in views) && 'p19' in views)
  // What a later version, or a mangled write, left there: only what reads as a view is taken.
  kept.set('views', { a: { band: '20m', span: 'wide', center: 14100000, preset: 'everything', split: 3 } })
  const { scope } = await render(bandMap({}, kept).hook)
  assert.deepEqual([scope.span, scope.centerHz, scope.split], [350000, 14100000, 0.9])
})

// A read that fails must not be followed by a write over what it would have found.
test('a view that could not be read is not written over', async () => {
  const kept = new Map<string, unknown>([['views', { a: { band: '20m', span: 60000 } }]])
  let fail = true
  const { hook } = bandMap({ kvGet: async (key: string) => { if (fail) throw new Error('busy'); return kept.get(key) ?? null } }, kept)
  await render(hook)
  await hook.onEvent(event('scope', { gesture: 'pan', value: 14100000 }))
  assert.deepEqual(kept.get('views'), { a: { band: '20m', span: 60000 } })
  fail = false
  assert.equal((await render(hook)).scope.span, 60000)
})

// Where the app cannot tune itself — the radio on another band, so the scope draws none — a click
// on the picture comes to the map, which tunes the radio there.
test('a click the app could not tune itself tunes the radio there', async () => {
  const { hook, tuned } = bandMap()
  await render(hook, { config: { band: '40m' } })
  await hook.onEvent(event('scope', { phase: 'commit', value: 7030000 }))
  assert.deepEqual(tuned, [{ id: 'r', frequencyHz: 7030000 }])
  const refusing = bandMap({ setRadio: async () => ({ accepted: false, reason: 'transmitting' }) }).hook
  await assert.rejects(refusing.onEvent(event('scope', { phase: 'commit', value: 7030000 })), /transmitting/)
})

// Its count lengthens a group's label along a wide map: one beside it on the same level would be drawn over it.
test('a group’s count takes room on the band, so a label beside it steps out', async () => {
  const board = [at('K1AA', 14030), at('K2BB', 14031), at('K3CC', 14058)]
  const { annotation } = await render(bandMap().hook, { board })
  assert.equal(annotation('spot:K1AA').badge.text, '+1')
  assert.equal(annotation('spot:K3CC').offset - annotation('spot:K1AA').offset, 10)
})

// With no radio, a note heading a group of stations still lets the operator pick one of them.
test('with no radio, a note heading stations still takes a click on them', async () => {
  const said = [{ type: 'general', fromHz: 14030000, toHz: 14040000, label: 'NET!', source: 'user', band: '20m', importance: 'primary' }]
  const { hook, suggested } = bandMap({ readRadio: async () => null })
  const { annotation } = await render(hook, { board: [at('K1AA', 14034)], config: { band: '20m' }, ctx: { getBandAnnotations: async () => said } })
  const net = annotation('spot:note:user:14030000')
  assert.deepEqual([net.event, net.more.map((m: { text: string }) => m.text)], ['spot', ['K1AA']])
  await hook.onEvent(event('spot', { annotation: net.id, at: { line: 1 } }))
  assert.deepEqual(suggested.map(q => q.their.call), ['K1AA'])
})

// A right-click takes a label off the map: the operator's band tag for good, through the host;
// another extension's note, or a station, for the session — the station until it is spotted again.
test('a right-click takes the operator’s band tag down, and hides another’s note or a station', async () => {
  const said = [
    { type: 'general', fromHz: 14100000, label: 'QRM!', key: 'tag-1', source: 'user', band: '20m', importance: 'primary' },
    { type: 'general', fromHz: 14300000, label: 'CWops', key: 'cwt', source: 'cwops', band: '20m', importance: 'primary' },
  ]
  let board: unknown[] = [at('K1AA', 14030), at('K2BB', 14200)]
  const { hook, removed } = bandMap()
  const show = () => render(hook, { board, config: { band: '20m' }, ctx: { getBandAnnotations: async () => said } })
  const r = await show()
  assert.equal(r.annotation('spot:K1AA').secondaryEvent, 'forget')
  await hook.onEvent(event('forget', { annotation: 'spot:note:user:tag-1' }))
  assert.deepEqual(removed, [[['tag-1'], { source: 'user' }]])
  await hook.onEvent(event('forget', { annotation: 'spot:note:cwops:cwt' }))
  await hook.onEvent(event('forget', { annotation: 'spot:K1AA' }))
  // The operator's tag is the host's to take; here it is still answered, so it still shows.
  assert.deepEqual(spotIds(await show()), ['spot:K2BB', 'spot:note:user:tag-1'])
  assert.equal(removed.length, 1, 'only the operator’s tag goes through the host')
  // Spotted again since: back.
  board = [at('K1AA', 14030, { spot: { timeInMillis: 1e12 + 60000, source: 'pota' } }), at('K2BB', 14200)]
  assert.deepEqual(spotIds(await show()), ['spot:K1AA', 'spot:K2BB', 'spot:note:user:tag-1'])
})

// On a group's open list, the line right-clicked is the one taken off.
test('a right-click on a listed line hides that station, not the group’s first', async () => {
  const { hook } = bandMap()
  const board = [at('K1AA', 14030), at('K2BB', 14031), at('K3CC', 14032)]
  await render(hook, { board })
  await hook.onEvent(event('forget', { annotation: 'spot:K1AA', at: { line: 1 } }))
  const group = (await render(hook, { board })).annotation('spot:K1AA')
  assert.deepEqual([group.badge.text, group.more.map((m: { text: string }) => m.text)], ['+1', ['K3CC']])
})

// Past ten, the list ends in "+n more", which names no one station: a right-click there takes
// nothing down — least of all the group's first, which may be the operator's own band tag.
test('a right-click on a group’s “more” line takes nothing down', async () => {
  const said = [{ type: 'general', fromHz: 14030000, toHz: 14040000, label: 'NET!', key: 'tag-1', source: 'user', band: '20m', importance: 'primary' }]
  const board = Array.from({ length: 12 }, (_, k) => at(`K${k}AA`, 14031 + k * 0.5))
  const { hook, removed } = bandMap()
  const show = () => render(hook, { board, config: { band: '20m' }, ctx: { getBandAnnotations: async () => said } })
  const net = (await show()).annotation('spot:note:user:tag-1')
  assert.equal(net.more.at(-1), '+2 more')
  await hook.onEvent(event('forget', { annotation: net.id, at: { line: 11 } }))
  assert.deepEqual(removed, [])
  assert.equal((await show()).annotation('spot:note:user:tag-1').badge.text, '+12')
})
