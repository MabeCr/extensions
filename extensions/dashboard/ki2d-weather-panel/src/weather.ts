// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MPL-2.0
import { icons, weatherIcon } from './icons.ts'
import { gridToLocation } from '@ham2k/lib-geo-tools'
import { panelTheme, themeColors, themeField } from '@ham2k/lib-panel-themes'
import type { FetchOptions, FetchResponse, HookContext, PanelEnvironment, PanelHook, PanelRenderArgs, SvgScene, SvgSceneLayer } from '@ham2k/extension-sdk'

type Fetch = (url: string, options?: FetchOptions) => Promise<FetchResponse>
type Hour = { time: number; temperature: number | null; rain: number | null; code: number | null; isDay: boolean }
type Reading = {
  temperature: number; code: number | null; isDay: boolean; wind: number | null; gusts: number | null
  humidity: number | null; direction: number | null; offset: number; zone: string
  unit: string; windUnit: string; hours: Hour[]; sunrise: number[]; sunset: number[]
}
type Entry = { reading?: Reading; fetchedAt?: number; attemptedAt?: number; failed?: boolean; pending?: Promise<void> }
const finite = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null
const array = (v: unknown): unknown[] => Array.isArray(v) ? v : []
const short = (v: unknown, fallback: string) => typeof v === 'string' && v.length <= 32 ? v : fallback
const en = {
  title: 'KI2D’s Weather Panel', description: 'Live weather rendered by an extension', location: 'Location',
  locationHelp: 'Grid square or latitude,longitude. Blank follows the operation.',
  noLocation: 'Set a location in this panel’s settings or in the operation.',
  badLocation: 'Invalid location. Use a grid square or latitude,longitude.',
  failed: 'Weather unavailable. Retrying shortly.', stale: 'Refresh failed', age: 'min ago',
  update: 'This panel needs a host with the panel environment API.', source: 'Open-Meteo',
  inspect: 'Forecast hour', humidity: 'Humidity', rain: 'Rain', wind: 'Wind', gusts: 'gusts',
  sunrise: 'Sunrise', sunset: 'Sunset',
  sky: ['Clear', 'Partly cloudy', 'Cloudy', 'Fog', 'Drizzle', 'Rain', 'Snow', 'Thunderstorms', 'Unknown'],
}
const es: typeof en = {
  title: 'Panel de tiempo de KI2D', description: 'Tiempo en vivo dibujado por una extensión', location: 'Ubicación',
  locationHelp: 'Cuadrícula o latitud,longitud. Vacío usa la ubicación de la operación.',
  noLocation: 'Define la ubicación del panel o de la operación.', badLocation: 'Ubicación inválida. Usa una cuadrícula o latitud,longitud.',
  failed: 'Tiempo no disponible. Se reintentará pronto.', stale: 'Actualización fallida', age: 'min atrás',
  update: 'Este panel necesita la API de contexto visual.', source: 'Open-Meteo',
  inspect: 'Hora del pronóstico', humidity: 'Humedad', rain: 'Lluvia', wind: 'Viento', gusts: 'ráfagas',
  sunrise: 'Amanecer', sunset: 'Atardecer',
  sky: ['Despejado', 'Parcialmente nublado', 'Nublado', 'Niebla', 'Llovizna', 'Lluvia', 'Nieve', 'Tormentas', 'Desconocido'],
}
const words = (locale?: string) => locale?.startsWith('es') ? es : en

export function weatherLocation(args: PanelRenderArgs): [number, number] | null {
  const explicit = typeof args.config.location === 'string' ? args.config.location.trim() : ''
  const op = args.operation ?? {}
  if (!explicit && finite(op.lat) !== null && finite(op.lon) !== null) {
    const pair: [number, number] = [op.lat as number, op.lon as number]
    return Math.abs(pair[0]) <= 90 && Math.abs(pair[1]) <= 180 ? pair : null
  }
  const input = explicit || (typeof op.grid === 'string' ? op.grid : '')
  if (/^[A-R]{2}[0-9]{2}(?:[A-X]{2}(?:[0-9]{2})?)?$/i.test(input)) return gridToLocation(input)
  const parts = input.split(',').map(s => s.trim())
  if (parts.length !== 2 || parts.some(s => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s))) return null
  const lat = Number(parts[0]), lon = Number(parts[1])
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lat, lon] : null
}

export function parseWeather(raw: unknown, imperial: boolean): Reading {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid weather response')
  const data = raw as Record<string, any>
  const current = data.current ?? {}, hourly = data.hourly ?? {}, daily = data.daily ?? {}
  const temperature = finite(current.temperature_2m)
  if (temperature === null) throw new Error('Missing current temperature')
  const temps = array(hourly.temperature_2m), rains = array(hourly.precipitation_probability)
  const codes = array(hourly.weather_code), daylight = array(hourly.is_day)
  const hours: Hour[] = []
  for (const [i, time] of array(hourly.time).slice(0, 168).entries()) {
    if (finite(time) === null) continue
    hours.push({ time: time as number, temperature: finite(temps[i]), rain: finite(rains[i]), code: finite(codes[i]), isDay: daylight[i] !== 0 })
  }
  hours.sort((a, b) => a.time - b.time)
  return {
    temperature, code: finite(current.weather_code), isDay: current.is_day !== 0, wind: finite(current.wind_speed_10m),
    gusts: finite(current.wind_gusts_10m), humidity: finite(current.relative_humidity_2m), direction: finite(current.wind_direction_10m),
    offset: finite(data.utc_offset_seconds) ?? 0, zone: short(data.timezone_abbreviation, ''),
    unit: short(data.current_units?.temperature_2m, imperial ? '°F' : '°C'),
    windUnit: short(data.current_units?.wind_speed_10m, imperial ? 'mph' : 'km/h'), hours,
    sunrise: array(daily.sunrise).map(finite).filter((v): v is number => v !== null),
    sunset: array(daily.sunset).map(finite).filter((v): v is number => v !== null),
  }
}

export function createWeatherPanel(fetch: Fetch): PanelHook {
  // Shared requests for identical locations/units; bounded independently of
  // placement count. Theme, resizing and local inspection never fetch again.
  const cache = new Map<string, Entry>()
  return {
    async getPanels(_args, ctx) {
      const t = words(ctx.locale)
      return [{ key: 'weather', title: t.title, description: t.description, icon: 'weather-partly-cloudy',
        multiple: true, on: ['operation', 'tick:60'],
        form: [{ type: 'field', key: 'location', fieldType: 'text', label: t.location, description: t.locationHelp }, themeField(ctx.locale)],
      }]
    },
    async render(args, ctx) {
      const t = words(ctx.locale), environment = args.environment
      if (!environment || !args.clock) return { kind: 'markdown', content: t.update }
      const place = weatherLocation(args)
      if (!place) return { kind: 'markdown', content: args.config.location ? t.badLocation : t.noLocation }
      const imperial = ctx.distanceUnits === 'miles'
      const key = `${place[0]},${place[1]}:${imperial}`
      let entry = cache.get(key)
      if (!entry) {
        if (cache.size >= 64) {
          const victim = [...cache].find(([, value]) => !value.pending)
          if (!victim) return { kind: 'markdown', content: t.failed }
          cache.delete(victim[0])
        }
        entry = {}; cache.set(key, entry)
      }
      const now = args.clock.realNowMillis
      const age = entry.attemptedAt === undefined ? Infinity : now - entry.attemptedAt
      if (!entry.pending && age >= (entry.failed ? 60_000 : 900_000)) {
        entry.attemptedAt = now
        const target = entry
        target.pending = (async () => {
          try {
            const url = 'https://api.open-meteo.com/v1/forecast?' + [
              `latitude=${place[0]}`, `longitude=${place[1]}`, 'timezone=auto', 'timeformat=unixtime', 'forecast_days=3',
              'current=temperature_2m,weather_code,is_day,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m',
              'hourly=temperature_2m,precipitation_probability,weather_code,is_day', 'daily=sunrise,sunset',
              `temperature_unit=${imperial ? 'fahrenheit' : 'celsius'}`, `wind_speed_unit=${imperial ? 'mph' : 'kmh'}`,
            ].join('&')
            const response = await fetch(url, { timeout: 4000 })
            if (response.status !== 200) throw new Error(`Weather HTTP ${response.status}`)
            target.reading = parseWeather(JSON.parse(response.body), imperial)
            target.fetchedAt = args.clock!.nowMillis
            target.failed = false
          } catch {
            target.failed = true
          } finally {
            target.pending = undefined
          }
        })()
      }
      if (entry.pending) await entry.pending
      if (!entry.reading) return { kind: 'markdown', content: t.failed }
      return { kind: 'svgScene', scene: weatherDocument({ ...environment, colors: themeColors(panelTheme(args.config), environment.colors) }, entry.reading, args.clock.nowMillis, entry.fetchedAt!, !!entry.failed, ctx) }
    },
  }
}

const skyIndex = (code: number | null) => code === null ? 8 : code === 0 ? 0 : code <= 2 ? 1 : code === 3 ? 2 : code <= 48 ? 3 : code <= 57 ? 4 : code <= 67 || code === 80 || code === 81 || code === 82 ? 5 : code < 95 ? 6 : 7

export function weatherDocument(e: PanelEnvironment, r: Reading, now: number, fetched: number, stale: boolean, ctx: HookContext): SvgScene {
  const t = words(e.locale), c = e.colors
  const width = Math.max(1, Math.min(8192, e.width)), height = Math.max(1, Math.min(8192, e.height))
  const layers: SvgSceneLayer[] = [], scene: SvgScene = { version: 1, width, height, values: { hour: 0 }, layers }
  const left = e.safeInsets.left, top = e.safeInsets.top, w = width - left - e.safeInsets.right, h = height - top - e.safeInsets.bottom
  if (w < 40 || h < 30) return scene
  const type = e.typography
  function text(id: string, value: string, x: number, y: number, tw: number, role: keyof typeof type, color = c.onSurface) {
    const style = type[role], th = style.scaledFontSize * style.lineHeight + 4
    if (y + th > top + h || tw < 1) return
    layers.push({ id, x, y, width: tw, height: th, text: {
      literal: value, size: style.fontSize, fontFamily: style.fontFamily ?? undefined,
      fontWeight: style.fontWeight, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing, color,
    } })
  }
  function svg(id: string, x: number, y: number, sw: number, sh: number, body: string): SvgSceneLayer {
    return { id, x, y, width: Math.max(1, sw), height: Math.max(1, sh), svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.max(1, sw)} ${Math.max(1, sh)}">${body}</svg>` }
  }
  function icon(id: string, name: keyof typeof icons, x: number, y: number, size: number, color = c.onSurfaceVariant) {
    layers.push({ id, x, y, width: size, height: size,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${color}" d="${icons[name]}"/></svg>` })
  }
  layers.push(svg('surface', 0, 0, width, height, `<rect width="${width}" height="${height}" fill="${c.surface}"/>`))
  const role = h < 100 || w < 180 ? 'title' : 'display'
  const line = type.label.scaledFontSize * type.label.lineHeight + 4
  let y = top + 8
  const currentIconSize = Math.min(44, type[role].scaledFontSize * .86)
  const currentIconSpace = w >= 150 ? currentIconSize + 8 : 0
  if (currentIconSpace) icon('condition-icon', weatherIcon(r.code, r.isDay), left + 12, y + 4, currentIconSize, c.accent)
  text('temperature', `${Math.round(r.temperature)}${r.unit}`, left + 12 + currentIconSpace, y, w - 24 - currentIconSpace, role)
  y += type[role].scaledFontSize * type[role].lineHeight + 8
  if (h >= 120) {
    text('condition', t.sky[skyIndex(r.code)], left + 12, y, w - 24, 'body', c.onSurfaceVariant)
    y += type.body.scaledFontSize * type.body.lineHeight + 8
  }
  const n = (v: number | null) => v === null ? '—' : String(Math.round(v))
  if (h >= 220 && w >= 220) {
    const compass = r.direction === null ? '' : ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(((r.direction % 360 + 360) % 360) / 22.5) % 16]
    icon('wind-icon', 'weather-windy', left + 12, y + (line - 16) / 2, 16)
    text('wind', `${t.wind} ${n(r.wind)} ${r.windUnit} ${compass} · ${t.gusts} ${n(r.gusts)}`, left + 34, y, w - 46, 'label', c.onSurfaceVariant)
    y += line
    const nextSun = [...r.sunrise.map(time => ({ time, label: t.sunrise })), ...r.sunset.map(time => ({ time, label: t.sunset }))].filter(s => s.time > now / 1000).sort((a, b) => a.time - b.time)[0]
    icon('humidity-icon', 'water-percent', left + 12, y + (line - 16) / 2, 16)
    const sunX = Math.max(120, w * .48)
    text('humidity', `${t.humidity} ${n(r.humidity)}%`, left + 34, y, nextSun ? sunX - 40 : w - 46, 'label', c.onSurfaceVariant)
    if (nextSun) {
      icon('sun-time-icon', nextSun.label === t.sunrise ? 'weather-sunset-up' : 'weather-sunset-down', left + sunX, y + (line - 16) / 2, 16)
      text('sun-time', `${nextSun.label} ${localTime(nextSun.time, r.offset)}`, left + sunX + 22, y, w - sunX - 30, 'label', c.onSurfaceVariant)
    }
    y += line
  }
  const age = Math.max(0, Math.floor((now - fetched) / 60000))
  const stamp = `${stale ? `${t.stale} · ` : ''}${age} ${t.age} · ${r.zone} · ${t.source}`
  const bottom = top + h - line - 8
  text('source', stamp, left + 12, bottom, w - 24, 'label', stale ? c.error : c.onSurfaceVariant)
  const hours = r.hours.filter(hour => hour.time + 3600 > now / 1000).slice(0, 8)
  const chartTop = y + line * 2 + 12
  const stackedHourIcons = bottom - line - chartTop - 4 >= 48
  const iconBand = stackedHourIcons ? 20 : 0
  const chartHeight = bottom - line - iconBand - chartTop - 4
  if (hours.length < 2 || chartHeight < 24) return scene
  const descriptions = hours.map(hour => `${localTime(hour.time, r.offset)} ${r.zone} · ${n(hour.temperature)}${r.unit} · ${t.rain} ${n(hour.rain)}%`)
  const x = (i: number) => (i + .5) * w / hours.length
  const known = hours.map(v => v.temperature).filter((v): v is number => v !== null)
  let lo = Math.min(...known), hi = Math.max(...known)
  if (hi - lo < 4) { const mid = (lo + hi) / 2; lo = mid - 2; hi = mid + 2 }
  const pointY = hours.map(hour => hour.temperature === null ? chartHeight / 2 : chartHeight - 6 - (hour.temperature - lo) / (hi - lo) * (chartHeight - 12))
  const points = hours.flatMap((hour, i) => hour.temperature === null ? [] : [{ x: x(i), y: pointY[i] }])
  const path = curvePath(points, w)
  let art = `<defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${c.accent}" stop-opacity=".22"/><stop offset="1" stop-color="${c.accent}" stop-opacity="0"/></linearGradient></defs>`
  for (const [i, hour] of hours.entries()) {
    const rain = Math.max(0, Math.min(100, hour.rain ?? 0)), rh = rain / 100 * chartHeight * .5, bw = Math.min(14, w / hours.length * .44)
    if (rh) art += `<rect x="${x(i) - bw / 2}" y="${chartHeight - rh}" width="${bw}" height="${rh}" rx="2" fill="${c.secondary}" fill-opacity=".3"/>`
    const hourColor = i === 0 ? c.accent : c.onSurfaceVariant
    const iconSize = Math.min(16, w / hours.length * .32)
    const columnLeft = left + w * i / hours.length
    icon(`hour-icon-${i}`, weatherIcon(hour.code, hour.isDay), stackedHourIcons ? left + x(i) - iconSize / 2 : columnLeft + 2, chartTop + chartHeight + (stackedHourIcons ? 2 : (line - iconSize) / 2), iconSize, hourColor)
    const hourTextX = stackedHourIcons ? left + x(i) - type.label.scaledFontSize * .6 : columnLeft + iconSize + 4
    text(`hour-${i}`, localTime(hour.time, r.offset).slice(0, 2), hourTextX, chartTop + chartHeight + iconBand, columnLeft + w / hours.length - hourTextX, 'label', hourColor)
  }
  if (path) art += `<path d="${path} L${w} ${chartHeight} L0 ${chartHeight} Z" fill="url(#fill)"/><path d="${path}" fill="none" stroke="${c.accent}" stroke-width="2" stroke-linecap="round"/>`
  art += `<path d="M0 ${chartHeight - .5} H${w}" stroke="${c.outlineVariant}"/>`
  layers.push(svg('chart', left, chartTop, w, chartHeight, art))
  layers.push({ ...svg('cursor', left, chartTop, 1, chartHeight, `<path d="M.5 0 V${chartHeight}" stroke="${c.onSurface}" stroke-dasharray="3 3"/>`), translateX: { value: 'hour', input: [0, hours.length - 1], output: [x(0), x(hours.length - 1)] } })
  // Sampled transforms keep the callout attached without extension calls on hover.
  const sample = (samples: number[]) => ({ value: 'hour', input: [0, hours.length - 1] as [number, number], output: [samples[0], samples[samples.length - 1]] as [number, number], samples })
  layers.push({ ...svg('selected-point', left - 5, chartTop - 5, 10, 10, `<circle cx="5" cy="5" r="3.5" fill="${c.surface}" stroke="${c.accent}" stroke-width="2"/>`),
    translateX: sample(hours.map((_, i) => x(i))), translateY: sample(pointY), opacity: sample(hours.map(hour => hour.temperature === null ? 0 : 1)) })
  const readouts = hours.map(hour => `${localTime(hour.time, r.offset)} · ${n(hour.temperature)}${r.unit}`)
  const rainReadouts = hours.map(hour => `${t.rain} ${n(hour.rain)}%`)
  const calloutWidth = Math.min(w - 8, Math.max(...[...readouts, ...rainReadouts].map(s => s.length)) * type.label.scaledFontSize * .7 + 16)
  const calloutHeight = line * 2 + 8
  const calloutX = sample(hours.map((_, i) => Math.max(4, Math.min(w - calloutWidth - 4, x(i) - calloutWidth / 2))))
  const calloutY = sample(pointY.map(py => Math.max(y + 4, chartTop + py - calloutHeight - 10)))
  layers.push({ ...svg('inspection-background', left, 0, calloutWidth, calloutHeight, `<rect x=".5" y=".5" width="${calloutWidth - 1}" height="${calloutHeight - 1}" rx="5" fill="${c.surface}" stroke="${c.outlineVariant}"/>`), translateX: calloutX, translateY: calloutY })
  for (const [i, samples] of [readouts, rainReadouts].entries()) {
    const id = i === 0 ? 'inspection' : 'inspection-rain'
    text(id, '', left + 8, 4 + i * line, calloutWidth - 16, 'label', i === 0 ? c.onSurface : c.onSurfaceVariant)
    const layer = layers.find(layer => layer.id === id)!
    delete layer.text!.literal
    layer.text!.value = 'hour'; layer.text!.samples = samples
    layer.translateX = calloutX; layer.translateY = calloutY
  }
  scene.controls = [{ id: 'hour', label: t.inspect, kind: 'slider', x: left, y, width: w, height: chartTop + chartHeight - y, value: 'hour', min: 0, max: hours.length - 1, step: 1, discrete: true, hover: true, valueLabels: descriptions }]
  return scene
}

const localTime = (seconds: number, offset: number) => {
  const date = new Date((seconds + offset) * 1000)
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
}

/** Clamped Catmull–Rom: control points cannot overshoot a segment's readings. */
export function curvePath(points: { x: number; y: number }[], width: number): string {
  if (!points.length) return ''
  let path = `M0 ${points[0].y} L${points[0].x} ${points[0].y}`
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[Math.max(0, i - 1)], b = points[i], c = points[i + 1], d = points[Math.min(points.length - 1, i + 2)]
    const clamp = (v: number) => Math.max(Math.min(b.y, c.y), Math.min(Math.max(b.y, c.y), v))
    path += ` C${b.x + (c.x - a.x) / 6} ${clamp(b.y + (c.y - a.y) / 6)} ${c.x - (d.x - b.x) / 6} ${clamp(c.y - (d.y - b.y) / 6)} ${c.x} ${c.y}`
  }
  return `${path} L${width} ${points[points.length - 1].y}`
}
