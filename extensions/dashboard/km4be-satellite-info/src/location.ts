// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// Where the passes are worked out for. The device's own position is rounded to
// the center of its six-character grid square (a few kilometers), which is as
// exact as a pass prediction needs and no more precise than the operator would
// give on the air. A grid typed into the settings is used as it is.

import { host } from "@ham2k/extension-sdk"
import { gridToLocation, locationToGrid6 } from "@ham2k/lib-geo-tools"

import { onForget } from "./memory.ts"
import type { Observer } from "./orbit.ts"

export interface Place extends Observer {
  grid: string
  /// Where it came from, for the panel to say.
  source: "device" | "settings" | "operation"
}

/// The center of a Maidenhead square of 4, 6 or 8 characters, or null when it is not one.
export function observerFromGrid(grid: unknown): Observer | null {
  if (typeof grid !== "string" || !/^[A-Ra-r]{2}\d{2}([A-Xa-x]{2}(\d{2})?)?$/.test(grid.trim())) return null
  try {
    const [lat, lon] = gridToLocation(grid.trim())
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null
  } catch {
    return null
  }
}

/// A coordinate moved to the center of its six-character grid square.
export function roundedPlace(lat: number, lon: number): Place | null {
  const grid = locationToGrid6(lat, lon)
  const observer = grid && observerFromGrid(grid)
  return grid && observer ? { ...observer, grid, source: "device" } : null
}

/// How long a position is good for: a person on foot or in a car does not move far enough in a
/// minute to change a pass, and asking the host for the device's location is a round trip.
const PLACE_MAX_AGE_MS = 60_000

let placeMemo: { key: string; at: number; place: Place | null } | undefined
onForget(() => {
  placeMemo = undefined
})

/// The device's position if the host will say, then the grid typed in the panel's settings, then
/// the operation's own grid; asked again at most once a minute, or when the grids it falls back
/// on change.
export async function findPlace(
  config: Record<string, unknown> | undefined,
  operation: Record<string, unknown> | undefined,
  now: number = Date.now(),
): Promise<Place | null> {
  const key = `${String(config?.grid)}|${String(operation?.grid)}`
  if (placeMemo && placeMemo.key === key && now >= placeMemo.at && now - placeMemo.at < PLACE_MAX_AGE_MS) return placeMemo.place
  const place = await lookForPlace(config, operation)
  placeMemo = { key, at: now, place }
  return place
}

async function lookForPlace(config: Record<string, unknown> | undefined, operation: Record<string, unknown> | undefined): Promise<Place | null> {
  const device = await host.getLocation().catch(() => null)
  if (device && Number.isFinite(device.latitude) && Number.isFinite(device.longitude)) {
    const place = roundedPlace(device.latitude, device.longitude)
    if (place) return place
  }
  for (const [grid, source] of [[config?.grid, "settings"], [operation?.grid, "operation"]] as const) {
    const observer = observerFromGrid(grid)
    if (observer) return { ...observer, grid: String(grid).trim(), source }
  }
  return null
}
