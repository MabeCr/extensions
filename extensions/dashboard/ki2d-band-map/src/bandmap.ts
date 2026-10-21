// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MPL-2.0
//
// The spots on one band, along a line of its frequencies: vertical in a tall panel (rising bottom
// to top, as a vertical panadapter does), horizontal in a wide one. Where the radio's scope is on
// the band shown, the line spans the scope's window instead of the band, and the host draws the
// panadapter behind the labels.
import type { HookContext, PanelEnvironment, PanelHook, PanelRadioResult, PanelRadioSet, PanelRadioSpectrumSet, PanelRadioState, PanelScene } from '@ham2k/extension-sdk'
import type { DisplayedSpot, Scene, SceneControl as Control, SceneLayer as Layer, SuggestedQso } from './sdkGap.ts'
import { bandEdges, bandForKHz, bands, radioModeFor } from './bands.ts'
import { freqParts, hzDigitsNeeded, type FreqParts } from './frequency.ts'
import { columns, lanes, tickStep } from './layout.ts'

type BandMapHost = {
  readRadio(id?: string): Promise<PanelRadioState | null>
  setRadio(args: PanelRadioSet): Promise<PanelRadioResult>
  setRadioSpectrum(args: PanelRadioSpectrumSet): Promise<PanelRadioResult>
  /** The spot's station into the panel's operation's logging fields, as a Spots Panel tap. */
  suggestQso(args: { qso: SuggestedQso; operationUuid?: string }): Promise<{ accepted: boolean }>
}

const en = {
  title: 'KI2D’s Band Map', description: 'The spots on a band, along its frequencies',
  band: 'Band', auto: 'Automatic (the radio’s band)', age: 'Spots no older than', minutes: (n: number) => `${n} minutes`,
  panadapter: 'Radio panadapter', on: 'Behind the spots, when on this band', off: 'Off',
  mapTitle: (band: string) => `${band} Band Map`, unavailable: 'This app cannot show the band map', more: (n: number) => `+${n} more`,
  tune: (call: string, mhz: string) => `Tune to ${call} on ${mhz} MHz`, scope: 'Panadapter',
  zoomIn: 'Zoom in', zoomOut: 'Zoom out',
  refused: (reason?: string) => `The radio did not take it${reason ? ` (${reason})` : ''}`, unknown: (action: string) => `The band map has no action “${action}”`,
}
const es: typeof en = {
  title: 'Mapa de banda de KI2D', description: 'Los spots de una banda, a lo largo de sus frecuencias',
  band: 'Banda', auto: 'Automática (la banda de la radio)', age: 'Spots de hasta', minutes: (n: number) => `${n} minutos`,
  panadapter: 'Panorámico de la radio', on: 'Detrás de los spots, si está en esta banda', off: 'Apagado',
  mapTitle: (band: string) => `Mapa de ${band}`, unavailable: 'Esta app no puede mostrar el mapa de banda', more: (n: number) => `+${n} más`,
  tune: (call: string, mhz: string) => `Sintonizar ${call} en ${mhz} MHz`, scope: 'Panorámico',
  zoomIn: 'Acercar', zoomOut: 'Alejar',
  refused: (reason?: string) => `La radio no lo aceptó${reason ? ` (${reason})` : ''}`, unknown: (action: string) => `El mapa de banda no tiene la acción “${action}”`,
}
const words = (locale?: string) => (locale?.startsWith('es') ? es : en)

/** The tuned frequency and the passband in KI2D's Radio Panel's colours, so the two panels read as one. */
const tuned = { line: '#a3e6f2', width: 3, passband: '#40d6eef4', passbandWaterfall: '#26ffffff' }
/** The filter by mode, for a radio that does not report its own: as KI2D's Radio Panel assumes. */
const passbands: Record<string, [number, number]> = {
  USB: [100, 2800], LSB: [-2800, -100], CW: [-250, 250], AM: [-3000, 3000], FM: [-5000, 5000],
  'DATA-USB': [0, 3000], 'DATA-LSB': [-3000, 0], RTTY: [-250, 250],
}
const ages = [10, 30, 60]
/**
 * Zoomed in at most `deepest` times the band, never to less than `narrowest` kHz across the pane,
 * and never past `longest` scene units of band, the most a scene can be.
 */
const deepest = 32, narrowest = 10, longest = 8192

/** A spot as the map shows it: one per station, its newest report. */
export type MapSpot = {
  call: string; khz: number; band?: string; mode?: string; refs: { type: string; ref: string }[]; ageMinutes: number; worked: boolean; isSelf: boolean; notices: number
  /** What the Spots Panel shows beside the call. */
  icon: string; iconColor?: string; emoji?: string
}


export function mapSpots(board: DisplayedSpot[], nowMillis: number, [lo, hi]: [number, number]): MapSpot[] {
  const seen = new Set<string>()
  const spots: MapSpot[] = []
  for (const s of board) {
    const call = s.their.call.toUpperCase()
    if (s.freq == null || s.freq < lo || s.freq > hi || seen.has(call)) continue
    seen.add(call)
    spots.push({
      call, khz: s.freq, band: s.band, mode: s.mode, refs: s.refs ?? [], ageMinutes: Math.max(0, Math.round((nowMillis - s.spot.timeInMillis) / 60000)),
      worked: s.annotations?.worked ?? false, isSelf: s.annotations?.isSelf ?? false, notices: s.annotations?.notices.length ?? 0,
      icon: s.display?.icon ?? s.icon ?? 'radio-tower', iconColor: s.display?.iconColor, emoji: s.display?.emoji,
    })
  }
  return spots
}

/** Who keeps a place when there is not room for all: something new first, then the unworked, then the newest. */
const rank = (s: MapSpot) => (s.notices ? 0 : s.worked ? 2 : 1) * 1e6 + s.ageMinutes
const byRank = (a: MapSpot, b: MapSpot) => rank(a) - rank(b)
/** Who sits nearest the line where labels crowd: the newest. */
const byAge = (a: MapSpot, b: MapSpot) => a.ageMinutes - b.ageMinutes

const mhz = (khz: number, decimals = 3) => (khz / 1000).toFixed(decimals)


/**
 * The most spots a map shows: each takes two controls and up to six layers, within the scene's 256
 * and 512 — fewer where the scale has used more of the layers. Ten more go to the radio's line,
 * the count of those left out, the shared frequency readout and the zoom buttons.
 */
const mostSpots = (layersUsed: number) => Math.min(100, Math.floor((512 - layersUsed - 10) / 6))

/** What a render placed, so a click on a label knows where to tune. */
export type Placed = { id: string; spot: MapSpot }

export type MapView = {
  band: string
  /** The kHz the line runs between: the band's edges, or the scope's window. */
  window: [number, number]
  spots: MapSpot[]
  /** The age at which a spot is shown faintest: the oldest the map asks for. */
  maxAgeMinutes: number
  radioKHz?: number
  /** The receive filter's edges in Hz from the tuned frequency. */
  passband?: [number, number]
  /** Present when the host draws the radio's panadapter behind the map. */
  scope?: { radio: string }
  /** The operator's own thousands and decimal marks. */
  marks: { group: string; decimal: string }
  /** Which ways the map can zoom from here. */
  zoom: { in: boolean; out: boolean }
  /**
   * Without the panadapter: the band drawn `factor` times the pane's length, scrolled by the app.
   * `offset` is where the view was left, in scene units, or none to centre on the radio; with
   * `follow`, the radio has moved since, and the view moves just enough to keep it in its middle
   * 20–80%. With `centerOn` (kHz), a zoom has just changed, and the view keeps that frequency in
   * its middle. `stretch` is how far a drag on the scale may zoom from here.
   */
  scroll?: { factor: number; offset?: number; follow: boolean; centerOn?: number; stretch: { min: number; max: number } }
}

export function bandMapScene(e: PanelEnvironment, view: MapView, t: typeof en): { scene: Scene; placed: Placed[]; offset?: number; centerKHz?: number } {
  const c = e.colors
  const paneWidth = Math.max(1, Math.min(8192, e.width)), paneHeight = Math.max(1, Math.min(8192, e.height))
  const vertical = paneHeight > paneWidth
  // Scrolling, the band runs on past the pane along the line; the zoom buttons stay on the pane.
  const factor = view.scroll?.factor ?? 1
  const width = vertical ? paneWidth : Math.min(8192, paneWidth * factor), height = vertical ? Math.min(8192, paneHeight * factor) : paneHeight
  const left = e.safeInsets.left + 8, top = e.safeInsets.top + 8, right = width - e.safeInsets.right - 8, bottom = height - e.safeInsets.bottom - 8
  const paneRight = paneWidth - e.safeInsets.right - 8
  // Calls in the app's own call face (the Spots Panel's: its mono role, bold); colour alone accents one.
  const mono = e.typography.mono.fontFamily ?? undefined
  const callSize = 13, scaleSize = 11, row = 20
  // RobotoMono advances 0.6 em a glyph; a hair over sizes the boxes around the host's own layout.
  const advance = (size: number) => size * 0.61
  const [lo, hi] = view.window
  const layers: Layer[] = [], controls: Control[] = [], placed: Placed[] = [], values: Record<string, number> = {}
  const text = (id: string, x: number, y: number, w: number, h: number, literal: string, size: number, color: string, extra: Record<string, unknown> = {}) =>
    layers.push({ id, x, y, width: w, height: h, text: { literal, size, color, lineHeight: 1.2, ...extra } })
  // Each piece of artwork is a layer of its own, sized to what it draws: a zoom drag moves the pieces
  // apart at their own sizes, and only a `stretch` one — the background, the line — scales.
  const piece = (id: string, [x0, y0, x1, y1]: number[], body: string, extra: Partial<Layer> = {}) => {
    const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0)
    layers.push({ id, x: x0, y: y0, width: w, height: h, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${w} ${h}">${body}</svg>`, ...extra })
  }
  piece('background', [0, 0, width, height], `<rect width="${width}" height="${height}" fill="${c.surface}"/>`, { stretch: true })

  // The line: along the panel's longer side, frequency rising to the top or to the right.
  const axis = vertical ? left + 58 : bottom - 18
  const [a0, a1] = vertical ? [bottom, top] : [left, right]
  const at = (khz: number) => a0 + ((khz - lo) / (hi - lo)) * (a1 - a0)
  const length = Math.abs(a1 - a0)
  // At most 48 labels on the scale, however long a zoomed band runs: each takes three layers.
  const step = tickStep(hi - lo, length, Math.max(vertical ? 36 : 64, length / 48))
  // A reading in the QSO list's three weights: whole MHz bold, the kHz plain, the Hz light and smaller.
  // Each part is its own text layer, a box sized to its characters, so they sit side by side.
  const hzSize = (size: number) => size * 0.8
  // The Hz sit on the others' baseline: in the same line box (the larger text's 1.2 em), a smaller
  // size's baseline rides high by half its lost (ascent − descent) — RobotoMono's 1.048 and 0.271 em.
  const hzLift = (size: number) => ((1.048 - 0.271) / 2) * (size - hzSize(size))
  const hzLine = 1.2 / 0.8
  const readingWidths = (parts: FreqParts, size: number) =>
    [parts.mhz.length * advance(size), parts.khz.length * advance(size), (parts.hz?.length ?? 0) * advance(hzSize(size))] as const
  const reading = (id: string, parts: FreqParts, x: number, y: number, h: number, size: number, color: string) => {
    const [m, k, z] = readingWidths(parts, size)
    text(`${id}-mhz`, x, y, m + 1, h, parts.mhz, size, color, { fontFamily: mono, fontWeight: 700 })
    if (parts.khz) text(`${id}-khz`, x + m, y, k + 1, h, parts.khz, size, color, { fontFamily: mono })
    if (parts.hz) text(`${id}-hz`, x + m + k, y + hzLift(size), z + 1, h, parts.hz, hzSize(size), color, { fontFamily: mono, fontWeight: 300, lineHeight: hzLine })
    return m + k + z
  }
  // The line, and the band's own edges where the scope's window runs past them.
  const line = [vertical ? `<path d="M${axis} ${top}V${bottom}" stroke="${c.outline}" stroke-width="2"/>` : `<path d="M${left} ${axis}H${right}" stroke="${c.outline}" stroke-width="2"/>`]
  const [edgeLo, edgeHi] = bandEdges[view.band]
  for (const [from, to] of [[lo, edgeLo], [edgeHi, hi]]) {
    if (to <= from) continue
    const [p, q] = [at(from), at(to)]
    line.push(vertical
      ? `<rect x="${axis - 4}" y="${Math.min(p, q)}" width="8" height="${Math.abs(q - p)}" fill="${c.error}" fill-opacity=".5"/>`
      : `<rect x="${Math.min(p, q)}" y="${axis - 4}" width="${Math.abs(q - p)}" height="8" fill="${c.error}" fill-opacity=".5"/>`)
  }
  piece('line', [0, 0, width, height], line.join(''), { stretch: true })
  for (let khz = Math.ceil(lo / step) * step; khz <= hi; khz += step) {
    const p = at(khz), parts = freqParts(khz, step < 1 ? 1 : 0, view.marks)
    const w = readingWidths(parts, scaleSize).reduce((a, b) => a + b)
    if (vertical) {
      piece(`tick-${khz}`, [axis - 6, p - 1, axis, p + 1], `<path d="M${axis - 6} ${p}H${axis}" stroke="${c.outline}" stroke-width="1"/>`)
      reading(`tick-${khz}`, parts, axis - 10 - w, p - 8, 16, scaleSize, c.onSurfaceVariant)
    } else {
      piece(`tick-${khz}`, [p - 1, axis, p + 1, axis + 5], `<path d="M${p} ${axis}V${axis + 5}" stroke="${c.outline}" stroke-width="1"/>`)
      if (p - w / 2 >= left - 4 && p + w / 2 <= right + 4) reading(`tick-${khz}`, parts, p - w / 2, axis + 5, 14, scaleSize, c.onSurfaceVariant)
    }
  }
  const scaleLayers = layers.length

  // The panadapter, behind everything but the background; its own tuned-frequency line marks the radio.
  if (view.scope) {
    controls.push({
      id: 'scope', label: t.scope, kind: 'spectrum', radio: view.scope.radio, after: 'background', event: 'tune', display: 'both', split: 0.3,
      flow: vertical ? 'right' : 'up', scale: false,
      center: { pan: { color: tuned.line, width: tuned.width }, waterfall: { color: tuned.line, width: tuned.width } },
      overlays: view.passband ? [{ from: view.passband[0], to: view.passband[1], pan: { fill: tuned.passband }, waterfall: { fill: tuned.passbandWaterfall } }] : [],
      ...(vertical ? { x: axis, y: top, width: Math.max(1, right - axis), height: Math.max(1, bottom - top) } : { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, axis - top) }),
    })
  } else if (view.radioKHz != null && view.radioKHz >= lo && view.radioKHz <= hi) {
    const p = at(view.radioKHz)
    // The passband at least a few pixels wide, so a CW filter on a whole band still shows.
    const [q, r] = view.passband ? view.passband.map(hz => at(view.radioKHz! + hz / 1000)).sort((a, b) => a - b) : [p, p]
    const pad = Math.max(0, (3 - (r - q)) / 2)
    const band = view.passband ? (vertical
      ? `<rect x="${axis}" y="${q - pad}" width="${Math.max(0, right - axis)}" height="${r - q + pad * 2}" fill="#d6eef4" fill-opacity=".25"/>`
      : `<rect x="${q - pad}" y="${top}" width="${r - q + pad * 2}" height="${Math.max(0, axis - top)}" fill="#d6eef4" fill-opacity=".25"/>`) : ''
    piece('radio', vertical ? [axis - 12, Math.min(p - 7, q - pad), right, Math.max(p + 7, r + pad)] : [Math.min(p - 7, q - pad), top, Math.max(p + 7, r + pad), axis + 12], band + (vertical
      ? `<path d="M${axis - 10} ${p}H${right}" stroke="${tuned.line}" stroke-width="${tuned.width}"/><path d="M${axis - 12} ${p - 7}L${axis} ${p}L${axis - 12} ${p + 7}Z" fill="${tuned.line}"/>`
      : `<path d="M${p} ${top}V${axis + 10}" stroke="${tuned.line}" stroke-width="${tuned.width}"/><path d="M${p - 7} ${axis + 12}L${p} ${axis}L${p + 7} ${axis + 12}Z" fill="${tuned.line}"/>`))
  }

  const ink = (s: MapSpot) => (s.notices ? c.primary : s.isSelf ? c.secondary : s.worked ? c.onSurfaceVariant : c.onSurface)
  // Age shows only as fading: fresh at full strength, the oldest asked for at `faintest`.
  const faintest = 0.35
  const fade = (s: MapSpot) => 1 - (1 - faintest) * Math.min(1, s.ageMinutes / view.maxAgeMinutes)
  // A label: the spot's icon, its call, and its note's emoji where it has one.
  // The text in the top `textHeight` of the box, with room left under it.
  const iconSize = 13, emojiWidth = 16, labelHeight = row - 2, textHeight = labelHeight - 2
  const callWidth = (s: MapSpot) => s.call.length * advance(callSize)
  const pillWidth = (s: MapSpot) => 3 + iconSize + 3 + callWidth(s) + (s.emoji ? 2 + emojiWidth : 0) + 6
  const ranked = [...view.spots].sort(byRank).slice(0, mostSpots(scaleLayers))

  // Where each spot shown goes: its point on the line, its label centred on it, and the leader between them.
  type Shown = { s: MapSpot; p: number; x: number; y: number; w: number; leader: string; reach: number[] }
  const shown: Shown[] = []
  if (vertical) {
    // Columns beside the line: as few as keep every label within `drift` of its point, and no more
    // than the width holds.
    // No calls at all where a column has no room for one, rather than boxes too narrow to draw.
    const x0 = axis + 22, gap = 16, drift = 2 * row
    const fits = right - x0 >= 48 ? Math.max(0, Math.floor((bottom - top) / row)) : 0
    const want = (s: MapSpot) => at(s.khz)
    const columnWidth = Math.max(0, ...ranked.slice(0, fits * 3).map(pillWidth))
    const most = Math.max(1, Math.min(3, Math.floor((right - x0 + gap) / (columnWidth + gap))))
    let chosen: MapSpot[] = [], tops: { column: number; top: number }[] = []
    for (let count = 1; count <= most; count++) {
      chosen = ranked.slice(0, fits * count).sort((a, b) => want(a) - want(b))
      const newest = chosen.map((_, i) => i).sort((a, b) => byAge(chosen[a], chosen[b]))
      tops = columns(chosen.map(want), count, row, top, bottom, newest)
      if (tops.every(({ top: y }, i) => Math.abs(y + row / 2 - want(chosen[i])) <= drift)) break
    }
    chosen.forEach((s, i) => {
      const p = at(s.khz), x = x0 + tops[i].column * (columnWidth + gap), y = tops[i].top, w = Math.min(right - x, pillWidth(s))
      const meet = y + labelHeight / 2
      shown.push({ s, p, x, y, w, leader: `M${axis} ${p}C${axis + 11} ${p} ${x - 11} ${meet} ${x} ${meet}`, reach: [axis - 5, Math.min(p, meet) - 5, x + 1, Math.max(p, meet) + 5] })
    })
  } else {
    // Lanes above the line, the newest spots taking the nearest, each label centred on its point.
    const count = Math.max(0, Math.floor((axis - 6 - top) / row))
    const nearest = [...ranked].sort(byAge)
    const spans = nearest.map(s => {
      const w = pillWidth(s), p = at(s.khz)
      // In a pane narrower than the label, from its start: the call's first letters are what read.
      const start = Math.max(left, Math.min(p - w / 2, right - w))
      return [start, start + w] as [number, number]
    })
    lanes(spans, count, 4).forEach((lane, i) => {
      if (lane == null) return
      const s = nearest[i], p = at(s.khz), y = axis - 6 - (lane + 1) * row, [x, end] = spans[i]
      shown.push({ s, p, x, y, w: end - x, leader: `M${p} ${axis}V${y + labelHeight}`, reach: [p - 5, y + labelHeight - 1, p + 5, axis + 5] })
    })
  }
  const hidden = view.spots.length - shown.length

  // Under the pointer — its label, or its point on the scale — a spot's line, dot and label light up
  // together: the host sets `hot` to the spot's number, and each lit layer shows only at its own.
  values.hot = -1
  const lit = (i: number, rest: number) => ({ value: 'hot', input: [i - 1, i + 1] as [number, number], output: [rest, rest] as [number, number], samples: [rest, 1, rest] })
  const dot = (s: MapSpot, p: number, r: number) => (vertical ? `<circle cx="${axis}" cy="${p}" r="${r}" fill="${ink(s)}"/>` : `<circle cx="${p}" cy="${axis}" r="${r}" fill="${ink(s)}"/>`)
  const strike = ({ s, x, y }: Shown) =>
    s.worked ? `<path d="M${x + 3 + iconSize + 2} ${y + textHeight / 2}h${callWidth(s) + 2}" stroke="${c.onSurfaceVariant}" stroke-width="1"/>` : ''
  const fill = view.scope ? c.surface : c.surfaceContainer, fillOpacity = view.scope ? 0.82 : 1
  // Leaders first, so a nearer label covers those passing behind it.
  shown.forEach(({ s, p, leader, reach }, i) => {
    piece(`spot-${i}-line`, reach, `<path d="${leader}" fill="none" stroke="${ink(s)}" stroke-opacity=".6" stroke-width="1"/>${dot(s, p, 2.5)}`, { opacity: lit(i, fade(s)) })
  })
  shown.forEach((spot, i) => {
    const { s, x, y, w } = spot
    piece(`spot-${i}-box`, [x, y, x + w, y + labelHeight], `<g opacity="${fade(s).toFixed(2)}"><rect x="${x}" y="${y}" width="${w}" height="${labelHeight}" rx="3" fill="${fill}" fill-opacity="${fillOpacity}"/>${strike(spot)}</g>`)
  })
  shown.forEach((spot, i) => {
    const { s, p, x, y, w, leader, reach } = spot
    const box = [Math.min(reach[0], x), Math.min(reach[1], y), Math.max(reach[2], x + w), Math.max(reach[3], y + labelHeight)]
    piece(`lit-${i}`, [box[0] - 2, box[1] - 2, box[2] + 2, box[3] + 2], `<path d="${leader}" fill="none" stroke="${ink(s)}" stroke-width="2.5"/>${dot(s, p, 4.5)}` +
      `<rect x="${x}" y="${y}" width="${w}" height="${labelHeight}" rx="3" fill="${c.surface}"/>` +
      `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${labelHeight - 1}" rx="3" fill="none" stroke="${ink(s)}" stroke-width="1"/>${strike(spot)}`, { opacity: lit(i, 0) })
  })
  shown.forEach(({ s, x, y, w }, i) => {
    // Text colours take no alpha, so each part fades through its layer's opacity: by age, and full when lit.
    // The call's box runs to the label's end, so a guess short of the real advance never cuts it off.
    layers.push({ id: `spot-${i}-icon`, x: x + 3, y: y + (textHeight - iconSize) / 2 + 2, width: iconSize, height: iconSize, icon: { name: s.icon, color: s.iconColor ?? ink(s) }, opacity: lit(i, fade(s)) })
    text(`spot-${i}-call`, x + 3 + iconSize + 3, y, Math.max(1, w - (3 + iconSize + 3) - 2), textHeight, s.call, callSize, ink(s), { fontFamily: mono, fontWeight: 700 })
    layers[layers.length - 1].opacity = lit(i, fade(s))
    if (s.emoji) {
      text(`spot-${i}-emoji`, x + w - 6 - emojiWidth, y, emojiWidth + 4, textHeight, s.emoji, callSize - 1, ink(s), { align: 'center' })
      layers[layers.length - 1].opacity = lit(i, fade(s))
    }
  })

  // A label tunes to its spot; so does the line at its dot, shared with its neighbours halfway — the
  // line and dots only, so the scale's frequencies beside them select nothing.
  // Ids name the station, not its place in the list, which every new spot shifts: a click on the
  // picture painted before a render must still reach the spot it showed. A map holds one spot a call.
  const hover = (i: number) => ({ hoverSet: { value: 'hot', to: i } })
  shown.forEach(({ s, x, y, w }, i) => {
    controls.push({ id: `spot:${s.call}`, label: t.tune(s.call, mhz(s.khz)), kind: 'button', x, y, width: w, height: labelHeight, event: 'spot', ...hover(i) })
    placed.push({ id: `spot:${s.call}`, spot: s })
  })
  const byPoint = shown.map((spot, i) => ({ ...spot, i })).sort((a, b) => a.p - b.p)
  byPoint.forEach(({ s, p, i }, k) => {
    const from = Math.max(p - 10, k ? (byPoint[k - 1].p + p) / 2 : -Infinity), to = Math.min(p + 10, k < byPoint.length - 1 ? (p + byPoint[k + 1].p) / 2 : Infinity)
    if (to - from < 1) return
    const rect = vertical ? { x: axis - 8, y: from, width: 16, height: to - from } : { x: from, y: axis - 8, width: to - from, height: 16 }
    controls.push({ id: `scale:${s.call}`, label: t.tune(s.call, mhz(s.khz)), kind: 'button', ...rect, event: 'spot', ...hover(i) })
    placed.push({ id: `scale:${s.call}`, spot: s })
  })
  // Zoom, in the top right corner over everything else; a way it cannot go is shown faint and does nothing.
  const button = 26, buttonGap = 4, buttonsWidth = button * 2 + buttonGap
  const zoomArt = ([['out', 'M8 13h10'], ['in', 'M8 13h10M13 8v10']] as const).map(([way, glyph], k) => {
    const x = paneRight - buttonsWidth + k * (button + buttonGap), on = view.zoom[way]
    controls.push({ id: `zoom-${way}`, label: way === 'in' ? t.zoomIn : t.zoomOut, kind: 'button', x, y: top, width: button, height: button, event: `zoom-${way}`, disabled: !on, fixed: true })
    return `<g transform="translate(${x} ${top})" opacity="${on ? 1 : 0.35}"><circle cx="13" cy="13" r="12" fill="${c.surfaceContainer}" stroke="${c.outline}"/><path d="${glyph}" stroke="${c.onSurface}" stroke-width="2" stroke-linecap="round"/></g>`
  })
  if (hidden) {
    text('more', paneRight - buttonsWidth - 8 - 80, top + (button - 16) / 2, 80, 16, t.more(hidden), scaleSize, c.onSurfaceVariant, { align: 'end' })
    layers[layers.length - 1].fixed = true
  }

  // A lit spot's frequency, white on a black pill on the scale where its dot meets it. One readout
  // serves every spot: `hot` picks its text and moves it there, with no render between.
  if (shown.length) {
    const hzDigits = hzDigitsNeeded(shown.map(({ s }) => s.khz))
    const all = shown.map(({ s }) => freqParts(s.khz, hzDigits, view.marks))
    const widest = all.map(parts => readingWidths(parts, scaleSize)).reduce((a, b) => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])] as const)
    const pw = widest[0] + widest[1] + widest[2] + 12, ph = 16
    const at0 = shown.map(({ p }) => (vertical ? p - ph / 2 : p - pw / 2))
    // Samples run one past the last spot, so a lone spot still has a range to bind over.
    const follow = { value: 'hot', input: [0, shown.length] as [number, number], output: [0, 0] as [number, number], samples: [...at0, at0[at0.length - 1]] }
    const move = vertical ? { translateY: follow } : { translateX: follow }
    // Its end over the lit dot, as though the dot carried it.
    const [ox, oy] = vertical ? [axis + 3 - pw, 0] : [0, axis - 3]
    const shownOnly = { value: 'hot', input: [-1, 0] as [number, number], output: [0, 1] as [number, number] }
    layers.push({ id: 'readout', x: ox, y: oy, width: pw, height: ph, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pw} ${ph}"><rect width="${pw}" height="${ph}" rx="${ph / 2}" fill="#000000"/></svg>`, opacity: shownOnly, ...move })
    let x = ox + 6
    widest.forEach((w, k) => {
      const key = (['mhz', 'khz', 'hz'] as const)[k]
      if (!w) return
      const small = key === 'hz'
      layers.push({
        id: `readout-${key}`, x, y: oy + (small ? hzLift(scaleSize) : 0), width: w + 1, height: ph, opacity: shownOnly, ...move,
        text: { value: 'hot', samples: all.map(parts => parts[key] ?? ''), size: small ? hzSize(scaleSize) : scaleSize, color: '#ffffff', fontFamily: mono, fontWeight: key === 'mhz' ? 700 : small ? 300 : 400, lineHeight: small ? hzLine : 1.2, align: key === 'mhz' ? 'end' : 'start' },
      })
      x += w
    })
  }

  layers.push({ id: 'zoom', x: 0, y: 0, width: paneWidth, height: paneHeight, fixed: true, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${paneWidth} ${paneHeight}">${zoomArt.join('')}</svg>` })

  // Where the scrolled view stands: where it was left, or centred on the radio, moved just enough
  // to keep a radio that has retuned within the pane's middle 20–80%.
  let offset: number | undefined, centerKHz: number | undefined
  if (view.scroll) {
    const pane = vertical ? paneHeight : paneWidth, end = Math.max(0, (vertical ? height : width) - pane)
    const radio = view.radioKHz != null && view.radioKHz >= lo && view.radioKHz <= hi ? at(view.radioKHz) : undefined
    if (view.scroll.centerOn != null) offset = at(view.scroll.centerOn) - pane / 2
    else {
      offset = view.scroll.offset ?? (radio ?? (vertical ? height : width) / 2) - pane / 2
      if (radio != null && view.scroll.follow) offset = Math.min(Math.max(offset, radio - 0.8 * pane), radio - 0.2 * pane)
    }
    offset = Math.min(Math.max(offset, 0), end)
    values.scroll = offset
    centerKHz = lo + ((offset + pane / 2 - a0) / (a1 - a0)) * (hi - lo)
    // Dragging along the scale zooms about the pane's middle; a tap on it still tunes.
    const strip = vertical ? { x: 0, y: 0, width: axis + 8, height } : { x: 0, y: axis - 8, width, height: height - (axis - 8) }
    // None where there is no zoom to drag to: the host refuses a strip whose range is a single factor.
    if (view.scroll.stretch.max > view.scroll.stretch.min) {
      controls.push({ id: 'stretch', label: t.zoomIn, kind: 'zoom', event: 'stretch', min: view.scroll.stretch.min, max: view.scroll.stretch.max, ...strip })
    }
  }
  const scroll = view.scroll ? { scroll: { axis: vertical ? ('y' as const) : ('x' as const), value: 'scroll', event: 'scrolled' } } : {}
  return { scene: { version: 1, width, height, values, layers, controls, ...scroll }, placed, offset, centerKHz }
}

export function createBandMap(host: BandMapHost): PanelHook {
  /** What each placement's last render drew, so an event knows what it acts on. */
  const placements = new Map<string, { placed: Placed[]; scoped: boolean; zoom: MapView['zoom']; operationUuid?: string }>()
  /**
   * Each placement's zoom, as a multiple of the band across the pane; where its view stood and the
   * frequency in its middle at the last render, and where the radio was then; for the render after a
   * zoom, the frequency to keep in the middle; and the band and pane the view was drawn for.
   */
  const views = new Map<string, { factor: number; offset?: number; center?: number; radioKHz?: number; recenter?: number; frame?: string }>()
  const viewOf = (key: string) => {
    if (!views.has(key)) views.set(key, { factor: 1 })
    if (views.size > 64) views.delete(views.keys().next().value!)
    return views.get(key)!
  }
  return {
    async getPanels(_args, ctx) {
      const t = words(ctx.locale)
      return [{
        key: 'band-map', title: t.title, description: t.description, icon: 'map-marker-radius', multiple: true, on: ['spots', 'tick:1'],
        form: [
          { type: 'field', fieldType: 'select', key: 'band', label: t.band, value: 'auto', options: [{ value: 'auto', label: t.auto }, ...bands.map(b => ({ value: b, label: b }))] },
          { type: 'field', fieldType: 'select', key: 'age', label: t.age, value: '30', options: ages.map(n => ({ value: String(n), label: t.minutes(n) })) },
          { type: 'field', fieldType: 'select', key: 'panadapter', label: t.panadapter, value: 'on', options: [{ value: 'on', label: t.on }, { value: 'off', label: t.off }] },
        ],
      }]
    },
    async render(args, ctx: HookContext) {
      const t = words(args.environment?.locale ?? ctx.locale)
      if (!args.environment || !args.clock) return { kind: 'markdown', content: t.unavailable }
      const key = args.instanceId ?? 'default'
      const radio = await host.readRadio()
      const radioKHz = radio?.frequencyHz ? radio.frequencyHz / 1000 : undefined
      const configured = typeof args.config.band === 'string' && args.config.band in bandEdges ? args.config.band : undefined
      const band = configured ?? bandForKHz(radioKHz) ?? '20m'
      // The scope's window, where it is on this band and placed where the map can follow it.
      const sp = radio?.spectrum
      let window: [number, number] = bandEdges[band]
      let scope: MapView['scope']
      if (args.config.panadapter !== 'off' && radio?.id && sp && !sp.problem && radioKHz != null && bandForKHz(radioKHz) === band) {
        const scoped: [number, number] | undefined = sp.mode === 'fixed' && sp.lowHz != null && sp.highHz != null ? [sp.lowHz / 1000, sp.highHz / 1000]
          : sp.mode === 'center' && sp.spanHz ? [radioKHz - sp.spanHz / 1000, radioKHz + sp.spanHz / 1000]
          : undefined
        if (scoped) [window, scope] = [scoped, { radio: radio.id }]
      }
      // Over the panadapter the map zooms the radio's scope, so the picture and the line stay one
      // window; elsewhere it halves the band about the radio, kept inside the band.
      let zoom: MapView['zoom'], scroll: MapView['scroll']
      if (scope) {
        const span = sp!.spanHz
        zoom = sp!.mode === 'center' && span != null ? { in: sp!.spansHz.some(s => s < span), out: sp!.spansHz.some(s => s > span) } : { in: false, out: false }
      } else {
        // The whole band at a multiple of the pane's length, which the app scrolls.
        const v = viewOf(key), [lo, hi] = bandEdges[band], pane = Math.max(args.environment.width, args.environment.height)
        // The offset is in scene units, which a resized or turned pane lays out anew: there the view
        // keeps the frequency in its middle instead. On another band nothing of the old view applies.
        const frame = `${band} ${args.environment.width}x${args.environment.height}`
        if (v.frame != null && v.frame !== frame) {
          Object.assign(v, v.frame.startsWith(`${band} `) ? { recenter: v.recenter ?? v.center } : { offset: undefined, center: undefined, recenter: undefined })
        }
        v.frame = frame
        const most = Math.max(1, Math.min(deepest, (hi - lo) / narrowest, longest / pane))
        const factor = (v.factor = Math.min(Math.max(v.factor, 1), most))
        zoom = { in: factor < most * 0.999, out: factor > 1.001 }
        scroll = { factor, offset: v.offset, follow: v.offset == null || v.radioKHz !== radioKHz, centerOn: v.recenter, stretch: { min: 1 / factor, max: most / factor } }
      }
      const maxAgeMinutes = ages.includes(Number(args.config.age)) ? Number(args.config.age) : 30
      const board = (await ctx.getSpots?.({ filter: 'all', band, maxAgeMinutes })) ?? []
      const passband: [number, number] | undefined = radio?.passband ? [radio.passband.lowHz, radio.passband.highHz] : passbands[radio?.mode ?? '']
      const marks = { group: ctx.groupingSeparator ?? ',', decimal: ctx.decimalSeparator ?? '.' }
      const view: MapView = { band, window, passband, spots: mapSpots(board, args.clock.nowMillis, window), maxAgeMinutes, radioKHz, scope, marks, zoom, scroll }
      const { scene, placed, offset, centerKHz } = bandMapScene(args.environment, view, t)
      if (scroll) Object.assign(viewOf(key), { offset, center: centerKHz, radioKHz, recenter: undefined })
      placements.set(key, { placed, scoped: !!scope, zoom, operationUuid: typeof args.operation.uuid === 'string' ? args.operation.uuid : undefined })
      if (placements.size > 64) placements.delete(placements.keys().next().value!)
      // An API 12 scene, which the published SDK's `PanelScene` does not describe yet (sdkGap.ts).
      return { kind: 'scene', title: t.mapTitle(band), scene: scene as unknown as PanelScene }
    },
    async onEvent(args) {
      const { event } = args
      const t = words(args.environment?.locale)
      // A command the radio refused leaves the click undone: an error the host reports, not a success.
      const refusedBy = (result: PanelRadioResult) => {
        if (!result.accepted) throw new Error(t.refused(result.reason))
      }
      const key = args.instanceId ?? 'default', drawn = placements.get(key)
      // The operator's scroll, come to rest: where the view stays until the radio moves or the zoom changes.
      if (event.action === 'scrolled' && typeof event.value === 'number') {
        viewOf(key).offset = event.value
        return { values: {} }
      }
      // A zoom keeps the frequency in the view's middle where it is: twice or half for a button, the
      // drag's own factor along the scale. The next render clamps it to what the band allows.
      if (event.action === 'stretch' && typeof event.value === 'number') {
        // From a picture drawn before the panadapter came on: the scope's zoom is its buttons'.
        if (drawn?.scoped) return { values: {} }
        const v = viewOf(key)
        Object.assign(v, { factor: v.factor * event.value, recenter: v.center })
        return { values: {} }
      }
      // Only the ways the last render offered: a click can land after the limit moved.
      if ((event.action === 'zoom-in' && !drawn?.zoom.in) || (event.action === 'zoom-out' && !drawn?.zoom.out)) return { values: {} }
      if ((event.action === 'zoom-in' || event.action === 'zoom-out') && !drawn?.scoped) {
        const v = viewOf(key)
        Object.assign(v, { factor: event.action === 'zoom-in' ? v.factor * 2 : v.factor / 2, recenter: v.center })
        return { values: {} }
      }
      // As a Spots Panel tap: the station into this operation's logging fields, which move the radio
      // there too. With no such operation open, the radio alone.
      if (event.action === 'spot') {
        const spot = drawn?.placed.find(p => p.id === event.controlId)?.spot
        if (!spot) return { values: {} }
        const qso = { their: { call: spot.call }, freq: spot.khz, band: spot.band, mode: spot.mode, refs: spot.refs }
        // Not accepted is no such operation open; a refusal throws, and is the host's to report.
        const { accepted } = await host.suggestQso({ qso, operationUuid: drawn?.operationUuid })
        const radio = accepted ? null : await host.readRadio()
        if (radio?.id) {
          const mode = radioModeFor(spot.mode, spot.khz, radio.modes ?? [])
          refusedBy(await host.setRadio({ id: radio.id, frequencyHz: Math.round(spot.khz * 1000), ...(mode && mode !== radio.mode ? { mode } : {}) }))
        }
        return { values: {} }
      }
      const radio = await host.readRadio()
      if (!radio?.id) return { values: {} }
      if (event.action === 'zoom-in' || event.action === 'zoom-out') {
        const span = radio.spectrum?.spanHz, spans = [...(radio.spectrum?.spansHz ?? [])].sort((a, b) => a - b)
        const next = span == null ? undefined : event.action === 'zoom-in' ? spans.filter(s => s < span).pop() : spans.find(s => s > span)
        if (next != null) refusedBy(await host.setRadioSpectrum({ id: radio.id, spanHz: next }))
        return { values: {} }
      }
      if (event.action === 'tune' && typeof event.value === 'number') {
        refusedBy(await host.setRadio({ id: radio.id, frequencyHz: Math.round(event.value) }))
        return { values: {} }
      }
      // A control this map does not draw: a dead one would say nothing of why.
      throw new Error(t.unknown(event.action))
    },
  }
}
