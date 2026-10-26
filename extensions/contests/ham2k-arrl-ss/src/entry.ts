// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The entry we declare, and the two things it decides: the PRECEDENCE letter
// we send in every exchange, and the Cabrillo `CATEGORY-` lines the ARRL's log
// robot reads to place the entry. One answer for both, because in Sweepstakes
// they are the same fact — "A" IS Single Operator, Low Power.
//
// Per the rules' Entry Categories (v1.6) and the precedence list (4.2):
//   Q  Single Operator, QRP            A  Single Operator, Low Power
//   B  Single Operator, High Power     U  Single Operator Unlimited, any power
//   M  Multioperator, Single Transmitter, Low or High Power
//   S  School Club, no power sub-categories
//
// NOTHING is defaulted, as in `cqww`: the category is a claim about how we
// operated, so an unanswered one sends no precedence and writes no category
// lines rather than a guessed one.
//
// The Limited Antennas overlay is not asked: Cabrillo has no CATEGORY-OVERLAY
// value for it, and the ARRL's upload page asks for it itself.

import type { JSONValue } from "@ham2k/extension-sdk"
import type { ContestRules } from "@ham2k/lib-contest-rules"

/// The entry categories, as the setup form offers them: each a precedence and,
/// where it has one, a power sub-category.
export const ENTRY_CLASSES = [
  'SO-QRP', 'SO-LOW', 'SO-HIGH',
  'SOU-QRP', 'SOU-LOW', 'SOU-HIGH',
  'MULTI-LOW', 'MULTI-HIGH',
  'SCHOOL',
] as const
export type EntryClass = typeof ENTRY_CLASSES[number]

const PRECEDENCE_FOR: Record<EntryClass, string> = {
  'SO-QRP': 'Q', 'SO-LOW': 'A', 'SO-HIGH': 'B',
  'SOU-QRP': 'U', 'SOU-LOW': 'U', 'SOU-HIGH': 'U',
  'MULTI-LOW': 'M', 'MULTI-HIGH': 'M',
  SCHOOL: 'S',
}

/// A precedence as received: one of the six letters, or ''.
export const PRECEDENCE_PATTERN = '[QABUMS]'

export function normalizePrecedence(value: JSONValue | undefined): string {
  const letter = String(value ?? '').trim().toUpperCase()
  return /^[QABUMS]$/.test(letter) ? letter : ''
}

/// A check as received or set: the two digits of a year. "The last two digits
/// of the year the operator or the station was first licensed."
export const CHECK_PATTERN = '[0-9]{2}'

export function normalizeCheck(value: JSONValue | undefined): string {
  const digits = String(value ?? '').trim()
  return /^\d{2}$/.test(digits) ? digits : ''
}

export function declaredEntry(ref: Record<string, JSONValue> | undefined): EntryClass | undefined {
  const upper = typeof ref?.entry === 'string' ? ref.entry.toUpperCase() : ''
  return ENTRY_CLASSES.find((option) => option === upper)
}

/// What the rules allow an entry declared as [entry]. A Single Operator, at
/// any power, may not use spotting assistance (HCAT.1.1); Unlimited, Multi and
/// School may (HCAT.2.1, HCAT.3.1, HCAT.4.5). Self-spotting is not among the
/// prohibited conduct (PROH), so the rules leave it to the operator.
export function contestRules(entry: JSONValue | undefined): ContestRules {
  return { assistance: !declaredEntry({ entry: entry ?? '' })?.startsWith('SO-'), selfSpotting: true }
}

/// The precedence letter we send, from the entry declared on [ref].
export function ourPrecedence(ref: Record<string, JSONValue> | undefined): string {
  const entry = declaredEntry(ref)
  return entry ? PRECEDENCE_FOR[entry] : ''
}

/// The `CATEGORY-` lines for the entry declared on [ref], as the ARRL's own
/// Sweepstakes Cabrillo templates write them. A line with no value is dropped
/// by the Cabrillo writer.
export function cabrilloCategories(ref: Record<string, JSONValue> | undefined): [string, string | undefined][] {
  const mode = typeof ref?.mode === 'string' ? ref.mode : ''
  const entry = declaredEntry(ref)
  const single = entry?.startsWith('SO') ?? false
  // Single Operator alone may not use spotting assistance; Unlimited,
  // Multioperator and School Club all may.
  const assisted = entry === undefined ? undefined : entry.startsWith('SO-') ? 'NON-ASSISTED' : 'ASSISTED'
  // School Club has no power sub-categories. The ARRL's template still writes
  // a POWER line for it, as HIGH, and so does this.
  const power = entry === undefined ? undefined : entry === 'SCHOOL' ? 'HIGH' : entry.split('-')[1]

  return [
    ['CATEGORY-OPERATOR', entry === undefined ? undefined : single ? 'SINGLE-OP' : 'MULTI-OP'],
    ['CATEGORY-ASSISTED', assisted],
    // Every category is all-band and one transmitted signal at a time.
    ['CATEGORY-BAND', 'ALL'],
    ['CATEGORY-POWER', power],
    ['CATEGORY-MODE', mode || undefined],
    ['CATEGORY-TRANSMITTER', 'ONE'],
    ['CATEGORY-STATION', entry === 'SCHOOL' ? 'SCHOOL' : undefined],
  ]
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
