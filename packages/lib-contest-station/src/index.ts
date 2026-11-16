// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Who a contest entry names, the same in every contest.
//
//   * The OPERATORS are whoever the log says logged — each contact carries its
//     operator's call, or none when the station's own holder made it — and
//     whoever the operation names as its operator. So they are found, never
//     typed: a typed list goes stale the moment someone else sits down.
//   * The STATION OWNER is the operation's `ownerCall` (extension API 21),
//     set in the app's Operation Details: whose station this is when it
//     belongs to none of the operators. Cabrillo names it as `@CALL` at the
//     end of OPERATORS; the app's own ADIF export writes OWNER_CALLSIGN.
//   * The CLUB is seeded from the operator's profile, so the field shows what
//     will be sent rather than a placeholder promising it.

import { host } from "@ham2k/extension-sdk"
import type { FormField, HookContext, JSONValue } from "@ham2k/extension-sdk"

import { tFor } from "./i18n.ts"

function str(value: JSONValue | undefined): string {
  return typeof value === 'string' ? value : ''
}

function callOf(value: JSONValue | undefined): string {
  return str(value).trim().toUpperCase()
}

/// The operation's station owner, as one bare call (no `@`), or ''.
export function ownerCall(operation: Record<string, JSONValue>): string {
  return callOf(operation.ownerCall).replace(/^@/, '').split(/[\s,;]+/)[0] ?? ''
}

/// The calls that logged [qsos], in the order each first appears — a
/// contact's own operator call, else the call it was logged under — then the
/// operation's operator, when the contacts do not already name them. With
/// nobody at all, the station call.
///
/// Deleted contacts and band-`event` markers name nobody.
export function logOperators(operation: Record<string, JSONValue>, qsos: Record<string, JSONValue>[]): string[] {
  const calls: string[] = []
  const add = (call: string) => {
    if (call && !calls.includes(call)) calls.push(call)
  }
  for (const qso of qsos) {
    if (qso.deleted === true || qso.band === 'event') continue
    const our = (qso.our as Record<string, JSONValue> | undefined) ?? {}
    add(callOf(our.operatorCall) || callOf(our.call) || callOf(operation.stationCall))
  }
  add(callOf(operation.operatorCall) || callOf((operation.local as Record<string, JSONValue> | undefined)?.operatorCall))
  if (calls.length === 0) add(callOf(operation.stationCall))
  return calls
}

/// Cabrillo's `OPERATORS`: [logOperators], then `@OWNER` when the operation
/// names a station owner who is not already one of them — Cabrillo's mark for
/// the host station.
export function cabrilloOperators(operation: Record<string, JSONValue>, qsos: Record<string, JSONValue>[]): string {
  const calls = logOperators(operation, qsos)
  const owner = ownerCall(operation)
  return [...calls, ...(owner && !calls.includes(owner) ? [`@${owner}`] : [])].join(' ')
}

/// `CLUB`: the club on [ref] as typed, on one line. A setup that holds no
/// `club` at all — one never opened since the field was seeded — sends the
/// profile's; one holding `''` was cleared on purpose and sends none.
export async function cabrilloClub(ref: Record<string, JSONValue> | undefined, tag: string): Promise<string> {
  if (typeof ref?.club !== 'string') return profileClub(tag)
  return ref.club.replace(/\s+/g, ' ').trim()
}

/// The profile's club, kept from the last read that worked.
///
/// STICKY ON FAILURE, because it seeds the setup form's `value`, and
/// FormRenderer re-applies a `value` that changes between two fetches of the
/// definition onto a field the operator has not edited. A host call that fails
/// once, between two reads that work, would otherwise blank the field in front
/// of them mid-setup.
let lastKnownClub = ''

async function profileClub(tag: string): Promise<string> {
  try {
    const settings = (await host.getSettings()) as Record<string, JSONValue> | undefined
    lastKnownClub = str(settings?.operatorClub).replace(/\s+/g, ' ').trim()
  } catch (e) {
    // A local recovery with its own fallback (docs/design/error-reporting.md).
    // Throwing would cost the contest its whole setup control: the hook
    // fan-out drops a throwing hook silently.
    console.warn(`[${tag}] profile settings unavailable, keeping the last club read:`, e)
  }
  return lastKnownClub
}

/// The setup form's Club field, seeded with the profile's club. The seed only
/// fills a setup that has no `club` yet; one already saved keeps its own.
///
/// [words] replaces the label and placeholder for a contest that asks for
/// something wider than a club — Field Day's "Club or group".
export async function clubField(
  ctx: Pick<HookContext, 'locale'>,
  tag: string,
  words?: { label: string; placeholder?: string },
): Promise<FormField> {
  const t = tFor(ctx)
  return {
    type: 'field',
    fieldType: 'text',
    key: 'club',
    label: words?.label ?? t('clubLabel'),
    placeholder: words ? words.placeholder : t('clubPlaceholder'),
    value: await profileClub(tag),
  }
}
