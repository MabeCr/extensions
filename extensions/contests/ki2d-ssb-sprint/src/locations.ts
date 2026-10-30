// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The Sprint's location exchange, and who is a North American station.
//
// Per the rules (ssbsprint.com/rules, 7, 9, 10) and the sponsor's multiplier
// checklist: 51 US multipliers (the lower 48, DC, AK and HI), 13 Canadian
// ones, and a list of other North American countries, each counted once for
// the whole contest. Stations outside North America send `DX`, which is a
// valid exchange and never a multiplier.

import type { JSONValue } from "@ham2k/extension-sdk"
import { annotateCallAgainstCountryFile } from "@ham2k/extension-sdk"

/// The 50 states and DC — "DC is separate from MD", and "KH6 DOES count as a
/// state in this contest".
export const US_STATES = [
  'AK', 'AL', 'AR', 'AZ', 'CA', 'CO', 'CT', 'DC', 'DE', 'FL', 'GA', 'HI',
  'IA', 'ID', 'IL', 'IN', 'KS', 'KY', 'LA', 'MA', 'MD', 'ME', 'MI', 'MN',
  'MO', 'MS', 'MT', 'NC', 'ND', 'NE', 'NH', 'NJ', 'NM', 'NV', 'NY', 'OH',
  'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VA', 'VT', 'WA',
  'WI', 'WV', 'WY',
]

export const CANADIAN_PROVINCES = [
  'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK',
  'YT',
]

/// The rules' "North American countries", as the sponsor spells them. Not the
/// country file's: the Dominican Republic is `HI3` here (Hawaii has `HI`), and
/// Clipperton is `FO/C`.
export const NA_COUNTRIES = [
  '6Y', '8P', 'C6', 'CM', 'FG', 'FJ', 'FM', 'FO/C', 'FS', 'HH', 'HI3', 'HK0',
  'HP', 'HR', 'J3', 'J6', 'J7', 'J8', 'KG4', 'KP1', 'KP2', 'KP4', 'KP5', 'OX',
  'PJ5', 'PJ7', 'TG', 'TI', 'TI9', 'V2', 'V3', 'V4', 'VP2E', 'VP2M', 'VP2V',
  'VP5', 'XE', 'XF4', 'YN', 'YS', 'YV0', 'ZF',
]

/// North American by CQ WW's reckoning (rule 9) but missing from the rules'
/// country list: a contact, never a multiplier. They are accepted as sent so
/// an operator who copies one isn't told the exchange is wrong.
const NA_NOT_COUNTED = ['4U1U', 'CY0', 'CY9', 'FP', 'VP9']

const MULTIPLIERS = new Set<string>([...US_STATES, ...CANADIAN_PROVINCES, ...NA_COUNTRIES])

/// Everything the location field accepts.
export const VALID_LOCATIONS = new Set<string>([...MULTIPLIERS, ...NA_NOT_COUNTED, 'DX'])

/// What else an operator may send or type for a location: the rules write
/// "AK/KL7 and HI/KH6", and PQ and NF are still heard for Quebec and
/// Newfoundland.
const ALIASES: Record<string, string> = { KL7: 'AK', KH6: 'HI', PQ: 'QC', NF: 'NL' }

/// The country file's entity prefixes that the sponsor writes differently.
/// (Clipperton is the country file's `FO/c`, which upper-cases to the
/// sponsor's spelling by itself.)
const SPONSOR_SPELLING: Record<string, string> = { HI: 'HI3' }

/// A location as typed or received, in the sponsor's spelling. Whatever it is,
/// valid or not — validity is [isValidLocation]'s question.
export function normalizeLocation(value: JSONValue | undefined): string {
  const code = String(value ?? '').replace(/\s+/g, '').toUpperCase()
  return ALIASES[code] ?? code
}

export function isValidLocation(location: string): boolean {
  return VALID_LOCATIONS.has(location)
}

export function isMultiplier(location: string): boolean {
  return MULTIPLIERS.has(location)
}

/// Which list a multiplier is on — the summary counts the three apart.
export function locationKind(location: string): 'state' | 'province' | 'country' {
  if (US_STATES.includes(location)) return 'state'
  if (CANADIAN_PROVINCES.includes(location)) return 'province'
  return 'country'
}

/// Letters, digits and a slash, for `FO/C`; up to four, as in `VP2E`.
export const LOCATION_PATTERN = '[A-Za-z0-9/]{1,4}'

/// Whether [call] is a North American station: CQ WW's North America, "plus
/// KH6". A call the country file cannot place gets the benefit of the doubt.
export function isNorthAmerican(call: string): boolean {
  if (!call) return true
  const info = annotateCallAgainstCountryFile(call) as Record<string, JSONValue>
  const entity = typeof info.entityPrefix === 'string' ? info.entityPrefix : ''
  if (!entity) return true
  return entity === 'KH6' || info.continent === 'NA'
}

/// The location a North American entity sends as a country, in the sponsor's
/// spelling, or '' when it sends a state or province (or isn't North
/// American at all).
///
/// The country file splits some entities finer than the sponsor does: San
/// Andres is `HK0/a`, which the Sprint lists as plain `HK0`. A sub-entity the
/// list doesn't name reduces to its parent before giving up, or a real
/// multiplier goes unsuggested. Clipperton's `FO/c` IS listed, as itself.
export function countryLocationFor(entityPrefix: string): string {
  const country = (code: string) => {
    const spelled = SPONSOR_SPELLING[code] ?? code
    return VALID_LOCATIONS.has(spelled) && !US_STATES.includes(spelled) && !CANADIAN_PROVINCES.includes(spelled) ? spelled : ''
  }
  const prefix = entityPrefix.toUpperCase()
  return country(prefix) || country(prefix.split('/')[0])
}
