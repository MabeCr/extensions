// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The name and location to offer while logging, and to stamp at save.
//
// Separate from index.ts so it can be unit-tested: index.ts calls
// `defineExtension` at import time.

import type { HookContext, JSONValue } from "@ham2k/extension-sdk"
import { priorSent } from "@ham2k/lib-contest-exchange"
import { VALID_LOCATIONS, firstName, guessedLocation, guessedName, normalizeLocation } from "@ham2k/lib-naqp-exchange"

/// The ref type an operation stores. It is data in the operator's log, so it
/// stays what the app's own built-in wrote there whatever this package is
/// called: the manifest key names the package, `TYPE` names the activation.
export const TYPE = 'naqp'

/// The ref types whose contacts carry the same name and location exchange,
/// NAQP's first: the Phone Weekly Test and the SSB Sprint are sent by the
/// same people, the same way.
const SAME_EXCHANGE_TYPES = [TYPE, 'pwt', 'ssb-sprint']

export interface Exchange {
  name: string
  location: string
}

/// The name and location to offer [qso]'s station in [operation], from the
/// first source that has one:
///
///   * what it sent earlier in THIS operation — copied minutes ago;
///   * for the name, what it sent in an earlier NAQP, PWT or Sprint, then the
///     lookup's; for the location, the lookup's and the country file's, then
///     the one it sent before. A name doesn't move, but a station can, and
///     the lookup is the fresher word on where it is.
///
/// A host that cannot answer costs the log's history, never the lookup's guess.
export async function suggestedExchange(
  ctx: HookContext,
  operation: Record<string, JSONValue>,
  qso: Record<string, JSONValue> | undefined,
): Promise<Exchange> {
  const their = (qso?.their as Record<string, JSONValue>) ?? {}
  const { here, before } = await priorSent(ctx, {
    call: typeof their.call === 'string' ? their.call : '',
    operation,
    qso,
    refTypes: SAME_EXCHANGE_TYPES,
    read: {
      name: (ref) => firstName(ref.name),
      location: (ref) => {
        const location = normalizeLocation(ref.location)
        return VALID_LOCATIONS.has(location) ? location : ''
      },
    },
  })
  return {
    name: here.name || before.name || guessedName(their),
    location: here.location || guessedLocation(their) || before.location,
  }
}
