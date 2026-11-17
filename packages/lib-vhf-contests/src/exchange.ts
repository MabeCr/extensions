// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Reading and guessing the grid half of the exchange, which every R1 and
// RSGB VHF+ event sends in the same shape.

import type { HookContext, JSONValue } from "@ham2k/extension-sdk"
import { priorSent } from "@ham2k/lib-contest-exchange"

/// Every R1 VHF+ event sends a 6-character grid — unlike arrl-vhf-tests,
/// there is no 4-character shape here, so no per-event `gridChars`.
export const GRID_PATTERN = '^[A-R]{2}[0-9]{2}[A-X]{2}$'

export function trimmedGrid(grid: string | undefined | null): string {
  return (grid ?? '').trim().toUpperCase().substring(0, 6)
}

/// The grid to offer for the station being worked, from whatever the callsign
/// lookup or a prior QSO with this call resolved.
export function guessedGrid(their: Record<string, JSONValue> | undefined): string {
  const guess = (their?.guess as Record<string, JSONValue>) ?? {}
  const raw = (their?.grid as string | undefined) ?? (guess.grid as string | undefined)
  return trimmedGrid(raw)
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
/// ([isRover]) is offered no earlier event's grid at all. A lookup's grid
/// short of a locator outranks nothing, and is offered only for the operator
/// to complete.
export async function suggestedGrid(
  ctx: HookContext,
  operation: Record<string, JSONValue>,
  qso: Record<string, JSONValue> | undefined,
  refType: string,
): Promise<string> {
  const their = (qso?.their as Record<string, JSONValue>) ?? {}
  const call = typeof their.call === 'string' ? their.call : ''
  const valid = new RegExp(GRID_PATTERN, 'i')
  const lookedUp = guessedGrid(their)
  const looked = valid.test(lookedUp) ? lookedUp : ''
  const { here, before } = await priorSent(ctx, {
    call,
    operation,
    qso,
    refTypes: [refType],
    read: {
      grid: (ref) => {
        const grid = trimmedGrid(typeof ref.grid === 'string' ? ref.grid : '')
        return valid.test(grid) ? grid : ''
      },
    },
  })
  return here.grid || looked || (isRover(call) ? '' : before.grid) || lookedUp
}
