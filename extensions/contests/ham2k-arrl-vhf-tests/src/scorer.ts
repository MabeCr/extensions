// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// ARRL VHF+ contest scoring, ported from app-polo's ARRLVHFContestsExtension
// `scoringForQSO`/`accumulateScoreForOperation`/`summarizeScore` into a
// `ContestScorer`.
//
// Three scoring shapes share one scorer, selected by the running event's
// `score` kind (events.ts):
//   * `points` — a fixed value per band, times the grid squares worked on each
//     band (Jan/Jun/Sep VHF, rules 5.3–5.4). A rover adds one multiplier for
//     each grid square it made a contact from (5.4.2). A fixed station may not
//     move (6.3), so a log made from more than one grid is a rover's, whatever
//     its call says.
//   * `distance` — `round(great-circle km) * multipliers[band]` (222 MHz+).
//   * `distanceAndPoints` — the distance formula plus `points.qso` ONCE per
//     unique callsign per band (10 GHz+, rules 5.1–5.4). The QSO points are
//     not multiplied by the band factor, and a station re-worked on the same
//     band from a new location earns distance only. Only a contact carrying
//     the event's full-length grid takes the QSO points, so an earlier
//     short-grid contact with the same station neither earns them nor uses
//     them up.
//
// `operation.grid` is the segment-effective grid for each QSO — the harness
// resolves `break`/`start` overrides before calling `scoreQso`
// (docs/design/contests.md, `ContestScorer.scoreQso` doc comment), so a
// rover's current grid is simply what this reads; no segment-walking here.
//
// A QSO worked while OUR grid differs from a prior QSO with the same station
// is not a dupe — a rover changing squares creates a new, separately-scored
// contact even against a station already worked. Only a repeat of the exact
// (call, band, our grid, their grid) tuple is a dupe. A QSO with no their-grid
// exchange never reaches the dupe check at all — it exits earlier, held back
// as `incomplete` on the grid field, and is never recorded into `worked`. A grid that is
// present but shorter than the event's exchange (`shortGrid`) still scores
// its distance: the sponsor's log checker may accept it, and refusing the
// points outright would hide a real contact behind a typing slip.

import { contestArithmetic, contestSummary } from "@ham2k/extension-sdk"
import type { ContestScorer, JSONValue, QsoScoreVerdict } from "@ham2k/extension-sdk"
import { bandBreakdown } from "@ham2k/lib-contest-summary"
import { fmtInteger } from "@ham2k/lib-format-tools"
import { distanceOnEarth, gridToLocation } from "@ham2k/lib-geo-tools"

import { eventFor } from "./events.ts"
import { isRover, trimmedGrid } from "./exchange.ts"
import { tFor } from "./i18n.ts"

import manifest from "../manifest.json" with { type: "json" }

export type ARRLVHFScoresheet = {
  /// `call|band|ourGrid` → the set of their-grids already worked under that
  /// key.
  worked: Record<string, string[]>
  /// `call|band` → the QSO points already went to a contact with this
  /// station on this band (`distanceAndPoints` events only).
  qsoPointsTaken: Record<string, true>
  bands: Record<string, number>
  /// band → the points its contacts scored. Optional: a checkpoint cached
  /// before it existed has none, and its band lines show no points until the
  /// log is rescored.
  bandPoints?: Record<string, number>
  /// band → the grid squares worked on it: the multipliers of a `points`
  /// event. Optional, like `bandPoints`.
  bandGrids?: Record<string, string[]>
  /// The grid squares a contact was made from — a rover's own multipliers.
  ourGrids?: string[]
  qsos: number
  points: number
  /// The two halves of `points` for `distanceAndPoints` events — the summary
  /// reports them separately, since the rules score them separately.
  distancePoints: number
  qsoPoints: number
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

function distanceKm(ourGrid: string, theirGrid: string): number | null {
  if (!ourGrid || !theirGrid) return null
  // gridToLocation THROWS on anything that isn't a well-formed 4/6/8-char
  // locator — unlike distanceOnEarth, which returns null. A grid that made it
  // this far already passed the exchange field's pattern, but `operation.grid`
  // has no equivalent gate, so a malformed rover grid must not take down
  // scoring for the whole log.
  let our: [number, number]
  let their: [number, number]
  try {
    our = gridToLocation(ourGrid)
    their = gridToLocation(theirGrid)
  } catch {
    return null
  }
  return distanceOnEarth({ lat: our[0], lon: our[1] }, { lat: their[0], lon: their[1] }, { units: 'km' })
}

export const ARRLVHFScorer: ContestScorer<ARRLVHFScoresheet> = {
  startScoresheet(): ARRLVHFScoresheet {
    return {
      worked: {}, qsoPointsTaken: {}, bands: {}, bandPoints: {}, bandGrids: {}, ourGrids: [], qsos: 0, points: 0, distancePoints: 0, qsoPoints: 0,
      distanceTotal: 0, maxDistance: 0, maxDistancePerBand: {},
    }
  },

  // Mutates and returns the given scoresheet — see ContestScorer.scoreQso.
  scoreQso({ scoresheet, qso, operation, ref }) {
    const base = scoresheet
    // A scoresheet persisted by a build that predates these three fields
    // comes back through `resumeFrom` (the spots panel scores candidates off
    // the cached end-of-log sheet before the whole-log rescore replaces it);
    // without this it reads `undefined[...]` and the pass throws.
    base.qsoPointsTaken ??= {}
    base.distancePoints ??= 0
    base.qsoPoints ??= 0
    base.bandPoints ??= {}
    base.bandGrids ??= {}
    base.ourGrids ??= []

    const event = eventFor(str(ref?.ref))
    if (!event) return { scoresheet: base, score: { value: 0 } }

    const their = (qso.their as Record<string, JSONValue>) ?? {}
    const call = str(their.call)
    if (!call) return { scoresheet: base, score: { value: 0 } }

    const band = str(qso.band)
    if (!event.bands.includes(band)) {
      return { scoresheet: base, score: { value: 0, alerts: ['invalidBand'] } }
    }

    const ourGrid = trimmedGrid(str(operation.grid), event)
    const contestRef = ((qso.refs as Record<string, JSONValue>[] | undefined) ?? []).find(
      (r) => r?.type === 'arrl-vhf-tests',
    )
    const theirGrid = trimmedGrid(str(contestRef?.grid), event)

    if (!ourGrid) {
      return { scoresheet: base, score: { value: 0, alerts: ['ourGrid'] } }
    }
    if (!theirGrid) {
      return { scoresheet: base, score: { value: 0, incomplete: ['arrl-vhf-tests/grid'] } }
    }

    const key = `${call}|${band}|${ourGrid}`
    const priorGrids = base.worked[key] ?? []
    const isDupe = priorGrids.includes(theirGrid)
    if (isDupe) {
      return { scoresheet: base, score: { value: 0, dupe: true, alerts: ['duplicate'] } }
    }

    // Worked before, never on this band. The host's core scorer would say so,
    // but steps aside for this verdict (`dupe: false` below), so it says so here.
    const workedBands = Object.keys(base.worked).filter((k) => k.startsWith(`${call}|`)).map((k) => k.split('|')[1])
    const newBand = workedBands.length > 0 && !workedBands.includes(band)

    const alerts: string[] = []
    const fullGrid = theirGrid.length >= event.gridChars
    if (event.score !== 'points' && !fullGrid) alerts.push('shortGrid')

    let value: number
    let distance: number | null = null
    let distancePoints = 0
    let qsoPoints = 0
    let newMult = false
    if (event.score === 'points') {
      value = event.points?.[band] ?? 0
      const grids = (base.bandGrids[band] ??= [])
      newMult = !grids.includes(theirGrid)
      if (newMult) grids.push(theirGrid)
      if (!base.ourGrids.includes(ourGrid)) base.ourGrids.push(ourGrid)
    } else {
      // Both grids are present here (the earlier `!ourGrid`/`!theirGrid`
      // checks already handled the missing-exchange case) — a null result
      // means one of them is present but malformed, not absent.
      distance = distanceKm(ourGrid, theirGrid)
      if (distance === null) return { scoresheet: base, score: { value: 0, alerts: ['invalidExchange'] } }
      distance = Math.round(distance)
      // A band this event lists but doesn't multiplier is a gap in the event
      // data (polo's own 10 GHz tables omit `submm`) — score it visibly
      // wrong rather than silently zero, so it reads as a data bug to fix
      // instead of a legitimate zero-point contact.
      const multiplier = event.multipliers?.[band]
      if (multiplier === undefined) return { scoresheet: base, score: { value: 0, alerts: ['invalidBand'] } }
      distancePoints = distance * multiplier
      value = distancePoints
      if (event.score === 'distanceAndPoints') {
        const pointsKey = `${call}|${band}`
        if (fullGrid && !base.qsoPointsTaken[pointsKey]) {
          qsoPoints = event.points?.qso ?? 0
          base.qsoPointsTaken[pointsKey] = true
        }
        value += qsoPoints
      }
    }

    base.worked[key] = [...priorGrids, theirGrid]
    base.bands[band] = (base.bands[band] ?? 0) + 1
    base.bandPoints[band] = (base.bandPoints[band] ?? 0) + value
    base.qsos += 1
    base.points += value
    base.distancePoints += distancePoints
    base.qsoPoints += qsoPoints
    if (distance !== null) {
      base.distanceTotal += distance
      base.maxDistance = Math.max(base.maxDistance, distance)
      base.maxDistancePerBand[band] = Math.max(base.maxDistancePerBand[band] ?? 0, distance)
    }

    // `dupe: false` says this contact passed the contest's own duplicate test —
    // a rover in a new square is not a repeat — which is what makes the host's
    // core scorer step aside rather than mark it by call, band and mode.
    const score: QsoScoreVerdict = { value, band, dupe: false }
    const notices: string[] = []
    if (newMult) notices.push('newMult')
    if (newBand) notices.push('newBand')
    if (notices.length > 0) score.notices = notices
    if (distance !== null) score.distance = distance
    if (alerts.length > 0) score.alerts = alerts
    return { scoresheet: base, score }
  },

  summarizeScore({ scoresheet, operation, ref, scope }, ctx) {
    const event = eventFor(str(ref?.ref))
    const t = tFor(ctx)
    const counted = (count: number, noun: string) =>
      count === 1 ? t(`${noun}One`) : t(`${noun}Many`, { formatted: fmtInteger(count) })

    const usesDistance = event?.score !== 'points'
    // The rules score the two halves separately, so the split is shown too.
    const split = event?.score === 'distanceAndPoints'
      ? `${counted(scoresheet.distancePoints ?? 0, 'distancePoint')} + ${counted(scoresheet.qsoPoints ?? 0, 'qsoPoint')}`
      : null

    // A checkpoint cached before the grids were kept has none to count, and
    // scoring it as zero multipliers would show a zero score until the log is
    // rescored; its points alone stand until then.
    const gridMults = event?.score === 'points' && scoresheet.bandGrids ? scoresheet.bandGrids : undefined
    const ourGrids = scoresheet.ourGrids ?? []
    const rover = ourGrids.length > 1 || isRover(str(operation?.stationCall))
    const gridsWorked = gridMults ? Object.values(gridMults).reduce((sum, grids) => sum + grids.length, 0) : 0
    const gridsActivated = rover ? ourGrids.length : 0
    const mults = gridMults ? gridsWorked + gridsActivated : undefined
    const total = mults === undefined ? scoresheet.points : scoresheet.points * mults

    const bandLines = bandBreakdown(
      Object.entries(scoresheet.bands).map(([band, qsos]) => ({
        band,
        qsos,
        points: scoresheet.bandPoints?.[band],
        mults: gridMults ? (gridMults[band]?.length ?? 0) : undefined,
        // A points-only event measures no distance, so it has no longest one.
        more: usesDistance ? [t('longest', { formatted: fmtInteger(scoresheet.maxDistancePerBand[band] ?? 0) })] : [],
      })),
      ctx,
      { multNoun: (count) => counted(count, 'grid') },
    )

    return contestSummary(
      {
        key: 'arrl-vhf-tests',
        scope,
        icon: 'radio-tower',
        title: contestTitle(ref),
        total,
        arithmetic: contestArithmetic(
          {
            qsos: scoresheet.qsos,
            points: scoresheet.points,
            mults,
            multParts: gridsActivated > 0 ? [counted(gridsWorked, 'gridWorked'), counted(gridsActivated, 'gridActivated')] : [],
            more: usesDistance ? [`${fmtInteger(scoresheet.distanceTotal)} km`] : [],
          },
          ctx,
        ),
        detail: [...(split ? [split, ''] : []), bandLines].join('\n'),
        extra: { qsos: scoresheet.qsos, ...(mults === undefined ? {} : { points: scoresheet.points, mults }) },
      },
      ctx,
    )
  },
}
