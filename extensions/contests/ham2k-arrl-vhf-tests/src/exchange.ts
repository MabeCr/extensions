// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Reading and guessing the VHF-contest grid exchange.
//
// Separate from index.ts so these can be unit-tested: index.ts calls
// `defineExtension` at import time, so nothing in it is reachable from
// `node --test`.

import type { HookContext, JSONValue } from "@ham2k/extension-sdk"
import { priorSent } from "@ham2k/lib-contest-exchange"

import type { VhfEvent } from "./events.ts"

const GRID4_PATTERN = '^[A-R]{2}[0-9]{2}$'
const GRID6_PATTERN = '^[A-R]{2}[0-9]{2}[A-X]{2}$'

/// Trims a grid to the precision this event's exchange actually wants — a
/// station that types or is looked up with 6+ characters, in a 4-character
/// event, sends only the field/square the sponsor's exchange calls for.
export function trimmedGrid(grid: string | undefined | null, event: VhfEvent): string {
  return (grid ?? '').trim().toUpperCase().substring(0, event.gridChars)
}

/// The regex source this event's grid field validates against — anchored and
/// case-insensitive by the core's shared `pattern` compilation.
export function gridPatternFor(event: VhfEvent): string {
  return event.gridChars === 6 ? GRID6_PATTERN : GRID4_PATTERN
}

/// The grid to offer for the station being worked, from whatever the callsign
/// lookup or a prior QSO with this call resolved — mirrors polo's
/// `lookupCall`, which reads the last QSO's `their.grid` for the same call.
export function guessedGrid(their: Record<string, JSONValue> | undefined, event: VhfEvent): string {
  const guess = (their?.guess as Record<string, JSONValue>) ?? {}
  const raw = (their?.grid as string | undefined) ?? (guess.grid as string | undefined)
  return trimmedGrid(raw, event)
}

/// Whether [call] is a rover's (`/R`), whose grid changes as it goes — so an
/// earlier event's grid says nothing about where it is now. Its newest grid in
/// this operation is still the nearest word on it, and stands until corrected.
export function isRover(call: string): boolean {
  return /\/R$/i.test(call.trim())
}

/// The grid to offer [qso]'s station in [operation] of [refType]: the one it
/// sent earlier in THIS operation, on another band; else the lookup's; else
/// the one it sent in an earlier event. A grid says where the station is,
/// which can change, and the lookup is the fresher word on it. A rover
/// ([isRover]) is offered no earlier event's grid at all.
///
/// An earlier grid short of what [event] asks for (a 4-character one, in a
/// 6-character event) is passed over; a longer one is trimmed to it. A
/// lookup's grid that short outranks nothing, and is offered only for the
/// operator to complete.
export async function suggestedGrid(
  ctx: HookContext,
  operation: Record<string, JSONValue>,
  qso: Record<string, JSONValue> | undefined,
  refType: string,
  event: VhfEvent,
): Promise<string> {
  const their = (qso?.their as Record<string, JSONValue>) ?? {}
  const call = typeof their.call === 'string' ? their.call : ''
  const lookedUp = guessedGrid(their, event)
  const valid = new RegExp(gridPatternFor(event), 'i')
  const looked = valid.test(lookedUp) ? lookedUp : ''
  const { here, before } = await priorSent(ctx, {
    call,
    operation,
    qso,
    refTypes: [refType],
    read: {
      grid: (ref) => {
        const grid = trimmedGrid(typeof ref.grid === 'string' ? ref.grid : '', event)
        return valid.test(grid) ? grid : ''
      },
    },
  })
  return here.grid || looked || (isRover(call) ? '' : before.grid) || lookedUp
}
