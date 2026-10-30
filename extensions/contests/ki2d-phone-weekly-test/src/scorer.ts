// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Phone Weekly Test scoring, per its rules — "In essence this is the same
// rules as NAQP but without 10 meters", so `ham2k-naqp`'s scorer, narrowed:
//   * "Multiply total valid contacts by the sum of the number of multipliers
//     worked on each band": every valid contact is a point, and multipliers
//     count ONCE PER BAND.
//   * The multipliers are the US states, DC, the Canadian provinces and
//     territories, and the other North American DXCC entities. `DX` is a good
//     exchange and a good contact, but not a multiplier.
//   * "15, 20, 40, 80, 160. You may work a station once per band." SSB only.
//   * "Wednesday, 0230-0300 UTC": a contact either side of the half hour,
//     logged in the same operation, counts for nothing.

import { fmtInteger } from "@ham2k/lib-format-tools"
import type { ContestScorer, JSONValue, QsoScoreVerdict } from "@ham2k/extension-sdk"
import { contestArithmetic, contestSummary } from "@ham2k/extension-sdk"
import { firstName, isMultiplier, locationKind, normalizeLocation } from "@ham2k/lib-naqp-exchange"
import { isDuring } from "@ham2k/lib-weekly-contest"

import { TYPE, refOfType, str } from "./exchange.ts"
import { tFor } from "./i18n.ts"
import { sessionFor } from "./schedule.ts"

export const CONTEST_TITLE = 'Phone Weekly Test'

/// The bands the rules list, in the order the summary lists them.
export const VALID_BANDS = ['160m', '80m', '40m', '20m', '15m']

/// "SSB": the radio may report the sideband.
const PHONE_MODES = ['SSB', 'USB', 'LSB']

export type PwtScoresheet = {
  /// call → bands already worked with it.
  workedByCall: Record<string, string[]>
  /// `band|LOCATION` → contacts. Per band, which is the whole multiplier rule.
  mults: Record<string, number>
  bands: Record<string, number>
  qsos: number
  points: number
}

export const PwtScorer: ContestScorer<PwtScoresheet> = {
  startScoresheet(): PwtScoresheet {
    return { workedByCall: {}, mults: {}, bands: {}, qsos: 0, points: 0 }
  },

  // Mutates and returns the given scoresheet — see ContestScorer.scoreQso.
  scoreQso({ scoresheet, qso, ref }) {
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

    // A contact with no time is given the benefit of the doubt.
    const session = sessionFor(str(ref?.ref))
    if (session && typeof qso.startAtMillis === 'number' && !isDuring(session, qso.startAtMillis)) {
      return { scoresheet: sheet, score: { value: 0, alerts: ['outsideSession'] } }
    }

    const worked = sheet.workedByCall[call] ?? []
    if (worked.includes(band)) {
      return { scoresheet: sheet, score: { value: 0, dupe: true, alerts: ['duplicate'] } }
    }

    const received = refOfType(qso, TYPE)
    const location = normalizeLocation(received?.location)

    // Every valid contact is a point, whatever they sent — an unrecognized or
    // missing location costs the multiplier, not the contact.
    const points = 1
    let newMult = false
    if (isMultiplier(location)) {
      const mult = `${band}|${location}`
      newMult = sheet.mults[mult] === undefined
      sheet.mults[mult] = (sheet.mults[mult] ?? 0) + 1
    }

    const heardBefore = worked.length > 0
    if (heardBefore) sheet.workedByCall[call].push(band)
    else sheet.workedByCall[call] = [band]
    sheet.bands[band] = (sheet.bands[band] ?? 0) + 1
    sheet.qsos += 1
    sheet.points += points

    const score: QsoScoreVerdict = { value: points, band, dupe: false }
    const notices: string[] = []
    if (newMult) notices.push('newMult')
    if (heardBefore) notices.push('newBand')
    if (notices.length > 0) score.notices = notices
    // Every state, province and NA entity is a multiplier, so a location this
    // contest doesn't recognize is one going unclaimed — and a typo the
    // operator can still fix, if told. A name is half of every exchange, DX
    // included.
    if (!location || !firstName(received?.name)) score.alerts = ['missingExchange']
    else if (!isMultiplier(location) && location !== 'DX') score.alerts = ['invalidExchange']

    return { scoresheet: sheet, score }
  },

  summarizeScore({ scoresheet, scope }, ctx) {
    const t = tFor(ctx)
    const keys = Object.keys(scoresheet.mults)
    const kinds = { state: 0, province: 0, country: 0 }
    for (const key of keys) kinds[locationKind(key.slice(key.indexOf('|') + 1))] += 1
    const part = (count: number, kind: 'state' | 'province' | 'country') =>
      count === 1 ? t(`${kind}One`) : count > 1 ? t(`${kind}Many`, { formatted: fmtInteger(count) }) : ''
    return contestSummary(
      {
        key: TYPE,
        scope,
        icon: 'account-voice',
        title: CONTEST_TITLE,
        total: scoresheet.points * keys.length,
        arithmetic: contestArithmetic(
          {
            qsos: scoresheet.qsos,
            points: scoresheet.points,
            mults: keys.length,
            multParts: [part(kinds.state, 'state'), part(kinds.province, 'province'), part(kinds.country, 'country')].filter((p) => p),
          },
          ctx,
        ),
        detail: bandBreakdown(scoresheet),
        extra: { points: scoresheet.points, mults: keys.length, qsos: scoresheet.qsos },
      },
      ctx,
    )
  },
}

/// Contacts and multipliers band by band, every band listed: there are no logs
/// to send, so this is what the score posted to 3830scores.com is read from.
function bandBreakdown(sheet: PwtScoresheet): string {
  return VALID_BANDS.map((band) => {
    const qsos = sheet.bands[band] ?? 0
    const mults = Object.keys(sheet.mults).filter((key) => key.startsWith(`${band}|`)).length
    return qsos === 0 && mults === 0
      ? `**${band}**: —`
      : `**${band}**: ${fmtInteger(qsos)} QSOs, ${fmtInteger(mults)} mults`
  }).join('\n')
}
