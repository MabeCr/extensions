// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Whose reference this is, and which park each side of a QSO is in, resolved
// ONCE for everyone who asks.
//
// The scorer, the ADIF fields, the Cabrillo writer and the operation title all
// need the same two answers, and they must agree: a QSO scored as one park and
// submitted as another shows a multiplier the log does not support.
//
// Everything here is in the sponsor's three-letter identifiers, because that is
// what stations exchange. The TYPED value wins: what the operator keyed is what
// was sent on the air, so it is the data of record. A POTA reference is the
// fallback — it is where an identifier comes from when nothing was keyed.

import type { JSONValue } from "@ham2k/extension-sdk"

import { LEGACY_KEY, LEGACY_TYPE, PARK_BY_ABBREVIATION, PARK_BY_REF, TYPE } from "./event.ts"

export const POTA_HUNTING = 'pota'
export const POTA_ACTIVATION = 'potaActivation'

/// Anything carrying `refs` — an operation or a QSO.
type Container = Record<string, JSONValue> | undefined

function str(value: JSONValue | undefined): string {
  return typeof value === 'string' ? value : ''
}

export function refsOfType(container: Container, type: string): Record<string, JSONValue>[] {
  return (((container?.refs as Record<string, JSONValue>[] | undefined) ?? [])).filter((r) => r?.type === type)
}

/// Whether [ref] is this event's — its own type, or the combined extension's
/// ref naming this event.
///
/// The second half is what every hook has to ask before answering: the scoring
/// scope names `stateparks` so that legacy operations reach this scorer at all,
/// which means the OTHER state-park events' legacy operations reach it too.
export function isOurRef(ref: Record<string, JSONValue> | undefined): boolean {
  if (ref?.type === TYPE) return true
  return ref?.type === LEGACY_TYPE && str(ref.ref).toUpperCase() === LEGACY_KEY
}

/// The event's ref on [operation], in either shape. Its own type wins where
/// both are present: that is the one the operator has set up since.
export function eventRefIn(operation: Container): Record<string, JSONValue> | undefined {
  const refs = (operation?.refs as Record<string, JSONValue>[] | undefined) ?? []
  return refs.find((r) => r?.type === TYPE) ?? refs.find(isOurRef)
}

/// The ref carrying the exchange on a QSO: ours, else the combined extension's.
///
/// The legacy one has no event key to check — it is `{type: 'stateparks', park}`
/// and nothing more — and needs none: the hooks that read it have already
/// established that the OPERATION is this event's, and Ohio was the only
/// state-park event with an exchange to store.
export function exchangeRefIn(qso: Container): Record<string, JSONValue> | undefined {
  return refsOfType(qso, TYPE)[0] ?? refsOfType(qso, LEGACY_TYPE)[0]
}

/// The identifier set up for this operation, if it is one of the sponsor's.
///
/// [ownRef] wins when given: a scorer is handed the ref that SELECTED it, which
/// on a segmented log is the segment's own, and `decorateRef` is handed a ref
/// with no operation around it at all.
export function configuredOurPark(operation: Container, ownRef?: Record<string, JSONValue>): string {
  const configured = str((ownRef ?? eventRefIn(operation))?.ourPark).toUpperCase()
  return PARK_BY_ABBREVIATION[configured] ? configured : ''
}

/// The park we are operating from, as its identifier, or `''`.
///
/// What was set up wins; the POTA activation is where it comes from otherwise.
/// ONE park, never two: "No station may claim simultaneous operation of the same
/// call sign in more than one Ohio State Park", and even on South Bass Island,
/// where two parks share the ground, an entrant "can claim to be in either one
/// (only one)".
export function ourPark(operation: Container, ownRef?: Record<string, JSONValue>): string {
  const configured = configuredOurPark(operation, ownRef)
  if (configured) return configured
  for (const activation of refsOfType(operation, POTA_ACTIVATION)) {
    const park = PARK_BY_REF[str(activation.ref).toUpperCase()]
    if (park) return park.abbreviation
  }
  return ''
}

/// What the station we worked sent, as typed if anything was typed — a blank
/// included, since the core writes `park: ''` only when the operator empties
/// the field on purpose — else the identifier of a park they are logged as
/// being in. NOT validated: this is what the exchange column shows, typo and
/// all.
export function theirExchange(qso: Container): string {
  const ref = exchangeRefIn(qso)
  if (ref !== undefined && 'park' in ref) return str(ref.park).toUpperCase()
  return guessedPark(qso)
}

/// The identifier of a park the station we worked is logged as being in, by
/// the POTA reference hunted on the contact, or `''`.
export function guessedPark(qso: Container): string {
  for (const hunted of refsOfType(qso, POTA_HUNTING)) {
    const park = PARK_BY_REF[str(hunted.ref).toUpperCase()]
    if (park) return park.abbreviation
  }
  return ''
}

/// The park the station we worked is in, as one of the sponsor's identifiers,
/// or `''` — a typed value that is not one claims nothing, rather than falling
/// through to a POTA reference for a park they just told us they were not in.
export function theirPark(qso: Container): string {
  const exchange = theirExchange(qso)
  return PARK_BY_ABBREVIATION[exchange] ? exchange : ''
}
