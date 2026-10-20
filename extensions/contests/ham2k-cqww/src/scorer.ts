// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// CQ WW DX scoring, ported from app-polo's CQWWExtension `scoringForQSO` /
// `accumulateScoreForOperation` / `summarizeScore` into a `ContestScorer`.
//
// The rules, per cqww.com/rules and cqwwrtty.com/rules.htm:
//   * Points depend on where the other station is relative to us. CW and SSB:
//     0 for our own country, 1 within our continent, 2 for NA-to-NA (North
//     America is the exception), 3 across continents. RTTY: 1 for our own
//     country, 2 within our continent (no NA exception), 3 across continents.
//   * Multipliers are PER BAND: each CQ zone and each country worked on that
//     band, plus on RTTY each W/VE QTH (see qth.ts). Total = points x
//     multipliers. Our own country counts for a multiplier even at 0 points.
//   * "Country" is the DXCC list PLUS the WAE list and IG9/IH9 — Sicily,
//     African Italy, European Turkey and so on are countries of their own, on
//     their own continent. Maritime mobile stations count only for a zone.
//   * A station may be worked once per band. A repeat on the same band scores
//     nothing and yields no multiplier; the same station on a new band is a
//     fresh contact.
//   * Only 160/80/40/20/15/10m count — RTTY drops 160m — and the QSO's mode
//     must match the contest's mode.

import { fmtInteger } from "@ham2k/lib-format-tools"
import type { ContestScorer, JSONValue, QsoScoreVerdict } from "@ham2k/extension-sdk"
import { annotateCallAgainstCountryFile, contestArithmetic, contestSummary } from "@ham2k/extension-sdk"

import { tFor } from "./i18n.ts"
import { guessedQth, normalizeQth, sendsQth } from "./qth.ts"

/// CQ WW is an HF contest: the WARC bands are excluded by the rules, not an
/// oversight.
export const VALID_BANDS = ['160m', '80m', '40m', '20m', '15m', '10m']

/// The RTTY weekend runs on five of them: "3.5, 7, 14, 21 and 28 MHz".
const RTTY_BANDS = VALID_BANDS.filter((band) => band !== '160m')

/// The country file, read the way CQ WW counts countries: with the WAE
/// entities and IG9/IH9 split out of their DXCC parents.
export function cqwwCallInfo(call: string) {
  return annotateCallAgainstCountryFile(call, { wae: true })
}

/// A CQ zone as typed: 1-40, with or without a leading zero. Anchored and
/// matched case-insensitively by the core, so this is just the body.
export const ZONE_PATTERN = '0?(?:[1-9]|[1-3][0-9]|40)'

export type CQWWScoresheet = {
  /// call → bands already worked with it (one QSO per band is allowed).
  workedByCall: Record<string, string[]>
  /// Every `band|Znn` / `band|Cxx` multiplier seen, and the per-band split the
  /// summary breaks out.
  mults: Record<string, number>
  bandMults: Record<string, Record<string, number>>
  bands: Record<string, number>
  bandPoints: Record<string, number>
  qsos: number
  points: number
  /// Our own continent and DXCC entity, resolved once from the station call —
  /// every point calculation is relative to them.
  ourContinent?: string
  ourEntity?: string
}

function str(value: JSONValue | undefined): string {
  return typeof value === 'string' ? value : ''
}

/// The zone as the operator typed it, reduced to its canonical form: "05" and
/// "5" are the same multiplier, and must not count twice.
export function normalizeZone(value: JSONValue | undefined): string {
  const digits = String(value ?? '').trim().replace(/^0+(?=\d)/, '')
  return /^([1-9]|[1-3][0-9]|40)$/.test(digits) ? digits : ''
}

/// CQ WW runs separate CW, SSB and RTTY weekends; a QSO in the wrong mode is
/// not a contest QSO. SSB covers the sideband modes a radio may report.
function modeMatches(contestMode: string, qsoMode: string): boolean {
  if (!contestMode) return true
  if (contestMode === 'SSB') return qsoMode === 'SSB' || qsoMode === 'USB' || qsoMode === 'LSB'
  return qsoMode === contestMode
}

export const CQWWScorer: ContestScorer<CQWWScoresheet> = {
  startScoresheet({ operation }): CQWWScoresheet {
    const ours = cqwwCallInfo(str(operation.stationCall))
    return {
      workedByCall: {}, mults: {}, bandMults: {}, bands: {}, bandPoints: {},
      qsos: 0, points: 0,
      ourContinent: ours.continent,
      ourEntity: ours.entityPrefix,
    }
  },

  // Mutates and returns the given scoresheet — see ContestScorer.scoreQso.
  scoreQso({ scoresheet, qso, ref }) {
    const base = scoresheet

    const their = (qso.their as Record<string, JSONValue>) ?? {}
    const call = str(their.call)
    if (!call) return { scoresheet: base, score: { value: 0 } }

    const band = str(qso.band)
    const mode = str(qso.mode)

    if (!modeMatches(str(ref?.mode), mode)) {
      return { scoresheet: base, score: { value: 0, alerts: ['invalidMode'] } }
    }
    const rtty = str(ref?.mode) === 'RTTY'
    if (!(rtty ? RTTY_BANDS : VALID_BANDS).includes(band)) {
      return { scoresheet: base, score: { value: 0, alerts: ['invalidBand'] } }
    }

    // One QSO per station per band.
    const worked = base.workedByCall[call] ?? []
    if (worked.includes(band)) {
      return { scoresheet: base, score: { value: 0, dupe: true, alerts: ['duplicate'] } }
    }

    // The exchange the operator typed wins; the country file's zone for that
    // call is the fallback, so a QSO logged without an exchange still scores.
    //
    // PRESENCE of the field decides, not truthiness. The core writes
    // `theirZone: ''` for a zone the operator deliberately emptied and drops the
    // key when none was ever entered, so falling back on `||` would score a
    // guessed multiplier for a QSO whose Cabrillo line exports a dash — the
    // exact log-disagrees-with-its-own-score problem §8 exists to prevent, just
    // arrived at from the other side.
    const theirInfo = cqwwCallInfo(call)
    const contestRef = ((qso.refs as Record<string, JSONValue>[] | undefined) ?? []).find((r) => r?.type === 'cqww')
    const zone = contestRef && 'theirZone' in contestRef
      ? normalizeZone(contestRef.theirZone)
      : normalizeZone(theirInfo.cqZone)
    // A maritime mobile station is in no country: it counts for its zone only,
    // and is never "our own country" for points.
    const maritime = /\/MM$/i.test(call)
    const entity = maritime ? undefined : theirInfo.entityPrefix
    // The W/VE QTH, on RTTY only and only from a station that sends one. The
    // same presence rule as the zone above.
    const qth = rtty && !maritime && sendsQth(call)
      ? (contestRef && 'theirQth' in contestRef ? normalizeQth(contestRef.theirQth) : guessedQth(their))
      : ''

    // Points are relative to us: our own country is worth least, our own
    // continent more, another continent most. NA-to-NA is the CW/SSB
    // exception at 2; RTTY has none, and gives our own country a point.
    let points = 3
    if (base.ourEntity && entity && base.ourEntity === entity) {
      points = rtty ? 1 : 0
    } else if (base.ourContinent && theirInfo.continent && base.ourContinent === theirInfo.continent) {
      points = rtty || base.ourContinent === 'NA' ? 2 : 1
    }

    // Zone, country and (RTTY) QTH each multiply, once per band.
    const newMults: string[] = []
    for (const mult of [zone ? `${band}|Z${zone}` : '', entity ? `${band}|C${entity}` : '', qth ? `${band}|Q${qth}` : '']) {
      if (!mult) continue
      if (base.mults[mult] === undefined) newMults.push(mult)
      base.mults[mult] = (base.mults[mult] ?? 0) + 1
      ;(base.bandMults[band] ??= {})[mult] = (base.bandMults[band]?.[mult] ?? 0) + 1
    }

    if (worked.length > 0) base.workedByCall[call].push(band)
    else base.workedByCall[call] = [band]

    base.bands[band] = (base.bands[band] ?? 0) + 1
    base.bandPoints[band] = (base.bandPoints[band] ?? 0) + points
    base.qsos += 1
    base.points += points

    const score: QsoScoreVerdict = { value: points, band }
    const notices: string[] = []
    if (newMults.length > 0) notices.push('newMult')
    if (worked.length > 0) notices.push('newBand')
    if (notices.length > 0) score.notices = notices
    if (zone) score.zone = zone
    if (qth) score.qth = qth

    return { scoresheet: base, score }
  },

  summarizeScore({ scoresheet, ref, scope }, ctx) {
    const t = tFor(ctx)
    const keys = Object.keys(scoresheet.mults)
    const zones = keys.filter((key) => key.includes('|Z')).length
    const qths = keys.filter((key) => key.includes('|Q')).length
    const countries = keys.length - zones - qths
    return contestSummary(
      {
        key: 'cqww',
        scope,
        icon: 'earth',
        title: contestTitle(ref),
        total: scoresheet.points * keys.length,
        arithmetic: contestArithmetic(
          {
            qsos: scoresheet.qsos,
            points: scoresheet.points,
            mults: keys.length,
            multParts: [
              zones === 1 ? t('zoneOne') : zones > 1 ? t('zoneMany', { formatted: fmtInteger(zones) }) : '',
              countries === 1 ? t('countryOne') : countries > 1 ? t('countryMany', { formatted: fmtInteger(countries) }) : '',
              qths === 1 ? t('qthOne') : qths > 1 ? t('qthMany', { formatted: fmtInteger(qths) }) : '',
            ].filter((part) => part),
          },
          ctx,
        ),
        detail: bandBreakdown(scoresheet, str(ref?.mode) === 'RTTY'),
        extra: { points: scoresheet.points, mults: keys.length, qsos: scoresheet.qsos },
      },
      ctx,
    )
  },
}

/// "CQWW SSB" — the name the operation's title gives the contest, which its
/// summary repeats.
export function contestTitle(ref: Record<string, JSONValue> | undefined): string {
  return ['CQWW', str(ref?.mode)].filter((x) => x).join(' ')
}

/// The per-band table a contester actually reads while operating — QSOs,
/// points and multipliers for each band, in band order.
function bandBreakdown(sheet: CQWWScoresheet, rtty: boolean): string {
  const lines = (rtty ? RTTY_BANDS : VALID_BANDS).map((band) => {
    const qsos = sheet.bands[band] ?? 0
    const points = sheet.bandPoints[band] ?? 0
    const mults = Object.keys(sheet.bandMults[band] ?? {}).length
    return qsos === 0 && mults === 0
      ? `**${band}**: —`
      : `**${band}**: ${fmtInteger(qsos)} QSOs, ${fmtInteger(points)} pts, ${fmtInteger(mults)} mults`
  })
  return lines.join('\n')
}
