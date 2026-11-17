// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The exchange to offer while logging, and to stamp at save.
//
// Separate from index.ts so it can be unit-tested: index.ts calls
// `defineExtension` at import time.

import type { HookContext, JSONValue } from "@ham2k/extension-sdk"
import { annotateCallAgainstCountryFile } from "@ham2k/extension-sdk"
import { priorSent } from "@ham2k/lib-contest-exchange"

import { normalizeZone, parseExchange } from "./scorer.ts"

/// The ref type an operation stores. It is data in the operator's log, so it
/// stays what the app's own built-in wrote there whatever this package is
/// called: the manifest key names the package, `TYPE` names the activation.
export const TYPE = 'iaru-hf'

/// The ITU zone the lookup or the country file resolves for a callsign.
export function guessedZoneFor(their: Record<string, JSONValue>): string {
  const guess = (their.guess as Record<string, JSONValue>) ?? {}
  const call = typeof their.call === 'string' ? their.call : ''
  return (
    normalizeZone(their.ituZone) ||
    normalizeZone(guess.ituZone) ||
    (call ? normalizeZone(annotateCallAgainstCountryFile(call).ituZone) : '')
  )
}

/// The exchange to offer [qso]'s station in [operation]: what it sent earlier
/// in THIS operation, on another band or mode; else the newest society or
/// office it sent in any earlier IARU, even behind a zone sent since — who the
/// station is, which no lookup knows; else the lookup's zone; else the zone it
/// sent before. A zone
/// says where the station is, which can change, and the lookup is the fresher
/// word on it.
export async function suggestedExchange(
  ctx: HookContext,
  operation: Record<string, JSONValue>,
  qso: Record<string, JSONValue> | undefined,
): Promise<string> {
  const their = (qso?.their as Record<string, JSONValue>) ?? {}
  const { here, before } = await priorSent(ctx, {
    call: typeof their.call === 'string' ? their.call : '',
    operation,
    qso,
    refTypes: [TYPE],
    // A station is worked on up to six bands and two modes a running, so ten
    // contacts can all be last year's zones, hiding the society before them.
    limit: 50,
    read: {
      exchange: (ref) => {
        const parsed = parseExchange(ref.theirExchange)
        return parsed.kind === 'none' ? '' : parsed.value
      },
      identity: (ref) => {
        const parsed = parseExchange(ref.theirExchange)
        return parsed.kind === 'none' || parsed.kind === 'zone' ? '' : parsed.value
      },
      zone: (ref) => {
        const parsed = parseExchange(ref.theirExchange)
        return parsed.kind === 'zone' ? parsed.value : ''
      },
    },
  })
  return here.exchange || before.identity || guessedZoneFor(their) || before.zone
}
