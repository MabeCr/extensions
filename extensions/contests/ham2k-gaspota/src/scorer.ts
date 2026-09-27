// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Georgia State Parks on the Air scoring, from the "2026 GA-POTA Rules v.1.2".
// The sponsor scores TWO entries by two formulas, and this computes both.
//
//   ACTIVATORS (§6.1.1): "Base Score = (number of parks activated) x (sum of the
//   scores from each park), with the score from each park being 1 point for each
//   QSO, plus an additional 5 pts for each QSO with each distinct GA park." The
//   sponsor's score sheet states it as one line — Contact Points = B + (5*C),
//   Base Score = D * A — with C counted once across the whole entry ("each of
//   the 52 parks counts only once"). §6.1.2.2: 2 × (80 + 135) = 430.
//
//   HUNTERS (§6.2.1): "Base Score = (number of Georgia state parks hunted) x
//   (total number of contacts with Georgia state parks)", plus 100 for hunting
//   on both UTC days. §6.2.2: 28 parks × 45 contacts = 1260. There is NO
//   5-point term, and a contact with anyone else is not a contact at all: the
//   sponsor derives this score from the activators' logs.
//
// Both formulas reproduce every row of the sponsor's published 2026 results —
// 65 activators, 3,431 hunters — and those results settle two things the text
// leaves open:
//
//   * A PARK COUNTS AS ACTIVATED WITH FEWER THAN TEN QSOS. "(10 or more
//     contacts)" appears only in the Multi-Park class definition (§5.1.1.1), and
//     an entry with 9 QSOs was scored with one park. So `P` is the listed parks
//     we made a contact from, with no threshold.
//   * One entrant may be on BOTH tables, so an operation that does both shows
//     the activator score and states the hunter one beneath it.
//
// WHAT A CONTACT IS. §4.2: "Each band/mode/operator counts as a separate
// contact", §4.4 makes the mode an exact one, and:
//
//   * each of OUR parks is its own log (the filename names one park, §7.2.1), so
//     a station worked from one park is a new contact from the next;
//   * "n-fer contacts must be listed separately with <SIG_INFO> for each park to
//     count as a new contact" (the sponsor's rules page), so a station at
//     several parks is a contact per park — every POTA park, since "there is no
//     'bonus' for contacting out of state parks, so they count just as regular
//     contacts" (FAQ).
//
// A HUNTER's contact is a row in an activator's log, where our own park does not
// figure: it is kept by station, band, mode and THEIR listed park alone.
//
// The three activator bonuses (repeat offender, first-time activator, hike-in)
// and the hunters' repeat bonus rest on facts no log holds; the sponsor credits
// them from its own lists and upload form. The contest period is not enforced,
// as in the other contests here.

import { fmtInteger } from "@ham2k/lib-format-tools"
import { contestArithmetic, contestSummary } from "@ham2k/extension-sdk"
import type { ContestScorer, JSONValue, QsoScoreVerdict } from "@ham2k/extension-sdk"

import { EXCLUDED_BANDS, POINTS_PER_DISTINCT_PARK, TWO_DAY_BONUS, slotMode } from "./event.ts"
import { isListed, isOurRef, ourParks, theirParks } from "./parks.ts"

import manifest from "../manifest.json" with { type: "json" }

export type GaspotaScoresheet = {
  /// Whether any QSO was scored under THIS event's ref. The scope offers this
  /// scorer every legacy state-parks operation, the other events' included, and
  /// one that was never ours summarizes to nothing at all.
  ours?: boolean
  /// The activator's log: call → `OURPARK|band|MODE` → their parks already
  /// credited in that slot, `''` being a contact from no park.
  worked: Record<string, Record<string, string[]>>
  /// The hunter's: call → `band|MODE` → their LISTED parks already credited.
  huntedSlots: Record<string, Record<string, string[]>>
  /// Listed park we operated from → contacts made there.
  activated: Record<string, number>
  /// Listed park worked → contacts with it, as a hunter's table counts them.
  hunted: Record<string, number>
  /// UTC day → 1, for each day with a contact with a listed park.
  huntDays: Record<string, number>
  bands: Record<string, number>
  /// Contacts made from a listed park — the activator's `B`.
  contacts: number
  /// Contacts with listed parks — the hunter's total.
  parkContacts: number
  dupes: number
}

function str(value: JSONValue | undefined): string {
  return typeof value === 'string' ? value : ''
}

const DAY_MILLIS = 24 * 60 * 60 * 1000

export interface GaspotaTotals {
  activator: { contacts: number; distinctParks: number; parksActivated: number; total: number }
  hunter: { contacts: number; parks: number; bonus: number; total: number }
}

export function totalsFor(sheet: GaspotaScoresheet): GaspotaTotals {
  const distinctParks = Object.keys(sheet.hunted).length
  const parksActivated = Object.keys(sheet.activated).length
  const bonus = Object.keys(sheet.huntDays).length >= 2 ? TWO_DAY_BONUS : 0
  return {
    activator: {
      contacts: sheet.contacts,
      distinctParks,
      parksActivated,
      total: (sheet.contacts + POINTS_PER_DISTINCT_PARK * distinctParks) * parksActivated,
    },
    hunter: {
      contacts: sheet.parkContacts,
      parks: distinctParks,
      bonus,
      total: distinctParks * sheet.parkContacts + (sheet.parkContacts > 0 ? bonus : 0),
    },
  }
}

/// The claims in [claims] a slot has not been credited, recording them.
///
/// A slot already credited ANYTHING is closed to a parkless claim: only a park
/// they had not given us there earns another contact. Without the `park &&`,
/// "no park" would read as a park the slot was still missing.
function creditFresh(bySlot: Record<string, string[]>, slot: string, claims: string[]): string[] {
  const credited = bySlot[slot]
  const fresh = credited ? claims.filter((park) => park && !credited.includes(park)) : claims
  if (fresh.length > 0) bySlot[slot] = [...(credited ?? []), ...fresh]
  return fresh
}

export const GaspotaScorer: ContestScorer<GaspotaScoresheet> = {
  startScoresheet(): GaspotaScoresheet {
    return {
      worked: {}, huntedSlots: {}, activated: {}, hunted: {}, huntDays: {}, bands: {},
      contacts: 0, parkContacts: 0, dupes: 0,
    }
  },

  // Mutates and returns the given scoresheet — see ContestScorer.scoreQso.
  scoreQso({ scoresheet: sheet, qso, operation, ref }) {
    // Another state-park event's legacy operation: not ours to judge, so no
    // alert either — an `unknownEvent` here would flag every Texas QSO.
    if (!isOurRef(ref)) return { scoresheet: sheet, score: { value: 0 } }
    sheet.ours = true

    const call = str(((qso.their as Record<string, JSONValue>) ?? {}).call)
    if (!call) return { scoresheet: sheet, score: { value: 0 } }

    // A QSO with no band is refused along with the WARC ones: it cannot be
    // checked against §4.1, and saying `invalidBand` is how an import that lost
    // its BAND column becomes visible instead of scoring.
    const band = str(qso.band)
    if (!band || EXCLUDED_BANDS.includes(band)) return { scoresheet: sheet, score: { value: 0, alerts: ['invalidBand'] } }

    const mode = slotMode(str(qso.mode))
    const ours = ourParks(operation)
    const theirs = theirParks(qso)
    const listed = theirs.filter(isListed)

    const bySlot = (sheet.worked[call] ??= {})
    const byHuntedSlot = (sheet.huntedSlots[call] ??= {})
    const before = [...Object.keys(bySlot).map((key) => key.slice(key.indexOf('|') + 1)), ...Object.keys(byHuntedSlot)]
    const hadBandAndMode = before.includes(`${band}|${mode}`)

    // The activator's log, one per park of ours.
    let contacts = 0
    let theirNewPark = false
    for (const our of ours) {
      const fresh = creditFresh(bySlot, `${our}|${band}|${mode}`, theirs.length > 0 ? theirs : [''])
      contacts += fresh.length
      if (fresh.length > 0) sheet.activated[our] = (sheet.activated[our] ?? 0) + fresh.length
      if (fresh.some((park) => park)) theirNewPark = true
    }

    // The hunter's table, which our own park is no part of.
    const freshListed = creditFresh(byHuntedSlot, `${band}|${mode}`, listed)
    const newToLog = freshListed.some((park) => sheet.hunted[park] === undefined)
    for (const park of freshListed) sheet.hunted[park] = (sheet.hunted[park] ?? 0) + 1
    if (freshListed.length > 0) {
      theirNewPark = true
      const at = typeof qso.startAtMillis === 'number' ? qso.startAtMillis : undefined
      if (at !== undefined) sheet.huntDays[`${Math.floor(at / DAY_MILLIS)}`] = 1
    }

    // What the QSO is worth is its contacts in the entry we are making: the
    // activator's while we are in a listed park, the hunter's otherwise.
    const value = ours.length > 0 ? contacts : freshListed.length
    if (value === 0) {
      // In no park, working nobody in one: not a contest contact, and not an
      // error either.
      if (ours.length === 0 && listed.length === 0) return { scoresheet: sheet, score: { value: 0 } }
      sheet.dupes += 1
      return { scoresheet: sheet, score: { value: 0, dupe: true, alerts: ['duplicate'] } }
    }

    const notices: string[] = []
    if (before.length > 0 && !before.some((key) => key.split('|')[0] === band)) notices.push('newBand')
    if (before.length > 0 && !before.some((key) => key.split('|')[1] === mode)) notices.push('newMode')
    if (newToLog) notices.push('newPark')
    // Credited again on a band and mode already worked: the verdict has to SAY
    // it judged the prior contact, or the app's own `duplicate` alert stands
    // beside the credit (the host's scoring_priority.dart). Their new park is
    // `newPark`; ours, with nothing new on their side, is `newRef`.
    if (hadBandAndMode && !notices.includes('newPark')) notices.push(theirNewPark ? 'newPark' : 'newRef')

    sheet.bands[band] = (sheet.bands[band] ?? 0) + value
    sheet.contacts += contacts
    sheet.parkContacts += freshListed.length

    const score: QsoScoreVerdict = { value, band }
    if (notices.length > 0) score.notices = notices
    return { scoresheet: sheet, score }
  },

  summarizeScore({ scoresheet: sheet, scope }, ctx) {
    if (!sheet.ours) return {}

    const { activator, hunter } = totalsFor(sheet)
    const activating = activator.parksActivated > 0
    const contacts = activating ? activator.contacts : hunter.contacts
    const mults = activating ? activator.parksActivated : hunter.parks

    return contestSummary({
      key: 'gaspota',
      scope,
      icon: 'fruit-cherries',
      title: manifest.shortName,
      total: activating ? activator.total : hunter.total,
      // The activator's five points per distinct park join the contacts BEFORE
      // they are multiplied (§6.1.1); the hunter's two-day bonus is added after.
      arithmetic: activating
        ? contestArithmetic({ qsos: contacts, points: contacts, bonus: POINTS_PER_DISTINCT_PARK * activator.distinctParks, bonusFirst: true, mults }, ctx)
        : contestArithmetic({ qsos: contacts, points: contacts, mults, bonus: contacts > 0 ? hunter.bonus : 0 }, ctx),
      detail: longSummaryFor(sheet, { activator, hunter }),
      extra: { points: contacts, mults, qsos: contacts },
    }, ctx)
  },
}

function longSummaryFor(sheet: GaspotaScoresheet, { activator, hunter }: GaspotaTotals): string {
  const parts: string[] = []

  if (activator.parksActivated > 0) {
    parts.push([
      `**Activator:** ${fmtInteger(activator.total)}`,
      `Contacts: ${fmtInteger(activator.contacts)} • Distinct Georgia parks contacted: ${fmtInteger(activator.distinctParks)} • Parks activated: ${fmtInteger(activator.parksActivated)}`,
    ].join('\n'))
    parts.push(`### Activating\n${Object.entries(sheet.activated).map(([park, n]) => `${park} (${fmtInteger(n)})`).join(' • ')}`)
  }

  if (hunter.contacts > 0) {
    parts.push([
      `**Hunter:** ${fmtInteger(hunter.total)}`,
      `Georgia parks contacted: ${fmtInteger(hunter.parks)} • Contacts with Georgia parks: ${fmtInteger(hunter.contacts)}${hunter.bonus > 0 ? ` • Two-day bonus: ${fmtInteger(hunter.bonus)}` : ''}`,
    ].join('\n'))
    parts.push(`### Parks worked\n${Object.keys(sheet.hunted).sort().join(' • ')}`)
  }

  const bands = Object.keys(sheet.bands).sort()
  if (bands.length > 0) {
    parts.push(bands.map((band) => `**${band}**: ${fmtInteger(sheet.bands[band])} QSOs`).join('\n'))
  }

  return parts.join('\n\n')
}
