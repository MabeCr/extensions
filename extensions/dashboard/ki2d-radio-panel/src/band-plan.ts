// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MPL-2.0
//
// The band plan across the panafall, as the app's own Band Scope draws it at "Edges & Modes", less its
// FT8/FT4 windows and license classes: the band's edges, with what lies outside them dimmed, and where
// CW, data and phone begin, each labelled on a tag fading into the band. The plan is the station's
// own, by its region and country, as the library has it.
import { modeForFrequency, superModeForMode } from '@ham2k/lib-operation-data'
import type { PanelSceneSpectrumLayer } from '@ham2k/extension-sdk'

/** Each band's widest edges in kHz, the US's: the plan is looked for between them. */
export const bandEdges: Record<string, [number, number]> = {
  '160m': [1800, 2000], '80m': [3500, 4000], '60m': [5330, 5410], '40m': [7000, 7300], '30m': [10100, 10150],
  '20m': [14000, 14350], '17m': [18068, 18168], '15m': [21000, 21450], '12m': [24890, 24990], '10m': [28000, 29700],
  '6m': [50000, 54000], '4m': [70000, 70500], '2m': [144000, 148000], '1.25m': [222000, 225000], '70cm': [420000, 450000],
}

/**
 * A stretch of a band plan: its mode, null where the plan leaves it open, an empty string where the
 * plan says nothing within the band, false or undefined out of band.
 */
export type PlanSegment = { from: number; to: number; mode: string | null | false | undefined }
export interface Where { ituRegion?: number; countryCode?: string }
const plans = new Map<string, PlanSegment[]>()

/**
 * A band's plan for a region and country: the stretches where its mode stays the same, end to end.
 * The library answers only frequency by frequency, so the band is sampled finely enough for its
 * narrowest segments, and each change of mode found to within 10 Hz.
 */
export function bandPlan(band: string, where: Where): PlanSegment[] {
  const key = `${band} ${where.ituRegion ?? ''} ${where.countryCode ?? ''}`
  const known = plans.get(key)
  if (known) return known
  const edges = bandEdges[band]
  if (!edges) return []
  const [lo, hi] = edges
  // Half a kHz up to 4 MHz wide: 2 m's windows have half-kHz gaps between them, and a coarser step
  // would join FT8's window to the gap below it.
  const step = Math.max(0.5, (hi - lo) / 8000)
  const at = (khz: number) => modeForFrequency(khz, where)
  const segments: PlanSegment[] = [{ from: lo, to: hi, mode: at(lo) }]
  for (let k = 1; lo + k * step <= hi; k++) {
    const khz = Math.min(lo + k * step, hi), mode = at(khz), last = segments[segments.length - 1]
    if (mode === last.mode) continue
    let [a, b] = [khz - step, khz]
    while (b - a > 0.01) {
      const m = (a + b) / 2
      if (at(m) === last.mode) a = m
      else b = m
    }
    // A plan's edges fall on whole half kHz; within 15 Hz of one, it is that.
    const edge = Math.abs(b - Math.round(b * 2) / 2) <= 0.015 ? Math.round(b * 2) / 2 : Math.round(b * 100) / 100
    last.to = edge
    segments.push({ from: edge, to: hi, mode })
  }
  // A stretch the library has no segment for between two it has, such as a beacon slot, is a hole
  // in its plan, not the band's end: unplanned, it takes the kind of mode around it.
  const banded = (s?: PlanSegment) => s !== undefined && s.mode !== false && s.mode !== undefined
  for (const [i, s] of segments.entries()) if (s.mode === undefined && banded(segments[i - 1]) && banded(segments[i + 1])) s.mode = ''
  plans.set(key, segments)
  return segments
}

/** The modes the plan gives a narrow window of their own, inside a stretch of another. */
const windowModes = ['FT8', 'FT4']

type Kind = 'CW' | 'DATA' | 'PHONE' | 'ANY'
const kindLabels: Record<Kind, string> = { CW: 'CW', DATA: 'Data', PHONE: 'Phone', ANY: 'All modes' }
/** The band's edges and its modes' boundaries: the barrier's yellow. */
const boundaryInk = '#FFD400'
/** A mode's label: dark, on a light gold tag. */
const modeTag = '#F2DC8C', modeInk = '#2B2410'
/** Out of band: a light see-through tint, so what is heard there still shows. */
const outside = '#24D0D6DE'

const inBand = (s: PlanSegment) => s.mode !== false && s.mode !== undefined
const kindOf = (mode: string | null): Kind => (mode == null ? 'ANY' : (superModeForMode(mode) as Kind))

export interface PlanLayout {
  /** Hz across one pixel of the panafall, at the width it shows. */
  hzPerPx: number
  /** Where the labels hang from: `spectrum`, or `waterfall` where there is no spectrum. */
  top: string
  /** Only what falls within this stretch, in kHz, is drawn: the rest would only spend layers. */
  window: [number, number]
  /** The panafall's height in pixels: the edges' stripes are drawn to it, so they keep their slant. */
  height: number
  /** The band's edges and what lies outside them, and no mode's start. */
  edgesOnly?: boolean
}

/** A label's row height, its size, and how far it stands in from its line. */
const planRow = 17, labelSize = 10, labelInset = 8
/** How far the tag behind a mode's label fades over the band. */
const tagLength = 56
/** Rows of mode labels: a second where two starts lie closer than a label's width. */
const rows = 2

/** A band's edge, as a construction barrier: yellow and black stripes slanting across a strip [barrier] wide. */
const barrier = 3
const stripes = (height: number) => {
  const tall = Math.max(1, Math.ceil(height))
  const slants = Array.from({ length: Math.ceil(tall / 8) + 1 },
    (_, i) => `<polygon points="0,${i * 8} ${barrier},${i * 8 - barrier} ${barrier},${i * 8 + 4 - barrier} 0,${i * 8 + 4}"/>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${barrier} ${tall}" preserveAspectRatio="none"><rect width="${barrier}" height="${tall}" fill="${boundaryInk}"/><g fill="#111111">${slants.join('')}</g></svg>`
}
/** A tag solid up to [solid] of its length, under its text, then fading out. */
const tag = (solid: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" preserveAspectRatio="none"><defs><linearGradient id="t" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${modeTag}" stop-opacity=".95"/><stop offset="${solid}" stop-color="${modeTag}" stop-opacity=".95"/><stop offset="1" stop-color="${modeTag}" stop-opacity="0"/></linearGradient></defs><rect width="10" height="10" fill="url(#t)"/></svg>`

/** The layers for a band's plan: its edges and what lies outside them, then where each kind of mode starts. */
export function planLayers(segments: PlanSegment[], layout: PlanLayout): PanelSceneSpectrumLayer[] {
  const [lo, hi] = layout.window
  const seen = (from: number, to = from) => to >= lo && from <= hi
  const hz = (khz: number) => Math.round(khz * 1000)
  const row = (n: number, dy = 0) => `${layout.top}+${2 + n * planRow + dy}px`
  const layers: PanelSceneSpectrumLayer[] = []

  const runs: [number, number][] = []
  for (const s of segments.filter(inBand)) {
    const last = runs[runs.length - 1]
    if (last && last[1] >= s.from) last[1] = s.to
    else runs.push([s.from, s.to])
  }
  if (!runs.length) return []
  const gaps: [number, number][] = runs.map(([from], i) => [i ? runs[i - 1][1] : -Infinity, from])
  gaps.push([runs[runs.length - 1][1], Infinity])
  for (const [from, to] of gaps) {
    if (!seen(from, to)) continue
    layers.push({ id: `plan:out:${from}`, kind: 'rect', x: `freq:${Number.isFinite(from) ? hz(from) : 0}`, x2: `freq:${Number.isFinite(to) ? hz(to) : hz(hi * 2)}`, fill: outside })
  }
  const edges = [...new Set(runs.flat())]
  for (const khz of edges.filter(k => seen(k))) {
    layers.push({ id: `plan:edge:${khz}`, kind: 'svg', x: `freq:${hz(khz)}-${barrier / 2}px`, x2: `freq:${hz(khz)}+${barrier / 2}px`, svg: stripes(layout.height) })
  }
  if (layout.edgesOnly) return layers

  // The modes' stretches. A window of its own, or a hole in the plan, takes the kind before it (at a
  // run's start, the one after), so it splits no stretch.
  const banded = segments.filter(inBand)
  const kinds = banded.map(s => (typeof s.mode === 'string' && windowModes.includes(s.mode)) || s.mode === '' ? undefined : kindOf(s.mode as string | null))
  for (const [i, s] of banded.entries()) {
    if (kinds[i]) continue
    kinds[i] = (i && banded[i - 1].to === s.from ? kinds[i - 1] : undefined) ?? kinds.slice(i + 1).find(k => k) ?? 'DATA'
  }
  const stretches: { from: number; to: number; kind: Kind }[] = []
  for (const [i, s] of banded.entries()) {
    const last = stretches[stretches.length - 1]
    if (last && last.to === s.from && last.kind === kinds[i]) last.to = s.to
    else stretches.push({ from: s.from, to: s.to, kind: kinds[i]! })
  }
  // A line where each starts (the band's edge already marks its first), and its label on a tag along
  // the top, in the first row where it clears the labels before it.
  const taken: [number, number][][] = Array.from({ length: rows }, () => [])
  for (const s of stretches) {
    if (!seen(s.from, s.to)) continue
    const text = kindLabels[s.kind], textPx = labelInset + text.length * labelSize * 0.62
    const long = Math.max(tagLength, textPx + 8)
    const span: [number, number] = [hz(s.from), hz(s.from) + long * layout.hzPerPx]
    if (!edges.includes(s.from)) layers.push({ id: `plan:mode:${s.from}`, kind: 'line', x: `freq:${hz(s.from)}`, width: 2, color: boundaryInk })
    const lane = taken.findIndex(spans => spans.every(([a, b]) => span[1] <= a || span[0] >= b))
    if (lane < 0) continue
    taken[lane].push(span)
    layers.push({ id: `plan:mode-tag:${s.from}`, kind: 'svg', x: `freq:${hz(s.from)}`, x2: `freq:${hz(s.from)}+${Math.round(long)}px`,
      y: row(lane, -2), y2: row(lane + 1, -1), svg: tag(textPx / long) })
    layers.push({ id: `plan:mode-label:${s.from}`, kind: 'text', x: `freq:${hz(s.from)}+${labelInset}px`, y: row(lane), text, size: labelSize, weight: 700, color: modeInk })
  }
  return layers
}
