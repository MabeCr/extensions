// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// The next passes across the whole catalog, and how they are written down.

import type { Satellite } from "./data.ts"
import { compass, findPasses, satrecFromOmm } from "./orbit.ts"
import type { Observer, Pass } from "./orbit.ts"

export interface SatellitePass extends Pass {
  satellite: Satellite
}

export const LOOK_AHEAD_HOURS = 24
export const DEFAULT_MIN_ELEVATION = 10
export const MAX_MIN_ELEVATION = 60

/// The pane's minimum peak elevation from its settings: 0 to 60 degrees, and
/// the default for anything blank, negative or not a number.
export function minElevation(config: Record<string, unknown> | undefined): number {
  const v = config?.minElevation
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(MAX_MIN_ELEVATION, v) : DEFAULT_MIN_ELEVATION
}

/// Every pass in the next day, soonest first, for the satellites that have elements.
export function nextPasses(satellites: Satellite[], observer: Observer, now: number, minEl: number, hours = LOOK_AHEAD_HOURS): SatellitePass[] {
  return satellites
    .flatMap((satellite) =>
      satellite.omm ? findPasses(satrecFromOmm(satellite.omm), observer, now, hours, minEl).map((pass) => ({ ...pass, satellite })) : [],
    )
    .sort((a, b) => a.aos - b.aos || b.maxElevation - a.maxElevation)
}

const two = (n: number) => String(n).padStart(2, "0")

/// A clock time, with the date when it is not today. Local time, or UTC with a `Z`.
export function clock(millis: number, now: number, utc: boolean): string {
  const d = new Date(millis)
  const n = new Date(now)
  const [h, m, day, today, month] = utc
    ? [d.getUTCHours(), d.getUTCMinutes(), d.getUTCDate(), n.getUTCDate(), d.getUTCMonth() + 1]
    : [d.getHours(), d.getMinutes(), d.getDate(), n.getDate(), d.getMonth() + 1]
  return `${day === today ? "" : `${two(month)}-${two(day)} `}${two(h)}:${two(m)}${utc ? "Z" : ""}`
}

export function duration(pass: Pass): string {
  const minutes = Math.round((pass.los - pass.aos) / 60_000)
  return `${minutes} min`
}

/// "NW → SE", the way round the sky the pass goes.
export const direction = (pass: Pass): string => `${compass(pass.aosAzimuth)} → ${compass(pass.losAzimuth)}`
