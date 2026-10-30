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
// short of three contacts in a row on one frequency — and HaLo has no words
// for such an alert yet.

import { fmtInteger } from "@ham2k/lib-format-tools"
import type { ContestScorer, JSONValue, QsoScoreVerdict } from "@ham2k/extension-sdk"
import { contestArithmetic, contestSummary } from "@ham2k/extension-sdk"

import { TYPE, ourExchange, refOfType, str } from "./exchange.ts"
import { firstName } from "./history.ts"
import { tFor } from "./i18n.ts"
import { CANADIAN_PROVINCES, US_STATES, isMultiplier, isNorthAmerican, isValidLocation, locationKind, normalizeLocation } from "./locations.ts"

/// "20, 40 and 80 meters only", in the order the summary lists them.
export const VALID_BANDS = ['20m', '40m', '80m']

/// "SSB only": the radio may report the sideband.
const PHONE_MODES = ['SSB', 'USB', 'LSB']

export type SprintScoresheet = {
  /// call → bands already worked with it.
  workedByCall: Record<string, string[]>
  /// Contacts per multiplier — once for the whole contest.
  mults: Record<string, number>
  bands: Record<string, number>
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
    return { workedByCall: {}, mults: {}, bands: {}, qsos: 0 }
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
      if (sheet.mults[location] === undefined) notices.push('newMult')
      sheet.mults[location] = (sheet.mults[location] ?? 0) + 1
    }
    if (heardBefore) notices.push('newBand')
    if (notices.length > 0) score.notices = notices

    // The contact still counts, but an exchange that is incomplete, or a
    // location the Sprint doesn't know, is a contact the log checker will
    // remove (16) or a multiplier going unclaimed — and a typo the operator
    // can still fix, if told.
    const parts = [qsoRef?.theirSerial, qsoRef?.name, qsoRef?.location]
    if (parts.some((part) => String(part ?? '').trim() === '')) score.alerts = ['missingExchange']
    else if (!/^\d+$/.test(String(qsoRef?.theirSerial).trim()) || !firstName(qsoRef?.name) || !isValidLocation(location)) score.alerts = ['invalidExchange']

    return { scoresheet: sheet, score }
  },

  summarizeScore({ scoresheet, scope }, ctx) {
    const t = tFor(ctx)
    const keys = Object.keys(scoresheet.mults)
    const kinds = { state: 0, province: 0, country: 0 }
    for (const key of keys) kinds[locationKind(key)] += 1
    const part = (count: number, kind: 'state' | 'province' | 'country') =>
      count === 1 ? t(`${kind}One`) : count > 1 ? t(`${kind}Many`, { formatted: fmtInteger(count) }) : ''
    return contestSummary(
      {
        key: TYPE,
        scope,
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
        detail: [multsLines(scoresheet, t), bandBreakdown(scoresheet)].join('\n\n'),
        extra: { points: scoresheet.qsos, mults: keys.length, qsos: scoresheet.qsos },
      },
      ctx,
    )
  },
}

export const CONTEST_TITLE = 'SSB Sprint'

/// Once few enough are left to chase, which ones.
const MISSING_SHOWN_FROM = 15

/// States and provinces worked out of how many there are, and the missing
/// ones when the list is short enough to read.
function multsLines(sheet: SprintScoresheet, t: ReturnType<typeof tFor>): string {
  const line = (label: string, all: string[]) => {
    const missing = all.filter((code) => !sheet.mults[code])
    const counted = t('multsWorked', { label, worked: fmtInteger(all.length - missing.length), total: fmtInteger(all.length) })
    if (missing.length === 0) return `${counted} ✓`
    return missing.length <= MISSING_SHOWN_FROM ? `${counted} — ${t('missing', { list: missing.join(' ') })}` : counted
  }
  return [line(t('statesLabel'), US_STATES), line(t('provincesLabel'), CANADIAN_PROVINCES)].join('\n')
}

/// QSOs per band, in band order.
function bandBreakdown(sheet: SprintScoresheet): string {
  return VALID_BANDS.map((band) => {
    const qsos = sheet.bands[band] ?? 0
    return qsos === 0 ? `**${band}**: —` : `**${band}**: ${fmtInteger(qsos)} QSOs`
  }).join('\n')
}
