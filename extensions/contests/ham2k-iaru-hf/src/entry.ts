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

/// The classes whose QSO lines end in a transmitter ID: "The submitted log
/// must indicate which transmitter made each contact" (HCAT.4.2.6). Cabrillo's
/// "t is transmitter id ... It is a single digit of 0 or 1."
const LOGS_TRANSMITTER: readonly OperatorClass[] = ['MULTI-TWO']

/// The transmitter column for each QSO line, as a function of the QSO —
/// nothing unless the class declared on [ref] has one.
///
/// The transmitter is the operating position each contact was logged at
/// (`our.multiIdentifier`, else `our.operatingPosition`). A position is any
/// label a station gives its seats, so the column is not the label itself:
/// the distinct positions in the log are sorted — numbers in numeric order,
/// ahead of other labels — and numbered from 0, as Cabrillo counts
/// transmitters. A contact logged from no position — made before the seat
/// was set, or imported from another logger — is taken to be from the first
/// position, transmitter 0. A log with more positions than its class has
/// transmitters writes them as counted, 2 and on, for the log checker to flag
/// rather than folded into one of the two here.
///
/// Counted over the contacts the Cabrillo writer writes, so an event row or
/// a deleted contact never takes up a number.
export function transmitterColumns(ref: Record<string, JSONValue> | undefined, qsos: Record<string, JSONValue>[]): (qso: Record<string, JSONValue>) => string[] {
  const operator = declared(ref?.operator, OPERATOR_CLASSES)
  if (!operator || !LOGS_TRANSMITTER.includes(operator)) return () => []
  const written = qsos.filter((qso) => qso.band !== 'event' && qso.deleted !== true)
  const positions = [...new Set(written.map(positionOf).filter((label) => label))].sort(byPosition)
  return (qso) => {
    const label = positionOf(qso)
    return [String(label ? positions.indexOf(label) : 0)]
  }
}

function positionOf(qso: Record<string, JSONValue>): string {
  const our = qso.our && typeof qso.our === 'object' && !Array.isArray(qso.our) ? qso.our : {}
  for (const value of [our.multiIdentifier, our.operatingPosition]) {
    const label = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''
    // A number is one position however it is written: `02` is seat 2.
    if (/^\d+$/.test(label)) return String(Number(label))
    if (label) return label
  }
  return ''
}

function byPosition(a: string, b: string): number {
  const aNumber = /^\d+$/.test(a)
  const bNumber = /^\d+$/.test(b)
  if (aNumber && bNumber) return Number(a) - Number(b)
  if (aNumber !== bNumber) return aNumber ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}
