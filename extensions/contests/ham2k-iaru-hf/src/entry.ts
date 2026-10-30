// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The entry we declare — operator class, power and overlay, beside the mode
// restriction and station type the setup already asks for — and the Cabrillo
// `CATEGORY-` lines it becomes. The ARRL's log robot reads these to place the
// entry among the categories its results list; none of it changes the score.
// The same shape as `cqww`'s.
//
// The values are the ones the Cabrillo form the rules page links to
// (b4h.net/cabforms, IARU HF) offers: SINGLE-OP, MULTI-OP or CHECKLOG; ALL;
// MIXED, CW or SSB; HIGH, LOW or QRP; ONE, TWO or UNLIMITED; HQ; YOUTH.
//
// NOTHING is defaulted, as in the QSO parties: each answer is a claim about
// how we operated, so an unanswered question writes no line rather than a
// guessed one. What the rules make follow from an answer — a Multi-Single is
// high power and assisted, a Multi-Two low power and not — is written for it.

import type { JSONValue } from "@ham2k/extension-sdk"
import type { ContestRules } from "@ham2k/lib-contest-rules"

/// The rules' entry categories (Entry Categories, HCAT.1–HCAT.4). Operator and
/// transmitter are one axis here, as the rules list them, and split into the
/// two Cabrillo lines on the way out.
///
/// `MULTI-HQ` is the multi-operator HQ station, which "may have only one
/// transmitted signal per band and mode" (Special Rules 7.1) — neither of the
/// two multioperator categories, and no category at all for anyone else.
export const OPERATOR_CLASSES = [
  'SINGLE-OP', 'SINGLE-OP-UNLIMITED', 'MULTI-ONE', 'MULTI-TWO', 'MULTI-HQ', 'CHECKLOG',
] as const
export type OperatorClass = typeof OPERATOR_CLASSES[number]

export const POWER_CLASSES = ['HIGH', 'LOW', 'QRP'] as const

/// The Youth overlay, for a single operator 25 or younger (HCAT.1.5, HCAT.2.5).
export const OVERLAY_CLASSES = ['YOUTH'] as const

function declared<T extends string>(value: JSONValue | undefined, allowed: readonly T[]): T | undefined {
  const upper = typeof value === 'string' ? value.toUpperCase() : ''
  return allowed.find((option) => option === upper)
}

const TRANSMITTER_FOR: Partial<Record<OperatorClass, string>> = {
  'MULTI-ONE': 'ONE',
  'MULTI-TWO': 'TWO',
  'MULTI-HQ': 'UNLIMITED',
}

/// What each operator class says about spotting assistance: SO and M2 may not
/// use it, SOU and MS may (HCAT.1.1, HCAT.2.1, HCAT.4.1.2, HCAT.4.2.2). The
/// HQ rules say nothing either way, so an HQ entry claims nothing.
const ASSISTED_FOR: Partial<Record<OperatorClass, string>> = {
  'SINGLE-OP': 'NON-ASSISTED',
  'SINGLE-OP-UNLIMITED': 'ASSISTED',
  'MULTI-ONE': 'ASSISTED',
  'MULTI-TWO': 'NON-ASSISTED',
}

/// The setup's `modeRestriction`, as Cabrillo names it.
const MODE_FOR: Record<string, string> = { Mixed: 'MIXED', CW: 'CW', Phone: 'SSB' }

/// The `CATEGORY-` lines for the entry declared on [ref], in the order the
/// Cabrillo form gives them. A line with no value is dropped by the Cabrillo
/// writer.
export function cabrilloCategories(ref: Record<string, JSONValue> | undefined): [string, string | undefined][] {
  const hq = ref?.stationType === 'hq'
  const operator = declared(ref?.operator, OPERATOR_CLASSES)
  // A multi-operator HQ entry from a station that is not an HQ is no category
  // the rules have: it claims only what is still true, that it is multi-op.
  const notHq = operator === 'MULTI-HQ' && !hq
  const single = operator === 'SINGLE-OP' || operator === 'SINGLE-OP-UNLIMITED'
  const multi = operator?.startsWith('MULTI-') ?? false

  // "Multioperator stations may only enter as Mixed-Mode" (Special Rules 3.3).
  const mode = multi ? 'MIXED' : MODE_FOR[typeof ref?.modeRestriction === 'string' ? ref.modeRestriction : '']
  // Multi-Single has "no power subcategories" and is High Power (HCAT.4.1.4);
  // Multi-Two is "limited to 100 W" (HCAT.4.2.4), which QRP is within. A
  // Multi-Two that declared high power says so: the header never claims a
  // limit the operator said they didn't keep.
  const declaredPower = declared(ref?.power, POWER_CLASSES)
  const power = operator === 'MULTI-ONE' ? 'HIGH'
    : operator === 'MULTI-TWO' ? (declaredPower === 'HIGH' ? 'HIGH' : 'LOW')
    : declaredPower

  return [
    ['CATEGORY-OPERATOR', operator === 'CHECKLOG' ? 'CHECKLOG' : single ? 'SINGLE-OP' : multi ? 'MULTI-OP' : undefined],
    ['CATEGORY-ASSISTED', operator ? ASSISTED_FOR[operator] : undefined],
    // Every category is all-band; the rules have no single-band entry.
    ['CATEGORY-BAND', 'ALL'],
    ['CATEGORY-MODE', mode],
    ['CATEGORY-POWER', power],
    ['CATEGORY-TRANSMITTER', operator && !notHq ? TRANSMITTER_FOR[operator] : undefined],
    // HQ stations are a category of their own in the results; the station
    // type set up for the exchange already says we are one.
    ['CATEGORY-STATION', hq ? 'HQ' : undefined],
    ['CATEGORY-OVERLAY', single ? declared(ref?.overlay, OVERLAY_CLASSES) : undefined],
  ]
}

/// What the rules allow an entry declared as [operator]: spotting assistance
/// wherever [ASSISTED_FOR] does not rule it out, and no self-spotting for
/// anyone — "spotting your own station ('self-spotting') or asking to be
/// spotted by another station" is prohibited conduct (PROH.4).
export function contestRules(operator: JSONValue | undefined): ContestRules {
  const declaredClass = declared(operator, OPERATOR_CLASSES)
  return { assistance: !declaredClass || ASSISTED_FOR[declaredClass] !== 'NON-ASSISTED', selfSpotting: false }
}

/// `OPERATORS`: the calls typed at setup, uppercased and space-separated —
/// "Multioperator logs must include the complete list of operators" (ELOG.4).
/// Empty when nothing was typed, so the caller can fall back to the app's
/// operator call.
export function declaredOperators(ref: Record<string, JSONValue> | undefined): string {
  const typed = typeof ref?.operators === 'string' ? ref.operators : ''
  return typed.toUpperCase().split(/[\s,;]+/).filter((call) => call).join(' ')
}

/// `CLUB`: the club name as typed, on one line.
export function declaredClub(ref: Record<string, JSONValue> | undefined): string {
  return typeof ref?.club === 'string' ? ref.club.replace(/\s+/g, ' ').trim() : ''
}
