// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The zone, and RTTY's QTH, to offer while logging and to stamp at save.
//
// Separate from index.ts so it can be unit-tested: index.ts calls
// `defineExtension` at import time.

import type { HookContext, JSONValue } from "@ham2k/extension-sdk"
import { priorSent } from "@ham2k/lib-contest-exchange"

import { guessedQth, normalizeQth, sendsQth } from "./qth.ts"
import { cqwwCallInfo, normalizeZone } from "./scorer.ts"

/// The ref type an operation stores. It is data in the operator's log, so it
/// stays what the app's own built-in wrote there whatever this package is
/// called: the manifest key names the package, `TYPE` names the activation.
export const TYPE = 'cqww'

/// The zone and QTH to offer [qso]'s station in [operation]: what it sent
/// earlier in THIS operation, on another band; else the lookup's and the
/// country file's; else what it sent in an earlier CQWW. Both say where the
/// station is, which can change, and the lookup is the fresher word on it —
/// so an earlier running only answers where the lookup has nothing.
///
/// [rtty] says whether a QTH is asked for at all.
export async function suggestedExchange(
  ctx: HookContext,
  operation: Record<string, JSONValue>,
  qso: Record<string, JSONValue> | undefined,
  rtty: boolean,
): Promise<{ zone: string; qth: string }> {
  const their = (qso?.their as Record<string, JSONValue>) ?? {}
  const guess = (their.guess as Record<string, JSONValue>) ?? {}
  const call = typeof their.call === 'string' ? their.call : ''
  const { here, before } = await priorSent(ctx, {
    call,
    operation,
    qso,
    refTypes: [TYPE],
    read: { zone: (ref) => normalizeZone(ref.theirZone), qth: (ref) => normalizeQth(ref.theirQth) },
  })
  const zone = here.zone || normalizeZone(guess.cqZone) || (call ? normalizeZone(cqwwCallInfo(call).cqZone) : '') || before.zone
  // A station that sends no QTH has none to offer, whatever an old contact holds.
  const sendsAQth = rtty && call !== '' && sendsQth(call)
  return { zone, qth: sendsAQth ? here.qth || guessedQth(their) || before.qth : '' }
}
