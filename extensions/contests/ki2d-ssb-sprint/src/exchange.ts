// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Reading and guessing the Sprint's exchange: a serial, a name and a
// location, "122 BILL FL".
//
// Separate from index.ts so these can be unit-tested: index.ts calls
// `defineExtension` at import time, so nothing in it is reachable from
// `node --test`.

import type { HookContext, JSONValue } from "@ham2k/extension-sdk"
import { annotateCallAgainstCountryFile } from "@ham2k/extension-sdk"
import { priorSent } from "@ham2k/lib-contest-exchange"

import { firstName, historyFor } from "./history.ts"
import { CANADIAN_PROVINCES, US_STATES, countryLocationFor, isValidLocation, normalizeLocation } from "./locations.ts"

export const TYPE = 'ssb-sprint'

/// The ref types whose contacts carry the same name and location exchange,
/// the Sprint's first: NAQP and the Phone Weekly Test are sent by the same
/// people, the same way.
const SAME_EXCHANGE_TYPES = [TYPE, 'naqp', 'pwt']

/// The entities whose stations send a STATE or PROVINCE rather than a
/// country, and the one they send where the entity alone settles it.
/// Country-file prefixes: Alaska is `KL`, Hawaii `KH6`.
const SENDS_A_STATE: Record<string, string> = { K: '', VE: '', KL: 'AK', KH6: 'HI' }

export function str(value: JSONValue | undefined): string {
  return typeof value === 'string' ? value : ''
}

export function refOfType(container: Record<string, JSONValue> | undefined, type: string): Record<string, JSONValue> | undefined {
  return (((container?.refs as Record<string, JSONValue>[] | undefined) ?? [])).find((r) => r?.type === type)
}

/// A serial as it should appear in an export: whatever is on the ref, as digits.
export function serial(ref: Record<string, JSONValue> | undefined, field: string): string {
  return serialOf(ref?.[field])
}

export function serialOf(value: JSONValue | undefined): string {
  if (typeof value === 'number') return String(value)
  const digits = str(value).trim()
  return /^\d+$/.test(digits) ? String(parseInt(digits, 10)) : ''
}

export interface Exchange {
  name: string
  location: string
}

/// The name and location to offer [qso]'s station in [operation], from the
/// first source that has one:
///
///   * what it sent earlier in THIS operation — copied minutes ago;
///   * N1MM's Sprint call history;
///   * for the name, what it sent in an earlier Sprint, NAQP or PWT, then the
///     lookup's; for the location, the lookup's and the country file's, then
///     the one it sent before. A name doesn't move, but a station can, and
///     the lookup is the fresher word on where it is.
///
/// A host that cannot answer costs the log's history, never the file's or the
/// lookup's guess.
export async function suggestedExchange(
  ctx: HookContext,
  operation: Record<string, JSONValue>,
  qso: Record<string, JSONValue> | undefined,
): Promise<Exchange> {
  const their = (qso?.their as Record<string, JSONValue>) ?? {}
  const call = str(their.call)
  const { here, before } = await priorSent(ctx, {
    call,
    operation,
    qso,
    refTypes: SAME_EXCHANGE_TYPES,
    read: {
      name: (ref) => firstName(ref.name),
      location: (ref) => {
        const location = normalizeLocation(ref.location)
        return isValidLocation(location) ? location : ''
      },
    },
  })
  const file = historyFor(call)
  return {
    name: here.name || file?.name || before.name || guessedName(their),
    location: here.location || file?.location || guessedLocation(their) || before.location,
  }
}

/// The name the callsign lookup resolved for this station.
export function guessedName(their: Record<string, JSONValue>): string {
  const guess = (their.guess as Record<string, JSONValue>) ?? {}
  return firstName(their.name) || firstName(guess.name)
}

/// The location the lookup and the country file give for this station: a
/// state or province from the lookup, else its country if that is one the
/// Sprint lists, else `DX` for a station outside North America.
///
/// Anything not in the Sprint's set comes back EMPTY rather than as itself: a
/// guess is stamped onto the ref as data of record and exported as though the
/// station had sent it.
export function guessedLocation(their: Record<string, JSONValue>): string {
  const call = str(their.call)
  const guess = (their.guess as Record<string, JSONValue>) ?? {}
  const info = (call ? annotateCallAgainstCountryFile(call) : {}) as Record<string, JSONValue>
  const entity = str(their.entityPrefix) || str(guess.entityPrefix) || str(info.entityPrefix)
  const continent = str(their.continent) || str(guess.continent) || str(info.continent)

  if (entity in SENDS_A_STATE) {
    // Alaska and Hawaii are where they are, wherever the licensee's mail goes.
    if (SENDS_A_STATE[entity]) return SENDS_A_STATE[entity]
    // A state we don't know is better left blank than guessed wrong — every US
    // and Canadian station is a multiplier, so a wrong one is a wrong claim.
    // A portable call's lookup is the HOME call's address: K2LE/4 is not in
    // New York, and K2LE/VE3 is not in the US at all. Only a plain call's
    // state is trusted, and only one of its own country's.
    if (call.includes('/')) return ''
    const state = normalizeLocation(str(their.state) || str(guess.state))
    return (entity === 'K' ? US_STATES : CANADIAN_PROVINCES).includes(state) ? state : ''
  }
  if (!entity) return ''
  if (continent !== 'NA') return 'DX'
  return countryLocationFor(entity)
}

/// What WE send, from the setup.
///
/// Read from `ourName`/`ourLocation`, NOT `name`/`location`: `name` on a ref
/// is a CORE-OWNED decoration slot — `decorateRef` writes the activity row's
/// subtitle there, and the decorated ref is what gets persisted.
export function ourExchange(ref: Record<string, JSONValue> | undefined): { name: string; location: string } {
  return { name: firstName(ref?.ourName), location: normalizeLocation(ref?.ourLocation) }
}

/// Their exchange as received on a QSO's ref, "122 BILL FL".
export function theirExchange(qsoRef: Record<string, JSONValue> | undefined): string {
  return [serial(qsoRef, 'theirSerial'), firstName(qsoRef?.name), normalizeLocation(qsoRef?.location)].filter((part) => part).join(' ')
}
