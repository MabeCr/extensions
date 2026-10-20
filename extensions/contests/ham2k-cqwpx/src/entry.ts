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

/// `OPERATORS`: the calls typed at setup, uppercased and space-separated as
/// the sponsor asks, with an `@station` kept as written. Empty when nothing
/// was typed, so the caller can fall back to the app's operator call.
export function declaredOperators(ref: Record<string, JSONValue> | undefined): string {
  const typed = typeof ref?.operators === 'string' ? ref.operators : ''
  return typed.toUpperCase().split(/[\s,;]+/).filter((call) => call).join(' ')
}

/// `CLUB`: the club name as typed — spelled out in full, which only the
/// operator can do — on one line.
export function declaredClub(ref: Record<string, JSONValue> | undefined): string {
  return typeof ref?.club === 'string' ? ref.club.replace(/\s+/g, ' ').trim() : ''
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
