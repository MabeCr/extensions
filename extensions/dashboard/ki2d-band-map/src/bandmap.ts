// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MPL-2.0
//
// The spots on one band, along a line of its frequencies: vertical in a tall panel (rising top to
// bottom, as a band plan reads down the page; its scale on the right, the calls to its left),
// horizontal in a wide one (its scale along the top, the calls under it). Where the radio's scope is
// on the band shown, the host draws it over the stretch of the line it covers, however the map is
// zoomed: its waterfall behind the calls, flowing away from the line, and its panadapter under the
// scale's labels. Inverted, the scale and the scope go to the other side.
import { entityForCall, entityPrefixForCall, regionAndCountryForDxccCode } from '@ham2k/extension-sdk'
import type { BoardSpot, HookContext, PanelEnvironment, PanelHook, PanelRadioResult, PanelRadioSet, PanelRadioState, PanelScene, PanelSceneControl as Control, PanelSceneLayer as Layer, SuggestedQso } from '@ham2k/extension-sdk'
import { bandEdges, bandForKHz, bandPlan, bands, modeStretch, planAllows, plannedMode, radioModeFor, spotPassband, superModeForRadio } from './bands.ts'
import type { SuperMode } from '@ham2k/lib-operation-data'
import { freqParts, hzDigitsNeeded, type FreqParts } from './frequency.ts'
import { columns, lanes, stack, tickStep } from './layout.ts'
import { markerLabelsEs, markersFor, type BandMarker } from './markers.ts'

type BandMapHost = {
  readRadio(id?: string): Promise<PanelRadioState | null>
  setRadio(args: PanelRadioSet): Promise<PanelRadioResult>
  /** The spot's station into the panel's operation's logging fields, as a Spots Panel tap. */
  suggestQso(args: { qso: SuggestedQso; operationUuid?: string }): Promise<{ accepted: boolean }>
}

const en = {
  title: 'KI2D’s Band Map', description: 'The spots on a band, along its frequencies',
  band: 'Band', auto: 'Automatic (the radio’s band)', age: 'Spots no older than', minutes: (n: number) => `${n} minutes`,
  waterfall: 'Radio waterfall', panadapter: 'Radio panadapter', direction: 'Scope direction', normal: 'Normal', inverted: 'Inverted',
  mapTitle: (band: string) => `${band} Band Map`, unavailable: 'This app cannot show the band map', more: (n: number) => `+${n} more`,
  tune: (call: string, mhz: string) => `Tune to ${call} on ${mhz} MHz`, tuneHere: 'Tune to this frequency', scope: 'Panadapter',
  zoomIn: 'Zoom in', zoomOut: 'Zoom out', zoomTo: { band: 'The whole band', segment: 'This mode’s segment', radio: 'Around the radio' },
  marker: (label: string) => label,
  refused: (reason?: string) => `The radio did not take it${reason ? ` (${reason})` : ''}`, unknown: (action: string) => `The band map has no action “${action}”`,
}
const es: typeof en = {
  title: 'Mapa de banda de KI2D', description: 'Los spots de una banda, a lo largo de sus frecuencias',
  band: 'Banda', auto: 'Automática (la banda de la radio)', age: 'Spots de hasta', minutes: (n: number) => `${n} minutos`,
  waterfall: 'Cascada de la radio', panadapter: 'Panorámico de la radio', direction: 'Dirección del panorámico', normal: 'Normal', inverted: 'Invertida',
  mapTitle: (band: string) => `Mapa de ${band}`, unavailable: 'Esta app no puede mostrar el mapa de banda', more: (n: number) => `+${n} más`,
  tune: (call: string, mhz: string) => `Sintonizar ${call} en ${mhz} MHz`, tuneHere: 'Sintonizar esta frecuencia', scope: 'Panorámico',
  zoomIn: 'Acercar', zoomOut: 'Alejar', zoomTo: { band: 'La banda entera', segment: 'El segmento de este modo', radio: 'Alrededor de la radio' },
  marker: (label: string) => markerLabelsEs[label] ?? label,
  refused: (reason?: string) => `La radio no lo aceptó${reason ? ` (${reason})` : ''}`, unknown: (action: string) => `El mapa de banda no tiene la acción “${action}”`,
}
const words = (locale?: string) => (locale?.startsWith('es') ? es : en)

/**
 * The tuned frequency and the passband in KI2D's Radio Panel's colours, so the two panels read as one;
 * on a light surface a deeper cyan, which a pale one on white loses.
 */
const tuned = { line: '#a3e6f2', lineLight: '#0a7f96', width: 3, passbandWaterfall: '#26ffffff', passbandWaterfallLight: '#1f0b5f73' }
/** The waterfall's stops above the map's surface, quietest first: a slate that deepens on white, and lightens on black. */
const waterfall = {
  light: ['#eef2f5', '#c9d4de', '#8fa3b5', '#56697b', '#2e3d4b'],
  dark: ['#161d24', '#243341', '#3e5568', '#7b93a8', '#c3d2de'],
}
/** The panadapter's trace under the scale's labels, in the waterfall's slate, quiet enough to read them over. */
const trace = { light: '#8fa3b5', lightFill: '#338fa3b5', dark: '#56697b', darkFill: '#4056697b' }
/** The filter by mode, for a radio that does not report its own: as KI2D's Radio Panel assumes. */
const passbands: Record<string, [number, number]> = {
  USB: [100, 2800], LSB: [-2800, -100], CW: [-250, 250], AM: [-3000, 3000], FM: [-5000, 5000],
  'DATA-USB': [0, 3000], 'DATA-LSB': [-3000, 0], RTTY: [-250, 250],
}
const ages = [10, 30, 60]
/**
 * Zoomed in to no less than `narrowest` kHz across the pane. A scene is at most `longest` units
 * long, so past that it holds a window of the band rather than all of it.
 */
const narrowest = 2, longest = 8192

/** A spot as the map shows it: one per station, its newest report. */
export type MapSpot = {
  call: string; khz: number; band?: string; mode?: string; refs: { type: string; ref: string }[]; ageMinutes: number; worked: boolean; isSelf: boolean; notices: number
  /** For a spot that names no mode, the band plan's guess: what its passband shows and the radio tunes to, but not what is logged. */
  planned?: string
  /**
   * What the Spots Panel shows beside the call. No icon for a cluster spot but one a reference gives
   * it: the tower there is only the board's stand-in for a source with none.
   */
  icon?: string; iconColor?: string; emoji?: string
}


/**
 * One spot a station, from the board's reports of it, newest first and each source's apart: where
 * and when from the newest, its refs from them all — a cluster spot after a POTA one still knows
 * the park — and a mode from another report on the same frequency where the newest names none.
 * Only where the newest is within [lo, hi]: an older report there is not where the station is now.
 */
export function mapSpots(board: BoardSpot[], nowMillis: number, [lo, hi]: [number, number]): MapSpot[] {
  const reports = new Map<string, BoardSpot[]>()
  for (const s of board) {
    const call = s.their.call.toUpperCase()
    if (s.freq == null) continue
    reports.set(call, [...(reports.get(call) ?? []), s])
  }
  const spots: MapSpot[] = []
  for (const [call, [s, ...older]] of reports) {
    if (s.freq! < lo || s.freq! > hi) continue
    const refs = new Map<string, NonNullable<BoardSpot['refs']>[number]>()
    for (const r of [s, ...older].flatMap(o => o.refs ?? [])) if (!refs.has(`${r.type}:${r.ref}`)) refs.set(`${r.type}:${r.ref}`, r)
    const mode = s.mode ?? older.find(o => o.mode && Math.abs(o.freq! - s.freq!) <= 1)?.mode
    // Drawn as the newest report that names a reference: a park's tree, not the cluster's tower.
    const shown = [s, ...older].find(o => o.refs?.length) ?? s
    const icon = shown.spot.source === 'cluster' && !shown.refs?.length ? undefined : shown.display?.icon ?? shown.icon ?? 'radio-tower'
    spots.push({
      call, khz: s.freq!, band: s.band, mode, planned: mode ? undefined : plannedMode(call, s.freq!), refs: [...refs.values()], ageMinutes: Math.max(0, Math.round((nowMillis - s.spot.timeInMillis) / 60000)),
      worked: s.annotations?.worked ?? false, isSelf: s.annotations?.isSelf ?? false, notices: s.annotations?.notices.length ?? 0,
      icon, iconColor: shown.display?.iconColor, emoji: shown.display?.emoji,
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

/**
 * The views the reset button steps through, in turn: the whole band, the band
 * plan's stretch for the radio's mode, and the radio with 50 kHz around it on phone, 10 on CW and data.
 */
export type Preset = 'band' | 'segment' | 'radio'
const presets: Preset[] = ['band', 'segment', 'radio']
/** The one after `current` among those `offered`, round again; from none, the first. False where that is where it already is. */
const nextPreset = (offered: Preset[], current: Preset | undefined): Preset | false => {
  const next = offered[(offered.indexOf(current as Preset) + 1) % offered.length]
  return next && next !== current ? next : false
}
/** Where the reset button goes: a zoom and the kHz to centre on. */
type ResetTo = { preset: Preset; factor: number; center: number }

/** What a render placed, so a click on a label knows where to tune. */
export type Placed = { id: string; spot: MapSpot }

export type MapView = {
  band: string
  /** The kHz the line runs between: the band's edges, or the stretch of them a long scene holds. */
  window: [number, number]
  spots: MapSpot[]
  /** The band plan's places worth marking, for the operator's station. */
  markers?: BandMarker[]
  /** The age at which a spot is shown faintest: the oldest the map asks for. */
  maxAgeMinutes: number
  radioKHz?: number
  /** The receive filter's edges in Hz from the tuned frequency. */
  passband?: [number, number]
  /** The band plan: where its modes change, and the stretches not meant for the radio's mode. */
  plan?: { edges: number[]; off: [number, number][] }
  /** The radio's kind of mode, while it is on this band: spots of another kind are shown fainter. */
  superMode?: SuperMode
  /** A radio to tune: the scale is clicked to tune it, and with none it is only drawn. */
  tunable?: boolean
  /**
   * Present when the host draws the radio's scope on the map, over `range` (kHz, the sweep's edges):
   * its waterfall behind the calls, its panadapter under the scale's labels, or both.
   */
  scope?: { radio: string; waterfall: boolean; pan: boolean; range: [number, number] }
  /** The scale and the scope on the other side: the line's left in a tall map, along the bottom of a wide one. */
  inverted?: boolean
  /** The operator's own thousands and decimal marks. */
  marks: { group: string; decimal: string }
  /** Which ways the map can zoom from here; `reset`, the preset view its button goes to next, if any. */
  zoom: { in: boolean; out: boolean; reset: Preset | false }
  /**
   * The window drawn `factor` times the pane's length, scrolled by the app.
   * `offset` is where the view was left, in scene units, or none to centre on the radio; with
   * `follow`, the radio has moved since, and the view moves just enough to keep it in its middle
   * 20–80%. With `centerOn` (kHz), a zoom has just changed, and the view keeps that frequency in
   * its middle. `stretch` is how far a drag on the scale may zoom from here.
   */
  scroll?: { factor: number; offset?: number; follow: boolean; centerOn?: number; stretch: { min: number; max: number } }
}

export function bandMapScene(
  e: PanelEnvironment,
  view: MapView,
  t: typeof en,
): { scene: PanelScene; placed: Placed[]; offset?: number; centerKHz?: number; centerAt?: (offset: number) => number; tuneAt: (along: number) => number } {
  const c = e.colors
  const paneWidth = Math.max(1, Math.min(8192, e.width)), paneHeight = Math.max(1, Math.min(8192, e.height))
  const vertical = paneHeight > paneWidth
  // Scrolling, the band runs on past the pane along the line; the zoom buttons stay on the pane.
  const factor = view.scroll?.factor ?? 1
  const width = vertical ? paneWidth : Math.min(8192, Math.round(paneWidth * factor)), height = vertical ? Math.min(8192, Math.round(paneHeight * factor)) : paneHeight
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

  // The line: along the panel's longer side, frequency rising to the right or down the page — as
  // the app turns the panadapter behind it, too. With `side` −1 the scale is past the line's right
  // or lower edge and the calls before it; +1 swaps them. Upright, the scale is on the right; wide,
  // along the top — so the waterfall flows left or down, out from the panadapter under the labels.
  // The field, between the line and the calls' edge, is where the spots and the waterfall go.
  const side: -1 | 1 = (vertical ? -1 : 1) * (view.inverted ? -1 : 1) as -1 | 1
  const axis = vertical ? (side < 0 ? right - 58 : left + 58) : side < 0 ? bottom - 18 : top + 18
  const [fieldLeft, fieldRight] = side < 0 ? [left, axis] : [axis, right]
  const [fieldTop, fieldBottom] = side < 0 ? [top, axis] : [axis, bottom]
  const [a0, a1] = vertical ? [top, bottom] : [left, right]
  const at = (khz: number) => a0 + ((khz - lo) / (hi - lo)) * (a1 - a0)
  const length = Math.abs(a1 - a0)
  // At most 80 labels on the scale, however long a zoomed band runs: each takes two layers, three with tenths.
  const step = tickStep(hi - lo, length, Math.max(vertical ? 30 : 64, length / 80))
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
  // The line.
  const line = [vertical ? `<path d="M${axis} ${top}V${bottom}" stroke="${c.outline}" stroke-width="2"/>` : `<path d="M${left} ${axis}H${right}" stroke="${c.outline}" stroke-width="2"/>`]
  piece('line', [0, 0, width, height], line.join(''), { stretch: true })
  // The band plan across the map: a line where its mode changes, and a veil over what the radio's mode is not meant for.
  if (view.plan) {
    const across = (p: number, q: number, body: string) =>
      vertical ? `<rect x="${fieldLeft}" y="${Math.min(p, q)}" width="${Math.max(0, fieldRight - fieldLeft)}" height="${Math.abs(q - p)}" ${body}/>`
        : `<rect x="${Math.min(p, q)}" y="${fieldTop}" width="${Math.abs(q - p)}" height="${Math.max(0, fieldBottom - fieldTop)}" ${body}/>`
    const plan = [
      ...view.plan.off.filter(([from, to]) => to > lo && from < hi).map(([from, to]) => across(at(Math.max(from, lo)), at(Math.min(to, hi)), `fill="${c.onSurface}" fill-opacity=".08"`)),
      ...view.plan.edges.filter(khz => khz > lo && khz < hi).map(khz => across(at(khz) - 0.5, at(khz) + 0.5, `fill="${c.outline}" fill-opacity=".7"`)),
    ]
    if (plan.length) piece('plan', [0, 0, width, height], plan.join(''), { stretch: true })
  }
  // The marks: one at each label, and finer ones between as many as stay 6 px apart — tenths with
  // the half longer, else fifths or quarters, else halves. All one piece, so they cost no layers.
  const pitch = (length * step) / (hi - lo), mantissa = Math.round(step / 10 ** Math.floor(Math.log10(step) + 1e-9) * 10) / 10
  const divisions = (mantissa === 2 ? [4, 2] : [10, 5, 2]).find(n => pitch / n >= 6) ?? 1
  const marks: string[][] = [[], []]
  // Counted in whole marks, so a tenth of a kHz adds up to no stray digits.
  for (let k = Math.ceil((lo / step) * divisions - 1e-6); (k / divisions) * step <= hi + 1e-9; k++) {
    // Out from the line's own edge, which would hide the shortest.
    const p = at((k / divisions) * step), long = k % divisions === 0 ? 5 : divisions % 2 === 0 && k % (divisions / 2) === 0 ? 3.5 : 2
    marks[long === 5 ? 0 : 1].push(vertical ? `M${axis - side * (1 + long)} ${p}H${axis}` : `M${p} ${axis}V${axis - side * (1 + long)}`)
  }
  piece('ticks', vertical ? [Math.min(axis, axis - side * 6), 0, Math.max(axis, axis - side * 6), height] : [0, Math.min(axis, axis - side * 6), width, Math.max(axis, axis - side * 6)],
    `<path d="${marks[0].join('')}" stroke="${c.outline}" stroke-width="1"/><path d="${marks[1].join('')}" stroke="${c.outline}" stroke-width="1" stroke-opacity=".6"/>`, { stretch: true })
  // The radio's frequency on the scale, under its labels: a pointer at the line, and the line it
  // draws across the field carried on to the pane's edge.
  const dark = e.brightness === 'dark', tunedLine = dark ? tuned.line : tuned.lineLight
  const vfo = view.radioKHz != null && view.radioKHz >= lo && view.radioKHz <= hi ? at(view.radioKHz) : undefined
  if (vfo != null) {
    const p = vfo, edge = vertical ? (side < 0 ? width : 0) : side < 0 ? height : 0, stroke = `stroke="${tunedLine}" stroke-width="${tuned.width}"`
    piece('vfo', vertical ? [Math.min(axis, edge), p - 7, Math.max(axis, edge), p + 7] : [p - 7, Math.min(axis, edge), p + 7, Math.max(axis, edge)], vertical
      ? `<path d="M${axis} ${p}H${edge}" ${stroke}/><path d="M${axis - side * 12} ${p - 7}L${axis} ${p}L${axis - side * 12} ${p + 7}Z" fill="${tunedLine}"/>`
      : `<path d="M${p} ${axis}V${edge}" ${stroke}/><path d="M${p - 7} ${axis - side * 12}L${p} ${axis}L${p + 7} ${axis - side * 12}Z" fill="${tunedLine}"/>`)
  }
  for (let k = Math.ceil(lo / step - 1e-9); k * step <= hi; k++) {
    const khz = Math.round(k * step * 1000) / 1000, p = at(khz), parts = freqParts(khz, step < 1 ? 1 : 0, view.marks)
    const w = readingWidths(parts, scaleSize).reduce((a, b) => a + b)
    if (vertical) reading(`tick-${khz}`, parts, side < 0 ? axis + 10 : axis - 10 - w, p - 8, 16, scaleSize, c.onSurfaceVariant)
    else if (p - w / 2 >= left - 4 && p + w / 2 <= right + 4) reading(`tick-${khz}`, parts, p - w / 2, side < 0 ? axis + 5 : axis - 19, 14, scaleSize, c.onSurfaceVariant)
  }

  // The band plan's markers: a dashed line from the scale across the field to the pane's far edge,
  // with its emoji there. The emoji keep a strip along the edge to themselves, so no spot's label sits
  // under one, and spread along it where they crowd; the line bends at the strip to meet its own.
  const markSize = 16, strip = 20, far = vertical ? (side < 0 ? left : right) : side < 0 ? top : bottom
  const markers = (view.markers ?? []).filter(m => m.khz >= lo && m.khz <= hi).map(m => ({ m, p: at(m.khz) })).sort((a, b) => a.p - b.p)
  const markTops = stack(markers.map(({ p }) => p), markSize, vertical ? top : left, vertical ? bottom : right)
  const markShown = markers.map(({ m, p }, i) => {
    const q = markTops[i] + markSize / 2, inner = far - side * markSize
    return vertical
      ? { m, p, q, icon: [Math.min(far, inner), markTops[i]], path: `M${axis} ${p}H${far - side * (strip + 2)}L${far - side * (markSize + 1)} ${q}`, reach: [Math.min(axis, inner), Math.min(p, q) - 1, Math.max(axis, inner), Math.max(p, q) + 1] }
      : { m, p, q, icon: [markTops[i], Math.min(far, inner)], path: `M${p} ${axis}V${far - side * (strip + 2)}L${q} ${far - side * (markSize + 1)}`, reach: [Math.min(p, q) - 1, Math.min(axis, inner), Math.max(p, q) + 1, Math.max(axis, inner)] }
  })
  // An edge — a boundary rather than a place — is a solid line, and heavier.
  const markStroke = (m: BandMarker) => (m.type === 'edge' ? 'stroke-width="2"' : 'stroke-width="1" stroke-dasharray="3 3"')
  markShown.forEach(({ m, path, reach }, i) => {
    piece(`mark-${i}-line`, reach, `<path d="${path}" fill="none" stroke="${c.outlineVariant}" ${markStroke(m)}/>`)
  })
  // Spots end short of the markers' strip.
  const markStrip = markShown.length ? strip : 0
  // Each marker takes four more layers further down: its emoji, and its lit line, label and emoji.
  const scaleLayers = layers.length + markShown.length * 4

  // The radio's scope, behind everything but the background: its waterfall a slow one across the
  // field, in muted slate rising out of the map's own surface, so the spots stay what the eye reads
  // first; its panadapter a quiet trace in the scale's strip, under the labels, peaking out from the
  // line. The waterfall's own tuned-frequency line marks the radio; on the scale, the map's own does.
  if (view.scope) {
    const { waterfall: falls, pan, range: [r0, r1] } = view.scope
    // Zoomed past the longest a control can be, the sweep's middle that long: the app crops it about its middle.
    let [s0, s1] = [at(r0), at(r1)].sort((a, b) => a - b)
    const cropped = s1 - s0 > longest
    // The width it shows, which is also what it asks of a scope the app sizes to its displays (a
    // FlexRadio's): all the map takes in, so it gets the widest — and never less than the sweep, which
    // a crop would draw stretched across the place the whole of it belongs. At most the 10 MHz the app takes.
    const span = Math.min(1e7, Math.floor(cropped ? ((r1 - r0) * 1000 * longest) / (s1 - s0) : Math.max(hi - lo, r1 - r0) * 1000))
    if (cropped) [s0, s1] = [(s0 + s1 - longest) / 2, (s0 + s1 + longest) / 2]
    // Frequency down the page or to the right, as the map's scale runs, whichever way the waterfall flows.
    const common = {
      kind: 'spectrum', radio: view.scope.radio, after: 'background', event: 'tune', span, scale: false, backgroundColor: c.surface,
      flow: vertical ? (side < 0 ? 'left' : 'right') : side < 0 ? 'up' : 'down', rising: vertical ? 'down' : 'right',
    } as const
    // Across the line where the sweep is: the field from the line to the calls' edge, or the scale's
    // strip from the line to the pane's.
    const place = (to: number) => {
      const [a, b] = [Math.min(axis, to), Math.max(axis, to)]
      return vertical ? { x: a, y: s0, width: Math.max(1, b - a), height: Math.max(1, s1 - s0) } : { x: s0, y: a, width: Math.max(1, s1 - s0), height: Math.max(1, b - a) }
    }
    if (falls) {
      controls.push({
        ...common, id: 'scope', label: t.scope, display: 'waterfall', waterfallSpeed: 5,
        waterfallColors: [c.surface, ...(dark ? waterfall.dark : waterfall.light)],
        center: { waterfall: { color: tunedLine, width: tuned.width } },
        overlays: view.passband ? [{ from: view.passband[0], to: view.passband[1], waterfall: { fill: dark ? tuned.passbandWaterfall : tuned.passbandWaterfallLight } }] : [],
        ...place(vertical ? (side < 0 ? fieldLeft : fieldRight) : side < 0 ? fieldTop : fieldBottom),
      })
    }
    if (pan) {
      controls.push({
        ...common, id: 'scope-pan', label: t.scope, display: 'pan', center: {},
        traceColor: dark ? trace.dark : trace.light, fillColor: dark ? trace.darkFill : trace.lightFill, gridColor: '#00000000',
        ...place(vertical ? (side < 0 ? right : left) : side < 0 ? bottom : top),
      })
    }
  } else if (vfo != null) {
    // Without one, the radio's line across the field, over its passband.
    const p = vfo
    // The passband at least a few pixels wide, so a CW filter on a whole band still shows.
    const [q, r] = view.passband ? view.passband.map(hz => at(view.radioKHz! + hz / 1000)).sort((a, b) => a - b) : [p, p]
    const pad = Math.max(0, (3 - (r - q)) / 2), fill = dark ? 'fill="#d6eef4" fill-opacity=".25"' : `fill="${tunedLine}" fill-opacity=".12"`
    const band = view.passband ? (vertical
      ? `<rect x="${fieldLeft}" y="${q - pad}" width="${Math.max(0, fieldRight - fieldLeft)}" height="${r - q + pad * 2}" ${fill}/>`
      : `<rect x="${q - pad}" y="${fieldTop}" width="${r - q + pad * 2}" height="${Math.max(0, fieldBottom - fieldTop)}" ${fill}/>`) : ''
    const [p0, p1] = [Math.min(p - 2, q - pad), Math.max(p + 2, r + pad)]
    piece('radio', vertical ? [fieldLeft, p0, fieldRight, p1] : [p0, fieldTop, p1, fieldBottom], band + (vertical
      ? `<path d="M${axis} ${p}H${side < 0 ? fieldLeft : fieldRight}" stroke="${tunedLine}" stroke-width="${tuned.width}"/>`
      : `<path d="M${p} ${side < 0 ? fieldTop : fieldBottom}V${axis}" stroke="${tunedLine}" stroke-width="${tuned.width}"/>`))
  }

  const ink = (s: MapSpot) => (s.notices ? c.primary : s.isSelf ? c.secondary : s.worked ? c.onSurfaceVariant : c.onSurface)
  // Age shows only as fading: fresh at full strength, the oldest asked for at `faintest`.
  // A spot of a kind the radio is not on — its mode's, or the plan's guess — at `elsewhere` of that.
  const faintest = 0.35, elsewhere = 0.45
  const offMode = (s: MapSpot) => { const mode = s.mode ?? s.planned; return !!view.superMode && !!mode && superModeForRadio(mode) !== view.superMode }
  const fade = (s: MapSpot) => (1 - (1 - faintest) * Math.min(1, s.ageMinutes / view.maxAgeMinutes)) * (offMode(s) ? elsewhere : 1)
  // A label: the spot's icon where it has one, its call, and its note's emoji where it has one.
  // The text in the top `textHeight` of the box, with room left under it.
  const iconSize = 13, emojiWidth = 16, labelHeight = row - 2, textHeight = labelHeight - 2
  const callWidth = (s: MapSpot) => s.call.length * advance(callSize)
  // Where the call starts in its label: after the icon, where it has one.
  const callAt = (s: MapSpot) => (s.icon ? 3 + iconSize + 3 : 6)
  const pillWidth = (s: MapSpot) => callAt(s) + callWidth(s) + (s.emoji ? 2 + emojiWidth : 0) + 6
  const ranked = [...view.spots].sort(byRank).slice(0, mostSpots(scaleLayers))

  // Where each spot shown goes: its point on the line, its label centred on it, and the leader between them.
  type Shown = { s: MapSpot; p: number; x: number; y: number; w: number; leader: string; reach: number[] }
  const shown: Shown[] = []
  if (vertical) {
    // Columns beside the line: as few as keep every label within `drift` of its point, and no more
    // than the width holds. The labels keep their frequencies' order down the page across them all,
    // so `count` columns hold one more label every `row / count` past the first.
    // No calls at all where a column has no room for one, rather than boxes too narrow to draw.
    // Each label hugs its column's edge nearer the line.
    const gap = 16, drift = 2 * row, room = side < 0 ? axis - 22 - (left + markStrip) : right - markStrip - axis - 22
    const fits = (count: number) => (room >= 48 && bottom - top >= row ? Math.floor(((bottom - top - row) * count) / row) + 1 : 0)
    const want = (s: MapSpot) => at(s.khz)
    const columnWidth = Math.max(0, ...ranked.slice(0, fits(3)).map(pillWidth))
    const most = Math.max(1, Math.min(3, Math.floor((room + gap) / (columnWidth + gap))))
    let chosen: MapSpot[] = [], tops: { column: number; top: number }[] = []
    for (let count = 1; count <= most; count++) {
      chosen = ranked.slice(0, fits(count)).sort((a, b) => want(a) - want(b))
      tops = columns(chosen.map(want), count, row, top, bottom)
      if (tops.every(({ top: y }, i) => Math.abs(y + row / 2 - want(chosen[i])) <= drift)) break
    }
    chosen.forEach((s, i) => {
      // The column's edge nearer the line, the label's width out from it, and the label's other end.
      const near = axis + side * (22 + tops[i].column * (columnWidth + gap)), w = Math.min(room - tops[i].column * (columnWidth + gap), pillWidth(s))
      const p = at(s.khz), x = side < 0 ? near - w : near, y = tops[i].top
      const meet = y + labelHeight / 2
      // Straight across where the dot is level with the label's side, clear of its rounded corners.
      // Elsewhere level out of the dot, a square turn just short of the label (in the gap before its
      // column), and level into its middle: the long run on the line's side, the short one at the call.
      const straight = p >= y + 4 && p <= y + labelHeight - 4
      const turn = near - side * 6, bend = straight ? 0 : Math.min(3, Math.abs(meet - p) / 2), dir = Math.sign(meet - p), out = side * bend
      const leader = bend
        ? `M${axis} ${p}H${turn - out}Q${turn} ${p} ${turn} ${p + dir * bend}V${meet - dir * bend}Q${turn} ${meet} ${turn + out} ${meet}H${near}`
        : `M${axis} ${p}H${near}`
      shown.push({ s, p, x, y, w, leader, reach: [Math.min(axis, near) - 5, Math.min(p, meet) - 5, Math.max(axis, near) + 5, Math.max(p, meet) + 5] })
    })
  } else {
    // Lanes on the calls' side of the line, the newest spots taking the nearest, each label centred
    // on its point; short of the markers' strip at the field's far edge.
    const count = Math.max(0, Math.floor((side < 0 ? axis - 6 - (top + markStrip) : bottom - markStrip - (axis + 6)) / row))
    const nearest = [...ranked].sort(byAge)
    const spans = nearest.map(s => {
      const w = pillWidth(s), p = at(s.khz)
      // In a pane narrower than the label, from its start: the call's first letters are what read.
      const start = Math.max(left, Math.min(p - w / 2, right - w))
      return [start, start + w] as [number, number]
    })
    lanes(spans, count, 4).forEach((lane, i) => {
      if (lane == null) return
      const s = nearest[i], p = at(s.khz), y = side < 0 ? axis - 6 - (lane + 1) * row : axis + 6 + lane * row + (row - labelHeight), [x, end] = spans[i]
      const meet = side < 0 ? y + labelHeight : y
      shown.push({ s, p, x, y, w: end - x, leader: `M${p} ${axis}V${meet}`, reach: [p - 5, Math.min(axis, meet) - 5, p + 5, Math.max(axis, meet) + 5] })
    })
  }
  const hidden = view.spots.length - shown.length

  // Under the pointer — its label, or its point on the scale — a spot's line, dot and label light up
  // together: the host sets `hot` to the spot's number, and each lit layer shows only at its own.
  values.hot = -1
  const lit = (i: number, rest: number, value = 'hot') => ({ value, input: [i - 1, i + 1] as [number, number], output: [rest, rest] as [number, number], samples: [rest, 1, rest] })
  const dot = (s: MapSpot, p: number, r: number) => (vertical ? `<circle cx="${axis}" cy="${p}" r="${r}" fill="${ink(s)}"/>` : `<circle cx="${p}" cy="${axis}" r="${r}" fill="${ink(s)}"/>`)
  const strike = ({ s, x, y }: Shown) =>
    s.worked ? `<path d="M${x + callAt(s) - 1} ${y + textHeight / 2}h${callWidth(s) + 2}" stroke="${c.onSurfaceVariant}" stroke-width="1"/>` : ''
  const fill = view.scope ? c.surface : c.surfaceContainer, fillOpacity = view.scope ? 0.82 : 1
  // The band the spot's signal takes by its mode, a bar along the line under its dot in the spot's ink, as its leader is, kept to the line.
  const [lineStart, lineEnd] = [Math.min(a0, a1), Math.max(a0, a1)]
  const signal = (s: MapSpot) => {
    const hz = spotPassband(s.mode ?? s.planned, s.khz)
    if (!hz) return undefined
    const [q, r] = hz.map(h => Math.min(Math.max(at(s.khz + h / 1000), lineStart), lineEnd)).sort((a, b) => a - b)
    return r > q ? [q, r] : undefined
  }
  const bar = (s: MapSpot, [q, r]: number[]) =>
    vertical ? `<rect x="${axis - 3}" y="${q}" width="6" height="${r - q}" fill="${ink(s)}" fill-opacity=".6"/>`
      : `<rect x="${q}" y="${axis - 3}" width="${r - q}" height="6" fill="${ink(s)}" fill-opacity=".6"/>`
  // Leaders first, so a nearer label covers those passing behind it.
  shown.forEach(({ s, p, leader, reach }, i) => {
    const band = signal(s)
    const box = band ? (vertical ? [Math.min(reach[0], axis - 3), Math.min(reach[1], band[0]), Math.max(reach[2], axis + 3), Math.max(reach[3], band[1])]
      : [Math.min(reach[0], band[0]), Math.min(reach[1], axis - 3), Math.max(reach[2], band[1]), Math.max(reach[3], axis + 3)]) : reach
    piece(`spot-${i}-line`, box, `${band ? bar(s, band) : ''}<path d="${leader}" fill="none" stroke="${ink(s)}" stroke-opacity=".6" stroke-width="1"/>${dot(s, p, 3.5)}`, { opacity: lit(i, fade(s)) })
  })
  shown.forEach((spot, i) => {
    const { s, x, y, w } = spot
    piece(`spot-${i}-box`, [x, y, x + w, y + labelHeight], `<g opacity="${fade(s).toFixed(2)}"><rect x="${x}" y="${y}" width="${w}" height="${labelHeight}" rx="3" fill="${fill}" fill-opacity="${fillOpacity}"/>${strike(spot)}</g>`)
  })
  shown.forEach((spot, i) => {
    const { s, p, x, y, w, leader, reach } = spot
    const box = [Math.min(reach[0], x), Math.min(reach[1], y), Math.max(reach[2], x + w), Math.max(reach[3], y + labelHeight)]
    piece(`lit-${i}`, [box[0] - 2, box[1] - 2, box[2] + 2, box[3] + 2], `<path d="${leader}" fill="none" stroke="${ink(s)}" stroke-width="2.5"/>${dot(s, p, 5.5)}` +
      `<rect x="${x}" y="${y}" width="${w}" height="${labelHeight}" rx="3" fill="${c.surface}"/>` +
      `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${labelHeight - 1}" rx="3" fill="none" stroke="${ink(s)}" stroke-width="1"/>${strike(spot)}`, { opacity: lit(i, 0) })
  })
  shown.forEach(({ s, x, y, w }, i) => {
    // Text colours take no alpha, so each part fades through its layer's opacity: by age, and full when lit.
    // The call's box runs to the label's end, so a guess short of the real advance never cuts it off.
    if (s.icon) layers.push({ id: `spot-${i}-icon`, x: x + 3, y: y + (textHeight - iconSize) / 2 + 2, width: iconSize, height: iconSize, icon: { name: s.icon, color: s.iconColor ?? ink(s) }, opacity: lit(i, fade(s)) })
    text(`spot-${i}-call`, x + callAt(s), y, Math.max(1, w - callAt(s) - 2), textHeight, s.call, callSize, ink(s), { fontFamily: mono, fontWeight: 700 })
    layers[layers.length - 1].opacity = lit(i, fade(s))
    if (s.emoji) {
      text(`spot-${i}-emoji`, x + w - 6 - emojiWidth, y, emojiWidth + 4, textHeight, s.emoji, callSize - 1, ink(s), { align: 'center' })
      layers[layers.length - 1].opacity = lit(i, fade(s))
    }
  })

  // A marker's emoji, and under the pointer its line drawn solid and its label in a pill that takes
  // in the emoji, over any spots and other emoji there. The host sets `mark` to its number.
  values.mark = -1
  const markText = 12, markHeight = 18
  markShown.forEach(({ m, icon: [ix, iy] }, i) => {
    text(`mark-${i}-icon`, ix, iy, markSize, markSize, m.icon, markText, c.onSurface, { align: 'center' })
  })
  markShown.forEach(({ m, icon: [ix, iy], path, reach }, i) => {
    const label = t.marker(m.label)
    // Proportional text, in a box a generous guess wide: one short of the text would wrap it.
    const lw = Math.ceil(label.length * markText * 0.6) + 8
    // The emoji's end of the pill, around it; the label runs from there into the pane, toward the line.
    const ew = markSize + 4, pw = lw + ew, py = iy + markSize / 2 - markHeight / 2
    const toRight = vertical ? side < 0 : ix - 2 + pw <= right
    const px = toRight ? ix - 2 : Math.max(left, ix + markSize + 2 - pw)
    const lx = toRight ? px + ew : px
    const box = [Math.min(reach[0], px), Math.min(reach[1], py), Math.max(reach[2], px + pw), Math.max(reach[3], py + markHeight)]
    piece(`mark-${i}-lit`, [box[0] - 1, box[1] - 1, box[2] + 1, box[3] + 1], `<path d="${path}" fill="none" stroke="${c.onSurfaceVariant}" stroke-width="${m.type === 'edge' ? 2.5 : 1.5}"/>` +
      `<rect x="${px + 0.5}" y="${py + 0.5}" width="${pw - 1}" height="${markHeight - 1}" rx="${markHeight / 2}" fill="${c.surfaceContainer}" stroke="${c.outline}" stroke-width="1"/>`, { opacity: lit(i, 0, 'mark') })
    text(`mark-${i}-label`, lx, py + 1, lw, markHeight - 2, label, markText, c.onSurface, { align: 'center' })
    layers[layers.length - 1].opacity = lit(i, 0, 'mark')
    // The pill hides the emoji under it; this one sits on the pill.
    text(`mark-${i}-lit-icon`, ix, iy, markSize, markSize, m.icon, markText, c.onSurface, { align: 'center' })
    layers[layers.length - 1].opacity = lit(i, 0, 'mark')
    // Nothing to do on a click: the label is the whole of it.
    controls.push({ id: `mark:${m.khz}:${i}`, label, kind: 'button', x: ix - 2, y: iy - 2, width: markSize + 4, height: markSize + 4, hoverSet: { value: 'mark', to: i } })
  })

  // The scale tunes where it is clicked, to its finest marks shown, or the kHz where it shows none:
  // the host says how far along the line the click landed. Under the spots' own buttons on the line.
  const tuneStep = divisions > 1 ? step / divisions : 1
  const tuneAt = (along: number) => Math.round((lo + along * (hi - lo)) / tuneStep) * tuneStep
  const scaleRect = vertical
    ? { x: side < 0 ? axis - 8 : 0, y: a0, width: side < 0 ? width - (axis - 8) : axis + 8, height: Math.max(1, a1 - a0) }
    : { x: a0, y: side < 0 ? axis - 8 : 0, width: Math.max(1, a1 - a0), height: side < 0 ? height - (axis - 8) : axis + 8 }
  if (view.tunable) controls.push({ id: 'axis', label: t.tuneHere, kind: 'button', ...scaleRect, event: 'axis', tapAt: true })

  // A label tunes to its spot; so does the line at its dot, shared with its neighbours halfway.
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
  // Zoom, down the top corner on the calls' side over everything else, clear of the markers' strip:
  // in, out, and the next of the preset views, named and drawn as the one it goes to. A way it cannot
  // go is shown faint and does nothing.
  const button = 26, buttonGap = 4, next = view.zoom.reset || 'band'
  const buttonX = vertical ? (side < 0 ? left + markStrip : paneRight - markStrip - button) : paneRight - button
  const buttonsTop = vertical ? top : side < 0 ? top + markStrip : axis + 6
  const ways = [['in', t.zoomIn, 'M8 13h10M13 8v10'], ['out', t.zoomOut, 'M8 13h10'], ['reset', t.zoomTo[next], '']] as const
  const zoomArt = ways.map(([way, label, glyph], k) => {
    const y = buttonsTop + k * (button + buttonGap), on = view.zoom[way]
    controls.push({ id: `zoom-${way}`, label, kind: 'button', x: buttonX, y, width: button, height: button, event: `zoom-${way}`, disabled: !on, fixed: true })
    return `<g transform="translate(${buttonX} ${y})" opacity="${on ? 1 : 0.35}"><circle cx="13" cy="13" r="12" fill="${c.surfaceContainer}" stroke="${c.outline}"/>${glyph ? `<path d="${glyph}" stroke="${c.onSurface}" stroke-width="2" stroke-linecap="round"/>` : ''}</g>`
  })
  if (hidden) {
    if (vertical && side < 0) text('more', buttonX + button + 8, buttonsTop + (button - 16) / 2, 80, 16, t.more(hidden), scaleSize, c.onSurfaceVariant, { align: 'start' })
    else text('more', buttonX - 8 - 80, buttonsTop + (button - 16) / 2, 80, 16, t.more(hidden), scaleSize, c.onSurfaceVariant, { align: 'end' })
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
    // Its end over the lit dot, as though the dot carried it, the pill over the scale.
    const [ox, oy] = vertical ? [side < 0 ? axis - 3 : axis + 3 - pw, 0] : [0, side < 0 ? axis - 3 : axis + 3 - ph]
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
  // The preset's glyph is one of the app's icons, a layer of its own; its faintness a binding that never moves.
  const resetY = buttonsTop + 2 * (button + buttonGap), resetOpacity = view.zoom.reset ? 1 : 0.35
  layers.push({
    id: 'zoom-reset-icon', x: buttonX + 6, y: resetY + 6, width: button - 12, height: button - 12, fixed: true,
    icon: { name: `${{ band: 'arrow-expand', segment: 'arrow-collapse', radio: 'focus-field' }[next]}-${vertical ? 'vertical' : 'horizontal'}`, color: c.onSurface }, opacity: { value: 'hot', input: [0, 1], output: [resetOpacity, resetOpacity] },
  })

  // Where the scrolled view stands: where it was left, or centred on the radio, moved just enough
  // to keep a radio that has retuned within the pane's middle 20–80%.
  let offset: number | undefined, centerKHz: number | undefined, centerAt: ((offset: number) => number) | undefined
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
    centerAt = (at: number) => lo + ((at + pane / 2 - a0) / (a1 - a0)) * (hi - lo)
    centerKHz = centerAt(offset)
    // Dragging along the scale zooms about the pane's middle; a tap on it still tunes.
    const strip = vertical ? (side < 0 ? { x: axis - 8, y: 0, width: width - (axis - 8), height } : { x: 0, y: 0, width: axis + 8, height }) : side < 0 ? { x: 0, y: axis - 8, width, height: height - (axis - 8) } : { x: 0, y: 0, width, height: axis + 8 }
    // None where there is no zoom to drag to: the host refuses a strip whose range is a single factor.
    if (view.scroll.stretch.max > view.scroll.stretch.min) {
      controls.push({ id: 'stretch', label: t.zoomIn, kind: 'zoom', event: 'stretch', min: view.scroll.stretch.min, max: view.scroll.stretch.max, ...strip })
    }
  }
  const scroll = view.scroll ? { scroll: { axis: vertical ? ('y' as const) : ('x' as const), value: 'scroll', event: 'scrolled' } } : {}
  return { scene: { version: 1, width, height, values, layers, controls, ...scroll }, placed, offset, centerKHz, centerAt, tuneAt }
}

export function createBandMap(host: BandMapHost): PanelHook {
  /** What each placement's last render drew, so an event knows what it acts on. */
  const placements = new Map<string, { placed: Placed[]; zoom: MapView['zoom']; resetTo?: ResetTo; centerAt?: (offset: number) => number; tuneAt?: (along: number) => number; operationUuid?: string }>()
  /**
   * Each placement's zoom, as a multiple of the band across the pane; where its view stood and the
   * frequency in its middle at the last render, and where the radio was then; for the render after a
   * zoom, the frequency to keep in the middle; the band and pane the view was drawn for; and the
   * preset view the reset button last went to, until another zoom.
   */
  const views = new Map<string, { factor: number; offset?: number; center?: number; radioKHz?: number; recenter?: number; frame?: string; window?: [number, number]; lead?: number; preset?: Preset }>()
  const viewOf = (key: string) => {
    if (!views.has(key)) views.set(key, { factor: 1 })
    if (views.size > 64) views.delete(views.keys().next().value!)
    return views.get(key)!
  }
  return {
    async getPanels(_args, ctx) {
      const t = words(ctx.locale)
      return [{
        key: 'band-map', title: t.title, description: t.description, icon: 'map-marker-radius', multiple: true, on: ['spots', 'qso', 'tick:1'],
        form: [
          { type: 'field', fieldType: 'select', key: 'band', label: t.band, value: 'auto', options: [{ value: 'auto', label: t.auto }, ...bands.map(b => ({ value: b, label: b }))] },
          { type: 'field', fieldType: 'select', key: 'age', label: t.age, value: '30', options: ages.map(n => ({ value: String(n), label: t.minutes(n) })) },
          { type: 'field', fieldType: 'checkbox', key: 'waterfall', label: t.waterfall, value: true },
          { type: 'field', fieldType: 'checkbox', key: 'pan', label: t.panadapter, value: true },
          { type: 'field', fieldType: 'select', key: 'direction', label: t.direction, value: 'normal', options: [{ value: 'normal', label: t.normal }, { value: 'inverted', label: t.inverted }] },
        ],
      }]
    },
    async render(args, ctx: HookContext) {
      const t = words(args.environment?.locale ?? ctx.locale)
      if (!args.environment || !args.clock) return { kind: 'markdown', content: t.unavailable }
      const key = args.instanceId ?? 'default'
      // Where the operator is: the radio, or with none to read, the logging controls' frequency and
      // mode — which follow the radio where there is one, and the operator where there is not.
      const radio = await host.readRadio()
      const draft = args.qso ?? {}, fromDraft = !radio?.frequencyHz
      const radioKHz = !fromDraft ? radio!.frequencyHz! / 1000 : typeof draft.freq === 'number' && draft.freq > 0 ? draft.freq : undefined
      const radioMode = !fromDraft ? radio!.mode ?? undefined : typeof draft.mode === 'string' && draft.mode ? draft.mode : undefined
      // A band picked in the logging controls with no frequency typed is still the operator's band.
      const draftBand = fromDraft && typeof draft.band === 'string' && draft.band in bandEdges ? draft.band : undefined
      const configured = typeof args.config.band === 'string' && args.config.band in bandEdges ? args.config.band : undefined
      const band = configured ?? bandForKHz(radioKHz) ?? draftBand ?? '20m'
      // The scope's sweep, where it is on this band and placed where the map can follow it — never
      // about the logging controls' frequency, which the radio's scope is not drawn around.
      const sp = fromDraft ? undefined : radio?.spectrum
      let window: [number, number] = bandEdges[band]
      let scope: MapView['scope']
      // A toggle left as it was set; one never set follows the menu these replace, whose Off was no scope at all.
      const toggle = (value: unknown, fallback: boolean) => (value === true || value === 'true' ? true : value === false || value === 'false' ? false : fallback)
      const scoping = args.config.panadapter !== 'off'
      const falls = toggle(args.config.waterfall, scoping), pan = toggle(args.config.pan, scoping)
      if ((falls || pan) && radio?.id && sp && !sp.problem && radioKHz != null && bandForKHz(radioKHz) === band) {
        // The edges the radio gives, fixed or centred apart from the dial (a FlexRadio's pan, which a
        // retune inside it leaves put); else centred on the radio. Assumed centred, a pan left put
        // would be drawn as far off the scale as the radio had tuned. The app runs a radio's scope
        // only while a control shows it, and says nothing of it until then (no mode): the first
        // render guesses it about the radio, its first span of 25 kHz or more either side, and the
        // next one has it. A scope reporting a mode but no place for it is not drawn.
        const guess = (sp.spansHz.find(s => s >= 25000) ?? 25000) / 1000
        const scoped: [number, number] | undefined = sp.lowHz != null && sp.highHz != null && sp.highHz > sp.lowHz ? [sp.lowHz / 1000, sp.highHz / 1000]
          : sp.mode === 'center' && sp.spanHz ? [radioKHz - sp.spanHz / 1000, radioKHz + sp.spanHz / 1000]
          : sp.mode == null ? [radioKHz - guess, radioKHz + guess]
          : undefined
        if (scoped) scope = { radio: radio.id, waterfall: falls, pan, range: scoped }
      }
      // The plan where the operation's station is, or the library's own where there is none; the
      // markers for its IARU region (its ITU one) and entity, or all of them.
      const station = String(args.operation.stationCall ?? '').trim().toUpperCase()
      const where = station ? regionAndCountryForDxccCode(entityForCall(station).dxccCode) : {}
      const segments = bandPlan(band, where)
      const markers = markersFor(band, station ? { entity: entityPrefixForCall(station), region: where.ituRegion } : {})
      const inBand = radioKHz != null && bandForKHz(radioKHz) === band
      const kind = radioMode && (inBand || draftBand === band) ? superModeForRadio(radioMode) : undefined
      // Around the radio, in kHz either side: phone's wider, or a mode not known.
      const around = kind === 'PHONE' || !kind ? 25 : 5
      // The whole band at a multiple of the pane's length, which the app scrolls — the scope's sweep
      // drawn over whatever of it the view takes in, at the map's own zoom.
      let zoom: MapView['zoom'], scroll: MapView['scroll'], resetTo: ResetTo | undefined
      const v = viewOf(key), [lo, hi] = bandEdges[band], pane = Math.max(args.environment.width, args.environment.height)
      // The offset is in scene units, which a resized or turned pane lays out anew: there the view
      // keeps the frequency in its middle instead. On another band nothing of the old view applies.
      const frame = `${band} ${args.environment.width}x${args.environment.height}`
      if (v.frame != null && v.frame !== frame) {
        Object.assign(v, v.frame.startsWith(`${band} `) ? { recenter: v.recenter ?? v.center } : { offset: undefined, center: undefined, recenter: undefined, window: undefined, preset: undefined })
      }
      v.frame = frame
      const most = Math.max(1, (hi - lo) / narrowest)
      const fit = (f: number) => Math.min(Math.max(f, 1), most)
      const factor = (v.factor = fit(v.factor))
      // The presets' stretches of the band, each where it shows more than the whole band does.
      const stretch = kind && inBand ? modeStretch(segments, kind, radioKHz) : undefined
      const ranges: Partial<Record<Preset, [number, number]>> = {
        band: [lo, hi],
        ...(stretch ? { segment: [stretch[0] - (stretch[1] - stretch[0]) / 20, stretch[1] + (stretch[1] - stretch[0]) / 20] } : {}),
        ...(inBand ? { radio: [radioKHz - around, radioKHz + around] } : {}),
      }
      const offered = presets.filter(p => ranges[p] && (p === 'band' || fit((hi - lo) / (ranges[p]![1] - ranges[p]![0])) > 1.001))
      const reset = nextPreset(offered, v.preset ?? (factor <= 1.001 ? 'band' : undefined))
      zoom = { in: factor < most * 0.999, out: factor > 1.001, reset }
      if (reset) {
        const [from, to] = ranges[reset]!
        resetTo = { preset: reset, factor: fit((hi - lo) / (to - from)), center: (from + to) / 2 }
      }
      let follow = v.offset == null || v.radioKHz !== radioKHz, centerOn = v.recenter
      // Longer than a scene can be, the scene is a window that long on the band. It stays put while
      // the view keeps a quarter of it clear on either side, so a scroll come to rest is where the
      // host already is; nearer an end it moves to centre on the view, and the band runs on past it.
      // A radio that has retuned is kept within the pane's middle 20–80%, as the whole band's scroll keeps it.
      const reach = (hi - lo) * Math.min(1, longest / (pane * factor))
      v.window = reach < hi - lo ? v.window : undefined
      if (reach < hi - lo) {
        const across = (hi - lo) / factor
        let middle = v.recenter ?? v.center ?? (inBand ? radioKHz : (lo + hi) / 2)
        if (inBand && follow && v.recenter == null) middle = Math.min(Math.max(middle, radioKHz - 0.3 * across), radioKHz + 0.3 * across)
        const [from, to] = v.window ?? [lo, lo]
        const kept = v.window && v.recenter == null && Math.abs(to - from - reach) < 1e-6 && from >= lo && to <= hi &&
          (middle - from >= reach / 4 || from <= lo) && (to - middle >= reach / 4 || to >= hi)
        if (!kept) {
          // The host moves its view only when asked for a place other than the last: a window that
          // would put the view where the last one did is moved a few units more.
          const place = (start: number) => Math.min(Math.max(start, lo), hi - reach), unit = reach / longest
          let start = place(middle - reach / 2)
          if (v.lead != null && Math.abs(middle - start - v.lead) < 2 * unit) start = place(start + 3 * unit) === start ? place(start - 3 * unit) : place(start + 3 * unit)
          v.window = [start, start + reach]
        }
        window = v.window!
        centerOn = kept && middle === v.center ? undefined : middle
        follow = false
      }
      scroll = { factor: (factor * reach) / (hi - lo), offset: v.offset, follow, centerOn, stretch: { min: 1 / factor, max: most / factor } }
      const maxAgeMinutes = ages.includes(Number(args.config.age)) ? Number(args.config.age) : 30
      const board = (await ctx.getSpots?.({ filter: 'all', band, maxAgeMinutes })) ?? []
      // The logging controls name a contact's mode, not a radio's: SSB is its sideband there, as a spot's is.
      const passband: [number, number] | undefined = fromDraft ? (radioKHz != null ? spotPassband(radioMode, radioKHz) : undefined)
        : radio?.passband ? [radio.passband.lowHz, radio.passband.highHz] : passbands[radioMode ?? '']
      const marks = { group: ctx.groupingSeparator ?? ',', decimal: ctx.decimalSeparator ?? '.' }
      const plan = {
        edges: segments.slice(1).map(s => s.from),
        off: kind ? segments.filter(s => !planAllows(s, kind)).map(s => [s.from, s.to] as [number, number]) : [],
      }
      const view: MapView = { band, window, inverted: args.config.direction === 'inverted', passband, plan, superMode: kind, tunable: !!radio?.id, spots: mapSpots(board, args.clock.nowMillis, window), markers, maxAgeMinutes, radioKHz, scope, marks, zoom, scroll }
      const { scene, placed, offset, centerKHz, centerAt, tuneAt } = bandMapScene(args.environment, view, t)
      if (scroll) {
        const v = viewOf(key)
        Object.assign(v, { offset, center: centerKHz, radioKHz, recenter: undefined, lead: v.window && centerKHz != null ? centerKHz - v.window[0] : undefined })
      }
      placements.set(key, { placed, zoom, resetTo, centerAt, tuneAt, operationUuid: typeof args.operation.uuid === 'string' ? args.operation.uuid : undefined })
      if (placements.size > 64) placements.delete(placements.keys().next().value!)
      return { kind: 'scene', title: t.mapTitle(band), scene }
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
        // Its middle too, which a window on the band moves to at the next render.
        Object.assign(viewOf(key), { offset: event.value, center: drawn?.centerAt?.(event.value) ?? viewOf(key).center })
        return { values: {} }
      }
      // A zoom keeps the frequency in the view's middle where it is: twice or half for a button, the
      // drag's own factor along the scale. The next render clamps it to what the band allows.
      if (event.action === 'stretch' && typeof event.value === 'number') {
        const v = viewOf(key)
        Object.assign(v, { factor: v.factor * event.value, recenter: v.center, preset: undefined })
        return { values: {} }
      }
      // Only the ways the last render offered: a click can land after the limit moved.
      const zooming = event.action === 'zoom-in' || event.action === 'zoom-out' || event.action === 'zoom-reset'
      if (zooming && !drawn?.zoom[event.action.slice(5) as keyof MapView['zoom']]) return { values: {} }
      if (zooming) {
        const v = viewOf(key), to = drawn?.resetTo
        if (event.action !== 'zoom-reset') Object.assign(v, { factor: event.action === 'zoom-in' ? v.factor * 2 : v.factor / 2, recenter: v.center, preset: undefined })
        else if (to) Object.assign(v, { factor: to.factor, recenter: to.center, preset: to.preset })
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
          const mode = radioModeFor(spot.mode ?? spot.planned, spot.khz, radio.modes ?? [])
          refusedBy(await host.setRadio({ id: radio.id, frequencyHz: Math.round(spot.khz * 1000), ...(mode && mode !== radio.mode ? { mode } : {}) }))
        }
        return { values: {} }
      }
      const radio = await host.readRadio()
      if (!radio?.id) return { values: {} }
      // A click on the scale, at the frequency drawn where it landed; a key on it says nowhere.
      if (event.action === 'axis') {
        const khz = typeof event.value === 'number' ? drawn?.tuneAt?.(event.value) : undefined
        if (khz != null) refusedBy(await host.setRadio({ id: radio.id, frequencyHz: Math.round(khz * 1000) }))
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
