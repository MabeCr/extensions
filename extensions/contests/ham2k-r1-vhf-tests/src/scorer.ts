// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// IARU Region 1 VHF+ contest scoring, ported from app-polo's
// Region1VHFContestsExtension `scoringForQSO`/`accumulateScoreForOperation`/
// `summarizeScore` into a `ContestScorer`.
//
// Points are `distanceForRegion1VHFContests(ourGrid, theirGrid) *
// multiplier[band]` — R1's own great-circle function (`@ham2k/lib-geo-tools`),
// which rounds UP (`floor(km) + 1`), unlike ARRL's plain `round(km)`. It also
// already try/catches a malformed grid internally and returns null, so
// nothing here needs to guard against `gridToLocation` throwing the way
// arrl-vhf-tests' scorer does.
//
// `operation.grid` is the segment-effective grid for each QSO (the harness
// resolves `break`/`start` overrides before calling `scoreQso`), so a rover's
// current grid is simply what this reads — same as arrl-vhf-tests, no
// segment-walking here.
//
// A QSO worked while OUR grid differs from a prior QSO with the same station
// is not a dupe — a rover changing squares creates a new, separately-scored
// contact. Only a repeat of the exact (call, band, our grid, their grid)
// tuple is a dupe.

import { contestArithmetic, contestSummary } from "@ham2k/extension-sdk"
import type { ContestScorer, JSONValue, QsoScoreVerdict } from "@ham2k/extension-sdk"
import { bandBreakdown } from "@ham2k/lib-contest-summary"
import { fmtInteger } from "@ham2k/lib-format-tools"
import { distanceForRegion1VHFContests } from "@ham2k/lib-geo-tools"
import { BAND_MULTIPLIERS, trimmedGrid } from "@ham2k/lib-vhf-contests"

import { eventFor } from "./events.ts"
import { tFor } from "./i18n.ts"

import manifest from "../manifest.json" with { type: "json" }

export type R1VHFScoresheet = {
  worked: Record<string, string[]>
  bands: Record<string, number>
  /// band → the points its contacts scored. Optional: a checkpoint cached
  /// before it existed has none, and its band lines show no points until the
  /// log is rescored.
  bandPoints?: Record<string, number>
  qsos: number
  points: number
  distanceTotal: number
  maxDistance: number
  maxDistancePerBand: Record<string, number>
}

function str(value: JSONValue | undefined): string {
  return typeof value === 'string' ? value : ''
}

/// The running event as the operation's title names it — and so as its score
/// is titled, so the two cannot disagree.
export function contestTitle(ref: { ref?: JSONValue } | undefined): string {
  return eventFor(str(ref?.ref))?.short ?? manifest.shortName
}

export const R1VHFScorer: ContestScorer<R1VHFScoresheet> = {
  startScoresheet(): R1VHFScoresheet {
    return {
      worked: {}, bands: {}, bandPoints: {}, qsos: 0, points: 0, distanceTotal: 0,
      maxDistance: 0, maxDistancePerBand: {},
    }
  },

  scoreQso({ scoresheet, qso, operation, ref }) {
    const base = scoresheet

    const event = eventFor(str(ref?.ref))
    if (!event) return { scoresheet: base, score: { value: 0 } }

    const their = (qso.their as Record<string, JSONValue>) ?? {}
    const call = str(their.call)
    if (!call) return { scoresheet: base, score: { value: 0 } }

    const band = str(qso.band)
    if (!event.bands.includes(band)) {
      return { scoresheet: base, score: { value: 0, alerts: ['invalidBand'] } }
    }

    const ourGrid = trimmedGrid(str(operation.grid))
    const contestRef = ((qso.refs as Record<string, JSONValue>[] | undefined) ?? []).find(
      (r) => r?.type === 'r1-vhf-tests',
    )
    const theirGrid = trimmedGrid(str(contestRef?.grid))

    if (!ourGrid) {
      return { scoresheet: base, score: { value: 0, alerts: ['ourGrid'] } }
    }
    if (!theirGrid) {
      return { scoresheet: base, score: { value: 0, incomplete: ['r1-vhf-tests/grid'] } }
    }

    const key = `${call}|${band}|${ourGrid}`
    const priorGrids = base.worked[key] ?? []
    if (priorGrids.includes(theirGrid)) {
      return { scoresheet: base, score: { value: 0, dupe: true, alerts: ['duplicate'] } }
    }

    // Worked before, never on this band. The host's core scorer would say so,
    // but steps aside for this verdict (`dupe: false` below), so it says so here.
    const workedBands = Object.keys(base.worked).filter((k) => k.startsWith(`${call}|`)).map((k) => k.split('|')[1])
    const newBand = workedBands.length > 0 && !workedBands.includes(band)

    const distance = distanceForRegion1VHFContests(ourGrid, theirGrid)
    if (distance === null) return { scoresheet: base, score: { value: 0, alerts: ['invalidExchange'] } }
    const value = distance * (BAND_MULTIPLIERS[band] ?? 0)

    base.worked[key] = [...priorGrids, theirGrid]
    base.bands[band] = (base.bands[band] ?? 0) + 1
    base.bandPoints ??= {}
    base.bandPoints[band] = (base.bandPoints[band] ?? 0) + value
    base.qsos += 1
    base.points += value
    base.distanceTotal += distance
    base.maxDistance = Math.max(base.maxDistance, distance)
    base.maxDistancePerBand[band] = Math.max(base.maxDistancePerBand[band] ?? 0, distance)

    // `dupe: false` says this contact passed the contest's own duplicate test —
    // a rover in a new square is not a repeat — which is what makes the host's
    // core scorer step aside rather than mark it by call, band and mode.
    const score: QsoScoreVerdict = { value, band, distance, dupe: false }
    if (newBand) score.notices = ['newBand']
    return { scoresheet: base, score }
  },

  summarizeScore({ scoresheet, ref, scope }, ctx) {
    const t = tFor(ctx)
    // No multipliers: the band factor scales a contact's distance, it is not a
    // count that multiplies the total.
    const bandLines = bandBreakdown(
      Object.entries(scoresheet.bands).map(([band, qsos]) => ({
        band,
        qsos,
        points: scoresheet.bandPoints?.[band],
        more: [t('longest', { formatted: fmtInteger(scoresheet.maxDistancePerBand[band] ?? 0) })],
      })),
      ctx,
    )

    return contestSummary(
      {
        key: 'r1-vhf-tests',
        scope,
        icon: 'flag-checkered',
        title: contestTitle(ref),
        total: scoresheet.points,
        arithmetic: contestArithmetic(
          { qsos: scoresheet.qsos, points: scoresheet.points, more: [`${fmtInteger(scoresheet.distanceTotal)} km`] },
          ctx,
        ),
        detail: bandLines,
        extra: { qsos: scoresheet.qsos },
      },
      ctx,
    )
  },
}
