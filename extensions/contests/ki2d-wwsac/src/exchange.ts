// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Reading and guessing the WWSAC exchange: a signal report and an age group
// (rules 3) — "Log 'Y' for Youth, and 'YYL' for Youth YL". The report is the
// core's own RST field; the age group is ours.
//
// Separate from index.ts so these can be unit-tested: index.ts calls
// `defineExtension` at import time, so nothing in it is reachable from
// `node --test`.

import type { HookContext, JSONValue } from "@ham2k/extension-sdk"

export const TYPE = 'wwsac'

/// The four age groups, as logged, and what a contact with each is worth
/// (rules 4): "A contact with an OM is worth 1 point", a YL 5, a Youth 10 and
/// a Youth YL 15.
export const AGE_GROUPS = ['OM', 'YL', 'Y', 'YYL'] as const
export type AgeGroup = typeof AGE_GROUPS[number]

export const POINTS: Record<AgeGroup, number> = { OM: 1, YL: 5, Y: 10, YYL: 15 }

/// An age group as typed. Anchored and matched case-insensitively by the core.
export const AGE_GROUP_PATTERN = '(OM|YL|Y|YYL)'

/// The spellings an operator, or another logger's file, may use for the two
/// the rules abbreviate.
const SPELLED_OUT: Record<string, AgeGroup> = { YOUTH: 'Y', 'YOUTH YL': 'YYL', YOUTHYL: 'YYL', 'Y YL': 'YYL' }

export function str(value: JSONValue | undefined): string {
  return typeof value === 'string' ? value : ''
}

export function refOfType(container: Record<string, JSONValue> | undefined, type: string): Record<string, JSONValue> | undefined {
  return (((container?.refs as Record<string, JSONValue>[] | undefined) ?? [])).find((r) => r?.type === type)
}

/// [value] as one of the four age groups, or '' when it is none of them.
export function ageGroupOf(value: JSONValue | undefined): AgeGroup | '' {
  const upper = str(value).trim().toUpperCase().replace(/\s+/g, ' ')
  const group = SPELLED_OUT[upper] ?? upper
  return (AGE_GROUPS as readonly string[]).includes(group) ? group as AgeGroup : ''
}

/// Their age group as it goes into an export: one of the four, else what the
/// operator typed. A mistyped one is still their copy, and the log checker,
/// not the export, is the one to judge it.
export function theirAgeGroup(value: JSONValue | undefined): string {
  return ageGroupOf(value) || str(value).trim().toUpperCase()
}

/// What WE send, from the setup. Read from `ourAgeGroup`, not a bare key the
/// core might decorate.
export function ourAgeGroup(ref: Record<string, JSONValue> | undefined): AgeGroup | '' {
  return ageGroupOf(ref?.ourAgeGroup)
}

/// The age group [call] sent in the newest WWSAC contact that recorded one —
/// this session's or any earlier week's. An age group belongs to the
/// operator, not the station's location, so an earlier week still holds, and
/// it is a SUGGESTION the operator confirms by ear.
///
/// A host that cannot answer costs the suggestion, never the contact.
export async function priorAgeGroup(ctx: HookContext, call: string): Promise<AgeGroup | ''> {
  if (!call || !ctx.getHistoryForCall) return ''
  try {
    const history = await ctx.getHistoryForCall(call, { refType: TYPE, limit: 10 })
    for (const qso of history ?? []) {
      const group = ageGroupOf(refOfType(qso, TYPE)?.ageGroup)
      if (group) return group
    }
  } catch (e) {
    console.warn(`[${TYPE}] call history unavailable, no earlier age group offered:`, e)
  }
  return ''
}
