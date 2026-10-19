// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PanelEnvironment, PanelRenderArgs, HookContext } from '@ham2k/extension-sdk'
import { createSolarPanel, parseConditions, parseSeries, mergePoints, windBuckets, urls, parseStations, nearestStation, operationLocation, operatingMHz, panelOptions } from './solar.ts'

const style = { fontFamily: 'Roboto', fontFamilyFallback: ['NotoColorEmoji'], fontSize: 14, scaledFontSize: 14, fontWeight: 400, lineHeight: 1.2, letterSpacing: 0 }
const environment: PanelEnvironment = {
  version: 1, width: 440, height: 650, safeInsets: { left: 0, top: 0, right: 0, bottom: 0 },
  brightness: 'dark', colors: {
    surface: '#101010', surfaceContainer: '#202020', onSurface: '#eeeeee', onSurfaceVariant: '#bbbbbb',
    accent: '#00ffff', primary: '#00cccc', onPrimary: '#000000', secondary: '#ff00ff',
    outline: '#aaaaaa', outlineVariant: '#555555', error: '#ff0000', onError: '#ffffff',
  },
  typography: { body: style, label: style, title: style, display: { ...style, fontSize: 36, scaledFontSize: 36 }, mono: { ...style, fontFamily: 'RobotoMono' } },
  locale: 'en', textDirection: 'ltr', devicePixelRatio: 2, reducedMotion: false, highContrast: false,
}
const now = Date.UTC(2026, 8, 17, 12)
const args: PanelRenderArgs = { panelKey: 'solar', operation: { grid: 'FN42' }, qsoCount: 0, config: {}, reason: 'initial', environment, clock: { nowMillis: now, realNowMillis: now } }
const ctx: HookContext = { online: true, locale: 'en', distanceUnits: 'kilometers' }

const xml = '<solar><solarflux>132</solarflux><sunspots>83</sunspots><aindex>6</aindex><kindex>2</kindex><solarwind>410.5</solarwind><band time="night" name="80m-40m">Good</band><band name="80m-40m" time="day">Fair</band><band name="20m" time="day">NoRpt</band></solar>'
const stamps = [now - 6 * 3600000, now - 3 * 3600000, now]
const utc = (time: number) => new Date(time).toISOString().replace('Z', '')
const bodies = {
  [urls.conditions]: xml,
  [urls.flux]: JSON.stringify(stamps.map((time, i) => ({ time_tag: utc(time), flux: 130 + i }))),
  [urls.kp]: JSON.stringify([['time_tag', 'Kp'], ...stamps.map((time, i) => [utc(time), String(i + 1)])]),
  [urls.wind]: JSON.stringify([['time_tag', 'speed'], ...stamps.map((time, i) => [utc(time), 400 + i * 20])]),
  [urls.history]: JSON.stringify([['time_tag', 'speed'], ...stamps.map((time, i) => [utc(time), 390 + i * 20])]),
  [urls.stations]: JSON.stringify([
    { time: utc(now - 600000), mufd: 28.4, fof2: 8.6, cs: 70, station: { name: 'Millstone Hill, MA, USA', code: 'MHJ45', latitude: '42.6', longitude: '288.5' } },
    { time: utc(now - 600000), mufd: 12, fof2: 4, cs: 10, station: { name: 'Doubtful, MA, USA', code: 'XX000', latitude: '42.4', longitude: '288.9' } },
    { time: utc(now - 600000), mufd: 15.9, fof2: 5.2, cs: -1, station: { name: 'El Arenosillo, Spain', code: 'EA036', latitude: '37.1', longitude: '353.3' } },
    { time: utc(now - 30 * 86400000), mufd: 28.8, fof2: 8.6, cs: 100, station: { name: 'Austin, TX, USA', code: 'AU930', latitude: '30.4', longitude: '262.3' } },
  ]),
}

test('parses band pairs, missing indices, UTC tables and object series without inventing zeroes', () => {
  const r = parseConditions(xml)
  assert.deepEqual(r.bands, [{ name: '80m-40m', day: 'fair', night: 'good' }, { name: '20m', day: 'unknown', night: 'unknown' }])
  assert.throws(() => parseConditions('<html>Unavailable</html>'))
  assert.equal(parseConditions('<solarflux>100</solarflux>').a, null)
  const kp = parseSeries(bodies[urls.kp], 'Kp')
  assert.deepEqual(kp.map(p => p.time), stamps)
  assert.deepEqual(kp.map(p => p.value), [1, 2, 3])
  assert.deepEqual(parseSeries(JSON.stringify([['speed', 'time_tag'], [null, utc(now)], ['420', utc(now - 1)]]), 'speed'), [{ time: now - 1, value: 420 }])
  assert.throws(() => parseSeries('[{"time_tag":"bad","flux":0}]', 'flux'))
  assert.throws(() => parseSeries('[{"time_tag":"2026-09-17T12:00:00","Kp":null}]', 'Kp'))
})

test('wind merging prefers recent readings and averages UTC three-hour buckets', () => {
  const points = mergePoints([{ time: now, value: 100 }], [{ time: now, value: 400 }, { time: now + 60000, value: 600 }])
  assert.deepEqual(windBuckets(points), [{ time: now, value: 500 }])
})

test('shared cache deduplicates placements and keeps resize/theme/inspection network-free', async () => {
  const calls: string[] = []
  const panel = createSolarPanel(async url => { calls.push(url); return { status: 200, body: bodies[url] } })
  const [a, b] = await Promise.all([panel.render(args, ctx), panel.render({ ...args, instanceId: 'two' }, ctx)])
  assert.equal(a.kind, 'svgScene'); assert.equal(b.kind, 'svgScene'); assert.equal(calls.length, 6)
  const next = await panel.render({ ...args, environment: { ...environment, brightness: 'light', colors: { ...environment.colors, accent: '#cc1100' } } }, ctx)
  assert.equal(calls.length, 6)
  if (next.kind !== 'svgScene') return
  assert.match(next.scene.layers.find(l => l.id === 'flux-chart')!.svg!, /#cc1100/)
  assert.equal(next.scene.controls![0].event, undefined)
  assert.equal(next.scene.controls![0].valueLabels!.length, 57)
  assert.equal(next.scene.layers.filter(l => l.id.endsWith('-chart')).length, 3)
  assert.equal(next.scene.layers.find(l => l.id === 'sfi')!.text!.fontFamily, 'Roboto')
  await panel.render({ ...args, clock: { nowMillis: now + 900000, realNowMillis: now + 900000 } }, ctx)
  assert.equal(calls.length, 11, 'large wind history is not fetched on every refresh')
})

test('the week of wind follows hamqsl and never holds up a render', async () => {
  // Beside hamqsl, the megabyte shares a slow link with the one request the panel cannot draw without;
  // awaited by the render, it has to fit the render's few seconds, which on that link it never does.
  const calls: string[] = []
  let answerConditions!: () => void, answerHistory!: () => void
  const conditionsGate = new Promise<void>(resolve => { answerConditions = resolve })
  const historyGate = new Promise<void>(resolve => { answerHistory = resolve })
  const week = JSON.stringify([['time_tag', 'speed'], [utc(now - 9 * 3600000), 350], ...stamps.map((time, i) => [utc(time), 390 + i * 20])])
  const panel = createSolarPanel(async url => {
    calls.push(url)
    if (url === urls.conditions) await conditionsGate
    if (url === urls.history) { await historyGate; return { status: 200, body: week } }
    return { status: 200, body: bodies[url] }
  })
  const first = panel.render(args, ctx)
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(!calls.includes(urls.history), 'not while hamqsl is still answering')
  answerConditions()
  // Bounded, so a render that waits for the week fails here instead of hanging the run.
  const drawn = await Promise.race([first, new Promise<null>(resolve => setTimeout(() => resolve(null), 200))])
  assert.equal(drawn?.kind, 'svgScene', 'drawn while the week is still downloading')
  assert.ok(calls.includes(urls.history))
  answerHistory()
  await new Promise(resolve => setImmediate(resolve))
  const next = await panel.render({ ...args, clock: { nowMillis: now + 60000, realNowMillis: now + 60000 } }, ctx)
  if (next.kind !== 'svgScene') return assert.fail('no scene')
  // A reading only the week holds, drawn by a render that fetched nothing.
  assert.match(next.scene.layers.find(l => l.id === 'wind-caption')!.text!.samples![0] as string, /Wind.* 350 km\/s/)
})

test('the week of wind downloads only for a placement that draws it', async () => {
  // A placement hiding the wind must not pay for the megabyte, and the cache it shares must not then
  // keep the week from a placement that shows the wind, even between rounds.
  const calls: string[] = []
  const panel = createSolarPanel(async url => { calls.push(url); return { status: 200, body: bodies[url] } })
  await panel.render({ ...args, config: { wind: false } }, ctx)
  assert.ok(calls.includes(urls.wind) && !calls.includes(urls.history))
  const round = calls.length
  await panel.render({ ...args, instanceId: 'two', clock: { nowMillis: now + 60000, realNowMillis: now + 60000 } }, ctx)
  assert.deepEqual(calls.slice(round), [urls.history])
})

test('a failed hamqsl round does not ask for the week of wind', async () => {
  const calls: string[] = []
  const panel = createSolarPanel(async url => { calls.push(url); return { status: url === urls.conditions ? 503 : 200, body: bodies[url] } })
  await panel.render(args, ctx)
  assert.ok(calls.includes(urls.wind) && !calls.includes(urls.history))
})

test('partial NOAA failures keep good charts; primary failure marks cached indices and rate-limits retries', async () => {
  let fail = false, calls = 0
  const panel = createSolarPanel(async url => { calls++; return { status: fail ? 503 : 200, body: bodies[url] } })
  await panel.render(args, ctx); fail = true
  const stale = await panel.render({ ...args, clock: { nowMillis: now + 900000, realNowMillis: now + 900000 } }, ctx)
  assert.equal(stale.kind, 'svgScene')
  if (stale.kind !== 'svgScene') return
  assert.match(stale.scene.layers.find(l => l.id === 'source')!.text!.literal!, /Refresh failed/)
  assert.equal(stale.scene.layers.filter(l => l.id.endsWith('-chart')).length, 3)
  assert.match(stale.scene.layers.find(l => l.id === 'kp-caption')!.text!.samples![56] as string, /Refresh failed/)
  const count = calls
  await panel.render({ ...args, clock: { nowMillis: now + 86400000, realNowMillis: now + 901000 } }, ctx)
  assert.equal(calls, count)
  const partial = createSolarPanel(async url => ({ status: url === urls.flux ? 500 : 200, body: bodies[url] }))
  const p = await partial.render(args, ctx)
  assert.equal(p.kind, 'svgScene')
  if (p.kind === 'svgScene') assert.deepEqual(p.scene.layers.filter(l => l.id.endsWith('-chart')).map(l => l.id), ['wind-chart', 'kp-chart'])
})

test('compact, large-text and Spanish layouts remain bounded and omit unreadable charts', async () => {
  const panel = createSolarPanel(async url => ({ status: 200, body: bodies[url] }))
  for (const [width, height] of [[1, 1], [90, 70], [220, 140], [450, 700]]) {
    const typography = Object.fromEntries(Object.entries(environment.typography).map(([k, s]) => [k, { ...s, scaledFontSize: s.fontSize * 2 }])) as PanelEnvironment['typography']
    const r = await panel.render({ ...args, environment: { ...environment, width, height, typography, locale: 'es' } }, ctx)
    assert.equal(r.kind, 'svgScene')
    if (r.kind !== 'svgScene') continue
    for (const layer of r.scene.layers) {
      assert.ok(layer.width >= 1 && layer.height >= 1)
      assert.ok(!/NaN|Infinity/.test(layer.svg ?? ''))
    }
    if (height === 700) assert.ok(r.scene.layers.some(l => l.text?.literal === 'Día'))
  }
})

test('the right edge inspects the newest measurement between three-hour boundaries', async () => {
  const later = now + 3600000
  const panel = createSolarPanel(async url => ({ status: 200, body: url === urls.flux
    ? JSON.stringify([{ time_tag: utc(now), flux: 130 }, { time_tag: utc(later), flux: 140 }]) : bodies[url] }))
  const r = await panel.render({ ...args, clock: { nowMillis: later, realNowMillis: later } }, ctx)
  assert.equal(r.kind, 'svgScene')
  if (r.kind === 'svgScene') assert.match(r.scene.layers.find(l => l.id === 'flux-caption')!.text!.samples![56] as string, /SFI 140.*13:00Z/)
})

const mufText = (scene: { layers: { id: string; text?: { literal?: string } }[] }) => scene.layers.filter(l => l.id.startsWith('muf-')).map(l => l.text!.literal).join(' ')
type Scene = { layers: { id: string; text?: { literal?: string; color?: string } }[] }
const colored = (scene: Scene, color: string) => scene.layers.filter(l => l.id.startsWith('muf-') && l.text!.color === color).map(l => l.text!.literal)
const red = (scene: Scene) => colored(scene, '#ff2d2d'), green = (scene: Scene) => colored(scene, '#2e9e4f')

test('the nearest fresh, trusted ionosonde supplies MUF and foF2', () => {
  const stations = parseStations(bodies[urls.stations])
  assert.deepEqual(stations.map(s => s.code), ['MHJ45', 'EA036', 'AU930'], 'barely trusted autoscaling is dropped, manual scaling kept')
  assert.equal(stations[0].lon, -71.5)
  assert.equal(nearestStation(stations, [42, -72], now)?.code, 'MHJ45')
  assert.equal(nearestStation(stations, [30, -98], now)?.code, 'MHJ45', 'a month-old reading never wins on distance')
  assert.equal(nearestStation(stations, null, now), null)
  assert.throws(() => parseStations('{}'))
  assert.throws(() => parseStations(JSON.stringify([{ time: utc(now), MUF: 20, station: { lat: 1, lon: 2 } }])), /No usable/, 'a renamed field is a failure, not an empty sky')
  assert.deepEqual(parseStations('[]'), [])
  assert.deepEqual(operationLocation({ lat: 10, lon: 20, grid: 'FN42' }), [10, 20])
  assert.ok(operationLocation({ grid: 'FN42' }))
  assert.equal(operationLocation({ grid: 'nowhere' }), null)
})

test('the operating frequency comes from the QSO, in MHz, else the bottom of its band', () => {
  assert.equal(operatingMHz({ freq: 14074, band: '20m' }), 14.074)
  assert.equal(operatingMHz({ band: '40m' }), 7)
  assert.equal(operatingMHz({ band: '2190m' }), null)
  assert.equal(operatingMHz(undefined), null)
})

test('a MUF below the operating frequency warns up to 6 m; a foF2 above it is good news', async () => {
  const panel = createSolarPanel(async url => ({ status: 200, body: bodies[url] }))
  const at = async (freq?: number) => {
    const r = await panel.render({ ...args, qso: freq ? { freq } : undefined }, ctx)
    assert.equal(r.kind, 'svgScene')
    return r.kind === 'svgScene' ? r.scene : { layers: [] }
  }
  const quiet = await at(14074)
  assert.match(mufText(quiet), /^MUF 28 MHz · foF2 9 MHz · /)
  assert.deepEqual(red(quiet), [])
  assert.deepEqual(green(quiet), [])
  const forty = await at(7074)
  assert.deepEqual(red(forty), [])
  assert.deepEqual(green(forty), ['foF2', '9', 'MHz'])
  assert.deepEqual(red(await at(50313)), ['MUF', '28', 'MHz'])
  assert.deepEqual(red(await at(144200)), [], 'F2 is not the path on VHF')
  assert.deepEqual(red(await at()), [])
  const light = await panel.render({ ...args, qso: { freq: 50313 }, config: { theme: 'light' } }, ctx)
  if (light.kind === 'svgScene') assert.deepEqual(colored(light.scene, '#f80000'), ['MUF', '28', 'MHz'])
})

test('without a station the MUF row says why', async () => {
  const panel = createSolarPanel(async url => ({ status: 200, body: bodies[url] }))
  const hint = async (operation: Record<string, string>, nowMillis = now) => {
    const r = await panel.render({ ...args, operation, clock: { nowMillis, realNowMillis: now } }, ctx)
    return r.kind === 'svgScene' ? r.scene.layers.find(l => l.id === 'muf-hint')?.text?.literal : undefined
  }
  assert.equal(await hint({}), 'MUF: set a grid in the operation')
  assert.equal(await hint({ grid: 'FN42' }), undefined)
  assert.equal(await hint({ grid: 'FN42' }, now + 3 * 3600000), 'MUF: no recent ionosonde readings')
})

test('each placement chooses its rows, history range and theme', async () => {
  assert.deepEqual(panelOptions({}), { rows: { metrics: true, muf: true, bands: true, sfi: true, wind: true, kp: true }, days: 7, theme: 'auto' })
  assert.equal(panelOptions({ days: '9', theme: 'pink' }).days, 7)
  const panel = createSolarPanel(async url => ({ status: 200, body: bodies[url] }))
  const r = await panel.render({ ...args, config: { metrics: false, muf: false, wind: false, days: '1', theme: 'teal' } }, ctx)
  assert.equal(r.kind, 'svgScene')
  if (r.kind !== 'svgScene') return
  const ids = r.scene.layers.map(l => l.id)
  assert.ok(!ids.includes('sfi') && !ids.some(id => id.startsWith('muf-')))
  assert.deepEqual(ids.filter(id => id.endsWith('-chart')), ['flux-chart', 'kp-chart'])
  assert.ok(ids.includes('band-0-0'))
  assert.match(r.scene.layers.find(l => l.id === 'surface')!.svg!, /#a9c4cb/)
  assert.match(r.scene.layers.find(l => l.id === 'kp-chart')!.svg!, /width="53"/, 'over one day, eight three-hour bars fill the width')
})

test('the credits open the sources sheet', async () => {
  const shown: unknown[] = []
  const panel = createSolarPanel(async url => ({ status: 200, body: bodies[url] }), async form => { shown.push(form) })
  const r = await panel.render(args, ctx)
  assert.equal(r.kind, 'svgScene')
  if (r.kind !== 'svgScene') return
  const control = r.scene.controls!.find(c => c.id === 'sources')!
  assert.equal(r.scene.layers.find(l => l.id === 'credits')!.text!.literal, 'hamqsl.com · NOAA · KC2G')
  await panel.onEvent!({ ...args, event: { controlId: control.id, action: control.event!, phase: 'activate', sequence: 1 } }, ctx)
  const form = shown[0] as { elements: { type: string; url: string; description: string }[] }
  assert.deepEqual(form.elements.map(e => e.url), ['https://www.hamqsl.com/solar.html', 'https://www.swpc.noaa.gov/', 'https://prop.kc2g.com/stations/'])
  assert.match(form.elements[2].description, /Millstone Hill/)
})
