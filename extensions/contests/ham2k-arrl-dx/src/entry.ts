// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The entry we declare — operator class, band and power — and the Cabrillo
// `CATEGORY-` lines it becomes. The ARRL's log robot reads these to place the
// entry; none of it changes the score.
//
// Per the rules (v2.0), Special Rules 3 and the Categories section (HCAT):
//   Single Operator (SO), Single Operator Unlimited (SOU)
//       All Band or Single Band; QRP, Low or High Power
//   Multioperator, Single Transmitter (MS)    Low or High Power
//   Multioperator, Two Transmitter (M2)       High Power only
//   Multioperator, Multitransmitter (MM)      High Power only
//   Checklog
// W/VE and DX stations enter the same categories.
//
// NOTHING is defaulted, as in `cqww`: each answer is a claim about how we
// operated, so an unanswered question writes no line rather than a guessed
// one. What the rules make follow from an answer — a multioperator entry is
// all-band and assisted, and M2 and MM are high power — is written for it.
//
// The Limited Antennas overlay is not asked: Cabrillo has no CATEGORY-OVERLAY
// value for it, as in `arrl-ss`.

import type { JSONValue } from "@ham2k/extension-sdk"
import type { ContestRules } from "@ham2k/lib-contest-rules"

/// The rules' entry categories. Operator and transmitter are one axis here,
/// as the rules list them, and split into the two Cabrillo lines on the way
/// out.
export const OPERATOR_CLASSES = [
  'SINGLE-OP', 'SINGLE-OP-UNLIMITED', 'MULTI-ONE', 'MULTI-TWO', 'MULTI-MULTI', 'CHECKLOG',
] as const
export type OperatorClass = typeof OPERATOR_CLASSES[number]

/// `ALL` or one band — "All Band or Single Band" for the single operators.
export const BAND_CLASSES = ['ALL', '160M', '80M', '40M', '20M', '15M', '10M'] as const

export const POWER_CLASSES = ['HIGH', 'LOW', 'QRP'] as const
export type PowerClass = typeof POWER_CLASSES[number]

function declared<T extends string>(value: JSONValue | undefined, allowed: readonly T[]): T | undefined {
  const upper = typeof value === 'string' ? value.toUpperCase() : ''
  return allowed.find((option) => option === upper)
}

const TRANSMITTER_FOR: Partial<Record<OperatorClass, string>> = {
  'MULTI-ONE': 'ONE',
  'MULTI-TWO': 'TWO',
  'MULTI-MULTI': 'UNLIMITED',
}

/// The power sub-categories each multioperator class has (HCAT.4, and the
/// rules' category summary). The single operators have all three.
const POWERS_FOR: Partial<Record<OperatorClass, readonly PowerClass[]>> = {
  'MULTI-ONE': ['HIGH', 'LOW'],
  'MULTI-TWO': ['HIGH'],
  'MULTI-MULTI': ['HIGH'],
}

/// The `CATEGORY-` lines for the entry declared on [ref], in the order the
/// ARRL's own Cabrillo templates give them — it publishes them for
/// Sweepstakes, none for DX. A line with no value is dropped by the Cabrillo
/// writer.
export function cabrilloCategories(ref: Record<string, JSONValue> | undefined): [string, string | undefined][] {
  const mode = typeof ref?.mode === 'string' ? ref.mode : ''
  const operator = declared(ref?.operator, OPERATOR_CLASSES)
  const single = operator === 'SINGLE-OP' || operator === 'SINGLE-OP-UNLIMITED'
  const multi = operator?.startsWith('MULTI-') ?? false

  // "Multioperator stations may only enter as All Band", so their band is not
  // a question.
  const band = multi ? 'ALL' : declared(ref?.band, BAND_CLASSES)
  // A class with one power sub-category answers it. Multi-Single has no QRP,
  // and a QRP station is within its Low Power.
  const powers = operator ? POWERS_FOR[operator] : undefined
  const declaredPower = declared(ref?.power, POWER_CLASSES)
  const power = powers?.length === 1 ? powers[0]
    : operator === 'MULTI-ONE' && declaredPower === 'QRP' ? 'LOW'
    : declaredPower

  return [
    ['CATEGORY-OPERATOR', operator === 'CHECKLOG' ? 'CHECKLOG' : single ? 'SINGLE-OP' : multi ? 'MULTI-OP' : undefined],
    // Single Operator may not use spotting assistance; Unlimited and every
    // multioperator class may.
    ['CATEGORY-ASSISTED', operator === 'SINGLE-OP' ? 'NON-ASSISTED' : operator === 'SINGLE-OP-UNLIMITED' || multi ? 'ASSISTED' : undefined],
    ['CATEGORY-BAND', band],
    ['CATEGORY-POWER', power],
    // The Phone weekend is Cabrillo's SSB.
    ['CATEGORY-MODE', mode === 'Phone' ? 'SSB' : mode || undefined],
    ['CATEGORY-TRANSMITTER', operator ? TRANSMITTER_FOR[operator] : undefined],
  ]
}

/// What the rules allow an entry declared as [operator]. A Single Operator
/// may not use spotting assistance (HCAT.1.1, and HCAT.3.2.1 single-band);
/// every other class may. Self-spotting is not among the prohibited conduct
/// (PROH), so the rules leave it to the operator.
export function contestRules(operator: JSONValue | undefined): ContestRules {
  return { assistance: declared(operator, OPERATOR_CLASSES) !== 'SINGLE-OP', selfSpotting: true }
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
