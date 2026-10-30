// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The entry we declare — operator class and power — and the Cabrillo
// `CATEGORY-` lines it becomes, in the shape of the NCJ's own NAQP Cabrillo
// template (ncjweb.com/NAQP_Cabrillo_Template.txt). None of it changes the
// score.
//
// NOTHING is defaulted, as in `cqww`: each answer is a claim about how we
// operated, so an unanswered question writes no line rather than a guessed
// one. What the rules make follow from an answer — Single Operator is
// unassisted, Multioperator is two transmitters and may use assistance — is
// written for it.
//
// Not asked: a band, since every entry is all-band (rules 5, 8); a team,
// since teams are registered ahead of time and "inclusion of team information
// in submitted Cabrillo logs is not required" (14); and a youth overlay, which
// the NCJ's upload page asks for itself, as an age.

import type { JSONValue } from "@ham2k/extension-sdk"

/// The rules' entry classifications (5.A–C), and a check log — what the NCJ's
/// upload page and Web-to-Cabrillo forms offer besides them.
export const OPERATOR_CLASSES = ['SINGLE-OP', 'SINGLE-OP-ASSISTED', 'MULTI-TWO', 'CHECKLOG'] as const
export type OperatorClass = typeof OPERATOR_CLASSES[number]

/// The power categories (6): 100 W at most, with QRP recognized in the
/// results. Anything more is a check log, not a power.
export const POWER_CLASSES = ['LOW', 'QRP'] as const

function declared<T extends string>(value: JSONValue | undefined, allowed: readonly T[]): T | undefined {
  const upper = typeof value === 'string' ? value.toUpperCase() : ''
  return allowed.find((option) => option === upper)
}

/// The `CATEGORY-` lines for the entry declared on [ref], in the order the
/// sponsor's template gives them. A line with no value is dropped by the
/// Cabrillo writer.
export function cabrilloCategories(ref: Record<string, JSONValue> | undefined): [string, string | undefined][] {
  const mode = typeof ref?.mode === 'string' ? ref.mode : ''
  const operator = declared(ref?.operator, OPERATOR_CLASSES)
  const single = operator === 'SINGLE-OP' || operator === 'SINGLE-OP-ASSISTED'
  const multi = operator === 'MULTI-TWO'

  return [
    ['CATEGORY-OPERATOR', operator === 'CHECKLOG' ? 'CHECKLOG' : single ? 'SINGLE-OP' : multi ? 'MULTI-OP' : undefined],
    // "Only one transmitted signal allowed at a time" for both single
    // operators; "a maximum of two" for Multioperator Two-Transmitter.
    ['CATEGORY-TRANSMITTER', single ? 'ONE' : multi ? 'TWO' : undefined],
    ['CATEGORY-ASSISTED', operator === 'SINGLE-OP' ? 'NON-ASSISTED' : operator === 'SINGLE-OP-ASSISTED' || multi ? 'ASSISTED' : undefined],
    // The only band category there is, so not a claim.
    ['CATEGORY-BAND', 'ALL'],
    ['CATEGORY-POWER', declared(ref?.power, POWER_CLASSES)],
    ['CATEGORY-MODE', mode || undefined],
  ]
}

/// `OPERATORS`: the calls typed at setup, uppercased and space-separated, with
/// an `@station` kept as written. Empty when nothing was typed, so the caller
/// can fall back to the app's operator call.
export function declaredOperators(ref: Record<string, JSONValue> | undefined): string {
  const typed = typeof ref?.operators === 'string' ? ref.operators : ''
  return typed.toUpperCase().split(/[\s,;]+/).filter((call) => call).join(' ')
}
