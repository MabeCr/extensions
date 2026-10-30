// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// WWSAC scoring, per the rules (wwsac.com/rules.html):
//   * A contact is worth what the OTHER station's age group is worth: OM 1,
//     YL 5, Youth 10, Youth YL 15 (4). Where they are makes no difference.
//   * The multiplier is the callsign prefix, "same multipliers as CQ WPX" (4),
//     and the score is "QSO points * sum of callsign prefixes worked" — one
//     sum, so each prefix counts ONCE for the session, not per band. The
//     sponsor's N1MM file agrees (`IsMultPer = 4`, `MultiplierBands` empty).
//   * 160, 80, 40, 20, 15, 10 and 6m, SSB only (2).
//   * Dupes are not in the rules; the sponsor's N1MM file checks them per band
//     (`DupeType = 2`), which is what an operator who logs with it is held to.
//
// A contact whose age group is missing is still a contact: it counts as an
// OM's single point — the least the other station can be worth — and says so.

import { fmtInteger } from "@ham2k/lib-format-tools"
import type { ContestScorer, JSONValue, QsoScoreVerdict } from "@ham2k/extension-sdk"
import { contestArithmetic, contestSummary } from "@ham2k/extension-sdk"

import { AGE_GROUPS, POINTS, TYPE, ageGroupOf, refOfType, str } from "./exchange.ts"
import type { AgeGroup } from "./exchange.ts"
import { wpxPrefix } from "./prefix.ts"

export const CONTEST_TITLE = 'WWSAC'

/// The bands the rules list, in the order the summary lists them.
export const VALID_BANDS = ['160m', '80m', '40m', '20m', '15m', '10m', '6m']

/// "SSB mode": the radio may report the sideband.
const PHONE_MODES = ['SSB', 'USB', 'LSB']

export type WwsacScoresheet = {
  /// call → bands already worked with it.
  workedByCall: Record<string, string[]>
  /// Prefix → contacts. Session-wide: `Object.keys().length` IS the multiplier.
  mults: Record<string, number>
  bands: Record<string, number>
  bandPoints: Record<string, number>
  /// Contacts per age group, for the summary.
  ageGroups: Partial<Record<AgeGroup, number>>
  /// Contacts scored as an OM for want of a recognized age group — each one
  /// possibly worth more once fixed.
  unconfirmed: number
  qsos: number
  points: number
}

export const WwsacScorer: ContestScorer<WwsacScoresheet> = {
  startScoresheet(): WwsacScoresheet {
    return { workedByCall: {}, mults: {}, bands: {}, bandPoints: {}, ageGroups: {}, unconfirmed: 0, qsos: 0, points: 0 }
  },

  // Mutates and returns the given scoresheet — see ContestScorer.scoreQso.
  scoreQso({ scoresheet, qso }) {
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

    const typed = str(refOfType(qso, TYPE)?.ageGroup).trim()
    const ageGroup = ageGroupOf(typed)
    const points = ageGroup ? POINTS[ageGroup] : POINTS.OM

    const prefix = wpxPrefix(call)
    const isNewMult = !!prefix && sheet.mults[prefix] === undefined
    if (prefix) sheet.mults[prefix] = (sheet.mults[prefix] ?? 0) + 1

    const heardBefore = worked.length > 0
    if (heardBefore) sheet.workedByCall[call].push(band)
    else sheet.workedByCall[call] = [band]
    sheet.bands[band] = (sheet.bands[band] ?? 0) + 1
    sheet.bandPoints[band] = (sheet.bandPoints[band] ?? 0) + points
    if (ageGroup) sheet.ageGroups[ageGroup] = (sheet.ageGroups[ageGroup] ?? 0) + 1
    else sheet.unconfirmed += 1
    sheet.qsos += 1
    sheet.points += points

    const score: QsoScoreVerdict = { value: points, band, dupe: false }
    const notices: string[] = []
    if (isNewMult) notices.push('newMult')
    if (heardBefore) notices.push('newBand')
    if (notices.length > 0) score.notices = notices
    if (prefix) score.prefix = prefix
    // Still a contact, but one the operator can fix while it is fresh.
    if (!typed) score.alerts = ['missingExchange']
    else if (!ageGroup) score.alerts = ['invalidExchange']

    return { scoresheet: sheet, score }
  },

  summarizeScore({ scoresheet, scope }, ctx) {
    const mults = Object.keys(scoresheet.mults).length
    return contestSummary(
      {
        key: TYPE,
        scope,
        icon: 'microphone',
        title: CONTEST_TITLE,
        total: scoresheet.points * mults,
        arithmetic: contestArithmetic({ qsos: scoresheet.qsos, points: scoresheet.points, mults }, ctx),
        detail: breakdown(scoresheet),
        extra: { points: scoresheet.points, mults, qsos: scoresheet.qsos },
      },
      ctx,
    )
  },
}

/// The bands worked, who was worked, and the prefixes — which, as in WPX, are
/// what tells an operator whether a station is worth calling.
function breakdown(sheet: WwsacScoresheet): string {
  const lines = VALID_BANDS.filter((band) => sheet.bands[band]).map((band) =>
    `**${band}**: ${fmtInteger(sheet.bands[band])} QSOs, ${fmtInteger(sheet.bandPoints[band] ?? 0)} pts`)

  const groups = AGE_GROUPS.filter((group) => sheet.ageGroups[group]).map((group) => `${group} ${fmtInteger(sheet.ageGroups[group]!)}`)
  if (sheet.unconfirmed) groups.push(`? ${fmtInteger(sheet.unconfirmed)}`)
  if (groups.length > 0) {
    lines.push('')
    lines.push(groups.join(' · '))
  }

  const prefixes = Object.keys(sheet.mults).sort()
  if (prefixes.length > 0) {
    lines.push('')
    lines.push(`**${fmtInteger(prefixes.length)} prefixes**`)
    lines.push(prefixes.join(' '))
  }
  return lines.join('\n')
}
