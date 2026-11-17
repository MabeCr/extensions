// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// How a contest summary breaks its score down, the same in every contest.
//
//   * A band line says what the band is worth, not only how busy it was:
//     its QSOs, its points and its multipliers — `**20m**: 12 QSOs, 30 pts,
//     8 mults`. A contest whose multipliers run the whole event counts each one
//     on the band where it was first worked, so the lines add up to the total.
//   * Every count agrees with its number: `1 QSO`, never `1 QSOs`.
//   * Bands go longest wavelength first, 160m down to the microwaves, in every
//     contest, so an operator moving between two events reads them the same.
//   * A contest whose exchange is an ARRL/RAC section shows every section as
//     one checklist, those worked struck through (sections.ts).

import type { HookContext } from "@ham2k/extension-sdk"
import { fmtInteger } from "@ham2k/lib-format-tools"

import { tFor } from "./i18n.ts"

/// Longest wavelength first. A band not listed sorts after these, by name.
const BAND_ORDER = [
  '2190m', '630m', '560m', '160m', '80m', '60m', '40m', '30m', '20m', '17m', '15m', '12m', '10m', '8m', '6m', '5m', '4m',
  '2m', '1.25m', '70cm', '33cm', '23cm', '13cm', '9cm', '6cm', '3cm', '1.25cm', '6mm', '4mm', '2.5mm', '2mm', '1mm',
  'submm',
]

/// [bands] in band order, longest wavelength first.
export function sortBands(bands: Iterable<string>): string[] {
  const rank = (band: string) => {
    const index = BAND_ORDER.indexOf(band)
    return index === -1 ? BAND_ORDER.length : index
  }
  return [...bands].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

export type CountedNoun = 'qso' | 'point' | 'mult'

/// `1 QSO`, `12 QSOs`, `1 pt`, `30 pts`, `1 mult`, `8 mults`.
export function counted(count: number, noun: CountedNoun, ctx: Pick<HookContext, 'locale'>): string {
  const t = tFor(ctx)
  return count === 1 ? t(`${noun}One`) : t(`${noun}Many`, { formatted: fmtInteger(count) })
}

/// One band's share of the score.
export interface BandRow {
  band: string
  qsos: number
  /// Left out for a contest that scores no points per contact.
  points?: number
  /// Left out for a contest with no multipliers.
  mults?: number
  /// Anything else the band line carries — `Longest: 165 km` — after a `•`.
  more?: string[]
}

export interface BandBreakdownOptions {
  /// Bands shown as `—` when nothing was worked on them: the contest's own
  /// bands, so an empty one reads as a band still open. Any band worked
  /// outside this list is shown too.
  bands?: string[]
  /// The multiplier counted in the contest's own word — `2 prefixes`,
  /// `1 country` — in place of `mults`.
  multNoun?: (count: number) => string
}

/// The band lines of a summary, in band order, one per line.
export function bandBreakdown(rows: BandRow[], ctx: Pick<HookContext, 'locale'>, options: BandBreakdownOptions = {}): string {
  const byBand = new Map<string, BandRow>()
  for (const row of rows) if (row.qsos > 0) byBand.set(row.band, row)
  const bands = sortBands(new Set([...(options.bands ?? []), ...byBand.keys()]))
  return bands.map((band) => {
    const row = byBand.get(band)
    if (!row) return `**${band}**: —`
    const parts = [counted(row.qsos, 'qso', ctx)]
    if (row.points !== undefined) parts.push(counted(row.points, 'point', ctx))
    if (row.mults !== undefined) parts.push(options.multNoun ? options.multNoun(row.mults) : counted(row.mults, 'mult', ctx))
    return `**${band}**: ${[parts.join(', '), ...(row.more ?? [])].join(' • ')}`
  }).join('\n')
}

export { SECTION_ROWS, sectionsChecklist } from "./sections.ts"
