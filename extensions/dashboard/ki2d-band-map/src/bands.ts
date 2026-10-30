// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MPL-2.0
import { entityForCall, regionAndCountryForDxccCode } from '@ham2k/extension-sdk'
import { modeForFrequency, superModeForMode, type SuperMode } from '@ham2k/lib-operation-data'

/** Each band's edges in kHz, as the US allocates them: the map runs from one to the other. */
export const bandEdges: Record<string, [number, number]> = {
  '160m': [1800, 2000], '80m': [3500, 4000], '60m': [5330, 5410], '40m': [7000, 7300], '30m': [10100, 10150],
  '20m': [14000, 14350], '17m': [18068, 18168], '15m': [21000, 21450], '12m': [24890, 24990], '10m': [28000, 29700],
  '6m': [50000, 54000], '2m': [144000, 148000], '1.25m': [222000, 225000], '70cm': [420000, 450000],
}
export const bands = Object.keys(bandEdges)

export const bandForKHz = (khz: number | null | undefined) =>
  khz == null ? undefined : bands.find(band => khz >= bandEdges[band][0] && khz <= bandEdges[band][1])

/** SSB's sideband by the usual convention: lower below 10 MHz, but upper on 60 m. */
const sidebandFor = (khz: number) => (khz < 10000 && bandForKHz(khz) !== '60m' ? 'LSB' : 'USB')

const digital = ['FT8', 'FT4', 'JS8', 'PSK', 'PSK31', 'DATA', 'DIGI', 'OLIVIA', 'MFSK', 'JT65', 'JT9', 'Q65', 'FST4']

/**
 * The radio mode a spot's mode asks for, among the ones the radio offers: SSB on its usual
 * sideband, digital modes on upper sideband, the radio's data mode first.
 */
export function radioModeFor(mode: string | undefined, khz: number, offered: string[]): string | undefined {
  if (!mode) return undefined
  const wanted = mode === 'SSB' ? [sidebandFor(khz)]
    : ['USB', 'LSB', 'CW', 'AM', 'FM', 'RTTY'].includes(mode) ? [mode, ...(mode === 'RTTY' ? ['DATA-USB', 'USB'] : [])]
    : digital.includes(mode) ? ['DATA-USB', 'USB']
    : []
  return wanted.find(m => offered.includes(m))
}

/**
 * The stretch of band a spot's signal takes, in Hz either side of its frequency: phone 2.8 kHz on
 * its sideband, AM 2.8 kHz and FM 7 kHz either side, data 3 kHz above the dial, CW 250 Hz around it.
 */
export function spotPassband(mode: string | undefined, khz: number): [number, number] | undefined {
  const sideband = mode === 'SSB' ? sidebandFor(khz) : mode
  if (sideband === 'USB') return [0, 2800]
  if (sideband === 'LSB') return [-2800, 0]
  if (mode === 'AM') return [-2800, 2800]
  if (mode === 'FM') return [-7000, 7000]
  if (mode === 'RTTY' || (mode && digital.includes(mode))) return [0, 3000]
  if (mode === 'CW') return [-125, 125]
  return undefined
}

/** The mode a spot that names none is most likely in: the band plan's there, for the station's own region and country. */
export function plannedMode(call: string, khz: number): string | undefined {
  return modeForFrequency(khz, regionAndCountryForDxccCode(entityForCall(call).dxccCode)) || undefined
}

/** A stretch of a band plan: its mode, null where the plan leaves it open, false where it is out of band. */
export type PlanSegment = { from: number; to: number; mode: string | null | false | undefined }
const plans = new Map<string, PlanSegment[]>()

/**
 * A band's plan as the library has it, for a region and country: the stretches where its mode stays
 * the same, end to end. The library answers only frequency by frequency, so the band is sampled
 * finely enough for its narrowest segments, and each change of mode found to within 10 Hz.
 */
export function bandPlan(band: string, where: { ituRegion?: number; countryCode?: string }): PlanSegment[] {
  const key = `${band} ${where.ituRegion ?? ''} ${where.countryCode ?? ''}`
  const known = plans.get(key)
  if (known) return known
  const [lo, hi] = bandEdges[band]
  const modeAt = (khz: number) => modeForFrequency(khz, where)
  const step = Math.max(0.5, (hi - lo) / 4000)
  const segments: PlanSegment[] = [{ from: lo, to: hi, mode: modeAt(lo) }]
  for (let k = 1; lo + k * step <= hi; k++) {
    const khz = Math.min(lo + k * step, hi), mode = modeAt(khz), last = segments[segments.length - 1]
    if (mode === last.mode) continue
    let [a, b] = [khz - step, khz]
    while (b - a > 0.01) {
      const m = (a + b) / 2
      if (modeAt(m) === last.mode) a = m
      else b = m
    }
    // A plan's edges fall on whole half kHz; within 15 Hz of one, it is that.
    const edge = Math.abs(b - Math.round(b * 2) / 2) <= 0.015 ? Math.round(b * 2) / 2 : Math.round(b * 100) / 100
    last.to = edge
    segments.push({ from: edge, to: hi, mode })
  }
  plans.set(key, segments)
  return segments
}

/** A radio's mode as the band plan sorts modes: CW, phone, or data. */
export const superModeForRadio = (mode: string): SuperMode => (mode.startsWith('CW') ? 'CW' : superModeForMode(mode))

/** Whether a band plan's stretch is meant for a kind of mode: open stretches are for any, out of band for none. */
export const planAllows = (segment: PlanSegment, kind: SuperMode) =>
  segment.mode === null || segment.mode === undefined || (segment.mode !== false && superModeForMode(segment.mode) === kind)

/**
 * The stretch of a plan meant for a kind of mode around `khz`: its segments for that kind (or open
 * to any) run together, the one holding `khz`, or else the nearest. None where the plan has none.
 */
export function modeStretch(segments: PlanSegment[], kind: SuperMode, khz: number): [number, number] | undefined {
  const runs: [number, number][] = []
  for (const s of segments.filter(s => planAllows(s, kind))) {
    const last = runs[runs.length - 1]
    if (last && last[1] >= s.from) last[1] = s.to
    else runs.push([s.from, s.to])
  }
  const away = ([from, to]: [number, number]) => Math.max(from - khz, khz - to, 0)
  return runs.sort((a, b) => away(a) - away(b))[0]
}
