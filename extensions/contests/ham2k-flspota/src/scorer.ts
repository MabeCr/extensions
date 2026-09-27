// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Florida State Parks on the Air scoring, from the "2026 FSPOTA Rules v.1.3".
//
//   Activators (§6.1): Base Score = "sum of the scores from each park, with the
//   score from each park being 1 point for each SSB or Digital QSO and 2 points
//   for each CW QSO". "There are no multipliers". Plus 100 points per park
//   activated, a park being activated at 10 QSOs.
//
//   Hunters (§6.2) have no formula: "the number of QSOs made, and the number of
//   Florida parks contacted will be tabulated from all of the activator logs".
//
// WHAT A CONTACT IS. §4.3: "Each band/mode/operator counts as a separate
// contact", and §4.5 makes the mode an exact one. Two things follow from the way
// the sponsor takes logs rather than from a sentence of their own:
//
//   * EACH OF OUR PARKS IS ITS OWN LOG. §7.2: "One separate log is required for
//     each park activated", and the base score is summed park by park. A station
//     worked from one park is a new contact from the next, so the slot a contact
//     occupies carries our park. An activation at two listed parks at once is a
//     contact in both logs, and scores in both.
//   * A STATION AT SEVERAL PARKS IS SEVERAL CONTACTS. §7.4 asks for "the
//     recommended POTA log format", which writes one record per park hunted, and
//     those records are what the sponsor counts. So an activator's contact is
//     worth one per park of theirs — every POTA park, not only Florida's, since
//     the record is written either way. A park they had not given us in a slot
//     reopens it, which is also how a rover is worked again.
//
// A hunter's contact is one the sponsor finds in an ACTIVATOR's log, so for an
// operation in no listed park only contacts with listed parks count.
//
// The contest period and its 8 am – 8 pm operating hours (§2) are not enforced,
// as in the other contests here: the operation is what the operator says is
// their entry.

import { fmtInteger } from "@ham2k/lib-format-tools"
import { contestArithmetic, contestSummary } from "@ham2k/extension-sdk"
import type { ContestScorer, JSONValue, QsoScoreVerdict } from "@ham2k/extension-sdk"

import { BANDS, POINTS_PER_PARK_ACTIVATED, QSOS_TO_ACTIVATE, pointsForMode, slotMode } from "./event.ts"
import { isListed, isOurRef, ourParks, theirParks } from "./parks.ts"

import manifest from "../manifest.json" with { type: "json" }

export type FlspotaScoresheet = {
  /// Whether any QSO was scored under THIS event's ref. The scope offers this
  /// scorer every legacy state-parks operation, the other events' included, and
  /// one that was never ours summarizes to nothing at all.
  ours?: boolean
  /// call → `OURPARK|band|MODE` → their parks already credited in that slot.
  /// `''` for our park is an operation in no listed park; `''` among theirs is a
  /// contact from no park, which still occupies the slot.
  worked: Record<string, Record<string, string[]>>
  /// Listed park we operated from → contacts made there.
  activated: Record<string, number>
  /// Listed park worked → contacts with it.
  hunted: Record<string, number>
  bands: Record<string, number>
  qsos: number
  points: number
  dupes: number
}

function str(value: JSONValue | undefined): string {
  return typeof value === 'string' ? value : ''
}

export function parksActivated(sheet: FlspotaScoresheet): number {
  return Object.values(sheet.activated).filter((contacts) => contacts >= QSOS_TO_ACTIVATE).length
}

export const FlspotaScorer: ContestScorer<FlspotaScoresheet> = {
  startScoresheet(): FlspotaScoresheet {
    return { worked: {}, activated: {}, hunted: {}, bands: {}, qsos: 0, points: 0, dupes: 0 }
  },

  // Mutates and returns the given scoresheet — see ContestScorer.scoreQso.
  scoreQso({ scoresheet: sheet, qso, operation, ref }) {
    // Another state-park event's legacy operation: not ours to judge, so no
    // alert either — an `unknownEvent` here would flag every Texas QSO.
    if (!isOurRef(ref)) return { scoresheet: sheet, score: { value: 0 } }
    sheet.ours = true

    const call = str(((qso.their as Record<string, JSONValue>) ?? {}).call)
    if (!call) return { scoresheet: sheet, score: { value: 0 } }

    // A QSO with no band is refused along with the unlisted ones: it cannot be
    // checked against §4.2, and saying `invalidBand` is how an import that lost
    // its BAND column becomes visible instead of scoring.
    const band = str(qso.band)
    if (!BANDS.includes(band)) return { scoresheet: sheet, score: { value: 0, alerts: ['invalidBand'] } }

    const mode = slotMode(str(qso.mode))
    const ours = ourParks(operation)
    const theirs = theirParks(qso)
    // In no listed park we are a hunter, and only a listed park is a contact.
    const claims = ours.length > 0 ? (theirs.length > 0 ? theirs : ['']) : theirs.filter(isListed)
    if (claims.length === 0) return { scoresheet: sheet, score: { value: 0 } }

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

    const notices: string[] = []
    if (before.length > 0 && !before.some((key) => key.split('|')[1] === band)) notices.push('newBand')
    if (before.length > 0 && !before.some((key) => key.split('|')[2] === mode)) notices.push('newMode')
    if (newToSlot.some((park) => isListed(park) && sheet.hunted[park] === undefined)) notices.push('newPark')
    // Credited again on a band and mode already worked: the verdict has to SAY
    // it judged the prior contact, or the app's own `duplicate` alert stands
    // beside the credit (the host's scoring_priority.dart). Their new park is
    // `newPark`; ours, with nothing new on their side, is `newRef`.
    if (hadBandAndMode && !notices.includes('newPark')) notices.push(newToSlot.length > 0 ? 'newPark' : 'newRef')

    for (const park of newToSlot) if (isListed(park)) sheet.hunted[park] = (sheet.hunted[park] ?? 0) + 1
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

    // "There are no multipliers" (§6.1): the park bonus is simply added.
    const bonus = parksActivated(sheet) * POINTS_PER_PARK_ACTIVATED

    return contestSummary({
      key: 'flspota',
      scope,
      icon: 'palm-tree',
      title: manifest.shortName,
      total: sheet.points + bonus,
      arithmetic: contestArithmetic({ qsos: sheet.qsos, points: sheet.points, bonus }, ctx),
      detail: longSummaryFor(sheet),
      extra: { points: sheet.points, qsos: sheet.qsos },
    }, ctx)
  },
}

function longSummaryFor(sheet: FlspotaScoresheet): string {
  const parts: string[] = []

  const ours = Object.entries(sheet.activated)
  if (ours.length > 0) {
    parts.push(`### Activating\n${ours
      .map(([park, contacts]) => `${park} (${fmtInteger(contacts)}${contacts < QSOS_TO_ACTIVATE ? ` of ${QSOS_TO_ACTIVATE}` : ''})`)
      .join(' • ')}`)
  }

  const theirs = Object.keys(sheet.hunted).sort()
  if (theirs.length > 0) parts.push(`### ${fmtInteger(theirs.length)} Florida parks worked\n${theirs.join(' • ')}`)

  const bands = Object.keys(sheet.bands).sort()
  if (bands.length > 0) {
    parts.push(bands.map((band) => `**${band}**: ${fmtInteger(sheet.bands[band])} QSOs`).join('\n'))
  }

  return parts.join('\n\n')
}
