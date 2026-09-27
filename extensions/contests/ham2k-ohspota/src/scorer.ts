// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Ohio State Parks On The Air scoring, from the sponsor's rules (event.ts names
// the document).
//
//   "QSO POINTS - Each complete non-duplicate on each mode and/or band contact
//   is worth one point."
//   "MULTIPLIERS - Multipliers are the 76 Ohio State Parks (1 per park = 76
//   maximum) the State Park YOU are operating from will count as a multiplier."
//   "FINAL SCORE - Multiply QSO points by the total number of multipliers."
//   Their example: 37 contacts from PUN, 9 other parks contacted — "9 plus PUN,
//   Total score = 10 x 37 = 370 points."
//
// What follows from the rest of the rules:
//
//   * SSB and CW only. A digital contact is not a contact in this contest, so it
//     is refused rather than given a point.
//   * "Stations may be worked once on each band/mode." A park they had not given
//     us on that band and mode reopens it, which is how a multi-park operator is
//     worked again from their next park.
//   * OUR park is a multiplier outright — no count of contacts to reach first —
//     and ONCE: another station worked in the park we are in does not make it
//     two ("1 per park = 76 maximum").
//   * WHO MAY WORK WHOM: "Non-Ohio stations may work only Ohio stations located
//     in an Ohio State Park; Ohio stations not located in an Ohio State Park may
//     only contact stations operating from inside an Ohio State Park." So in no
//     park ourselves, a contact with a station in no park is worth nothing. In a
//     park, everyone counts.
//   * EACH PARK WE OPERATE FROM IS ITS OWN ENTRY: "If you activate three Ohio
//     State Parks in the MPO category, send in three Summary Sheets and three Log
//     files." Contacts, duplicates and multipliers all start over at the next
//     park, and the summary states a claimed score for each — the figure a
//     summary sheet asks for.
//
// The entry's own conditions — ten contacts, four of them with other parks —
// are stated in the summary and change no QSO's worth. The contest period is not
// enforced, as in the other contests here.

import { fmtInteger } from "@ham2k/lib-format-tools"
import { contestArithmetic, contestSummary } from "@ham2k/extension-sdk"
import type { ContestScorer, JSONValue, QsoScoreVerdict } from "@ham2k/extension-sdk"

import { BANDS, MIN_CONTACTS, MIN_OTHER_PARKS, PARKS, slotMode } from "./event.ts"
import { isOurRef, ourPark, theirExchange, theirPark } from "./parks.ts"

import manifest from "../manifest.json" with { type: "json" }

/// One entry: the contacts made from one park of ours, or from none (`''`).
export type OhspotaEntry = {
  qsos: number
  /// Their park → contacts with it.
  hunted: Record<string, number>
}

export type OhspotaScoresheet = {
  /// Whether any QSO was scored under THIS event's ref. The scope offers this
  /// scorer every legacy state-parks operation, the other events' included, and
  /// one that was never ours summarizes to nothing at all.
  ours?: boolean
  /// Our park (`''` for none) → that entry, in the order they were opened.
  entries: Record<string, OhspotaEntry>
  /// call → `OURPARK|band|MODE` → their parks already credited in that slot,
  /// `''` being a contact from no park, which still occupies the slot.
  worked: Record<string, Record<string, string[]>>
  bands: Record<string, number>
  dupes: number
}

function str(value: JSONValue | undefined): string {
  return typeof value === 'string' ? value : ''
}

/// The multipliers of the entry made from [park]: the parks it worked, and the
/// park itself, once.
export function multipliersOf(park: string, entry: OhspotaEntry): number {
  const parks = new Set(Object.keys(entry.hunted))
  if (park) parks.add(park)
  return parks.size
}

/// An entry's claimed score. `|| 1`: an entry with no park on either side yet is
/// still worth its contacts on the board, where a zero reads as broken.
export function scoreOf(park: string, entry: OhspotaEntry): number {
  return entry.qsos * (multipliersOf(park, entry) || 1)
}

export const OhspotaScorer: ContestScorer<OhspotaScoresheet> = {
  startScoresheet(): OhspotaScoresheet {
    return { entries: {}, worked: {}, bands: {}, dupes: 0 }
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
    // checked against the band list, and saying `invalidBand` is how an import
    // that lost its BAND column becomes visible instead of scoring.
    const band = str(qso.band)
    if (!BANDS.includes(band)) return { scoresheet: sheet, score: { value: 0, alerts: ['invalidBand'] } }

    const mode = slotMode(str(qso.mode))
    if (!mode) return { scoresheet: sheet, score: { value: 0, alerts: ['invalidMode'] } }

    const our = ourPark(operation, ref)
    const their = theirPark(qso)
    // The exchange IS a park identifier here, so one that is missing or is not
    // one of the 76 is a park going unclaimed: a multiplier, and a typo the
    // operator can still fix while the QSO is in front of them.
    const exchangeAlert = their ? undefined : (theirExchange(qso) ? 'invalidExchange' : 'missingExchange')

    // In no park ourselves, only a station in one may be worked at all.
    if (!our && !their) return { scoresheet: sheet, score: { value: 0, alerts: [exchangeAlert as string] } }

    const bySlot = (sheet.worked[call] ??= {})
    const slot = `${our}|${band}|${mode}`
    const credited = bySlot[slot]
    // A slot already credited ANYTHING is closed to a parkless claim: only a
    // park they had not given us there earns another contact. Without the
    // `!their ||`, "no park" would read as a park the slot was still missing.
    if (credited && (!their || credited.includes(their))) {
      sheet.dupes += 1
      return { scoresheet: sheet, score: { value: 0, dupe: true, alerts: ['duplicate'] } }
    }

    const entry = (sheet.entries[our] ??= { qsos: 0, hunted: {} })
    // This entry's own slots: a station worked from our last park is simply new
    // from this one, and says nothing about a prior contact.
    const before = Object.keys(bySlot).filter((key) => key.startsWith(`${our}|`))
    const notices: string[] = []
    if (before.length > 0 && !before.some((key) => key.split('|')[1] === band)) notices.push('newBand')
    if (before.length > 0 && !before.some((key) => key.split('|')[2] === mode)) notices.push('newMode')
    // A park new to the ENTRY, which is where a multiplier is counted — and one
    // new only to this slot, because a verdict that credits a worked-before
    // station without saying so leaves the app's own `duplicate` alert standing
    // beside the credit (the host's scoring_priority.dart).
    if (their && (credited || entry.hunted[their] === undefined)) notices.push('newPark')
    // The same duty when it is OUR park that is new: the app's own rule is call,
    // band and mode across the whole operation, and knows nothing of entries.
    const hadBandAndMode = Object.keys(bySlot).some((key) => key.endsWith(`|${band}|${mode}`))
    if (hadBandAndMode && !notices.includes('newPark')) notices.push('newRef')

    bySlot[slot] = [...(credited ?? []), their]
    entry.qsos += 1
    if (their) entry.hunted[their] = (entry.hunted[their] ?? 0) + 1
    sheet.bands[band] = (sheet.bands[band] ?? 0) + 1

    const score: QsoScoreVerdict = { value: 1, band }
    if (notices.length > 0) score.notices = notices
    if (exchangeAlert) score.alerts = [exchangeAlert]
    return { scoresheet: sheet, score }
  },

  summarizeScore({ scoresheet: sheet, scope }, ctx) {
    if (!sheet.ours) return {}

    // Every entry's claimed score, summed so the board has one number, with
    // each entry stated beneath it. Separate entries' products do not fold into
    // one, so with several the arithmetic lists them rather than multiplying.
    const entries = Object.entries(sheet.entries)
    const qsos = entries.reduce((sum, [, entry]) => sum + entry.qsos, 0)
    const total = entries.reduce((sum, [park, entry]) => sum + scoreOf(park, entry), 0)
    const single = entries.length === 1 ? entries[0] : undefined
    const mults = single ? (multipliersOf(single[0], single[1]) || 1) : undefined

    return contestSummary({
      key: 'ohspota',
      scope,
      icon: 'flag-checkered',
      title: manifest.shortName,
      total,
      arithmetic: mults !== undefined
        ? contestArithmetic({ qsos, points: qsos, mults }, ctx)
        : contestArithmetic({ qsos, more: entries.length > 1 ? [entries.map(([park, entry]) => fmtInteger(scoreOf(park, entry))).join(' + ')] : [] }, ctx),
      detail: longSummaryFor(sheet),
      extra: { points: qsos, qsos, ...(mults !== undefined ? { mults } : {}) },
    }, ctx)
  },
}

function longSummaryFor(sheet: OhspotaScoresheet): string {
  const parts: string[] = []

  for (const [park, entry] of Object.entries(sheet.entries)) {
    const mults = multipliersOf(park, entry) || 1
    const lines = [`**${park || 'Not in a park'}:** ${fmtInteger(entry.qsos)} × ${fmtInteger(mults)} = ${fmtInteger(scoreOf(park, entry))}`]
    if (park) {
      const otherParks = Object.keys(entry.hunted).filter((their) => their !== park).length
      if (entry.qsos < MIN_CONTACTS || otherParks < MIN_OTHER_PARKS) {
        lines.push(`Needs ${MIN_CONTACTS} contacts, ${MIN_OTHER_PARKS} with other parks: ${fmtInteger(entry.qsos)} and ${fmtInteger(otherParks)} so far`)
      }
    }
    parts.push(lines.join('\n'))
  }

  const worked = new Set(Object.values(sheet.entries).flatMap((entry) => Object.keys(entry.hunted)))
  const parkList = PARKS.map((park) => (worked.has(park.abbreviation) ? `**~~${park.abbreviation}~~**` : park.abbreviation)).join(' ')
  parts.push(`### ${fmtInteger(worked.size)} of ${fmtInteger(PARKS.length)} parks worked\n${parkList}`)

  const bands = Object.keys(sheet.bands).sort()
  if (bands.length > 0) {
    parts.push(bands.map((band) => `**${band}**: ${fmtInteger(sheet.bands[band])} QSOs`).join('\n'))
  }

  return parts.join('\n\n')
}
