// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// A received grid, projected into the contact's own `their.grid`.
//
// A contest keeps the grid it was sent on its own ref, which is all its
// scorer and its own exports (REG1TEST's WWL column) read. Everything else in
// the app reads `their.grid`, else the lookup's guess: the full ADIF export's
// GRIDSQUARE, SOTA's file, the map, the distance. A grid left only on the ref
// is invisible to all of them, which then show the lookup's square (the
// station's home, not where it is operating from) or nothing at all.
// app-polo's grid field wrote `their.grid` directly.

import type { JSONValue } from "@ham2k/extension-sdk"

const LOCATOR = /^[A-R]{2}[0-9]{2}([A-X]{2})?$/

/// The `their` fields that state [grid] as the other station's locator, or
/// `{}` when there is nothing to write: [grid] is not a 4- or 6-character
/// locator, or what the contact already says — `their.grid`, else the
/// lookup's — is that square or a finer one inside it.
///
/// The square's center goes beside it as `lat`/`lon`, as the app stores beside
/// every locator an operator states (HaLo's docs/design/locations.md): a
/// coordinate outranks the grid wherever one is read, so one left behind
/// from an earlier grid would silently put the station back there.
export function theirGridFields(
  their: Record<string, JSONValue> | undefined,
  grid: string,
): Record<string, JSONValue> {
  const stated = grid.trim().toUpperCase()
  if (!LOCATOR.test(stated)) return {}

  const guess = (their?.guess as Record<string, JSONValue> | undefined) ?? {}
  const current = their?.grid ?? guess.grid
  if (typeof current === 'string' && current.trim().toUpperCase().startsWith(stated)) return {}

  const { lat, lon } = locatorCenter(stated)
  return { grid: stated, lat, lon }
}

/// The center of a 4- or 6-character locator already checked against `LOCATOR`.
function locatorCenter(grid: string): { lat: number; lon: number } {
  let lonSize = 2
  let latSize = 1
  let lon = (grid.charCodeAt(0) - 65) * 20 - 180 + (grid.charCodeAt(2) - 48) * lonSize
  let lat = (grid.charCodeAt(1) - 65) * 10 - 90 + (grid.charCodeAt(3) - 48) * latSize
  if (grid.length >= 6) {
    lonSize /= 24
    latSize /= 24
    lon += (grid.charCodeAt(4) - 65) * lonSize
    lat += (grid.charCodeAt(5) - 65) * latSize
  }
  return { lat: round(lat + latSize / 2), lon: round(lon + lonSize / 2) }
}

/// Six decimals (about 10 cm): enough for any square's center, and free of
/// the float noise the twenty-fourths leave behind.
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6
}
