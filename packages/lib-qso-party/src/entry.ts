// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// What the operator declares once per operation — read off the party's ref, in
// one place, so the setup form, the scorer, the ADIF and the Cabrillo cannot
// disagree about what was claimed.
//
// The ref is the segment-effective one wherever a segment may have restated it:
// `location` and `mobile` are what a rover changes when they drive into the
// next county, so the scorer reads them per QSO rather than once per log.

import type { ContestRules } from "@ham2k/lib-contest-rules"

import type { ModeClass, OperatorClass, OverlayClass, PowerClass, StationClass } from "./params.ts"
import type { Party } from "./party.ts"

/// The shared class vocabularies, in the order every party's setup form reads
/// them down: a sponsor names the classes it publishes, and the ORDER is this
/// engine's so that two parties never present the same axis differently.
export const OPERATOR_CLASSES: OperatorClass[] =
  ['SINGLE-OP', 'SINGLE-OP-ASSISTED', 'MULTI-ONE', 'MULTI-TWO', 'MULTI-UNLIMITED']
export const POWER_CLASSES: PowerClass[] = ['QRP', 'LOW', 'HIGH']
export const STATION_CLASSES: StationClass[] =
  ['FIXED', 'MOBILE', 'PORTABLE', 'ROVER', 'EXPEDITION', 'COUNTY-LINE', 'SCHOOL', 'CLUB', 'EOC']
export const MODE_CLASSES: ModeClass[] = ['CW', 'PHONE', 'DIGITAL', 'MIXED']
export const OVERLAY_CLASSES: OverlayClass[] =
  ['ROOKIE', 'YOUTH', 'YL', 'NOVICE-TECH', 'NEW-CONTESTER', 'TB-WIRES', 'POTA']

/// The station classes that are ON THE MOVE — what a party means by "mobile or
/// rover" where it pays a bonus for the counties an entrant activates, and what
/// the old `mobile` flag on a ref stood for.
export const ROVING_STATION_CLASSES: StationClass[] = ['MOBILE', 'ROVER']

export function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/// A serial off a QSO ref, as text. The host allocates `ourSerial` as a
/// NUMBER while `theirSerial` is typed text, so [str] alone reads every sent
/// serial as blank.
export function serial(value: unknown): string {
  return typeof value === 'number' ? String(value) : str(value).trim()
}

/// A ref of exactly [type] on an operation (or on a QSO), if it has one.
export function refOfType(
  record: Record<string, unknown> | undefined,
  type: string,
): Record<string, unknown> | undefined {
  const refs = (record?.refs as Record<string, unknown>[] | undefined) ?? []
  return refs.find((ref) => ref?.type === type)
}

/// The ref on an operation (or on a QSO) that THIS PARTY answers for — its own
/// type, or a legacy pair it reaches back for.
///
/// A per-event party publishes `ny-qso-party`, and the operations logged when
/// fifty parties were one extension carry `{type: 'qp', ref: 'NY'}`. Those are
/// not migrated: the operation stays as the operator logged it, so every read
/// here has to find either shape and every write lands back on the one it
/// found. A log that edits itself years later because an extension arrived is
/// the outcome this whole arrangement exists to avoid.
///
/// The party's own type wins where both are present. An operation carrying
/// both is one the operator has since set up under the current name, and that
/// is the reference their entry class and exchange belong to.
///
/// The legacy code is matched as a PREFIX and case-folded, the same rule the
/// app's manifest claims use (`ref:qp/ny`) — one rule, so what the app offers
/// and what the extension then answers for cannot disagree.
export function partyRefIn(
  party: Party,
  record: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const own = refOfType(record, party.refType)
  if (own) return own
  const refs = refsOf(record)
  for (const claim of party.legacyRefs ?? []) {
    const found = refs.find((ref) => ref?.type === claim.type && codeClaimedBy(ref, claim))
    if (found) return found
  }
  return undefined
}

function refsOf(record: Record<string, unknown> | undefined): Record<string, unknown>[] {
  return (record?.refs as Record<string, unknown>[] | undefined) ?? []
}

function codeClaimedBy(ref: Record<string, unknown>, claim: { prefix: string }): boolean {
  return str(ref?.ref).toLowerCase().startsWith(claim.prefix)
}

/// The ref type this party reads and writes a contact's exchange under on
/// [operation]: a legacy type the operation carries a claim of, else the
/// party's own.
///
/// On an operation logged under a legacy claim the exchange controls publish
/// that legacy type, so the contacts logged from here on land on the same
/// shape as the ones before them and continue their serials — and the core,
/// which admits an exchange field only for a type the operation carries,
/// shows the fields at all. The legacy type wins even beside the party's own
/// ref: an operator who added the party again by its current name has not
/// started a new log.
export function exchangeRefType(party: Party, operation: Record<string, unknown> | undefined): string {
  const refs = refsOf(operation)
  for (const claim of party.legacyRefs ?? []) {
    if (refs.some((ref) => ref?.type === claim.type && codeClaimedBy(ref, claim))) return claim.type
  }
  return party.refType
}

/// The ref on a CONTACT that this party answers for, on [operation] — the
/// contact's own operation, segment-effective where the caller has one.
///
/// A contact's legacy ref carries no code: the built-in the parties were once
/// part of and app-polo both write `{type: 'qp', location: 'NHA'}` on the
/// contact and keep the party's code on the operation alone. Read by code, as
/// [partyRefIn] reads, such a contact matches nothing, and scores and files as
/// if no exchange had been copied. So a bare ref of a claimed legacy type is
/// this party's wherever the operation carries that claim — looked for in its
/// own right, not through [partyRefIn]: an operation the operator has since
/// added the party to under its current name carries both refs, and the
/// contacts logged before that are still the bare ones.
///
/// A contact ref that does name a code is read by it, so another party's
/// contact is never this one's, whatever operation it sits under.
export function partyContactRefIn(
  party: Party,
  qso: Record<string, unknown> | undefined,
  operation: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const own = refOfType(qso, party.refType)
  if (own) return own
  const refs = refsOf(qso)
  const operationRefs = refsOf(operation)
  for (const claim of party.legacyRefs ?? []) {
    const claimed = operationRefs.some((ref) => ref?.type === claim.type && codeClaimedBy(ref, claim))
    const found = refs.find((ref) => ref?.type === claim.type && (str(ref?.ref) ? codeClaimedBy(ref, claim) : claimed))
    if (found) return found
  }
  return undefined
}

/// The serial we sent, off a contact's party ref. app-polo files it as
/// `ourNumber`, so read under this engine's name alone, every serial of a log
/// kept there is blank — in the file, and in the exchange a save re-projects.
export function ourSerialOf(ref: Record<string, unknown> | undefined): string {
  return serial(ref?.ourSerial) || serial(ref?.ourNumber)
}

/// The serial they sent, off a contact's party ref — app-polo's `theirNumber`
/// as [ourSerialOf] reads its `ourNumber`.
export function theirSerialOf(ref: Record<string, unknown> | undefined): string {
  return serial(ref?.theirSerial) || serial(ref?.theirNumber)
}

/// Where we are operating from, as typed — one county, or a county line's two
/// separated by a slash. Not resolved here: `location.ts` owns what the text
/// means, and this is only where it lives.
export function ourLocationText(
  party: Party,
  operation: Record<string, unknown> | undefined,
  ref?: Record<string, unknown>,
): string {
  return str((ref ?? partyRefIn(party, operation))?.location).trim()
}

/// One declared class, or undefined for a question the operator has not
/// answered — and `undefined` is the answer that means "no claim", not a missing
/// value to be defaulted. A value the party does not publish is refused, so a
/// class left on a ref by an earlier setup cannot be submitted under this one.
function declared<T extends string>(
  ref: Record<string, unknown> | undefined,
  field: string,
  known: readonly T[],
  offered: readonly T[],
): T | undefined {
  const value = str(ref?.[field]).toUpperCase()
  const code = known.find((candidate) => candidate === value)
  return code && offered.includes(code) ? code : undefined
}

/// The entry class we are competing in, for each axis the party publishes.
export function ourOperatorClass(
  party: Party,
  operation: Record<string, unknown> | undefined,
  ref?: Record<string, unknown>,
): OperatorClass | undefined {
  return declared(ref ?? partyRefIn(party, operation), 'operator', OPERATOR_CLASSES, party.entryClasses.operator)
}

/// What the party's rules allow an entry declared as [operator]. Where a party
/// publishes an assisted single-operator class, plain Single Operator is the
/// unassisted one; elsewhere its classes say nothing of spotting assistance.
/// Self-spotting is the party's own rule, the same for every entry.
export function partyRules(party: Party, operator: unknown): ContestRules {
  const unassisted = party.entryClasses.operator.includes('SINGLE-OP-ASSISTED')
    && ourOperatorClass(party, undefined, { operator }) === 'SINGLE-OP'
  return { assistance: !unassisted, selfSpotting: party.selfSpotting !== false }
}

export function ourStationClass(
  party: Party,
  operation: Record<string, unknown> | undefined,
  ref?: Record<string, unknown>,
): StationClass | undefined {
  return declared(ref ?? partyRefIn(party, operation), 'station', STATION_CLASSES, party.entryClasses.station)
}

export function ourModeClass(
  party: Party,
  operation: Record<string, unknown> | undefined,
  ref?: Record<string, unknown>,
): ModeClass | undefined {
  return declared(ref ?? partyRefIn(party, operation), 'mode', MODE_CLASSES, party.entryClasses.mode)
}

export function ourOverlayClass(
  party: Party,
  operation: Record<string, unknown> | undefined,
  ref?: Record<string, unknown>,
): OverlayClass | undefined {
  return declared(ref ?? partyRefIn(party, operation), 'overlay', OVERLAY_CLASSES, party.entryClasses.overlay)
}

export function ourPowerClass(
  party: Party,
  operation: Record<string, unknown> | undefined,
  ref?: Record<string, unknown>,
): PowerClass | undefined {
  return declared(ref ?? partyRefIn(party, operation), 'power', POWER_CLASSES, party.entryClasses.power)
}

/// What the declared power class multiplies the score by, or 1 — for the six
/// parties that publish a table, and for the entrant who declared a class.
export function powerMultiplier(
  party: Party,
  operation: Record<string, unknown> | undefined,
  ref?: Record<string, unknown>,
): number {
  const power = ourPowerClass(party, operation, ref)
  if (!power) return 1
  return party.powerMultipliers[power] ?? 1
}

/// Whether we are entering as a mobile or rover station. Several parties pay
/// the per-county bonus to rovers only, and one lets a rover count its own
/// county as a multiplier.
///
/// A reading of the STATION class, which is the same question asked properly.
/// The old `mobile` boolean is still honoured — it is on every operation logged
/// before the classes existed, and on anything synced from app-polo.
export function isMobile(
  party: Party,
  operation: Record<string, unknown> | undefined,
  ref?: Record<string, unknown>,
): boolean {
  const own = ref ?? partyRefIn(party, operation)
  if (own?.mobile === true) return true
  const station = str(own?.station).toUpperCase() as StationClass
  return ROVING_STATION_CLASSES.includes(station) && party.entryClasses.station.includes(station)
}

/// The address a Cabrillo's `EMAIL:` line carries, for the sponsors that ask
/// for one.
export function ourEmail(
  party: Party,
  operation: Record<string, unknown> | undefined,
  ref?: Record<string, unknown>,
): string {
  return str((ref ?? partyRefIn(party, operation))?.email).trim()
}

/// The name we send, for the parties whose exchange includes one.
export function ourName(
  party: Party,
  operation: Record<string, unknown> | undefined,
  ref?: Record<string, unknown>,
): string {
  return str((ref ?? partyRefIn(party, operation))?.ourName).trim().toUpperCase()
}
