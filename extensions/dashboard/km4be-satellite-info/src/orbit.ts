// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// Where a satellite is, as seen from the operator, and when it is above the
// horizon. SGP4 is satellite.js (MIT); everything here is the geometry on top
// of it: look angles, range rate, pass finding and Doppler.
//
// Elements are CelesTrak's OMM JSON, which `json2satrec` reads as it is.

import { degreesToRadians, ecfToLookAngles, eciToEcf, gstime, json2satrec, propagate, radiansToDegrees } from "./vendor/satellite.js/index.js"
import type { OMMJsonObject, SatRec } from "./vendor/satellite.js/index.js"

export type Omm = OMMJsonObject

/// Where the operator is. Degrees north and east, kilometers above sea level.
export interface Observer {
  lat: number
  lon: number
  altKm?: number
}

export interface LookAngle {
  /// Degrees clockwise from north, 0 to 360.
  azimuth: number
  /// Degrees above the horizon; negative is below it.
  elevation: number
  rangeKm: number
}

export interface Pass {
  aos: number
  los: number
  maxElevation: number
  maxElevationAt: number
  aosAzimuth: number
  maxAzimuth: number
  losAzimuth: number
  /// True when the satellite was already up at the start of the search, so `aos` is that start and not a rise.
  inProgress: boolean
}

const SPEED_OF_LIGHT_KM_S = 299_792.458

export const satrecFromOmm = (omm: Omm): SatRec => json2satrec(omm)

/// Look angle from `observer` to the satellite at `at` (epoch milliseconds), or
/// null when SGP4 cannot place it (a decayed or stale element set).
export function lookAt(satrec: SatRec, observer: Observer, at: number): LookAngle | null {
  const date = new Date(at)
  const state = propagate(satrec, date)
  if (!state || !state.position) return null
  const ecf = eciToEcf(state.position, gstime(date))
  const look = ecfToLookAngles(
    { latitude: degreesToRadians(observer.lat), longitude: degreesToRadians(observer.lon), height: observer.altKm ?? 0 },
    ecf,
  )
  return {
    azimuth: (radiansToDegrees(look.azimuth) + 360) % 360,
    elevation: radiansToDegrees(look.elevation),
    rangeKm: look.rangeSat,
  }
}

/// How fast the distance to the satellite is changing, km/s: negative while it
/// approaches, positive as it recedes. A central difference over one second.
export function rangeRate(satrec: SatRec, observer: Observer, at: number): number | null {
  const before = lookAt(satrec, observer, at - 500)
  const after = lookAt(satrec, observer, at + 500)
  return before && after ? after.rangeKm - before.rangeKm : null
}

/// What a receiver hears when the satellite transmits `freqMHz`.
export const downlinkDoppler = (freqMHz: number, rangeRateKmS: number): number => freqMHz * (1 - rangeRateKmS / SPEED_OF_LIGHT_KM_S)

/// What to transmit so the satellite receives `freqMHz`.
export const uplinkDoppler = (freqMHz: number, rangeRateKmS: number): number => freqMHz * (1 + rangeRateKmS / SPEED_OF_LIGHT_KM_S)

const SEARCH_STEP_MS = 30_000
/// How close the edges and the peak of a pass are found: well inside the second the panel shows.
const EDGE_TOLERANCE_MS = 200
/// Shorter than this a pass is not one.
const MIN_PASS_MS = 10_000

/// Where the satellite crosses the horizon between `a` and `b`, which must be
/// on opposite sides of it, to within a fifth of a second. The answer is the moment on the
/// visible side: the first instant it is up when rising, the last when setting.
function crossing(satrec: SatRec, observer: Observer, a: number, b: number): number {
  const up = (t: number) => (lookAt(satrec, observer, t)?.elevation ?? -90) > 0
  const aUp = up(a)
  let lo = a
  let hi = b
  while (Math.abs(hi - lo) > EDGE_TOLERANCE_MS) {
    const mid = Math.round((lo + hi) / 2)
    if (up(mid) === aUp) lo = mid
    else hi = mid
  }
  return aUp ? lo : hi
}

/// The highest point between `start` and `end`, found by narrowing a ternary search.
function peak(satrec: SatRec, observer: Observer, start: number, end: number): { at: number; look: LookAngle } {
  let lo = start
  let hi = end
  const el = (t: number) => lookAt(satrec, observer, t)?.elevation ?? -90
  while (hi - lo > EDGE_TOLERANCE_MS) {
    const a = lo + (hi - lo) / 3
    const b = hi - (hi - lo) / 3
    if (el(a) < el(b)) lo = a
    else hi = b
  }
  const at = Math.round((lo + hi) / 2)
  return { at, look: lookAt(satrec, observer, at) ?? { azimuth: 0, elevation: -90, rangeKm: 0 } }
}

/// Every pass that begins or is under way between `from` and `from + hours`,
/// whose highest point reaches `minElevation`. Passes are 5 to 15 minutes, so a
/// half-minute scan finds each one; the edges and the peak are then refined.
export function findPasses(satrec: SatRec, observer: Observer, from: number, hours: number, minElevation = 0): Pass[] {
  const until = from + hours * 3_600_000
  const passes: Pass[] = []

  let t = from
  let el = lookAt(satrec, observer, t)?.elevation ?? -90
  let rise: number | undefined = el > 0 ? from : undefined
  const startedUp = el > 0

  for (t = from + SEARCH_STEP_MS; t <= until + SEARCH_STEP_MS; t += SEARCH_STEP_MS) {
    const now = lookAt(satrec, observer, t)?.elevation ?? -90
    if (rise === undefined && now > 0 && el <= 0) rise = crossing(satrec, observer, t - SEARCH_STEP_MS, t)
    else if (rise !== undefined && now <= 0 && el > 0) {
      const set = crossing(satrec, observer, t - SEARCH_STEP_MS, t)
      passes.push(makePass(satrec, observer, rise, set, startedUp && passes.length === 0 && rise === from))
      rise = undefined
    }
    el = now
  }
  // A satellite that clips the horizon for a few seconds is not a pass anyone can use, and with the
  // minimum at 0 it would be listed as one lasting no time at all.
  return passes.filter((p) => p.maxElevation >= minElevation && p.los - p.aos >= MIN_PASS_MS)
}

function makePass(satrec: SatRec, observer: Observer, aos: number, los: number, inProgress: boolean): Pass {
  const top = peak(satrec, observer, aos, los)
  const start = lookAt(satrec, observer, aos)
  const end = lookAt(satrec, observer, los)
  return {
    aos,
    los,
    maxElevation: top.look.elevation,
    maxElevationAt: top.at,
    aosAzimuth: start?.azimuth ?? 0,
    maxAzimuth: top.look.azimuth,
    losAzimuth: end?.azimuth ?? 0,
    inProgress,
  }
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"] as const

/// 0 to 360 degrees as a point of the compass, like `NNW`.
export const compass = (degrees: number): string => COMPASS[Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16]
