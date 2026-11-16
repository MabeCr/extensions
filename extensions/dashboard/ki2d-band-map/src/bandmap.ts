// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MPL-2.0
//
// The spots on one band, along its frequencies, drawn by the app's band scope: its axis, its
// tuning, zoom and pan, and the radio's spectrum and waterfall where the radio sweeps the band —
// with no sweep, the band alone over a blank picture. Vertical in a tall panel (frequency rising
// down the page), horizontal in a wide one. Over it, the spots and what is marked on the band (the
// operator's band tags, other extensions' notes) as labels out from the axis, stacked or grouped
// where they crowd, accented as the Spots panel accents them, and the band plan's modes and
// markers. Inverted, the axis and the spectrum go to the other side.
import { entityForCall, entityPrefixForCall, regionAndCountryForDxccCode } from '@ham2k/extension-sdk'
import type {
  BoardSpot, HeldBandAnnotation, HookContext, JSONValue, PanelEnvironment, PanelHook, PanelRadioResult, PanelRadioSet, PanelRadioState, PanelScene,
  PanelSceneControl as Control, PanelSceneSpectrumAnnotation as Annotation, PanelSceneSpectrumLayer as ScopeLayer, SuggestedQso,
} from '@ham2k/extension-sdk'
import { bandEdges, bandForKHz, bandPlan, bands, modeStretch, planAllows, plannedMode, radioModeFor, spotPassband, superModeForRadio } from './bands.ts'
import type { SuperMode } from '@ham2k/lib-operation-data'
import { markerLabelsEs, markersFor, type BandMarker } from './markers.ts'

type BandMapHost = {
  readRadio(id?: string): Promise<PanelRadioState | null>
  setRadio(args: PanelRadioSet): Promise<PanelRadioResult>
  /** The spot's station into the panel's operation's logging fields, as a Spots Panel tap. */
  suggestQso(args: { qso: SuggestedQso; operationUuid?: string }): Promise<{ accepted: boolean }>
  /** The operator's band tags under `keys`, taken down with `source: 'user'` where the operator right-clicks one. */
  bandAnnotations: { remove(keys: string[], options: { source: 'user' }): Promise<void> }
  /** The placements' views, kept for the session. */
  kvGet(key: string): Promise<JSONValue | null>
  kvSet(key: string, value: JSONValue): Promise<void>
}

const en = {
  title: 'KI2D’s Band Map', description: 'The spots on a band, along its frequencies',
  band: 'Band', auto: 'Automatic (the radio’s band)', age: 'Spots no older than', minutes: (n: number) => `${n} minutes`,
  notes: 'Band annotations', notesHelp: 'What is marked on the band among the spots: your band tags (QRM!, NET!) and what extensions mark.',
  waterfall: 'Show Waterfall', panadapter: 'Show Spectrum', direction: 'Scope direction', normal: 'Normal', inverted: 'Inverted',
  mapTitle: (band: string) => `${band} Band Map`, unavailable: 'This app cannot show the band map', more: (n: number) => `+${n} more`,
  marker: (label: string) => label,
  refused: (reason?: string) => `The radio did not take it${reason ? ` (${reason})` : ''}`, unknown: (action: string) => `The band map has no action “${action}”`,
}
const es: typeof en = {
  title: 'Mapa de banda de KI2D', description: 'Los spots de una banda, a lo largo de sus frecuencias',
  band: 'Banda', auto: 'Automática (la banda de la radio)', age: 'Spots de hasta', minutes: (n: number) => `${n} minutos`,
  notes: 'Anotaciones de la banda', notesHelp: 'Lo marcado en la banda entre los spots: tus etiquetas de banda (QRM!, NET!) y lo que marcan las extensiones.',
  waterfall: 'Mostrar cascada', panadapter: 'Mostrar espectro', direction: 'Dirección del panorámico', normal: 'Normal', inverted: 'Invertida',
  mapTitle: (band: string) => `Mapa de ${band}`, unavailable: 'Esta app no puede mostrar el mapa de banda', more: (n: number) => `+${n} más`,
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
/**
 * Something new to work a spot for, and a new multiplier, in the Spots panel's own colours
 * (`HaLoColors.important` and `spotMultiplier`, each theme's), so the two panels accent alike.
 */
const accents = { fresh: '#1aa01a', freshDark: '#1ac81a', multiplier: '#c2500f', multiplierDark: '#ff8a4c' }
const ages = [10, 30, 60]

/** A spot as the map shows it: one per station, its newest report. */
export type MapSpot = {
  call: string; khz: number; band?: string; mode?: string; refs: { type: string; ref: string }[]; ageMinutes: number; worked: boolean; isSelf: boolean
  /** What tells it from the rest where `call` alone does not: a call not fully copied, or a note. */
  key?: string
  /** Something new to work it for — a band, a mode, a day, a reference, a multiplier — as the Spots panel accents. */
  fresh: boolean
  /** A new multiplier, which the Spots panel draws in its own colour over the rest. */
  multiplier?: boolean
  /** One of the band's `general` annotations rather than a station: its label for a call, nothing to log. */
  note?: boolean
  /** A note's source and its own key there: `user` for the operator's band tags, which a right-click takes down. */
  source?: string; noteKey?: string
  /** When the station's newest report was made: a spot hidden before it shows again. */
  heardAt?: number
  /** The ink it suggests, `#rrggbb`: a note's. */
  color?: string
  /** The stretch it covers in Hz either side of it, where its mode does not say: a note's. */
  heard?: [number, number]
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
    // A call not fully copied ("W1A?") names no one station: two of them are two places on the
    // band, each its own spot.
    const key = call.includes('?') ? `${call}@${s.freq}` : call
    reports.set(key, [...(reports.get(key) ?? []), s])
  }
  const spots: MapSpot[] = []
  for (const [key, [s, ...older]] of reports) {
    const call = s.their.call.toUpperCase()
    if (s.freq! < lo || s.freq! > hi) continue
    const refs = new Map<string, NonNullable<BoardSpot['refs']>[number]>()
    for (const r of [s, ...older].flatMap(o => o.refs ?? [])) if (!refs.has(`${r.type}:${r.ref}`)) refs.set(`${r.type}:${r.ref}`, r)
    const mode = s.mode ?? older.find(o => o.mode && Math.abs(o.freq! - s.freq!) <= 1)?.mode
    // Drawn as the newest report that names a reference: a park's tree, not the cluster's tower.
    const shown = [s, ...older].find(o => o.refs?.length) ?? s
    const icon = shown.spot.source === 'cluster' && !shown.refs?.length ? undefined : shown.display?.icon ?? shown.icon ?? 'radio-tower'
    const notices = s.annotations?.notices ?? []
    spots.push({
      call, ...(key !== call ? { key } : {}), khz: s.freq!, heardAt: s.spot.timeInMillis, band: s.band, mode, planned: mode ? undefined : plannedMode(call, s.freq!), refs: [...refs.values()], ageMinutes: Math.max(0, Math.round((nowMillis - s.spot.timeInMillis) / 60000)),
      worked: s.annotations?.worked ?? false, isSelf: s.annotations?.isSelf ?? false,
      fresh: notices.some(n => accented.includes(n) || chaseAlert(n)), ...(notices.includes('newMult') ? { multiplier: true } : {}),
      icon, iconColor: shown.display?.iconColor, emoji: shown.display?.emoji,
    })
  }
  return spots
}

/**
 * The scorers' notices the Spots panel accents, and the map after it. A new DXCC, state or province
 * it leaves out: those are about the call being typed, and on a whole band they would light up most spots.
 */
const accented = ['newBand', 'newMode', 'newDay', 'newRef', 'newMult']
/** A chasing program's verdict the operator asked to be alerted to — `chase:<program>:<verdict>` then flags, `alert` among them. */
const chaseAlert = (notice: string) => notice.startsWith('chase:') && notice.split(':').slice(3).includes('alert')

/** The most characters of a note's label the map shows. */
const noteLength = 12

/**
 * The band's `general` annotations within [lo, hi] — the operator's band tags, what extensions mark —
 * as spots: each labelled, where it is or in the middle of what the window holds of the stretch it
 * covers, never fading.
 */
export function noteSpots(annotations: HeldBandAnnotation[], [lo, hi]: [number, number]): MapSpot[] {
  // Each named by its key, or where it starts: by its place in the list, a note added before it would
  // move a click on the picture painted before onto another. Two alike are told apart in turn.
  const seen = new Map<string, number>()
  return annotations.filter(a => a.type === 'general' && a.label?.trim()).flatMap(a => {
    const [from, to] = [a.fromHz, a.toHz != null && a.toHz > a.fromHz ? a.toHz : a.fromHz]
    if (to / 1000 < lo || from / 1000 > hi) return []
    const at = Math.round((Math.max(from, lo * 1000) + Math.min(to, hi * 1000)) / 2)
    const base = `note:${a.source}:${a.key ?? a.fromHz}`, n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    // Cut to a call's length: a label sizes the map's columns, and a long one would take their room.
    const label = a.label!.trim(), short = label.length > noteLength ? `${label.slice(0, noteLength - 1).trimEnd()}…` : label
    return [{
      call: short, key: n ? `${base}#${n}` : base, source: a.source, ...(a.key ? { noteKey: a.key } : {}), khz: at / 1000, refs: [], ageMinutes: 0, worked: false, isSelf: false, fresh: false, note: true,
      ...(a.icon ? { icon: a.icon, iconColor: a.color } : {}), ...(a.color ? { color: a.color } : {}),
      ...(to > from ? { heard: [from - at, to - at] as [number, number] } : {}),
    }]
  })
}

/** What names a spot among the rest: its call, or what tells it apart where the call does not. */
export const spotKey = (s: MapSpot) => s.key ?? s.call

/** Who keeps a place when there is not room for all: something new first, then the unworked, then the newest. */
const rank = (s: MapSpot) => (s.fresh ? 0 : s.worked ? 2 : 1) * 1e6 + s.ageMinutes
const byRank = (a: MapSpot, b: MapSpot) => rank(a) - rank(b)

/** `#rrggbb` (or `#aarrggbb`, its alpha replaced) at an opacity, as a band scope's `#AARRGGBB`. */
export const alpha = (color: string, opacity: number) =>
  `#${Math.round(Math.min(1, Math.max(0, opacity)) * 255).toString(16).padStart(2, '0')}${color.slice(-6)}`

/** `±<n>px`, as a band scope's coordinate offset is written. */
const px = (n: number) => `${n < 0 ? '-' : '+'}${Math.abs(Math.round(n))}px`

/**
 * The radio the scope names when the radio is on another band than the map's: a node that is no
 * radio, so the scope sweeps nothing and the map shows its band alone.
 */
const noRadio = 'none'

export type MapView = {
  band: string
  /** The band's edges in kHz: the window shown with no sweep, and the widest a zoom goes. */
  edges: [number, number]
  spots: MapSpot[]
  /** The band plan's places worth marking, for the operator's station. */
  markers?: BandMarker[]
  /** The age at which a spot is shown faintest: the oldest the map asks for. */
  maxAgeMinutes: number
  /** The radio on the map's band, which the scope draws, tunes and follows; none, the band alone. */
  radio?: string
  /** What the scope shows where the radio sweeps the band, as the form asks: its waterfall, its spectrum. */
  picture: { waterfall: boolean; pan: boolean }
  /** The logging controls' frequency where there is no radio to read, which the map marks itself. */
  draftKHz?: number
  /** The receive filter's edges in Hz from the tuned frequency. */
  passband?: [number, number]
  /** The band plan: where its modes change, and the stretches not meant for the radio's mode. */
  plan?: { edges: number[]; off: [number, number][] }
  /** The radio's kind of mode, while it is on this band: spots of another kind are shown fainter. */
  superMode?: SuperMode
  /** The axis and the spectrum on the other side: the right of a tall map, the bottom of a wide one. */
  inverted?: boolean
  /** The width the operator zoomed to and the middle they left the window at, in Hz, and the spectrum's share, from the scope's gestures. */
  span?: number
  center?: number
  split?: number
  /** The preset view the map is at, none where the operator zoomed or panned by hand. */
  preset?: Preset
  /** The preset view the button goes to next, or false where there is none other than this one. */
  next?: Preset | false
}

/**
 * The views the preset button steps through, in turn: the whole band, the band plan's stretch for
 * the radio's mode, and the radio with 25 kHz either side on phone, 5 on CW and data.
 */
export type Preset = 'band' | 'segment' | 'radio'
const presets: Preset[] = ['band', 'segment', 'radio']
/** The one after `current` among those `offered`, round again; from none, the first. False where that is where it already is. */
const nextPreset = (offered: Preset[], current: Preset | undefined): Preset | false => {
  const next = offered[(offered.indexOf(current as Preset) + 1) % offered.length]
  return next && next !== current ? next : false
}
/** How far past each of the band's edges the map zooms out and pans to, a share of the band's width. */
const beyond = 0.25
/** The preset button's glyph, in a 26-pixel circle, upright for a tall map: the view the map is at, or a magnifier for one set by hand. */
const presetGlyph: Record<Preset | 'hand', string> = {
  hand: '<circle cx="11.5" cy="11.5" r="4.5" fill="none" stroke-width="2"/><path d="M15 15L19 19" fill="none" stroke-width="2.5" stroke-linecap="round"/>',
  band: '<path d="M13 9V17M10 11L13 8L16 11M10 15L13 18L16 15M8 5H18M8 21H18" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  segment: '<path d="M8 13H18M13 5V10M10 8L13 11L16 8M13 21V16M10 18L13 15L16 18" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  radio: '<circle cx="13" cy="13" r="5.5" fill="none" stroke-width="2"/><circle cx="13" cy="13" r="1.8" stroke="none"/>',
}

/** The annotation's id for a spot; a click names it, and the render's table finds the spot again. */
export const spotId = (s: MapSpot) => `spot:${spotKey(s)}`

/** A spot's label: its call, at the size and weight the Spots panel shows calls, boxed from its capitals' tops to its baseline. */
const callSize = 14, labelGap = 4, padding = 2, paddingY = 4
const capHeight = callSize * 0.71
/** A spot's dot, the gap between it and the call, and the room between the axis and the labels. */
const dotSize = 6, textGap = 3, inset = 6
/** RobotoMono advances 0.6 em a glyph; a hair over keeps a guess from letting two boxes touch. */
const advance = callSize * 0.62
/** A label's width: the call, the icon before it and the emoji after. */
const widthOf = (s: MapSpot) => padding * 2 + s.call.length * advance + (s.icon ? callSize * 1.6 : 0) + (s.emoji ? callSize * 1.6 : 0)
/** What a group's count adds after its call: a space, `+n` a little smaller, and its pill's ends. */
const badgeWidth = (count: number) => advance + (String(count).length + 1) * advance * 0.85 + advance / 3 + 8

/**
 * The axis's depth: between the spectrum and the waterfall, no more than its line, the waterfall
 * right against it, its ticks and labels standing over the spectrum; at the waterfall's head with
 * no spectrum, a narrow strip; with no waterfall, over the spectrum's foot, deep enough for its labels.
 */
const axisBetween = 2, axisHead = 10, axisOver = 24
/** Room across the waterfall's head for the axis's labels, where they lie on it: a reading's width and a little air. */
const labelRoom = 46
/** The axis's ticks over the spectrum; a label's is three quarters longer. */
const tickLength = 8

/** The round step, 1, 2 or 5 times a power of ten, at least [hz]. */
const niceStep = (hz: number) => {
  const power = 10 ** Math.floor(Math.log10(Math.max(1, hz)))
  return [1, 2, 5, 10].map(m => m * power).find(step => step >= hz)!
}
/** The markers' strip along the part's far edge, which the labels stop short of. */
const markStrip = 20
/** The most spots shown: two layers each, of the 512 a band scope takes, the plan's taken first; under its 256 annotations. */
const mostSpots = 150

/** [key] set again as the newest, and the oldest let go past [most]: what a session keeps, not a leak. */
function keepNewest<K, V>(kept: Map<K, V>, key: K, value: V, most: number) {
  kept.delete(key)
  kept.set(key, value)
  while (kept.size > most) kept.delete(kept.keys().next().value!)
}

export function bandMapScene(e: PanelEnvironment, view: MapView, t: typeof en): { scene: PanelScene; spots: Map<string, MapSpot> } {
  const c = e.colors, dark = e.brightness === 'dark'
  const vertical = e.height > e.width
  const along = Math.max(1, vertical ? e.height : e.width), across = Math.max(1, vertical ? e.width : e.height)
  const [lo, hi] = view.edges, bandHz = Math.round((hi - lo) * 1000)
  const hz = (khz: number) => Math.round(khz * 1000)
  // Zoomed out or panned, the window runs a little past the band's edges.
  const [windowLo, windowHi] = [lo - (hi - lo) * beyond, hi + (hi - lo) * beyond], widestHz = Math.round((windowHi - windowLo) * 1000)
  const shownHz = Math.min(widestHz, Math.max(100, view.span ?? bandHz)), hzPerPx = shownHz / along
  // Over the band alone, the waterfall's room is the spots' field; over the radio's sweep, its
  // picture as the form asks, the spots on the waterfall where it is shown.
  // With no sweep, the spectrum's room is still kept, blank, for the axis's labels to reach over.
  const display = view.picture.waterfall && view.picture.pan ? 'both' : view.picture.pan ? 'spectrum' : 'waterfall'
  const between = display === 'both'
  // Tall with the waterfall alone, the axis is a strip of its own at the waterfall's head, its labels on the waterfall.
  const headed = vertical && display === 'waterfall'
  const strip = between || headed, axisGap = between ? axisBetween : headed ? axisHead : axisOver
  // How far the spots' field starts past the part's edge: clear of the axis lying over it, or of its labels.
  const clear = between ? 0 : headed ? labelRoom : axisGap
  // A little room at the far edge, short of the pane's border.
  const farRoom = 4
  const part = display === 'spectrum' ? 'spectrum' : 'waterfall'
  const split = view.split ?? 0.3
  const partAcross = between ? (across - axisGap) * (1 - split) : across
  // On the part's edge past the axis lying over it, moved `d` further in.
  const edge = (d = 0) => (part === 'waterfall' ? `waterfall${px(clear + d)}` : `spectrum:bottom${px(-clear - d)}`)
  // On its far edge, moved `d` back toward the axis.
  const far = (d = 0) => (part === 'waterfall' ? `waterfall:bottom${px(-farRoom - d)}` : `spectrum${px(farRoom + d)}`)
  const tunedLine = dark ? tuned.line : tuned.lineLight
  const layers: ScopeLayer[] = [], annotations: Annotation[] = []

  // Past the band's edges, shaded across the whole picture, the edges themselves solid.
  layers.push({ id: 'below', kind: 'rect', x: `freq:${hz(windowLo)}`, x2: `freq:${hz(lo)}`, fill: alpha(c.onSurface, 0.12) })
  layers.push({ id: 'above', kind: 'rect', x: `freq:${hz(hi)}`, x2: `freq:${hz(windowHi)}`, fill: alpha(c.onSurface, 0.12) })
  for (const [i, khz] of [lo, hi].entries()) layers.push({ id: `edge:${i}`, kind: 'line', x: `freq:${hz(khz)}`, color: c.outline, width: 1.5 })
  // The band plan across the field: a veil over what the radio's mode is not meant for, and a line where its mode changes.
  for (const [from, to] of view.plan?.off ?? []) {
    if (to > lo && from < hi) layers.push({ id: `off:${from}`, kind: 'rect', x: `freq:${hz(Math.max(from, lo))}`, x2: `freq:${hz(Math.min(to, hi))}`, y: edge(), y2: far(), fill: alpha(c.onSurface, 0.07) })
  }
  for (const khz of view.plan?.edges ?? []) {
    if (khz > lo && khz < hi) layers.push({ id: `plan:${khz}`, kind: 'line', x: `freq:${hz(khz)}`, y: edge(), y2: far(), color: alpha(c.outline, 0.7) })
  }
  // The markers: a line from the axis across the field to the far edge, and its emoji there; a click
  // on the emoji names it. An edge — a boundary rather than a place — solid and heavier.
  const markers = (view.markers ?? []).filter(m => m.khz >= lo && m.khz <= hi)
  markers.forEach((m, i) => {
    layers.push({
      id: `mark:${i}:line`, kind: 'line', x: `freq:${hz(m.khz)}`, y: edge(), y2: far(markStrip), color: c.outlineVariant,
      ...(m.type === 'edge' ? { width: 2 } : { dashed: true }),
    })
    layers.push({
      id: `mark:${i}`, kind: 'text', x: `freq:${hz(m.khz)}`, y: far(markStrip / 2), text: m.icon, size: 13, align: 'center', valign: 'center',
      menu: [{ label: t.marker(m.label), event: 'marker' }],
    })
  })
  // The preset button, in the pane's top left corner — the window's low end, on the control's first
  // side, or its last where the map is turned the other way: drawn as the view the map is at, faint
  // where there is no other to go to.
  {
    const button = 26, shown = view.preset ?? 'hand', inset = 4
    const last = display === 'spectrum' ? 'spectrum' : 'waterfall'
    const across = view.inverted ? { y: `${last}:bottom${px(-inset - button)}`, y2: `${last}:bottom${px(-inset)}` } : { y: px(inset), y2: px(inset + button) }
    // Arrows along the band, which runs across a wide map.
    const turn = vertical || shown === 'hand' || shown === 'radio' ? '' : ' transform="rotate(90 13 13)"'
    layers.push({
      id: 'preset', kind: 'svg', x: inset, x2: inset + button, ...across,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 26 26"><g opacity="${view.next ? 1 : 0.35}"><circle cx="13" cy="13" r="12" fill="${c.surfaceContainer}" stroke="${c.outline}"/><g${turn} stroke="${c.onSurface}" fill="${c.onSurface}">${presetGlyph[shown]}</g></g></svg>`,
      ...(view.next ? { event: 'preset' } : {}),
    })
  }
  // With no radio to draw, the logging controls' frequency, as the scope would draw the dial.
  if (!view.radio && view.draftKHz != null && view.draftKHz >= lo && view.draftKHz <= hi) {
    layers.push({ id: 'draft', kind: 'line', x: `freq:${hz(view.draftKHz)}`, color: tunedLine, width: tuned.width })
  }

  // A note in the ink it suggests; a station as the Spots panel accents it: a new multiplier over
  // anything else new, then our own, then the worked.
  const ink = (s: MapSpot) => s.color ?? (s.multiplier ? (dark ? accents.multiplierDark : accents.multiplier)
    : s.fresh ? (dark ? accents.freshDark : accents.fresh) : s.isSelf ? c.secondary : s.worked ? c.onSurfaceVariant : c.onSurface)
  // Age shows only as fading: fresh at full strength, the oldest asked for at `faintest`.
  // A spot of a kind the radio is not on — its mode's, or the plan's guess — at `elsewhere` of that.
  const faintest = 0.4, elsewhere = 0.5
  const offMode = (s: MapSpot) => { const mode = s.mode ?? s.planned; return !!view.superMode && !!mode && superModeForRadio(mode) !== view.superMode }
  const fade = (s: MapSpot) => (1 - (1 - faintest) * Math.min(1, s.ageMinutes / view.maxAgeMinutes)) * (offMode(s) ? elsewhere : 1)

  // Each spot's label, out from the axis past a little room, with its dot and its passband's bar
  // beside it on its side facing the axis. The label is centred on the dot and the passband
  // together, or where they are longer than the label, its background covers them, the call in its middle; boxed
  // from the call's capitals to its baseline, padded across it and more above and below. Spots go
  // in rank order. One whose label would overlap a placed one by more than `together` of the
  // shorter's length joins that one's group, the most overlapped: the group's label reads "<call>
  // + <how many more>", and lists them while the pointer is on it. One overlapping less is drawn
  // over those it overlaps, a step further from the axis than the furthest of them; and where the
  // room has no step left, it joins the group of the one it overlaps most.
  const ranked = [...view.spots].sort(byRank).slice(0, mostSpots)
  const together = 0.2, mostListed = 10
  const step = vertical ? 8 : 10
  // How deep a label is across the band: its dot, the gap, and the call across or along it.
  const depthOf = (s: MapSpot) => dotSize + textGap + (vertical ? widthOf(s) : capHeight + paddingY * 2)
  const room = partAcross - clear - inset - farRoom - (markers.length ? markStrip : 0)
  type Placed = { head: MapSpot; box: [number, number]; level: number; members: MapSpot[]; marks: [number, number]; length: number }
  const placed: Placed[] = []
  const overlap = ([a0, a1]: [number, number], [b0, b1]: [number, number]) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)) / Math.max(1e-9, Math.min(a1 - a0, b1 - b0))
  const heardOf = (s: MapSpot) => s.heard ?? spotPassband(s.mode ?? s.planned, s.khz)
  // What a spot marks along the band: its dot and its passband together, in Hz.
  const marked = (s: MapSpot, heard: [number, number] | undefined): [number, number] => {
    const at = hz(s.khz), dot = (dotSize / 2) * hzPerPx
    return [Math.min(at - dot, at + (heard?.[0] ?? 0)), Math.max(at + dot, at + (heard?.[1] ?? 0))]
  }
  for (const s of ranked) {
    const heard = heardOf(s), [low, high] = marked(s, heard), middle = (low + high) / 2
    // Centred on its dot and passband, or where they are the longer, over them.
    const length = (vertical ? capHeight + paddingY * 2 : widthOf(s)) * hzPerPx
    const box: [number, number] = high - low > length ? [low, high] : [middle - length / 2, middle + length / 2]
    // Those it overlaps, or comes nearer than a gap to.
    const gap = (labelGap * hzPerPx) / 2
    const near = placed.map(p => ({ p, by: overlap(box, p.box), touches: overlap([box[0] - gap, box[1] + gap], p.box) > 0 })).filter(o => o.touches)
    const most = near.reduce<{ p: Placed; by: number } | undefined>((best, o) => (!best || o.by > best.by ? o : best), undefined)
    const level = near.length ? Math.max(...near.map(o => o.p.level)) + 1 : 0
    if (most && (most.by > together || level * step + depthOf(s) > room)) {
      const p = most.p
      p.members.push(s)
      // Along a wide map, its count lengthens the label: the box grows to take it in.
      if (!vertical) {
        const grown = p.length + badgeWidth(p.members.length) * hzPerPx, [from, to] = p.marks, mid = (from + to) / 2
        p.box = to - from > grown ? [from, to] : [mid - grown / 2, mid + grown / 2]
      }
      continue
    }
    placed.push({ head: s, box, level, members: [], marks: [low, high], length })
  }
  const spots = new Map<string, MapSpot>()
  // The furthest from the axis drawn last, over those it overlaps.
  for (const { head: s, level, members } of [...placed].sort((a, b) => a.level - b.level)) {
    const at = hz(s.khz), heard = heardOf(s), opacity = fade(s), color = ink(s)
    // Its dot's place out from the part's edge, past the axis.
    const from = inset + level * step
    const id = spotId(s)
    spots.set(id, s)
    const across = from + dotSize / 2
    if (heard) layers.push({ id: `heard:${spotKey(s)}`, kind: 'rect', x: `freq:${at + heard[0]}`, x2: `freq:${at + heard[1]}`, y: edge(across - 2), y2: edge(across + 2), fill: alpha(color, opacity * 0.5) })
    layers.push({ id: `dot:${spotKey(s)}`, kind: 'rect', x: `freq:${at}-3px`, x2: `freq:${at}+3px`, y: edge(from), y2: edge(from + dotSize), radius: 3, fill: alpha(color, opacity) })
    const called = (m: MapSpot) => (m.emoji ? `${m.call} ${m.emoji}` : m.call)
    // Each listed under it, found again by the line a click on the open label names.
    members.slice(0, mostListed).forEach((m, i) => spots.set(`${id}#${i + 1}`, m))
    // Each with its icon, as the label has its own, the calls lined up past them.
    const listed: (string | { text: string; icon?: { name: string; color: string } })[] = members.slice(0, mostListed).map(m => ({
      text: called(m),
      ...(m.icon ? { icon: { name: m.icon, color: alpha(m.iconColor ?? ink(m), fade(m)) } } : {}),
    }))
    if (members.length > mostListed) listed.push(t.more(members.length - mostListed))
    const [low, high] = marked(s, heard), middle = Math.round((low + high) / 2)
    annotations.push({
      id, text: called(s), hz: middle, part, pointer: false, align: 'center', baseline: true,
      stretch: { from: Math.round(low - middle), to: Math.round(high - middle) },
      // How many more it stands for, in a gray pill, and they under it while the pointer is on it.
      ...(members.length ? { more: listed, openBorder: { color: alpha(color, opacity), width: 2 }, openBackground: c.surface, badge: { text: `+${members.length}`, color: c.onSurfaceVariant, background: c.outlineVariant } } : {}),
      // A right-click takes it off the map: the operator's band tag for good, anything else for now.
      secondaryEvent: 'forget',
      offset: clear + from + dotSize + textGap,
      size: callSize, weight: 700, padding: { x: padding, y: paddingY }, radius: 0,
      ...(e.typography.mono.fontFamily ? { fontFamily: e.typography.mono.fontFamily } : {}),
      color: alpha(color, opacity), background: alpha(c.surface, 0.6),
      ...(s.icon ? { icon: { name: s.icon, color: alpha(s.iconColor ?? color, opacity) } } : {}),
      // With no radio to tune, a note is only something to read; one heading stations still lists them to pick.
      ...(s.note && !view.radio && members.every(m => m.note) ? {} : { event: 'spot' }),
    })
  }

  // The axis's labels a round step apart, far enough apart to read, and marks between them.
  const labelStep = niceStep(hzPerPx * (vertical ? 56 : 84))
  const markStep = [5, 4, 2].map(n => labelStep / n).find(m => m / hzPerPx >= 6)

  const scope: Control = {
    id: 'map', label: t.mapTitle(view.band), kind: 'bandScope', radio: view.radio ?? noRadio, event: 'scope',
    display, flow: vertical ? (view.inverted ? 'left' : 'right') : view.inverted ? 'up' : 'down', rising: vertical ? 'down' : 'right',
    window: { lowHz: hz(windowLo), highHz: hz(windowHi) }, span: shownHz, maxWidthHz: widestHz, follow: 0.15,
    // The band's middle until the operator pans or picks a view: the window's own runs as far past either edge.
    ...(view.center != null ? { centerHz: view.center } : {}),
    ...(display === 'both' ? { split } : {}),
    backgroundColor: c.surface,
    traceColor: dark ? trace.dark : trace.light, fillColor: dark ? trace.darkFill : trace.lightFill,
    // No grid over a blank spectrum: its lines would mark levels nothing is drawn at.
    gridColor: view.radio ? alpha(c.outlineVariant, 0.5) : '#00000000', gridDashed: true,
    waterfallSpeed: 5, waterfallColors: [c.surface, ...(dark ? waterfall.dark : waterfall.light)],
    // Tall, the labels lie on the spectrum where it shows, their ends at the axis, and else on the
    // waterfall, starting at it; wide, they line up on the axis's waterfall side, reaching over the spectrum.
    scale: strip ? {
      gap: axisGap, background: c.surfaceContainer,
      // A line along the axis where its ticks stand: its edge on the spectrum's side, or on the waterfall's where it heads it alone.
      borderTop: headed ? { color: c.outlineVariant, width: 1 } : { color: c.outline, width: 1.5 },
      ...(headed ? { borderBottom: { color: c.outline, width: 1.5 } } : {}),
      // With the spectrum, the ticks rise over it from the axis, and its labels sit past them.
      labels: { color: c.onSurfaceVariant, size: 11, interval: labelStep, ...(headed ? { align: 'start', offset: 3 } : { align: 'end', offset: -(tickLength * 1.75 + 3) }) },
      ticks: { color: c.outline, width: 1.5, align: 'end', offset: 0, length: headed ? 5 : tickLength, ...(markStep ? { interval: markStep } : {}) },
    } : {
      over: part, gap: axisGap, background: alpha(c.surfaceContainer, 0.9),
      borderTop: { color: c.outlineVariant, width: 1 }, borderBottom: { color: c.outlineVariant, width: 1 },
      labels: { color: c.onSurfaceVariant, size: 11, offset: 6 }, ticks: { color: c.outline, width: 1, offset: 0, length: 5 },
    },
    // The spectrum's levels and the waterfall's age, along the end of the band: the bottom tall, the right wide.
    levelScale: {
      side: 'end',
      labels: { color: c.onSurfaceVariant, size: 10 },
      ticks: { color: c.outline, width: 1, length: 4 },
    },
    center: { spectrum: { color: tunedLine, width: tuned.width }, waterfall: { color: tunedLine, width: tuned.width } },
    overlays: view.passband ? [{
      from: view.passband[0], to: view.passband[1],
      spectrum: { fill: dark ? tuned.passbandWaterfall : tuned.passbandWaterfallLight },
      waterfall: { fill: dark ? tuned.passbandWaterfall : tuned.passbandWaterfallLight },
    }] : [],
    annotations, layers,
  }
  return {
    scene: { version: 1, width: 600, height: 24, values: {}, layers: [], controls: [scope], layout: { column: [{ control: 'map', flex: 1 }], crossAxisAlignment: 'stretch' } },
    spots,
  }
}

/** A kept view as far as it reads as one: each field of the right kind, or left out. */
function viewFrom(value: unknown): { band?: string; span?: number; center?: number; split?: number; preset?: Preset } {
  if (!value || typeof value !== 'object') return {}
  const { band, span, center, split, preset } = value as Record<string, unknown>
  const number = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : undefined)
  return {
    ...(typeof band === 'string' && band in bandEdges ? { band } : {}),
    ...(number(span) != null ? { span: number(span) } : {}), ...(number(center) != null ? { center: number(center) } : {}),
    ...(number(split) != null ? { split: Math.min(0.9, Math.max(0.1, number(split)!)) } : {}),
    ...(presets.includes(preset as Preset) ? { preset: preset as Preset } : {}),
  }
}

export function createBandMap(host: BandMapHost): PanelHook {
  /** The spots each placement's last render drew, by annotation id, and the operation it was for. */
  const placements = new Map<string, { spots: Map<string, MapSpot>; operationUuid?: string }>()
  /**
   * Each placement's view as the operator left it on the scope — the width and middle it was zoomed
   * and panned to, for the band they were on, and the spectrum's share — kept for the session, so a
   * reloaded map opens where it was.
   */
  type View = { band?: string; span?: number; center?: number; split?: number; preset?: Preset }
  /** Where each placement's preset button goes next: the view's width and middle in Hz, and its name. */
  const presetsNext = new Map<string, { preset: Preset; span: number; center: number }>()
  /**
   * The views of the placements drawn most recently, all under one key: the host keeps ten keys an
   * extension, and a key a placement would leave behind once removed. Read once; until a read
   * succeeds, nothing is kept or written over what it would have found.
   */
  const views = new Map<string, View>()
  const stored = 'views', mostKept = 16
  /**
   * What the operator took off the map for the session: notes by their key, and stations by theirs
   * with when — a station spotted again after that shows again.
   */
  const hiddenNotes = new Map<string, true>(), hiddenSpots = new Map<string, number>(), mostHidden = 500
  const shown = (s: MapSpot) => (s.note ? !hiddenNotes.has(spotKey(s)) : !((hiddenSpots.get(spotKey(s)) ?? -Infinity) >= (s.heardAt ?? 0)))
  let loaded: Promise<boolean> | undefined
  const load = () => (loaded ??= host.kvGet(stored).then(kept => {
    if (kept && typeof kept === 'object' && !Array.isArray(kept)) {
      for (const [key, value] of Object.entries(kept)) if (!views.has(key)) views.set(key, viewFrom(value))
    }
    return true
  }, error => {
    console.warn(`ki2d-band-map: the kept views could not be read: ${error}`)
    loaded = undefined
    return false
  }))
  const viewOf = async (key: string): Promise<View> => {
    // Unread, a view of this render's alone, so the next read is not shadowed by it.
    if (!(await load())) return {}
    const v = views.get(key) ?? {}
    // The most recently drawn last, so the oldest go first.
    keepNewest(views, key, v, mostKept)
    return v
  }
  const keep = async () => {
    if (await load()) await host.kvSet(stored, Object.fromEntries(views) as JSONValue)
  }
  return {
    async getPanels(_args, ctx) {
      const t = words(ctx.locale)
      return [{
        key: 'band-map', title: t.title, description: t.description, icon: 'map-marker-radius', multiple: true, on: ['spots', 'qso', 'tick:2', 'radio'],
        form: [
          { type: 'field', fieldType: 'select', key: 'band', label: t.band, value: 'auto', options: [{ value: 'auto', label: t.auto }, ...bands.map(b => ({ value: b, label: b }))] },
          { type: 'field', fieldType: 'select', key: 'age', label: t.age, value: '30', options: ages.map(n => ({ value: String(n), label: t.minutes(n) })) },
          { type: 'field', fieldType: 'checkbox', key: 'notes', label: t.notes, value: true, description: t.notesHelp },
          { type: 'field', fieldType: 'checkbox', key: 'pan', label: t.panadapter, value: true },
          { type: 'field', fieldType: 'checkbox', key: 'waterfall', label: t.waterfall, value: true },
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
      const edges = bandEdges[band]
      const inBand = radioKHz != null && bandForKHz(radioKHz) === band
      // A toggle left as it was set; one never set follows the menu these replace, whose Off was no scope at all.
      const toggle = (value: unknown, fallback: boolean) => (value === true || value === 'true' ? true : value === false || value === 'false' ? false : fallback)
      const scoping = args.config.panadapter !== 'off'
      const picture = { waterfall: toggle(args.config.waterfall, scoping), pan: toggle(args.config.pan, scoping) }
      // The plan where the operation's station is, or the library's own where there is none; the
      // markers for its IARU region (its ITU one) and entity, or all of them.
      const station = String(args.operation.stationCall ?? '').trim().toUpperCase()
      const where = station ? regionAndCountryForDxccCode(entityForCall(station).dxccCode) : {}
      const segments = bandPlan(band, where)
      const markers = markersFor(band, station ? { entity: entityPrefixForCall(station), region: where.ituRegion } : {})
      const kind = radioMode && (inBand || draftBand === band) ? superModeForRadio(radioMode) : undefined
      const maxAgeMinutes = ages.includes(Number(args.config.age)) ? Number(args.config.age) : 30
      // Every spot from the sources the operator has on, as the app's Band Scope takes them, whatever
      // the Spots panel's own filters leave out; and what is marked on the band among them.
      const board = (await ctx.getSpots?.({ filter: 'sources', band, maxAgeMinutes })) ?? []
      const notes = toggle(args.config.notes, true) ? noteSpots((await ctx.getBandAnnotations?.({ band })) ?? [], edges) : []
      // The logging controls name a contact's mode, not a radio's: SSB is its sideband there, as a spot's is.
      // FT8 and FT4 there are the radio's data passband, which a spot of them leaves unmarked.
      const passband: [number, number] | undefined = fromDraft ? undefined
        : radio?.passband ? [radio.passband.lowHz, radio.passband.highHz] : passbands[radioMode ?? '']
      const plan = {
        edges: segments.slice(1).map(s => s.from),
        off: kind ? segments.filter(s => !planAllows(s, kind)).map(s => [s.from, s.to] as [number, number]) : [],
      }
      // The operator's zoom and pan, while the map stays on the band they were made on, and the split.
      const v = await viewOf(key)
      if (v.band !== band) {
        Object.assign(v, { band, span: undefined, center: undefined, preset: undefined })
        await keep()
      }
      // The preset views: the whole band; the plan's stretch for the radio's mode, a twentieth wider
      // each side; and the radio with room either side, phone's wider, or a mode not known. Each but
      // the band only where it shows less than the whole band.
      const [lo, hi] = edges
      const stretch = kind && inBand ? modeStretch(segments, kind, radioKHz) : undefined
      const around = kind === 'PHONE' || !kind ? 25 : 5
      const ranges: Partial<Record<Preset, [number, number]>> = {
        band: [lo, hi],
        ...(stretch ? { segment: [stretch[0] - (stretch[1] - stretch[0]) / 20, stretch[1] + (stretch[1] - stretch[0]) / 20] } : {}),
        ...(inBand ? { radio: [radioKHz - around, radioKHz + around] } : {}),
      }
      const offered = presets.filter(p => ranges[p] && (p === 'band' || ranges[p]![1] - ranges[p]![0] < (hi - lo) * 0.999))
      // Where the view is now: the preset it was put at, or the whole band where it has not moved.
      const current = v.preset ?? (v.span == null && v.center == null ? 'band' : undefined)
      const next = nextPreset(offered, current)
      if (next) {
        const [from, to] = ranges[next]!
        keepNewest(presetsNext, key, { preset: next, span: Math.round((to - from) * 1000), center: Math.round(((from + to) / 2) * 1000) }, 64)
      } else presetsNext.delete(key)
      const view: MapView = {
        band, edges, spots: [...notes, ...mapSpots(board, args.clock.nowMillis, edges)].filter(shown), markers, maxAgeMinutes,
        radio: radio?.id && inBand ? radio.id : undefined, picture, draftKHz: fromDraft ? radioKHz : undefined,
        passband: inBand ? passband : undefined, plan, superMode: kind, inverted: args.config.direction === 'inverted', span: v.span, center: v.center, split: v.split,
        preset: current, next,
      }
      const { scene, spots } = bandMapScene(args.environment, view, t)
      keepNewest(placements, key, { spots, operationUuid: typeof args.operation.uuid === 'string' ? args.operation.uuid : undefined }, 64)
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
      // Where a zoom, a pan or a split drag ended, kept for the next render and a reloaded map; a zoom
      // of 0 is a double click on the axis, the whole band back.
      if (event.action === 'scope') {
        const value = event.value
        if (typeof value !== 'number' || !Number.isFinite(value)) return { values: {} }
        // A click on the picture the app could not tune itself — the radio is on another band, or
        // there is none to draw — tunes the radio there.
        if (!event.gesture) {
          const radio = await host.readRadio()
          if (radio?.id) refusedBy(await host.setRadio({ id: radio.id, frequencyHz: Math.round(value) }))
          return { values: {} }
        }
        const v = await viewOf(key)
        // Moved by hand, the view is no longer the preset it was put at.
        if (event.gesture === 'zoom') Object.assign(v, value > 0 ? { span: Math.round(value), preset: undefined } : { span: undefined, center: undefined, preset: undefined })
        else if (event.gesture === 'pan') Object.assign(v, { center: Math.round(value), preset: undefined })
        else if (event.gesture === 'split') v.split = Math.min(0.9, Math.max(0.1, value))
        // The spectrum's levels and the waterfall's speed are the app's own to keep.
        else return { values: {} }
        await keep()
        return { values: {} }
      }
      // The preset button: the next of the views, the one it showed.
      if (event.action === 'preset') {
        const to = presetsNext.get(key)
        if (!to) return { values: {} }
        const v = await viewOf(key)
        Object.assign(v, to.preset === 'band' ? { span: undefined, center: undefined, preset: 'band' } : { span: to.span, center: to.center, preset: to.preset })
        await keep()
        return { values: {} }
      }
      // A marker's name, shown in its menu: nothing more to do.
      if (event.action === 'marker') return { values: {} }
      // On a group's open list, the station on the line clicked; the label's own, its first.
      const line = event.at?.line
      const head = event.annotation ? drawn?.spots.get(event.annotation) : undefined
      const listed = event.annotation && line ? drawn?.spots.get(`${event.annotation}#${line}`) : undefined
      // A right-click: the operator's band tag taken down, another's note or a station hidden for the
      // session. On the count past the list, nothing: no one station is named there.
      if (event.action === 'forget') {
        const spot = line ? listed : head
        if (!spot) return { values: {} }
        if (spot.note && spot.source === 'user' && spot.noteKey) await host.bandAnnotations.remove([spot.noteKey], { source: 'user' })
        else if (spot.note) keepNewest(hiddenNotes, spotKey(spot), true, mostHidden)
        else keepNewest(hiddenSpots, spotKey(spot), spot.heardAt ?? 0, mostHidden)
        return { values: {} }
      }
      // A click on the count past the list works the group's first.
      const spot = listed ?? head
      // As a Spots Panel tap: the station into this operation's logging fields, which move the radio
      // there too. With no such operation open, the radio alone.
      if (event.action === 'spot') {
        if (!spot) return { values: {} }
        // Nothing to log at a note: the radio alone, to where it is, in the mode it is in.
        if (spot.note) {
          const radio = await host.readRadio()
          if (radio?.id) refusedBy(await host.setRadio({ id: radio.id, frequencyHz: Math.round(spot.khz * 1000) }))
          return { values: {} }
        }
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
      // A control this map does not draw: a dead one would say nothing of why.
      throw new Error(t.unknown(event.action))
    },
  }
}
