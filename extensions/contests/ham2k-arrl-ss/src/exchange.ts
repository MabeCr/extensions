// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Who counts in Sweepstakes, and what section a station is likely in.
//
// Separate from index.ts so these can be unit-tested: index.ts calls
// `defineExtension` at import time, so nothing in it is reachable from
// `node --test`.

import type { JSONValue } from "@ham2k/extension-sdk"
import { annotateCallAgainstCountryFile } from "@ham2k/extension-sdk"

import { ALL_SECTIONS, CALL_AREA_FOR_SECTION, PREFIX_TO_LOCATION } from "./sections.ts"

function str(value: JSONValue | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

/// A section as received, if it is one of the 85; '' otherwise.
export function normalizeSection(value: JSONValue | undefined): string {
  const code = str(value).toUpperCase()
  return code in ALL_SECTIONS ? code : ''
}

/// Whether [call] is a W/VE station by Sweepstakes' reckoning: the US and
/// Canada "including territories and possessions" — Alaska, Hawaii, Puerto
/// Rico, the Virgin Islands and the Pacific possessions all have sections.
/// Sable and St. Paul Islands are DX (the rules' Definitions). A call the
/// country file cannot place gets the benefit of the doubt.
export function isWVE(call: string): boolean {
  const entity = String(annotateCallAgainstCountryFile(call).entityPrefix ?? '')
  return !entity || entity === 'K' || entity === 'VE' || /^K[HLP]/.test(entity)
}

/// A US state or Canadian province, as a lookup reports it, that IS a section
/// — most states are one section each; the rest (California, Florida, New
/// York, Texas…) are split, and give no answer.
const SECTION_FOR_STATE: Record<string, string> = {
  MD: 'MDC', DC: 'MDC', HI: 'PAC', YT: 'TER', NT: 'TER', NU: 'TER',
}

function sectionForState(state: string): string {
  const code = state.toUpperCase()
  return SECTION_FOR_STATE[code] ?? (code in ALL_SECTIONS ? code : '')
}

/// Precomputed: rebuilding these per keystroke costs allocations to answer a
/// question that only depends on one digit.
const PREFIX_ENTRIES = Object.entries(PREFIX_TO_LOCATION)

const SECTIONS_BY_CALL_AREA: Record<number, string[]> = (() => {
  const byArea: Record<number, string[]> = {}
  for (const [section, area] of Object.entries(CALL_AREA_FOR_SECTION)) {
    if (typeof area === 'number') (byArea[area] ??= []).push(section)
  }
  return byArea
})()

/// Sections worth floating to the top of the picker for this station.
///
/// The state a lookup found wins where it is a section on its own; then a
/// prefix that names its section outright (KL7 is Alaska and nothing else);
/// then the US call area, which narrows 85 down to a handful. This only RANKS,
/// as in `fd`: a guess is wrong often enough — a station moved, a club
/// operating away from home — that prefilling it would be worse.
export function preferredSections(their: Record<string, JSONValue>): string[] {
  const guess = (their.guess as Record<string, JSONValue>) ?? {}
  const call = str(their.call).toUpperCase()
  const fromState = sectionForState(str(their.state) || str(guess.state))
  if (fromState) return [fromState]
  if (!call) return []

  for (const [prefix, section] of PREFIX_ENTRIES) {
    if (call.startsWith(prefix)) return [section]
  }
  // A bare digit is a US call area only for a US call: VE3ABC and G3ABC both
  // contain a 3. Canada has no single answer — Ontario alone is four sections.
  const entity = str(their.entityPrefix) || str(guess.entityPrefix) || String(annotateCallAgainstCountryFile(call).entityPrefix ?? '')
  if (entity && entity !== 'K') return []
  const digit = /[0-9]/.exec(call)
  return digit ? SECTIONS_BY_CALL_AREA[Number(digit[0])] ?? [] : []
}
