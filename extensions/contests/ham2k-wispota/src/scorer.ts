// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Wisconsin Parks on the Air scoring, from the sponsor's rules
// (https://wipota.com/files/WIPOTA_contest_rules.pdf, dated January 27, 2026).
//
//   Score = # of QSOs × # of unique WI parks.
//
//   * Every QSO is worth one, whoever it is with — "hams in other WI parks, as
//     well as hams not located in a park in any state, province or country".
//   * A station may be worked "multiple times on a given band. Once per mode",
//     and the rules count MODES, not mode families: their own example works one
//     station on SSB, AM, FM, C4FM, CW, FT8 and FT4 and calls it seven QSOs. So
//     the duplicate slot is call + band + mode, where every other contest here
//     folds modes into PHONE/CW/DATA.
//   * "All amateur bands, except 60, 30, 17 and 12 meters."
//   * A multiplier is each unique WI park worked, plus "any other UNIQUE parks
//     which you have operated in during the WIPOTA contest and have had at least
//     ten (10) QSOs in that park". Out-of-state parks earn nothing.
//
// ONE READING THE RULES DO NOT SETTLE: a station already worked on a band and
// mode counts AGAIN from a WI park it had not given us there — a rover is a new
// contact at each park, which is what ham2k-stateparks does for the other park
// events. The sponsor's text says neither yes nor no. Our own move to a new park
// does NOT reopen a slot; the rules give nothing to read that from, and an
// undercount is the safer error in a number the operator types into the
// sponsor's form.
//
// The contest period (1600–2300 UTC) is not enforced, as in every other scorer
// here: the operation is what the operator says is their entry.
//
// The parks come from POTA refs this extension does not own — see parks.ts.

import { fmtInteger } from "@ham2k/lib-format-tools"
import { contestArithmetic, contestSummary } from "@ham2k/extension-sdk"
import type { ContestScorer, JSONValue, QsoScoreVerdict } from "@ham2k/extension-sdk"

import { tFor } from "./i18n.ts"
import { ourPark, theirPark } from "./parks.ts"

import manifest from "../manifest.json" with { type: "json" }

/// "except 60, 30, 17 and 12 meters".
export const EXCLUDED_BANDS = ['60m', '30m', '17m', '12m']

/// QSOs a park we operate from needs before it is a multiplier: "at least ten
/// (10) QSOs in that park".
export const QSOS_TO_ACTIVATE = 10

export type WipotaScoresheet = {
  /// call → `band|MODE` → the WI parks already credited in that slot. `''`
  /// stands for a contact from no WI park, so an ordinary QSO still occupies
  /// the slot and a second one is a duplicate.
  worked: Record<string, Record<string, string[]>>
  /// WI park we operated from → QSOs made there.
  activated: Record<string, number>
  /// WI park worked → QSOs with it.
  hunted: Record<string, number>
  bands: Record<string, number>
  qsos: number
  dupes: number
}

function str(value: JSONValue | undefined): string {
  return typeof value === 'string' ? value : ''
}

/// The mode a QSO occupies a slot under. The sidebands are one mode — nobody
/// works a station "on USB and LSB" — and everything else is itself, because
/// the sponsor counts AM, FM and C4FM apart from SSB.
export function slotMode(mode: string): string {
  const upper = mode.toUpperCase()
  return upper === 'USB' || upper === 'LSB' ? 'SSB' : upper
}

/// The three numbers the sponsor's log form asks for, and their product.
///
/// `activated` is ADDITIONAL to `worked`, as the form words it ("Count all the
/// additional unique US-POTA parks which you operated in") and as the rules do
/// ("any other UNIQUE parks"): a park we operated from AND worked someone else
/// in is one multiplier, counted under worked.
export function totalsFor(sheet: WipotaScoresheet): { qsos: number; worked: number; activated: number; mults: number } {
  const worked = Object.keys(sheet.hunted).length
  const activated = Object.entries(sheet.activated)
    .filter(([park, qsos]) => qsos >= QSOS_TO_ACTIVATE && sheet.hunted[park] === undefined)
    .length
  return { qsos: sheet.qsos, worked, activated, mults: worked + activated }
}

export const WipotaScorer: ContestScorer<WipotaScoresheet> = {
  startScoresheet(): WipotaScoresheet {
    return { worked: {}, activated: {}, hunted: {}, bands: {}, qsos: 0, dupes: 0 }
  },

  // Mutates and returns the given scoresheet — see ContestScorer.scoreQso.
  scoreQso({ scoresheet: sheet, qso, operation }) {
    const call = str(((qso.their as Record<string, JSONValue>) ?? {}).call)
    if (!call) return { scoresheet: sheet, score: { value: 0 } }

    // A QSO with no band is refused along with the excluded ones: it cannot be
    // checked against the band rule, and saying `invalidBand` is how an import
    // that lost its BAND column becomes visible instead of scoring.
    const band = str(qso.band)
    if (!band || EXCLUDED_BANDS.includes(band)) {
      return { scoresheet: sheet, score: { value: 0, alerts: ['invalidBand'] } }
    }

    const mode = slotMode(str(qso.mode))
    const park = theirPark(qso)
    const slot = `${band}|${mode}`
    const bySlot = (sheet.worked[call] ??= {})
    const credited = bySlot[slot]

    // A slot already credited ANYTHING is closed to a parkless claim: only a WI
    // park they had not given us there earns another contact. Testing only
    // `credited.includes(park)` would let `''` through as though "no park" were
    // a park the slot was still missing.
    if (credited && (!park || credited.includes(park))) {
      sheet.dupes += 1
      return { scoresheet: sheet, score: { value: 0, dupe: true, alerts: ['duplicate'] } }
    }

    const slots = Object.keys(bySlot)
    const notices: string[] = []
    if (slots.length > 0 && !slots.some((key) => key.startsWith(`${band}|`))) notices.push('newBand')
    if (slots.length > 0 && !slots.some((key) => key.endsWith(`|${mode}`))) notices.push('newMode')
    // `newPark` for a park new to the LOG, and for one new only to this SLOT.
    // The second is not decoration: a rover credited again on a band and mode
    // already worked has no `newBand` or `newMode` to show, and a verdict that
    // says nothing about the prior contact leaves core's own `duplicate` alert
    // standing beside the credit (the host's scoring_priority.dart).
    if (park && (credited || sheet.hunted[park] === undefined)) notices.push('newPark')

    bySlot[slot] = [...(credited ?? []), park]
    if (park) sheet.hunted[park] = (sheet.hunted[park] ?? 0) + 1
    const ours = ourPark(operation)
    if (ours) sheet.activated[ours] = (sheet.activated[ours] ?? 0) + 1
    sheet.bands[band] = (sheet.bands[band] ?? 0) + 1
    sheet.qsos += 1

    const score: QsoScoreVerdict = { value: 1, band }
    if (notices.length > 0) score.notices = notices
    return { scoresheet: sheet, score }
  },

  summarizeScore({ scoresheet: sheet, scope }, ctx) {
    const t = tFor(ctx)
    const { qsos, worked, activated, mults } = totalsFor(sheet)
    // `|| 1`: a log with no WI park yet is still worth its QSOs on the board,
    // where a zero reads as broken.
    const mult = mults || 1
    const part = (count: number, one: string, many: string) => (count === 1 ? t(one) : t(many, { formatted: fmtInteger(count) }))
    const multParts = [
      worked > 0 ? part(worked, 'parkWorkedOne', 'parkWorkedMany') : '',
      activated > 0 ? part(activated, 'parkActivatedOne', 'parkActivatedMany') : '',
    ].filter((p) => p)

    return contestSummary({
      key: 'wispota',
      scope,
      icon: 'pine-tree',
      title: manifest.shortName,
      total: qsos * mult,
      arithmetic: contestArithmetic({ qsos, points: qsos, mults: mult, multParts }, ctx),
      detail: longSummaryFor(sheet, { qsos, worked, activated }),
      extra: { points: qsos, mults: mult, qsos },
    }, ctx)
  },
}

/// The sponsor's form, filled in: its three counts under the names it gives
/// them, then the parks behind each.
function longSummaryFor(sheet: WipotaScoresheet, totals: { qsos: number; worked: number; activated: number }): string {
  const parts: string[] = [
    [
      `**QSOs:** ${fmtInteger(totals.qsos)}`,
      `**WI Only Parks worked:** ${fmtInteger(totals.worked)}`,
      `**WI Parks Activated:** ${fmtInteger(totals.activated)}`,
    ].join('\n'),
  ]

  const ours = Object.entries(sheet.activated)
  if (ours.length > 0) {
    parts.push(`### Operated from\n${ours
      .map(([park, qsos]) => `${park} (${fmtInteger(qsos)}${qsos < QSOS_TO_ACTIVATE ? ` of ${QSOS_TO_ACTIVATE}` : ''})`)
      .join(' • ')}`)
  }

  const theirs = Object.keys(sheet.hunted).sort()
  if (theirs.length > 0) parts.push(`### Parks worked\n${theirs.join(' • ')}`)

  const bands = Object.keys(sheet.bands).sort()
  if (bands.length > 0) {
    parts.push(bands.map((band) => `**${band}**: ${fmtInteger(sheet.bands[band])} QSOs`).join('\n'))
  }

  return parts.join('\n\n')
}
