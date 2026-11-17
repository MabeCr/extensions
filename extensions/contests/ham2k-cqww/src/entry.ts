// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The entry we declare — operator class, band, power and overlay — and the
// Cabrillo `CATEGORY-` lines it becomes. The log robot reads these to place
// the entry, and "failure to fill out the header correctly may result in the
// entry being placed in the wrong category or reclassified as a Checklog"
// (rules X.3). None of it changes the score.
//
// NOTHING is defaulted, as in the QSO parties: each answer is a claim about
// how we operated, so an unanswered question writes no line rather than a
// guessed one. What the rules make follow from an answer — a multi-operator
// entry is all-band and may use assistance — is written for it.

import type { JSONValue } from "@ham2k/extension-sdk"
import type { ContestRules } from "@ham2k/lib-contest-rules"

/// The rules' entry categories (V.A, V.C, V.D). Operator and transmitter are
/// one axis here, as the rules list them, and split into the two Cabrillo
/// lines on the way out.
export const OPERATOR_CLASSES = [
  'SINGLE-OP', 'SINGLE-OP-ASSISTED', 'MULTI-ONE', 'MULTI-TWO', 'MULTI-MULTI', 'MULTI-DISTRIBUTED', 'CHECKLOG',
] as const
export type OperatorClass = typeof OPERATOR_CLASSES[number]

/// `ALL` or one band — "All Band or Single Band" for the single operators.
/// RTTY has no 160m.
export const BAND_CLASSES = ['ALL', '160M', '80M', '40M', '20M', '15M', '10M'] as const

export const POWER_CLASSES = ['HIGH', 'LOW', 'QRP'] as const

/// The single-operator overlays (V.B), entered alongside the main category.
export const OVERLAY_CLASSES = ['CLASSIC', 'ROOKIE', 'YOUTH'] as const

function declared<T extends string>(value: JSONValue | undefined, allowed: readonly T[]): T | undefined {
  const upper = typeof value === 'string' ? value.toUpperCase() : ''
  return allowed.find((option) => option === upper)
}

const TRANSMITTER_FOR: Partial<Record<OperatorClass, string>> = {
  'MULTI-ONE': 'ONE',
  'MULTI-TWO': 'TWO',
  'MULTI-MULTI': 'UNLIMITED',
}

/// The `CATEGORY-` lines for the entry declared on [ref], in the order the
/// sponsor's example header gives them. A line with no value is dropped by
/// the Cabrillo writer.
export function cabrilloCategories(ref: Record<string, JSONValue> | undefined): [string, string | undefined][] {
  const mode = typeof ref?.mode === 'string' ? ref.mode : ''
  const operator = declared(ref?.operator, OPERATOR_CLASSES)
  const single = operator === 'SINGLE-OP' || operator === 'SINGLE-OP-ASSISTED'
  const multi = operator?.startsWith('MULTI-') ?? false

  // Multi-operator categories are "all-band operation only" (V.C), so their
  // band is not a question. RTTY runs no 160m, so that answer is no entry.
  const band = multi ? 'ALL' : declared(ref?.band, BAND_CLASSES)
  const validBand = mode === 'RTTY' && band === '160M' ? undefined : band
  // Overlays are for single operators only, and Classic not for an assisted
  // one; anything else would be a claim the robot rejects.
  const overlay = declared(ref?.overlay, OVERLAY_CLASSES)
  const validOverlay = single && !(operator === 'SINGLE-OP-ASSISTED' && overlay === 'CLASSIC') ? overlay : undefined

  return [
    ['CATEGORY-OPERATOR', operator === 'CHECKLOG' ? 'CHECKLOG' : single ? 'SINGLE-OP' : multi ? 'MULTI-OP' : undefined],
    // Single Operator is defined as unassisted, and multi-operator entries
    // may use assistance, so each class answers this line itself.
    ['CATEGORY-ASSISTED', operator === 'SINGLE-OP' ? 'NON-ASSISTED' : operator === 'SINGLE-OP-ASSISTED' || multi ? 'ASSISTED' : undefined],
    ['CATEGORY-BAND', validBand],
    ['CATEGORY-POWER', declared(ref?.power, POWER_CLASSES)],
    ['CATEGORY-MODE', mode || undefined],
    ['CATEGORY-TRANSMITTER', operator ? TRANSMITTER_FOR[operator] : undefined],
    // Multi-Distributed is declared by this line with MULTI-OP (V.C.4).
    ['CATEGORY-STATION', operator === 'MULTI-DISTRIBUTED' ? 'DISTRIBUTED' : undefined],
    ['CATEGORY-OVERLAY', validOverlay],
  ]
}

/// What the rules allow an entry declared as [operator]. A Single Operator
/// uses no "QSO finding assistance of any kind" (V.A.1) — nor does the Classic
/// overlay (V.B.1), which only a Single Operator can claim — and "self-spotting
/// or asking to be spotted is not permitted" for anyone (IX.4).
export function contestRules(operator: JSONValue | undefined): ContestRules {
  return { assistance: declared(operator, OPERATOR_CLASSES) !== 'SINGLE-OP', selfSpotting: false }
}

/// The classes whose QSO lines end in a transmitter ID: "For the MULTI-ONE
/// and MULTI-TWO categories, the last column in the log indicates which
/// transmitter made the QSO" (the sponsor's Cabrillo page) — the run and
/// multiplier stations of a Multi-Single. Cabrillo's "t is transmitter id ...
/// It is a single digit of 0 or 1."
const LOGS_TRANSMITTER: readonly OperatorClass[] = ['MULTI-ONE', 'MULTI-TWO']

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
