// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Texas State Parks On The Air scoring, from the sponsor's rules as they stood
// for the 2026 event (event.ts names the document).
//
//   §6.5.1, activators: "Total score = total QSO points X (power multiplier +
//   Texas State Parks worked multiplier + Texas State Parks activated
//   multiplier) + bonus points."
//   §6.5.2, hunters: the same without the activated term.
//
// The three multipliers ADD. §6.3.3's "activation of two parks doubles the …
// score" cannot hold beside that formula, and the formula is the explicit one.
// Points are 1 per phone or digital contact and 2 per CW contact (§6.2).
//
// The bonuses a log can support (§6.4): 5 for the host station K5LRK, once; 50
// for activating more than three parks; 50 for working the same activator call
// in three different parks. The fourth, for a photo of the park sign, is claimed
// on the sponsor's upload form. There is NO bonus per park activated: a park is
// worth its term in the multiplier sum and nothing more.
//
// WHAT A CONTACT IS. §6.1: "Stations may be worked once per band per mode per
// park", and §4.2 makes the mode an exact one. "Per park" is read both ways,
// because both are how the sponsor takes the log:
//
//   * per park of OURS — the file names the park it is for, or carries it on
//     every record (§8.4.1.1), so a station worked from one park is a new
//     contact from the next;
//   * per park of THEIRS — which is how a rover is worked again, the very thing
//     §6.4.3 rewards. A station at several parks is a contact per park, as the
//     POTA-format log the sponsor asks for writes a record for each.
//
// HUNTERS: §5.2, "QSO with stations other than Texas State Park Activators do
// not count toward their Total Score." No such sentence binds an activator, so
// in a listed park every contact counts.
//
// The contest period is not enforced, as in the other contests here.

import { fmtInteger } from "@ham2k/lib-format-tools"
import { contestArithmetic, contestSummary } from "@ham2k/extension-sdk"
import type { ContestScorer, JSONValue, QsoScoreVerdict } from "@ham2k/extension-sdk"

import {
  EXCLUDED_BANDS, HOST_STATION, HOST_STATION_BONUS, MANY_PARKS_BONUS, MANY_PARKS_OVER,
  PARKS, QSOS_TO_ACTIVATE, ROVER_BONUS, ROVER_PARKS, pointsForMode, slotMode,
} from "./event.ts"
import { powerTerm } from "./entry.ts"
import { tFor } from "./i18n.ts"
import { isListed, isOurRef, ourParks, theirParks } from "./parks.ts"

import manifest from "../manifest.json" with { type: "json" }

export type TxspotaScoresheet = {
  /// Whether any QSO was scored under THIS event's ref. The scope offers this
  /// scorer every legacy state-parks operation, the other events' included, and
  /// one that was never ours summarizes to nothing at all.
  ours?: boolean
  /// What our power class adds to the multiplier sum, recorded as the fold goes:
  /// `summarizeScore` is handed the BASE operation's ref, and on a segmented log
  /// the class may be declared only in a later segment.
  powerTerm?: number
  /// call → `OURPARK|band|MODE` → their parks already credited in that slot.
  /// `''` for our park is an operation in no listed park; `''` among theirs is a
  /// contact from no park, which still occupies the slot.
  worked: Record<string, Record<string, string[]>>
  /// Listed park we operated from → contacts made there.
  activated: Record<string, number>
  /// Listed park worked → contacts with it.
  hunted: Record<string, number>
  /// Base call → the listed parks we worked it in, for §6.4.3.
  parksByCall: Record<string, string[]>
  hostStation?: boolean
  bands: Record<string, number>
  qsos: number
  points: number
  dupes: number
}

function str(value: JSONValue | undefined): string {
  return typeof value === 'string' ? value : ''
}

export interface TxspotaTotals {
  worked: number
  activated: number
  power: number
  mult: number
  bonus: number
}

export function totalsFor(sheet: TxspotaScoresheet): TxspotaTotals {
  const worked = Object.keys(sheet.hunted).length
  const activated = Object.values(sheet.activated).filter((contacts) => contacts >= QSOS_TO_ACTIVATE).length
  const power = sheet.powerTerm ?? 0
  const rover = Object.values(sheet.parksByCall).some((parks) => parks.length >= ROVER_PARKS)
  return {
    worked,
    activated,
    power,
    // `|| 1`: a log with no parks and no class declared is still worth its
    // points on the board, where a zero reads as broken.
    mult: (power + worked + activated) || 1,
    bonus: (sheet.hostStation ? HOST_STATION_BONUS : 0)
      + (activated > MANY_PARKS_OVER ? MANY_PARKS_BONUS : 0)
      + (rover ? ROVER_BONUS : 0),
  }
}

export const TxspotaScorer: ContestScorer<TxspotaScoresheet> = {
  startScoresheet(): TxspotaScoresheet {
    return {
      worked: {}, activated: {}, hunted: {}, parksByCall: {}, bands: {},
      qsos: 0, points: 0, dupes: 0,
    }
  },

  // Mutates and returns the given scoresheet — see ContestScorer.scoreQso.
  scoreQso({ scoresheet: sheet, qso, operation, ref }) {
    // Another state-park event's legacy operation: not ours to judge, so no
    // alert either — an `unknownEvent` here would flag every Florida QSO.
    if (!isOurRef(ref)) return { scoresheet: sheet, score: { value: 0 } }
    sheet.ours = true
    // The first DECLARED class wins, not the first QSO's answer: `??=` would
    // latch the 0 that stands for "no class declared", and a class arriving in
    // a later segment could never fill it in.
    if (!sheet.powerTerm) sheet.powerTerm = powerTerm(ref)

    const their = (qso.their as Record<string, JSONValue>) ?? {}
    const call = str(their.call)
    if (!call) return { scoresheet: sheet, score: { value: 0 } }

    // A QSO with no band is refused along with the excluded ones: it cannot be
    // checked against §4.3, and saying `invalidBand` is how an import that lost
    // its BAND column becomes visible instead of scoring.
    const band = str(qso.band)
    if (!band || EXCLUDED_BANDS.includes(band)) return { scoresheet: sheet, score: { value: 0, alerts: ['invalidBand'] } }

    const baseCall = (str(their.baseCall) || str(((their.guess as Record<string, JSONValue>) ?? {}).baseCall) || call).toUpperCase()
    const notices: string[] = []
    // Ahead of the hunter's test below: the host station is worth its bonus
    // whether or not it is in a park.
    if (baseCall === HOST_STATION && !sheet.hostStation) {
      sheet.hostStation = true
      notices.push('bonusStation')
    }

    const mode = slotMode(str(qso.mode))
    const ours = ourParks(operation)
    const theirs = theirParks(qso)
    // In no listed park we are a hunter, and only a listed park is a contact.
    const claims = ours.length > 0 ? (theirs.length > 0 ? theirs : ['']) : theirs.filter(isListed)
    if (claims.length === 0) {
      return { scoresheet: sheet, score: notices.length > 0 ? { value: 0, notices } : { value: 0 } }
    }

    const bySlot = (sheet.worked[call] ??= {})
    const before = Object.keys(bySlot)
    const hadBandAndMode = before.some((key) => key.endsWith(`|${band}|${mode}`))

    let contacts = 0
    const newToSlot: string[] = []
    for (const our of ours.length > 0 ? ours : ['']) {
      const slot = `${our}|${band}|${mode}`
      const credited = bySlot[slot]
      // A slot already credited ANYTHING is closed to a parkless claim: only a
      // park they had not given us there earns another contact. Without the
      // `park &&`, "no park" would read as a park the slot was still missing.
      const fresh = credited ? claims.filter((park) => park && !credited.includes(park)) : claims
      if (fresh.length === 0) continue
      bySlot[slot] = [...(credited ?? []), ...fresh]
      contacts += fresh.length
      if (our) sheet.activated[our] = (sheet.activated[our] ?? 0) + fresh.length
      for (const park of fresh) if (park && !newToSlot.includes(park)) newToSlot.push(park)
    }

    if (contacts === 0) {
      sheet.dupes += 1
      return { scoresheet: sheet, score: { value: 0, dupe: true, alerts: ['duplicate'] } }
    }

    if (before.length > 0 && !before.some((key) => key.split('|')[1] === band)) notices.push('newBand')
    if (before.length > 0 && !before.some((key) => key.split('|')[2] === mode)) notices.push('newMode')
    if (newToSlot.some((park) => isListed(park) && sheet.hunted[park] === undefined)) notices.push('newPark')
    // Credited again on a band and mode already worked: the verdict has to SAY
    // it judged the prior contact, or the app's own `duplicate` alert stands
    // beside the credit (the host's scoring_priority.dart). Their new park is
    // `newPark`; ours, with nothing new on their side, is `newRef`.
    if (hadBandAndMode && !notices.includes('newPark')) notices.push(newToSlot.length > 0 ? 'newPark' : 'newRef')

    for (const park of newToSlot) {
      if (!isListed(park)) continue
      sheet.hunted[park] = (sheet.hunted[park] ?? 0) + 1
      const parks = (sheet.parksByCall[baseCall] ??= [])
      if (!parks.includes(park)) parks.push(park)
    }

    const value = contacts * pointsForMode(mode)
    sheet.bands[band] = (sheet.bands[band] ?? 0) + contacts
    sheet.qsos += contacts
    sheet.points += value

    const score: QsoScoreVerdict = { value, band }
    if (notices.length > 0) score.notices = notices
    return { scoresheet: sheet, score }
  },

  summarizeScore({ scoresheet: sheet, scope }, ctx) {
    if (!sheet.ours) return {}

    const t = tFor(ctx)
    const totals = totalsFor(sheet)
    const part = (count: number, one: string, many: string) => (count === 1 ? t(one) : t(many, { formatted: fmtInteger(count) }))
    const multParts = [
      totals.activated > 0 ? part(totals.activated, 'parkActivatedOne', 'parkActivatedMany') : '',
      totals.worked > 0 ? part(totals.worked, 'parkWorkedOne', 'parkWorkedMany') : '',
      totals.power > 0 ? t('powerMultiplier', { formatted: fmtInteger(totals.power) }) : '',
    ].filter((p) => p)

    return contestSummary({
      key: 'txspota',
      scope,
      icon: 'star-circle',
      title: manifest.shortName,
      total: sheet.points * totals.mult + totals.bonus,
      arithmetic: contestArithmetic({ qsos: sheet.qsos, points: sheet.points, mults: totals.mult, multParts, bonus: totals.bonus }, ctx),
      detail: longSummaryFor(sheet, totals),
      extra: { points: sheet.points, mults: totals.mult, qsos: sheet.qsos },
    }, ctx)
  },
}

function longSummaryFor(sheet: TxspotaScoresheet, totals: TxspotaTotals): string {
  const parts: string[] = [
    `**Multipliers:** power ${fmtInteger(totals.power)} + parks worked ${fmtInteger(totals.worked)} + parks activated ${fmtInteger(totals.activated)}`,
  ]

  const ours = Object.entries(sheet.activated)
  if (ours.length > 0) {
    parts.push(`### Activating\n${ours
      .map(([park, contacts]) => `${park} (${fmtInteger(contacts)}${contacts < QSOS_TO_ACTIVATE ? ` of ${QSOS_TO_ACTIVATE}` : ''})`)
      .join(' • ')}`)
  }

  parts.push(`### Bonus station\n${sheet.hostStation ? `**~~${HOST_STATION}~~**` : HOST_STATION}`)

  const parkList = [...PARKS].map((park) => (sheet.hunted[park] !== undefined ? `**~~${park}~~**` : park)).join(' ')
  parts.push(`### ${fmtInteger(totals.worked)} of ${fmtInteger(PARKS.size)} parks worked\n${parkList}`)

  const bands = Object.keys(sheet.bands).sort()
  if (bands.length > 0) {
    parts.push(bands.map((band) => `**${band}**: ${fmtInteger(sheet.bands[band])} QSOs`).join('\n'))
  }

  return parts.join('\n\n')
}
