// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// North American SSB Sprint scoring, per the rules (ssbsprint.com/rules):
//   * Every valid contact counts; the score is contacts × multipliers (10).
//   * Multipliers are US states (with DC, AK and HI), Canadian provinces and
//     the listed North American countries, each ONCE for the whole contest,
//     not per band (10). `DX` is a contact and never a multiplier.
//   * A station may be worked once per band (6), on 20, 40 and 80m only (6),
//     in SSB only (5).
//   * A valid contact is between a North American station and another station
//     (8): two stations outside North America score nothing together.
//
// Not judged: the QSY rule (11). Whether a contact answered our solicitation
// or theirs is not in the log, so no frequency pattern proves a violation
// short of three contacts in a row on one frequency. It is kept live instead,
// on the FYI line, as the dial turns (qsy.ts).

import { bandBreakdown, counted } from "@ham2k/lib-contest-summary"
import { fmtInteger } from "@ham2k/lib-format-tools"
import type { ContestScorer, HookContext, JSONValue, QsoScoreVerdict } from "@ham2k/extension-sdk"
import { contestArithmetic, contestSummary } from "@ham2k/extension-sdk"

import { TYPE, ourExchange, refOfType, str } from "./exchange.ts"
import { firstName } from "./history.ts"
import { tFor } from "./i18n.ts"
import { CANADIAN_PROVINCES, US_STATES, isMultiplier, isNorthAmerican, isValidLocation, locationKind, normalizeLocation } from "./locations.ts"

/// "20, 40 and 80 meters only".
export const VALID_BANDS = ['80m', '40m', '20m']

/// "SSB only": the radio may report the sideband.
const PHONE_MODES = ['SSB', 'USB', 'LSB']

export type SprintScoresheet = {
  /// call → bands already worked with it.
  workedByCall: Record<string, string[]>
  /// Contacts per multiplier — once for the whole contest.
  mults: Record<string, number>
  bands: Record<string, number>
  /// Band → multipliers first worked on it, so the band lines add up to the
  /// multiplier. Missing from a checkpoint scored before it existed.
  bandFirstMults?: Record<string, number>
  qsos: number
}

/// Whether WE are a North American station: the location we send says so if
/// it is set, else our call does. Asked for every QSO and answered the same
/// way for the whole log, so the call's answer is kept.
let ourCallAnswer: { call: string; northAmerican: boolean } | undefined

export function weAreNorthAmerican(operation: Record<string, JSONValue> | undefined, ref: Record<string, JSONValue> | undefined): boolean {
  const location = ourExchange(ref).location
  if (location === 'DX') return false
  if (isValidLocation(location)) return true
  const call = str(operation?.stationCall)
  if (ourCallAnswer?.call !== call) ourCallAnswer = { call, northAmerican: isNorthAmerican(call) }
  return ourCallAnswer.northAmerican
}

export const SprintScorer: ContestScorer<SprintScoresheet> = {
  startScoresheet(): SprintScoresheet {
    return { workedByCall: {}, mults: {}, bands: {}, bandFirstMults: {}, qsos: 0 }
  },

  // Mutates and returns the given scoresheet — see ContestScorer.scoreQso.
  scoreQso({ scoresheet, qso, operation, ref }) {
    const sheet = scoresheet
    const their = (qso.their as Record<string, JSONValue>) ?? {}
    const call = str(their.call).toUpperCase()
    if (!call) return { scoresheet: sheet, score: { value: 0 } }

    if (!PHONE_MODES.includes(str(qso.mode).toUpperCase())) {
      return { scoresheet: sheet, score: { value: 0, alerts: ['invalidMode'] } }
    }
    const band = str(qso.band)
    if (!VALID_BANDS.includes(band)) {
      return { scoresheet: sheet, score: { value: 0, alerts: ['invalidBand'] } }
    }

    const worked = sheet.workedByCall[call] ?? []
    if (worked.includes(band)) {
      return { scoresheet: sheet, score: { value: 0, dupe: true, alerts: ['duplicate'] } }
    }
    // From here on the dupe test has run and passed, which `dupe: false` says.
    if (!weAreNorthAmerican(operation, ref) && !isNorthAmerican(call)) {
      return { scoresheet: sheet, score: { value: 0, dupe: false, alerts: ['invalidCategory'] } }
    }

    const qsoRef = refOfType(qso, TYPE)
    const location = normalizeLocation(qsoRef?.location)

    const heardBefore = worked.length > 0
    if (heardBefore) sheet.workedByCall[call].push(band)
    else sheet.workedByCall[call] = [band]
    sheet.bands[band] = (sheet.bands[band] ?? 0) + 1
    sheet.qsos += 1

    const score: QsoScoreVerdict = { value: 1, band, dupe: false }
    const notices: string[] = []
    if (isMultiplier(location)) {
      if (sheet.mults[location] === undefined) {
        notices.push('newMult')
        ;(sheet.bandFirstMults ??= {})[band] = (sheet.bandFirstMults[band] ?? 0) + 1
      }
      sheet.mults[location] = (sheet.mults[location] ?? 0) + 1
    }
    if (heardBefore) notices.push('newBand')
    if (notices.length > 0) score.notices = notices

    // A part not yet copied holds the contact back, named by its field, while
    // the station is still there to ask. One the Sprint doesn't know still
    // counts, but is a contact the log checker will remove (16) or a
    // multiplier going unclaimed — and a typo the operator can still fix, if
    // told.
    const parts = { theirSerial: qsoRef?.theirSerial, name: qsoRef?.name, location: qsoRef?.location }
    const missing = Object.entries(parts).filter(([, part]) => String(part ?? '').trim() === '')
    if (missing.length > 0) score.incomplete = missing.map(([key]) => `${TYPE}/${key}`)
    else if (!/^\d+$/.test(String(qsoRef?.theirSerial).trim()) || !firstName(qsoRef?.name) || !isValidLocation(location)) score.alerts = ['invalidExchange']

    return { scoresheet: sheet, score }
  },

  /// The contest's tally for the operation — and, unlike other contests', for
  /// the DAY too, so the log's date header carries the score. A contest
  /// usually answers the day with nothing (`contestSummary`), because its
  /// multipliers span the whole event and a day's share of the score is a
  /// number no sponsor defines. The Sprint's four hours fall inside one UTC
  /// day, 0000Z to 0400Z, so the day's score IS the contest's. The day's
  /// tally is the badge alone, with no detail: the information panel lists
  /// day tallies a line each, and the checklist belongs to the operation's.
  summarizeScore({ scoresheet, scope }, ctx) {
    const t = tFor(ctx)
    const keys = Object.keys(scoresheet.mults)
    const kinds = { state: 0, province: 0, country: 0 }
    for (const key of keys) kinds[locationKind(key)] += 1
    const part = (count: number, kind: 'state' | 'province' | 'country') =>
      count === 1 ? t(`${kind}One`) : count > 1 ? t(`${kind}Many`, { formatted: fmtInteger(count) }) : ''
    const tallies = contestSummary(
      {
        key: TYPE,
        scope: 'operation',
        icon: 'run-fast',
        title: CONTEST_TITLE,
        total: scoresheet.qsos * keys.length,
        arithmetic: contestArithmetic(
          {
            qsos: scoresheet.qsos,
            points: scoresheet.qsos,
            mults: keys.length,
            multParts: [part(kinds.state, 'state'), part(kinds.province, 'province'), part(kinds.country, 'country')].filter((p) => p),
          },
          ctx,
        ),
        detail: [...multsChecklist(scoresheet, t), ...bands(scoresheet, ctx)].join('\n\n'),
        grid: true,
        extra: { points: scoresheet.qsos, mults: keys.length, qsos: scoresheet.qsos },
      },
      ctx,
    )
    if (scope === 'operation') return tallies
    const { longSummary: _detail, grid: _grid, ...badge } = tallies[TYPE]
    return { [TYPE]: { ...badge, for: 'day' } }
  },
}

export const CONTEST_TITLE = 'SSB Sprint'

/// The states and provinces as a checklist, every one of them, those worked
/// struck through — the core's checklist convention (`grid: true`), as the
/// QSO parties draw theirs — then the countries worked, which are too many to
/// list unworked.
function multsChecklist(sheet: SprintScoresheet, t: ReturnType<typeof tFor>): string[] {
  const worked = (code: string) => (sheet.mults[code] !== undefined ? `**~~${code}~~**` : code)
  const count = (codes: string[]) => fmtInteger(codes.filter((code) => sheet.mults[code] !== undefined).length)
  const parts = [
    `### ${t('statesHeading', { worked: count(US_STATES), total: fmtInteger(US_STATES.length) })}`,
    US_STATES.map(worked).join(' '),
    `### ${t('provincesHeading', { worked: count(CANADIAN_PROVINCES), total: fmtInteger(CANADIAN_PROVINCES.length) })}`,
    CANADIAN_PROVINCES.map(worked).join(' '),
  ]
  const countries = Object.keys(sheet.mults).filter((code) => locationKind(code) === 'country').sort()
  if (countries.length > 0) {
    parts.push(`### ${countries.length === 1 ? t('countriesHeadingOne') : t('countriesHeadingMany', { formatted: fmtInteger(countries.length) })}`)
    parts.push(countries.map(worked).join(' '))
  }
  return parts
}

/// The band lines under the QSO count. A point a QSO, so a band's points are
/// its QSOs.
function bands(sheet: SprintScoresheet, ctx: Pick<HookContext, 'locale'>): string[] {
  if (sheet.qsos === 0) return []
  return [
    `### ${counted(sheet.qsos, 'qso', ctx)}`,
    bandBreakdown(
      Object.entries(sheet.bands).map(([band, qsos]) => ({ band, qsos, points: qsos, mults: sheet.bandFirstMults?.[band] ?? 0 })),
      ctx,
      { bands: VALID_BANDS },
    ),
  ]
}
