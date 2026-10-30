// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The entry we declare and the Cabrillo `CATEGORY-` lines it becomes. The
// rules (5) have one entry, Single Operator, in three power levels, with
// three overlays — Youth, Youth YL and YL — that are simply the age group we
// send. None of it changes the score.
//
// The power is not defaulted, as in `naqp`: it is a claim about how we
// operated, so an unanswered question writes no line rather than a guessed
// one. What the rules fix for every entry — one operator, SSB, one signal at
// a time (2, 5, 7) — is written regardless. The sponsor publishes no
// Cabrillo template; these are the standard v3 names.

import type { JSONValue } from "@ham2k/extension-sdk"
import type { ContestRules } from "@ham2k/lib-contest-rules"

/// "High power", "Low power" and "QRP" (5).
export const POWER_CLASSES = ['HIGH', 'LOW', 'QRP'] as const

/// "Spotting assistance is allowed in all categories" (5), and "No self
/// spotting or asking to be spotted" (7) — the same whatever the entry.
export const CONTEST_RULES: ContestRules = { assistance: true, selfSpotting: false }

function declared<T extends string>(value: JSONValue | undefined, allowed: readonly T[]): T | undefined {
  const upper = typeof value === 'string' ? value.toUpperCase() : ''
  return allowed.find((option) => option === upper)
}

/// The `CATEGORY-` lines for the entry declared on [ref]. A line with no value
/// is dropped by the Cabrillo writer.
export function cabrilloCategories(ref: Record<string, JSONValue> | undefined): [string, string | undefined][] {
  return [
    ['CATEGORY-OPERATOR', 'SINGLE-OP'],
    ['CATEGORY-BAND', 'ALL'],
    ['CATEGORY-POWER', declared(ref?.power, POWER_CLASSES)],
    ['CATEGORY-MODE', 'SSB'],
    ['CATEGORY-TRANSMITTER', 'ONE'],
  ]
}
