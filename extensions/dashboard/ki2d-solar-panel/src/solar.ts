// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MPL-2.0
import type { FetchOptions, FetchResponse, FormDefinition, JSONValue, PanelEnvironment, SettingsField, PanelHook, SceneBinding, SvgScene, SvgSceneLayer } from '@ham2k/extension-sdk'
import { distanceOnEarth, gridToLocation } from '@ham2k/lib-geo-tools'
import { panelTheme, themeColors, themeField, themeSurface, type PanelTheme } from '@ham2k/lib-panel-themes'
import { solarPalette, tealPalette, solarFluxColor, solarAColor, solarKColor } from './palette.ts'
import { parseSolarXml } from './spaceWeather.ts'

type Fetch = (url: string, options?: FetchOptions) => Promise<FetchResponse>
type ShowForm = (form: FormDefinition) => Promise<unknown>
type Log = (message: string) => void
export type Point = { time: number; value: number }
type Rating = 'good' | 'fair' | 'poor' | 'unknown'
type Conditions = { flux: number; spots: number | null; a: number | null; k: number | null; wind: number | null; bands: { name: string; day: Rating; night: Rating }[] }
type Feed = { points: Point[]; fetched?: number; failed: boolean }
const ROWS = ['metrics', 'muf', 'bands', 'sfi', 'wind', 'kp'] as const
type Row = typeof ROWS[number]
export type Options = { rows: Record<Row, boolean>; days: 1 | 3 | 7; theme: PanelTheme }
export type Ionosonde = { code: string; name: string; lat: number; lon: number; time: number; muf: number | null; fof2: number | null }
const HOUR = 3600000, BUCKET = 3 * HOUR
export const urls = {
  conditions: 'https://www.hamqsl.com/solarxml.php',
  flux: 'https://services.swpc.noaa.gov/json/f107_cm_flux.json',
  kp: 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',
  wind: 'https://services.swpc.noaa.gov/products/geospace/propagated-solar-wind-1-hour.json',
  history: 'https://services.swpc.noaa.gov/products/geospace/propagated-solar-wind.json',
  stations: 'https://prop.kc2g.com/api/stations.json',
}
const en = {
  title: 'KI2D’s Solar Panel', description: 'Solar indices, band conditions and interactive history',
  unavailable: 'Solar weather unavailable. Retrying shortly.', update: 'This panel needs the panel environment API.',
  stale: 'Refresh failed', age: 'min ago', day: 'Day', night: 'Night', band: 'Band',
  good: 'Good', fair: 'Fair', poor: 'Poor', unknown: '—', wind: 'Wind',
  inspect: 'Solar history', history: 'NOAA history unavailable', mean: (span: string) => `${span} mean`,
  mufNoLocation: 'MUF: set a grid in the operation', mufNoStation: 'MUF: no recent ionosonde readings',
  rows: { metrics: 'Show solar indices', muf: 'Show MUF and foF2 from the nearest ionosonde', bands: 'Show band conditions', sfi: 'Show SFI history', wind: 'Show solar wind history', kp: 'Show Kp history' },
  range: 'History range', ranges: { 7: '7 days', 3: '3 days', 1: '1 day' },
  sources: 'Data sources', hamqsl: 'Solar indices and band conditions, by N0NBH', noaa: 'NOAA Space Weather Prediction Center: solar flux, Kp and solar wind history',
  kc2g: 'Ionosonde readings, gathered by KC2G', kc2gFrom: (station: string) => `MUF and foF2 from ${station}, gathered by KC2G`,
}
const es: typeof en = {
  title: 'Panel solar de KI2D', description: 'Índices solares, propagación e historial interactivo',
  unavailable: 'Tiempo solar no disponible. Se reintentará pronto.', update: 'Este panel necesita la API de contexto visual.',
  stale: 'Actualización fallida', age: 'min atrás', day: 'Día', night: 'Noche', band: 'Banda',
  good: 'Buena', fair: 'Regular', poor: 'Mala', unknown: '—', wind: 'Viento',
  inspect: 'Historial solar', history: 'Historial NOAA no disponible', mean: (span: string) => `media ${span}`,
  mufNoLocation: 'MUF: define una cuadrícula en la operación', mufNoStation: 'MUF: sin lecturas recientes de ionosondas',
  rows: { metrics: 'Mostrar índices solares', muf: 'Mostrar MUF y foF2 de la ionosonda más cercana', bands: 'Mostrar propagación por banda', sfi: 'Mostrar historial de SFI', wind: 'Mostrar historial del viento solar', kp: 'Mostrar historial de Kp' },
  range: 'Período del historial', ranges: { 7: '7 días', 3: '3 días', 1: '1 día' },
  sources: 'Fuentes de datos', hamqsl: 'Índices solares y propagación por banda, de N0NBH', noaa: 'Centro de Predicción del Clima Espacial de NOAA: flujo solar, Kp e historial del viento solar',
  kc2g: 'Lecturas de ionosondas, recopiladas por KC2G', kc2gFrom: (station: string) => `MUF y foF2 de ${station}, recopilados por KC2G`,
}
// Readings older than this, or that the autoscaler barely trusted, describe a different ionosphere.
const STATION_MAX_AGE = 2 * HOUR, STATION_MIN_CONFIDENCE = 25
// Bright, but dark enough to read on each surface: about 4:1 on light, 3.5:1 on teal, 5:1 on dark.
const WARNING = { light: '#f80000', teal: '#c00000', dark: '#ff2d2d' }
const words = (locale?: string) => locale?.startsWith('es') ? es : en
/** Unset fields, as in a placement saved before these settings existed, show everything over a week. */
export function panelOptions(config: Record<string, JSONValue> | undefined): Options {
  const rows = Object.fromEntries(ROWS.map(row => [row, config?.[row] !== false])) as Record<Row, boolean>
  const days = Number(config?.days)
  return { rows, days: days === 1 || days === 3 ? days : 7, theme: panelTheme(config) }
}
const numeric = (value: unknown): number | null => {
  if (typeof value !== 'number' && typeof value !== 'string' || String(value).trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
const rating = (s: string): Rating => ['good', 'fair', 'poor'].includes(s.trim().toLowerCase()) ? s.trim().toLowerCase() as Rating : 'unknown'
export function parseConditions(body: string): Conditions {
  const raw = parseSolarXml(body), flux = numeric(raw.solarflux)
  if (flux === null) throw new Error('Missing solar flux')
  const bands = new Map<string, { name: string; day: Rating; night: Rating }>()
  for (const match of body.matchAll(/<band\b([^>]*)>([^<]*)<\/band>/g)) {
    const attrs = Object.fromEntries([...match[1].matchAll(/(\w+)\s*=\s*["']([^"']*)["']/g)].map(m => [m[1], m[2].trim()]))
    if (!attrs.name || attrs.name.length > 40 || !['day', 'night'].includes(attrs.time)) continue
    const row = bands.get(attrs.name) ?? { name: attrs.name, day: 'unknown', night: 'unknown' }
    row[attrs.time as 'day' | 'night'] = rating(match[2]); bands.set(attrs.name, row)
    if (bands.size >= 12) break
  }
  return { flux, spots: numeric(raw.sunspots), a: numeric(raw.aindex), k: numeric(raw.kindex), wind: numeric(raw.solarwind), bands: [...bands.values()] }
}

/** NOAA timestamps without an offset are UTC, regardless of device timezone. */
export function parseSeries(body: string, field: 'flux' | 'Kp' | 'speed'): Point[] {
  const data: unknown = JSON.parse(body)
  if (!Array.isArray(data)) throw new Error('Invalid NOAA series')
  const header = Array.isArray(data[0]) ? data[0] : null
  const timeIndex = header?.indexOf('time_tag') ?? -1, valueIndex = header?.indexOf(field) ?? -1
  const points = new Map<number, number>()
  for (const row of data.slice(header ? 1 : 0, 15000)) {
    if (!row || typeof row !== 'object') continue
    const stamp = header ? row[timeIndex] : row.time_tag
    const value = numeric(header ? row[valueIndex] : row[field])
    if (typeof stamp !== 'string' || value === null || value < 0 || (field === 'Kp' && value > 9)) continue
    const time = Date.parse(/[zZ]$|[+-]\d\d:\d\d$/.test(stamp) ? stamp : `${stamp}Z`)
    if (Number.isFinite(time)) points.set(time, value)
  }
  if (!points.size) throw new Error('No valid NOAA readings')
  return [...points].map(([time, value]) => ({ time, value })).sort((a, b) => a.time - b.time)
}

/** KC2G's latest reading per ionosonde; longitudes come as 0–360 east. */
export function parseStations(body: string): Ionosonde[] {
  const data: unknown = JSON.parse(body)
  if (!Array.isArray(data)) throw new Error('Invalid ionosonde list')
  const stations: Ionosonde[] = []
  for (const row of data.slice(0, 1000)) {
    const station = row?.station, lat = numeric(station?.latitude), lon = numeric(station?.longitude), confidence = numeric(row?.cs)
    const stamp = row?.time, muf = numeric(row?.mufd), fof2 = numeric(row?.fof2)
    if (lat === null || lon === null || Math.abs(lat) > 90 || lon < -180 || lon > 360 || typeof stamp !== 'string' || (muf === null && fof2 === null)) continue
    if (confidence !== null && confidence >= 0 && confidence < STATION_MIN_CONFIDENCE) continue
    const time = Date.parse(/[zZ]$|[+-]\d\d:\d\d$/.test(stamp) ? stamp : `${stamp}Z`)
    if (!Number.isFinite(time)) continue
    stations.push({ code: String(station.code ?? ''), name: String(station.name ?? station.code ?? '').slice(0, 60), lat, lon: ((lon + 540) % 360) - 180, time, muf, fof2 })
  }
  // Every row unusable means the format changed, not that the stations went quiet.
  if (data.length && !stations.length) throw new Error('No usable ionosonde readings')
  return stations
}

export function nearestStation(stations: Ionosonde[], place: [number, number] | null, now: number): Ionosonde | null {
  if (!place) return null
  let best: Ionosonde | null = null, bestDistance = Infinity
  for (const s of stations) {
    if (now - s.time > STATION_MAX_AGE || s.time - now > HOUR) continue
    const distance = distanceOnEarth({ lat: place[0], lon: place[1] }, { lat: s.lat, lon: s.lon }) ?? Infinity
    if (distance < bestDistance) { best = s; bestDistance = distance }
  }
  return best
}

/** The operation's own coordinates, else its grid square. */
export function operationLocation(operation: Record<string, JSONValue> | undefined): [number, number] | null {
  const op = operation ?? {}, lat = numeric(op.lat), lon = numeric(op.lon)
  if (lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return [lat, lon]
  const grid = typeof op.grid === 'string' ? op.grid.trim() : ''
  return /^[A-R]{2}[0-9]{2}(?:[A-X]{2}(?:[0-9]{2})?)?$/i.test(grid) ? gridToLocation(grid) : null
}

const BAND_MHZ: Record<string, number> = { '160m': 1.8, '80m': 3.5, '60m': 5.3, '40m': 7, '30m': 10.1, '20m': 14, '17m': 18.068, '15m': 21, '12m': 24.89, '10m': 28, '6m': 50 }
/** The current QSO's frequency in MHz (Ham2K keeps kHz), else the bottom of its band. */
export function operatingMHz(qso: Record<string, JSONValue> | undefined): number | null {
  const khz = numeric(qso?.freq)
  if (khz !== null && khz > 0) return khz / 1000
  return typeof qso?.band === 'string' ? BAND_MHZ[qso.band.toLowerCase()] ?? null : null
}

// Roboto advance widths in ems, close enough to lay a run of differently weighted words end to end.
const EM: Record<string, number> = { ' ': .248, '.': .263, ',': .196, '·': .263, '-': .276, '—': .79, M: .874, W: .874, I: .272, f: .347, i: .243, j: .239, l: .243, t: .327, r: .338, m: .876, w: .755 }
export const textWidth = (s: string, size: number, weight = 400) =>
  [...s].reduce((sum, ch) => sum + (EM[ch] ?? (/\d/.test(ch) ? .562 : /[A-Z]/.test(ch) ? .64 : /[a-z]/.test(ch) ? .53 : .6)), 0) * size * (weight >= 600 ? 1.04 : 1)

export function mergePoints(base: Point[], recent: Point[]): Point[] {
  return [...new Map([...base, ...recent].map(p => [p.time, p.value]))].map(([time, value]) => ({ time, value })).sort((a, b) => a.time - b.time)
}
export function windBuckets(points: Point[], bucket = BUCKET): Point[] {
  const bins = new Map<number, { sum: number; count: number }>()
  for (const p of points) {
    const time = Math.floor(p.time / bucket) * bucket, b = bins.get(time) ?? { sum: 0, count: 0 }
    b.sum += p.value; b.count++; bins.set(time, b)
  }
  return [...bins].map(([time, b]) => ({ time, value: b.sum / b.count })).sort((a, b) => a.time - b.time)
}

export function sourcesForm(locale: string | undefined, station: Ionosonde | null): FormDefinition {
  const t = words(locale)
  return { title: t.sources, elements: [
    { type: 'link', key: 'hamqsl', label: 'hamqsl.com', url: 'https://www.hamqsl.com/solar.html', description: t.hamqsl },
    { type: 'link', key: 'noaa', label: 'NOAA SWPC', url: 'https://www.swpc.noaa.gov/', description: t.noaa },
    { type: 'link', key: 'kc2g', label: 'KC2G', url: 'https://prop.kc2g.com/stations/', description: station ? t.kc2gFrom(station.name) : t.kc2g },
  ] }
}

export function createSolarPanel(fetch: Fetch, showForm?: ShowForm, log?: Log): PanelHook {
  let conditions: Conditions | undefined, fetched = 0, attempted: number | undefined, successful: number | undefined
  let failed = false, pending: Promise<void> | undefined, historyAttempt: number | undefined, historySuccess: number | undefined
  const feeds: Record<'flux' | 'kp' | 'wind', Feed> = { flux: { points: [], failed: false }, kp: { points: [], failed: false }, wind: { points: [], failed: false } }
  let windRaw: Point[] = [], stations: Ionosonde[] = []
  // 3.8s keeps a round inside the host's five-second render budget, since the render waits for it.
  async function body(url: string, options: FetchOptions = { timeout: 3800 }) {
    const response = await fetch(url, options)
    if (response.status !== 200) throw new Error(`Solar HTTP ${response.status}`)
    return response.body
  }
  // The week of wind is 1.13MB: too big for a round's 3.8s on a slow link, and sharing the link with
  // the round can push hamqsl past its timeout. So it starts only once hamqsl has answered, no render
  // waits for it, it runs under the host's own longer timeout, and the next tick draws it.
  function fetchHistory(real: number) {
    historyAttempt = real
    body(urls.history, {}).then(b => parseSeries(b, 'speed')).then(history => {
      historySuccess = real
      windRaw = mergePoints(history, windRaw).slice(-11000)
      feeds.wind.points = windRaw
    }).catch(error => log?.(`NOAA wind history failed: ${(error as Error)?.message ?? error}`))
  }
  return {
    async getPanels(_args, ctx) {
      const t = words(ctx.locale)
      const form: SettingsField[] = [
        ...ROWS.map(row => ({ type: 'field' as const, fieldType: 'checkbox' as const, key: row, label: t.rows[row], value: true })),
        { type: 'field', fieldType: 'select', key: 'days', label: t.range, value: '7', options: ([7, 3, 1] as const).map(days => ({ value: String(days), label: t.ranges[days] })) },
        themeField(ctx.locale),
      ]
      return [{ key: 'solar', title: t.title, description: t.description, icon: 'white-balance-sunny', multiple: true, on: ['operation', 'qso', 'tick:60'], form }]
    },
    async render(args, ctx) {
      const t = words(args.environment?.locale ?? ctx.locale)
      if (!args.environment || !args.clock) return { kind: 'markdown', content: t.update }
      const { nowMillis: now, realNowMillis: real } = args.clock
      const due = successful === undefined || real - successful >= 15 * 60000
      if (due && (attempted === undefined || real - attempted >= 60000) && !pending) {
        attempted = real
        pending = (async () => {
          await Promise.all([
            (async () => {
              try { conditions = parseConditions(await body(urls.conditions)); fetched = now; failed = false }
              catch { failed = true }
            })(),
            (async () => {
              try { stations = parseStations(await body(urls.stations)) } catch (error) { log?.(`KC2G stations failed: ${(error as Error)?.message ?? error}`) }
            })(),
            ...(['flux', 'kp'] as const).map(async key => {
              try { feeds[key] = { points: parseSeries(await body(urls[key]), key === 'flux' ? 'flux' : 'Kp'), fetched: now, failed: false } }
              catch { feeds[key].failed = true }
            }),
            (async () => {
              const recent = await body(urls.wind).then(b => parseSeries(b, 'speed')).catch(() => null)
              windRaw = mergePoints(windRaw, recent ?? []).slice(-11000)
              feeds.wind.points = windRaw
              feeds.wind.failed = recent === null
              if (recent) feeds.wind.fetched = now
            })(),
          ])
          if (!failed) successful = real
        })().finally(() => { pending = undefined })
      }
      if (pending) await pending
      if (!conditions) return { kind: 'markdown', content: t.unavailable }
      const options = panelOptions(args.config)
      // Only for a placement that draws the wind, so one that hides it never pulls the megabyte; the
      // cache is shared, so the first placement that does show it fetches it for all of them. Not
      // behind a failed hamqsl, even with older indices on screen: that failure is the sign of a slow
      // link, and the megabyte is the most expensive thing the panel could put on it next.
      const historyDue = (historySuccess === undefined || real - historySuccess >= 6 * HOUR) && (historyAttempt === undefined || real - historyAttempt >= 15 * 60000)
      if (options.rows.wind && !failed && historyDue) fetchHistory(real)
      const place = operationLocation(args.operation)
      return { kind: 'svgScene', scene: solarDocument(args.environment, conditions, feeds, now, fetched, failed, nearestStation(stations, place, now), options, operatingMHz(args.qso), place !== null) }
    },
    // Scenes cannot open a URL themselves; the host's sheet does, from its link elements.
    async onEvent(args, ctx) {
      if (args.event.action === 'sources' && showForm) {
        const station = nearestStation(stations, operationLocation(args.operation), args.clock?.nowMillis ?? Date.now())
        showForm(sourcesForm(args.environment?.locale ?? ctx.locale, station)).catch(error => log?.(`Solar sources sheet failed: ${(error as Error)?.message ?? error}`))
      }
      return { values: {} }
    },
  }
}

export function solarDocument(e: PanelEnvironment, r: Conditions, feeds: Record<'flux' | 'kp' | 'wind', Feed>, now: number, fetched: number, failed: boolean, station: Ionosonde | null = null, options: Options = panelOptions({}), mhzInUse: number | null = null, located = true): SvgScene {
  const t = words(e.locale), c = themeColors(options.theme, e.colors), status = options.theme === 'teal' ? tealPalette : solarPalette, style = e.typography.label
  const width = Math.max(1, Math.min(8192, e.width)), height = Math.max(1, Math.min(8192, e.height))
  const left = e.safeInsets.left, top = e.safeInsets.top, w = width - left - e.safeInsets.right, h = height - top - e.safeInsets.bottom
  const layers: SvgSceneLayer[] = [], scene: SvgScene = { version: 1, width, height, values: { time: 56 }, layers }
  if (w < 40 || h < 30) return scene
  const line = style.scaledFontSize * style.lineHeight + 4, end = top + h - line - 6
  function text(id: string, value: string | string[], x: number, y: number, tw: number, role: 'label' | 'title' | 'display' = 'label', color = c.onSurface, scale = 1) {
    const s = e.typography[role], th = s.scaledFontSize * scale * s.lineHeight + 4
    if (tw < 1 || y + th > top + h) return
    layers.push({ id, x, y, width: tw, height: th, text: { ...(typeof value === 'string' ? { literal: value } : { value: 'time', samples: value }), size: s.fontSize * scale, fontFamily: s.fontFamily ?? undefined, fontWeight: s.fontWeight, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing, color } })
  }
  function svg(id: string, x: number, y: number, sw: number, sh: number, body: string): SvgSceneLayer {
    return { id, x, y, width: Math.max(1, sw), height: Math.max(1, sh), svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.max(1, sw)} ${Math.max(1, sh)}">${body}</svg>` }
  }
  const fmt = (v: number | null) => v === null ? '—' : String(Math.round(v * 10) / 10)
  layers.push(svg('surface', 0, 0, width, height, `<rect width="${width}" height="${height}" fill="${c.surface}"/>`))
  const show = options.rows
  let y = top + 6
  if (show.metrics) {
    const role = w >= 220 && h >= 160 ? 'display' : 'title'
    const headline = [
      { id: 'sfi', label: `SFI ${fmt(r.flux)}`, color: c.onSurface },
      { id: 'sn', label: `SN ${fmt(r.spots)}`, color: c.onSurfaceVariant },
      { id: 'a', label: `A ${fmt(r.a)}`, color: r.a === null ? c.onSurfaceVariant : solarAColor(r.a, status) },
      { id: 'kp', label: `Kp ${fmt(r.k)}`, color: r.k === null ? c.onSurfaceVariant : solarKColor(r.k, status) },
    ]
    const headlineStyle = e.typography[role]
    const desiredWidths = headline.map(item => item.label.length * headlineStyle.scaledFontSize * .62)
    const desiredSun = Math.min(32, headlineStyle.scaledFontSize)
    // Scale the entire headline together so every index keeps equal prominence.
    const headlineScale = Math.min(1, (w - 20) / (desiredWidths.reduce((a, b) => a + b, 0) + desiredSun + 32))
    const sunSize = desiredSun * headlineScale, gap = 8 * headlineScale
    layers.push({ id: 'sun', x: left + 8, y: top + 10, width: sunSize, height: sunSize, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" fill="${solarFluxColor(r.flux, status)}"/><path d="M12 1V5 M12 19V23 M1 12H5 M19 12H23 M4 4L7 7 M17 17L20 20 M4 20L7 17 M17 7L20 4" stroke="${solarFluxColor(r.flux, status)}" stroke-width="2"/></svg>` })
    let headlineX = left + 8 + sunSize + gap
    const spare = Math.max(0, w - 20 - (desiredWidths.reduce((a, b) => a + b, 0) + desiredSun + 32) * headlineScale) / 4
    for (const [i, item] of headline.entries()) {
      const itemWidth = desiredWidths[i] * headlineScale + spare
      text(item.id, item.label, headlineX, top + 6, itemWidth, role, item.color, headlineScale)
      headlineX += itemWidth + gap
    }
    y = top + headlineStyle.scaledFontSize * headlineScale * headlineStyle.lineHeight + 14
  }
  if (show.muf && !station && y + line < end) {
    text('muf-hint', located ? t.mufNoStation : t.mufNoLocation, left + 10, y, w - 20, 'label', c.outline)
    const hint = layers[layers.length - 1]
    if (hint?.id === 'muf-hint' && hint.text) hint.text.align = 'center'
    y += line
  }
  if (show.muf && station && y + line < end) {
    // Bold numbers beside regular units need a layer per weight. A MUF under the operating frequency
    // shows in red. A foF2 over it shows in green: the band reflects straight up, with no skip zone.
    const red = WARNING[themeSurface(options.theme, e.brightness)]
    const size = style.scaledFontSize, base = style.fontWeight, mhz = (v: number | null) => v === null ? '—' : v.toFixed(0)
    // Above 6 m the F2 layer is never the path, so a low MUF there says nothing worth a warning.
    const warnMuf = mhzInUse !== null && mhzInUse <= 54 && station.muf !== null && station.muf < mhzInUse
    const nvis = mhzInUse !== null && station.fof2 !== null && station.fof2 > mhzInUse
    type Piece = { text: string; weight: number; color: string }
    const plain = (text: string): Piece => ({ text, weight: base, color: c.onSurfaceVariant })
    const reading = (label: string, v: number | null, mark: string | null, units: boolean): Piece[] => [
      { ...plain(`${label} `), ...(mark ? { color: mark, weight: 700 } : {}) },
      { text: mhz(v), weight: 700, color: mark ?? c.onSurface },
      ...(units ? [{ text: ' MHz', weight: 400, color: mark ?? c.onSurfaceVariant }] : []),
    ]
    const comma = station.name.indexOf(','), region = comma < 0 ? station.name : station.name.slice(comma + 1).trim()
    const run = (units: boolean, place: string | null): Piece[] => [...reading('MUF', station.muf, warnMuf ? red : null, units), plain(' · '), ...reading('foF2', station.fof2, nvis ? status.good : null, units), ...(place ? [plain(` · ${place}`)] : [])]
    const runWidth = (pieces: Piece[]) => pieces.reduce((sum, p) => sum + textWidth(p.text, size, p.weight), 0)
    // Shorten the station to its state and country, then drop the units and the station, before letting the line clip.
    const choices = [run(true, station.name), run(true, region), run(false, region), run(false, null)]
    const pieces = choices.find(p => runWidth(p) <= w - 20) ?? choices[choices.length - 1]
    let x = left + Math.max(10, (w - runWidth(pieces)) / 2)
    for (const [i, piece] of pieces.entries()) {
      // Spaces at a layer's edges are not reliably drawn, so they become offsets instead.
      const body = piece.text.trim(), lead = piece.text.length - piece.text.trimStart().length
      x += textWidth(' '.repeat(lead), size, piece.weight)
      const pw = textWidth(body, size, piece.weight), room = left + w - 10 - x
      if (room < 4) break
      text(`muf-${i}`, body, x, y, i === pieces.length - 1 ? room : Math.min(room, pw + 6), 'label', piece.color)
      const layer = layers[layers.length - 1]
      if (layer?.text) layer.text.fontWeight = piece.weight
      x += textWidth(piece.text.trimStart(), size, piece.weight)
    }
    y += line
  }
  if (show.bands && w >= 200 && y + (r.bands.length + 1) * line + 8 < end && r.bands.length) {
    const col = (w - 20) / 3
    for (const [i, label] of [t.band, t.day, t.night].entries()) {
      text(`band-heading-${i}`, label, left + 10 + i * col, y, col, 'label', c.outline)
      const heading = layers[layers.length - 1]
      if (i > 0 && heading.text) heading.text.align = 'center'
    }
    y += line
    for (const [i, band] of r.bands.entries()) {
      text(`band-${i}`, band.name, left + 10, y, col, 'label', c.onSurfaceVariant)
      for (const [j, rating] of [band.day, band.night].entries()) {
        const color = rating === 'unknown' ? c.outline : status[rating]
        const x = left + 10 + (j + 1) * col
        layers.push(svg(`band-background-${i}-${j}`, x + 2, y + 1, col - 4, line - 2, `<rect width="${col - 4}" height="${line - 2}" rx="3" fill="${color}" fill-opacity=".16"/>`))
        text(`band-${i}-${j}`, t[rating], x + 8, y, col - 16, 'label', color)
        const cell = layers[layers.length - 1]
        if (cell.text) { cell.text.fontWeight = 600; cell.text.align = 'center' }
      }
      y += line
    }
    y += 6
  }
  const span = options.days * 24 * HOUR, start = now - span
  // About 56 wind means across any range, the Kp bars' own count over a week.
  const windBucket = options.days === 7 ? BUCKET : options.days === 3 ? HOUR : HOUR / 2, windSpan = options.days === 7 ? '3h' : options.days === 3 ? '1h' : '30 min'
  const shown = { flux: show.sfi, wind: show.wind, kp: show.kp }
  const series = (['flux', 'wind', 'kp'] as const).filter(key => shown[key]).map(key => {
    const points = feeds[key].points.filter(p => p.time >= start - (key === 'wind' ? windBucket : 0) && p.time <= now)
    return { key, ...feeds[key], points: key === 'wind' ? windBuckets(points, windBucket).filter(p => p.time >= start) : points }
  })
  const room = end - y - 8, minChart = line + 34
  const available = series.filter(s => s.points.length >= 2)
  // Preserve SFI and Kp when space only permits two histories.
  const chosen = available.filter(s => s.key !== 'wind' || room >= minChart * available.length).slice(0, Math.max(0, Math.floor(room / minChart)))
  const chartStart = y, chartHeight = chosen.length ? Math.min(150, room / chosen.length) : 0
  const sample = (samples: number[]): SceneBinding => ({ value: 'time', input: [0, 56], output: [samples[0], samples[56]], samples })
  const date = (time: number) => `${new Date(time).toISOString().slice(5, 16).replace('T', ' ')}Z`
  const timelines = Array.from({ length: 57 }, (_, i) => start + i * span / 56)
  const valuesForTime: string[][] = []
  for (const series of chosen) {
    const { key, points } = series, label = key === 'flux' ? 'SFI' : key === 'kp' ? 'Kp' : `${t.wind} (${t.mean(windSpan)})`
    const suffix = key === 'wind' ? ' km/s' : ''
    const nearest = timelines.map(time => points.reduce((a, b) => Math.abs(a.time - time) <= Math.abs(b.time - time) ? a : b))
    const captions = nearest.map(p => `${label} ${fmt(p.value)}${suffix} · ${date(p.time)}${series.failed ? ` · ${t.stale}` : ''}`)
    valuesForTime.push(captions)
    text(`${key}-caption`, captions, left + 8, y, w - 16)
    const plotTop = y + line, ph = chartHeight - line - 8
    const lo = key === 'kp' ? 0 : Math.min(...points.map(p => p.value)) - 2
    const hi = key === 'kp' ? 9 : Math.max(lo + 4, ...points.map(p => p.value)) + 2
    const px = (time: number) => Math.max(4, Math.min(w - 4, 4 + (time - start) / (now - start || 1) * (w - 8)))
    const py = (value: number) => ph - 3 - (value - lo) / (hi - lo) * (ph - 6)
    const lineColor = key === 'wind' ? c.onSurfaceVariant : key === 'kp' ? c.onSurface : c.accent
    let art = `<path d="M0 ${ph} H${w}" stroke="${c.outlineVariant}"/>`
    if (key === 'kp') {
      for (const p of points) art += `<rect x="${px(p.time)}" y="${py(p.value)}" width="${Math.max(1, Math.min(w - px(p.time), (w - 8) * BUCKET / span - 1))}" height="${Math.max(.5, ph - py(p.value))}" fill="${solarKColor(p.value, status)}"/>`
    } else {
      let path = points.map((p, i) => `${i === 0 || p.time - points[i - 1].time > (key === 'wind' ? windBucket * 2 : 30 * HOUR) ? 'M' : 'L'}${px(p.time)} ${py(p.value)}`).join(' ')
      if (key === 'flux') {
        // Carry the endpoint readings to the pane edges, as the native chart does.
        path = `M0 ${py(points[0].value)} L${path.slice(1)} L${w} ${py(points[points.length - 1].value)}`
      }
      art += `<defs><linearGradient id="${key}-fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${lineColor}" stop-opacity="${key === 'wind' ? .16 : .20}"/><stop offset="1" stop-color="${lineColor}" stop-opacity="0"/></linearGradient></defs>`
      // Close each continuous segment separately so gaps remain unfilled.
      for (const segment of path.split('M').filter(Boolean)) {
        const coords = segment.trim().split(/\s*L/), firstX = coords[0].split(' ')[0], lastX = coords[coords.length - 1].split(' ')[0]
        art += `<path d="M${segment} L${lastX} ${ph} L${firstX} ${ph} Z" fill="url(#${key}-fill)"/>`
      }
      art += `<path d="${path}" stroke="${lineColor}" stroke-width="2" fill="none"/>`
    }
    layers.push(svg(`${key}-chart`, left, plotTop, w, ph + 1, art))
    layers.push({ ...svg(`${key}-cursor`, left, plotTop, 1, ph, `<path d="M.5 0V${ph}" stroke="${c.onSurfaceVariant}" stroke-dasharray="3 3"/>`), translateX: sample(nearest.map(p => px(p.time))) })
    layers.push({ ...svg(`${key}-point`, left - 4, plotTop - 4, 8, 8, `<circle cx="4" cy="4" r="3" fill="${c.surface}" stroke="${lineColor}" stroke-width="2"/>`), translateX: sample(nearest.map(p => px(p.time))), translateY: sample(nearest.map(p => py(p.value))) })
    y += chartHeight
  }
  if (chosen.length) scene.controls = [{ id: 'time', label: t.inspect, kind: 'slider', x: left, y: chartStart, width: w, height: y - chartStart, value: 'time', min: 0, max: 56, step: 1, hover: true, valueLabels: timelines.map((_, i) => valuesForTime.map(v => v[i]).join(' · ')) }]
  else if (!available.length && y + line < end) text('history-unavailable', t.history, left + 10, y, w - 20, 'label', c.onSurfaceVariant)
  // Credits sit at the right edge, in the accent color, over a button that opens the sources sheet.
  const age = `${failed ? `${t.stale} · ` : ''}${Math.max(0, Math.floor((now - fetched) / 60000))} ${t.age}`, chars = (s: string) => s.length * style.scaledFontSize * .58
  const credits = [`hamqsl.com · NOAA${station ? ' · KC2G' : ''}`, `hamqsl · NOAA${station ? ' · KC2G' : ''}`].find(s => chars(age) + chars(s) + 12 <= w - 20) ?? `hamqsl · NOAA${station ? ' · KC2G' : ''}`
  const creditsWidth = Math.min(w - 20, chars(credits) + 4)
  text('source', age, left + 10, end, Math.max(0, w - 20 - creditsWidth - 8), 'label', failed ? c.error : c.onSurfaceVariant)
  text('credits', credits, left + w - 10 - creditsWidth, end, creditsWidth, 'label', c.accent)
  const creditsLayer = layers[layers.length - 1]
  if (creditsLayer?.id === 'credits' && creditsLayer.text) {
    creditsLayer.text.align = 'end'
    scene.controls = [...scene.controls ?? [], { id: 'sources', label: t.sources, kind: 'button', event: 'sources', x: creditsLayer.x - 4, y: creditsLayer.y, width: creditsLayer.width + 8, height: creditsLayer.height }]
  }
  return scene
}
