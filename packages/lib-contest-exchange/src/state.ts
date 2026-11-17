// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// A received state or province, projected into the contact's own `their.state`.
//
// A contest keeps the location it was sent on its own ref. Everything else
// reads `their.state`, else the lookup's: ADIF's STATE, the SOTA and POTA
// files, Worked All States (which counts a lookup's state only as a guess).
// The station's own word on where it is outranks the address a lookup filed,
// and a portable station is not at that address.

import { annotateCallAgainstCountryFile } from "@ham2k/extension-sdk"
import type { JSONValue } from "@ham2k/extension-sdk"

/// The codes a contest location shares with ADIF's STATE: the fifty states and
/// DC, and Canada's provinces and territories.
const STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY',
  'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND',
  'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
  'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT',
])

/// The DXCC entities whose stations send a US state: the US itself, Alaska
/// and Hawaii. Canada's sends a province.
const US_DXCC = new Set([291, 6, 110])
const CANADA_DXCC = 1
const PROVINCES = new Set(['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'])

/// The `their` fields that state [location] as the other station's state or
/// province, or `{}` when there is nothing to write: [location] is not one
/// (a DX prefix, `DX`, a power level, a member number), the station is not in
/// the country it names, or `their.state` already says it.
///
/// The country check is what keeps a prefix from reading as a state: `OK`,
/// `OH`, `PA`, `CT`, `ON` and `HI` are entities as well (the Czech Republic,
/// Finland, the Netherlands, Portugal, Belgium, the Dominican Republic), and a
/// contest that takes a DX station's prefix as its location (CWT) or lists the
/// North American entities beside the states (NAQP) is sent them. Where the
/// contact holds no entity yet, the callsign's own, from the country file;
/// where even that says nothing, nothing is written.
export function theirStateFields(
  their: Record<string, JSONValue> | undefined,
  location: string,
): Record<string, JSONValue> {
  const state = location.trim().toUpperCase()
  if (!STATES.has(state)) return {}
  const dxcc = entityOf(their)
  if (PROVINCES.has(state) ? dxcc !== CANADA_DXCC : !US_DXCC.has(dxcc as number)) return {}
  if (their?.state === state) return {}
  return { state }
}

function entityOf(their: Record<string, JSONValue> | undefined): JSONValue | undefined {
  const guess = (their?.guess as Record<string, JSONValue> | undefined) ?? {}
  const known = their?.dxccCode ?? guess.dxccCode
  if (typeof known === 'number') return known
  const call = typeof their?.call === 'string' ? their.call : ''
  return call ? annotateCallAgainstCountryFile(call).dxccCode : undefined
}

/// [patch], a `processQsoBeforeSave` patch or null, with [fields] merged into
/// its `their`; null still when both are empty.
export function withTheirFields(
  patch: Record<string, JSONValue> | null,
  fields: Record<string, JSONValue>,
): Record<string, JSONValue> | null {
  if (Object.keys(fields).length === 0) return patch
  const their = (patch?.their as Record<string, JSONValue> | undefined) ?? {}
  return { ...(patch ?? {}), their: { ...their, ...fields } }
}
