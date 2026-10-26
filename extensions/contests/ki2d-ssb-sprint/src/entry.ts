// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The entry we declare — single operator or check log, and power — and the
// Cabrillo `CATEGORY-` lines it becomes, as the sponsor's Cabrillo page
// (ssbsprint.com/submit-log-cabrillo) gives them. None of it changes the score.
//
// NOTHING is defaulted, as in `naqp`: each answer is a claim about how we
// operated, so an unanswered question writes no line rather than a guessed
// one. What the rules fix for every entry — all bands, SSB, one transmitter
// (rules 5, 6, 12) — is written regardless.
//
// Not asked: a team, which is registered on the sponsor's site before the
// contest and has no Cabrillo line; and assistance, which the rules forbid
// (3) — a log that used it is a check log, per the Cabrillo page.

import type { JSONValue } from "@ham2k/extension-sdk"
import type { ContestRules } from "@ham2k/lib-contest-rules"

/// "Single-Operator only" (3), and a check log for a score not to be listed.
export const OPERATOR_CLASSES = ['SINGLE-OP', 'CHECKLOG'] as const

/// The three power levels (3a–c).
export const POWER_CLASSES = ['HIGH', 'LOW', 'QRP'] as const

function declared<T extends string>(value: JSONValue | undefined, allowed: readonly T[]): T | undefined {
  const upper = typeof value === 'string' ? value.toUpperCase() : ''
  return allowed.find((option) => option === upper)
}

/// The `CATEGORY-` lines for the entry declared on [ref], in the order of the
/// sponsor's example. A line with no value is dropped by the Cabrillo writer.
export function cabrilloCategories(ref: Record<string, JSONValue> | undefined): [string, string | undefined][] {
  const operator = declared(ref?.operator, OPERATOR_CLASSES)
  return [
    ['CATEGORY-OPERATOR', operator],
    ['CATEGORY-ASSISTED', operator === 'SINGLE-OP' ? 'NON-ASSISTED' : undefined],
    ['CATEGORY-BAND', 'ALL'],
    ['CATEGORY-POWER', declared(ref?.power, POWER_CLASSES)],
    ['CATEGORY-MODE', 'SSB'],
    ['CATEGORY-TRANSMITTER', 'ONE'],
  ]
}

/// What the rules allow an entry declared as [operator]. Spotting information
/// from anyone but the operator is prohibited (3), and the sponsor's Cabrillo
/// page files a log that used it as a check log — so only a check log may.
/// Self-spotting is not among what the rules forbid, so it is the operator's
/// call.
export function contestRules(operator: JSONValue | undefined): ContestRules {
  return { assistance: declared(operator ?? '', OPERATOR_CLASSES) === 'CHECKLOG', selfSpotting: true }
}
