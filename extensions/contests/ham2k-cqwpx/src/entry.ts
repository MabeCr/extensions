// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The entry we declare — operator class, band, power and overlay — and the
// Cabrillo `CATEGORY-` lines it becomes, with the rest of the header that
// describes us: LOCATION, OPERATORS and CLUB. The log robot reads these to
// place the entry, and "failure to fill out the header correctly may result in
// the entry being placed in the wrong category or reclassified as a Checklog"
// (rules XI.C). None of it changes the score. The same shape as `cqww`'s.
//
// NOTHING is defaulted, as in the QSO parties: each answer is a claim about
// how we operated, so an unanswered question writes no line rather than a
// guessed one. What the rules make follow from an answer — a multi-operator
// entry is all-band and may use assistance — is written for it.

import type { JSONValue } from "@ham2k/extension-sdk"
import { annotateCallAgainstCountryFile } from "@ham2k/extension-sdk"
import { parseCallsign } from "@ham2k/lib-callsigns"
import type { ContestRules } from "@ham2k/lib-contest-rules"

/// The rules' entry categories (VI.A, VI.C, VI.D). Operator and transmitter
/// are one axis here, as the rules list them, and split into the two Cabrillo
/// lines on the way out.
///
/// WPX has no separate assisted category — "use of QSO alerting assistance is
/// permitted in all categories" but the Classic overlay — yet its Cabrillo
/// header still has CATEGORY-ASSISTED, so a single operator says which.
export const OPERATOR_CLASSES = [
  'SINGLE-OP', 'SINGLE-OP-ASSISTED', 'MULTI-ONE', 'MULTI-TWO', 'MULTI-UNLIMITED', 'MULTI-DISTRIBUTED', 'CHECKLOG',
] as const
export type OperatorClass = typeof OPERATOR_CLASSES[number]

/// `ALL` or one band — "All Band or Single Band" for the single operators.
/// RTTY has no 160m.
export const BAND_CLASSES = ['ALL', '160M', '80M', '40M', '20M', '15M', '10M'] as const

export const POWER_CLASSES = ['HIGH', 'LOW', 'QRP'] as const

/// The single-operator overlays (VI.B), entered alongside the main category.
export const OVERLAY_CLASSES = ['TB-WIRES', 'ROOKIE', 'CLASSIC', 'YOUTH'] as const

function declared<T extends string>(value: JSONValue | undefined, allowed: readonly T[]): T | undefined {
  const upper = typeof value === 'string' ? value.toUpperCase() : ''
  return allowed.find((option) => option === upper)
}

const TRANSMITTER_FOR: Partial<Record<OperatorClass, string>> = {
  'MULTI-ONE': 'ONE',
  'MULTI-TWO': 'TWO',
  'MULTI-UNLIMITED': 'UNLIMITED',
}

/// The `CATEGORY-` lines for the entry declared on [ref], in the order the
/// sponsor's example header gives them. A line with no value is dropped by
/// the Cabrillo writer.
export function cabrilloCategories(ref: Record<string, JSONValue> | undefined): [string, string | undefined][] {
  const mode = typeof ref?.mode === 'string' ? ref.mode : ''
  const operator = declared(ref?.operator, OPERATOR_CLASSES)
  const single = operator === 'SINGLE-OP' || operator === 'SINGLE-OP-ASSISTED'
  const multi = operator?.startsWith('MULTI-') ?? false

  // Multi-operator categories are "All Band only" (VI.C), so their
  // band is not a question. RTTY runs no 160m, so that answer is no entry.
  const band = multi ? 'ALL' : declared(ref?.band, BAND_CLASSES)
  const validBand = mode === 'RTTY' && band === '160M' ? undefined : band
  // Overlays are for single operators only, and Classic not for an assisted
  // one — it is the one category that prohibits assistance.
  const overlay = declared(ref?.overlay, OVERLAY_CLASSES)
  const validOverlay = single && !(operator === 'SINGLE-OP-ASSISTED' && overlay === 'CLASSIC') ? overlay : undefined

  return [
    ['CATEGORY-OPERATOR', operator === 'CHECKLOG' ? 'CHECKLOG' : single ? 'SINGLE-OP' : multi ? 'MULTI-OP' : undefined],
    // Each class answers this line itself; multi-operator entries may use
    // assistance.
    ['CATEGORY-ASSISTED', operator === 'SINGLE-OP' ? 'NON-ASSISTED' : operator === 'SINGLE-OP-ASSISTED' || multi ? 'ASSISTED' : undefined],
    ['CATEGORY-BAND', validBand],
    ['CATEGORY-POWER', declared(ref?.power, POWER_CLASSES)],
    ['CATEGORY-MODE', mode || undefined],
    ['CATEGORY-TRANSMITTER', operator ? TRANSMITTER_FOR[operator] : undefined],
    // Multi-Distributed is declared by this line with MULTI-OP (VI.C.4).
    ['CATEGORY-STATION', operator === 'MULTI-DISTRIBUTED' ? 'DISTRIBUTED' : undefined],
    ['CATEGORY-OVERLAY', validOverlay],
  ]
}

/// What the rules allow an entry declared as [operator]. QSO alerting
/// assistance is "permitted in all categories with the exception of the
/// Single Operator Classic Overlay" (VI) — but a plain Single Operator is the
/// entry the header files as NON-ASSISTED, and the only one Classic is open to,
/// so it is the one without. "Self-spotting or asking to be spotted is not
/// permitted" for anyone (X.D).
export function contestRules(operator: JSONValue | undefined): ContestRules {
  return { assistance: declared(operator, OPERATOR_CLASSES) !== 'SINGLE-OP', selfSpotting: false }
}

/// The classes whose QSO lines end in a transmitter ID: "For the MULTI-TWO
/// category, the last column in the log indicates which transmitter made the
/// QSO" (the sponsor's Cabrillo page). Cabrillo's "t is transmitter id ... It
/// is a single digit of 0 or 1."
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

/// The Canadian call areas, by the call-area prefix each is named for — a
/// VE station's LOCATION when it set none.
const PROVINCE_BY_PREFIX: Record<string, string> = {
  VE1: 'NS', VA1: 'NS', VE2: 'QC', VA2: 'QC', VE3: 'ON', VA3: 'ON',
  VE4: 'MB', VA4: 'MB', VE5: 'SK', VA5: 'SK', VE6: 'AB', VA6: 'AB',
  VE7: 'BC', VA7: 'BC', VE8: 'NT', VE9: 'NB', VO1: 'NL', VO2: 'NL',
  VY0: 'NU', VY1: 'YT', VY2: 'PE',
}

/// The entities whose stations give a state, province or ARRL section in the
/// LOCATION line — the US and Canada, Alaska, Hawaii, Puerto Rico and the
/// Virgin Islands included — where everyone else puts `DX`.
const HAS_A_SECTION = ['K', 'VE', 'KL', 'KH6', 'KP4', 'KP2']

/// The Cabrillo LOCATION for [call]: what was typed at setup, else a Canadian
/// call area, else `DX` for a station outside the US and Canada. Blank for a
/// US station that set none — the rules require one (XI.C), and claiming `DX`
/// for it would be wrong.
export function cabrilloLocation(call: string, typed: JSONValue | undefined): string {
  const own = (typeof typed === 'string' ? typed : '').toUpperCase().replace(/[^A-Z]/g, '')
  if (own) return own
  if (!call) return ''
  const entity = String(annotateCallAgainstCountryFile(call).entityPrefix ?? '')
  if (!HAS_A_SECTION.includes(entity)) return 'DX'
  return entity === 'VE' ? PROVINCE_BY_PREFIX[String(parseCallsign(call).prefix ?? '')] ?? '' : ''
}
