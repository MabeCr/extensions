// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Guessing the exchange: "Operator name and station location (S/P/C) for NA
// stations. Operator name only for non-NA stations (log those as DX)." —
// NAQP's, so the readers and the lookup's guesses are
// `@ham2k/lib-naqp-exchange`'s.
//
// What a weekly contest adds is history: most of each week's stations were
// worked last week, and what they SENT then — a nickname, not the lookup's
// "Hiram Percy Maxim" — is the better guess. NAQP SSB contacts count too: the
// same exchange, sent by the same people.
//
// Separate from index.ts so these can be unit-tested: index.ts calls
// `defineExtension` at import time, so nothing in it is reachable from
// `node --test`.

import type { HookContext, JSONValue } from "@ham2k/extension-sdk"
import { VALID_LOCATIONS, firstName, guessedLocation, guessedName, normalizeLocation } from "@ham2k/lib-naqp-exchange"
import { isAround } from "@ham2k/lib-weekly-contest"

import { sessionFor } from "./schedule.ts"

export const TYPE = 'pwt'

/// The ref types whose contacts carry the same name and location exchange,
/// this contest's first.
const SAME_EXCHANGE_TYPES = [TYPE, 'naqp']

export function str(value: JSONValue | undefined): string {
  return typeof value === 'string' ? value : ''
}

export function refOfType(container: Record<string, JSONValue> | undefined, type: string): Record<string, JSONValue> | undefined {
  return (((container?.refs as Record<string, JSONValue>[] | undefined) ?? [])).find((r) => r?.type === type)
}

export interface Exchange {
  name: string
  location: string
}

/// The newest name and the newest valid location among [qsos], each read from
/// a ref with the same exchange — a host older than the `refType` filter
/// answers unfiltered, so each contact is checked here.
function sentIn(qsos: Record<string, JSONValue>[]): Exchange {
  const sent: Exchange = { name: '', location: '' }
  for (const qso of qsos) {
    for (const type of SAME_EXCHANGE_TYPES) {
      const ref = refOfType(qso, type)
      if (!ref) continue
      sent.name ||= firstName(ref.name)
      const location = normalizeLocation(ref.location)
      if (!sent.location && VALID_LOCATIONS.has(location)) sent.location = location
    }
    if (sent.name && sent.location) break
  }
  return sent
}

async function history(ctx: HookContext, call: string, options: Record<string, JSONValue>): Promise<Record<string, JSONValue>[]> {
  try {
    return (await ctx.getHistoryForCall!(call, { limit: 10, ...options })) ?? []
  } catch (e) {
    console.warn(`[${TYPE}] call history unavailable, no earlier exchange offered:`, e)
    return []
  }
}

/// The exchange to offer [their] station in [operation].
///
///   * What they sent earlier in THIS session, on another band, stands as it
///     is: the operator copied it minutes ago.
///   * Otherwise the name they sent in an earlier week or an NAQP, else the
///     lookup's; and the location the lookup and country file give, else the
///     one they sent before. A station's name doesn't move, but the station
///     can, and the lookup is the fresher word on where it is.
///
/// "This session" is told by each contact's TIME, not by the host's
/// `operation` filter: a host older than that filter answers unfiltered, and
/// last month's exchange would pass for one copied minutes ago.
///
/// A host that cannot answer costs the history, never the lookup's guess.
export async function suggestedExchange(
  ctx: HookContext,
  operation: Record<string, JSONValue>,
  their: Record<string, JSONValue>,
): Promise<Exchange> {
  const call = str(their.call).trim().toUpperCase()
  const looked = { name: guessedName(their), location: guessedLocation(their) }
  if (!call || !ctx.getHistoryForCall) return looked

  const session = sessionFor(str(refOfType(operation, TYPE)?.ref))
  const thisSession = (qso: Record<string, JSONValue>) =>
    session !== undefined && refOfType(qso, TYPE) !== undefined && typeof qso.startAtMillis === 'number' && isAround(session, qso.startAtMillis)
  const qsos = await history(ctx, call, { refType: SAME_EXCHANGE_TYPES })
  const here = sentIn(qsos.filter(thisSession))
  const before = sentIn(qsos.filter((qso) => !thisSession(qso)))
  return {
    name: here.name || before.name || looked.name,
    location: here.location || looked.location || before.location,
  }
}

/// An exchange as it is sent and logged: "SEB NY", "HANS DX", or a DX
/// station's own name alone.
export function exchangeText({ name, location }: Exchange): string {
  return [name, location].filter((part) => part).join(' ')
}
