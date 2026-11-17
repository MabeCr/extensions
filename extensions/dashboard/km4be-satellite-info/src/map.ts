// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// A pass on a map of the world (extension API 25): the ground track, the line on the Earth straight
// under the satellite, solid while it is above your horizon and dashed for a quarter hour either side;
// where it rises and sets for you; where it is now, with the circle of ground it can be heard from;
// and you. The app draws the map, and zooms and pans it, with no call back to the extension.

import type { PanelSceneControl } from "@ham2k/extension-sdk"

import type { Observer, Pass } from "./orbit.ts"
import { footprintKm, subPoint } from "./orbit.ts"
import type { SkyColors } from "./sky.ts"
import type { SatRec } from "./vendor/satellite.js/index.js"

/// How much of the track either side of the pass is drawn, and how finely.
export const TRACK_MARGIN_MS = 15 * 60_000
const STEP_MS = 15_000
/// Close enough in to see a footprint a few thousand kilometres across with you in it.
export const MAP_ZOOM = 2

export type LatLon = { lat: number; lon: number }

/// Where the point under the satellite is, every `step` from `from` to `to`, both ends included.
export function groundTrack(satrec: SatRec, from: number, to: number, step = STEP_MS): LatLon[] {
  const points: LatLon[] = []
  const add = (t: number) => {
    const p = subPoint(satrec, t)
    if (p) points.push({ lat: +p.lat.toFixed(3), lon: +p.lon.toFixed(3) })
  }
  for (let t = from; t < to; t += step) add(t)
  add(to)
  return points
}

/// `#RRGGBB` with an alpha in front, for a fill that lets the map show through.
export const faded = (color: string, alpha = "33"): string => (/^#[0-9a-f]{6}$/i.test(color) ? `#${alpha}${color.slice(1)}` : color)

/// The map control for a pass. `now` places the satellite, wherever it is, up or not.
export function passMap(satrec: SatRec, observer: Observer, pass: Pass, now: number, colors: SkyColors, text: string): PanelSceneControl {
  const during = groundTrack(satrec, pass.aos, pass.los)
  const before = groundTrack(satrec, pass.aos - TRACK_MARGIN_MS, pass.aos)
  const after = groundTrack(satrec, pass.los, pass.los + TRACK_MARGIN_MS)
  const here = subPoint(satrec, now)
  const home = { lat: +observer.lat.toFixed(3), lon: +observer.lon.toFixed(3) }

  const lines = [
    ...(before.length > 1 ? [{ id: "before", points: before, style: "nearby" }] : []),
    ...(after.length > 1 ? [{ id: "after", points: after, style: "nearby" }] : []),
    ...(during.length > 1 ? [{ id: "pass", points: during, style: "pass" }] : []),
  ]
  const markers = [
    ...(during.length ? [{ id: "rise", ...during[0], fill: colors.rise, style: "end" }, { id: "set", ...during[during.length - 1], fill: colors.set, style: "end" }] : []),
    { id: "home", ...home, style: "home" },
    ...(here ? [{ id: "sat", lat: +here.lat.toFixed(3), lon: +here.lon.toFixed(3), style: "sat" }] : []),
  ]
  const circles = here ? [{ id: "footprint", at: "sat", km: Math.round(footprintKm(here.altKm)), color: colors.path, fill: faded(colors.path), width: 1.5 }] : []

  return {
    id: "passMap",
    kind: "map",
    label: "Where the pass goes over the Earth",
    projection: "mercator",
    home,
    zoom: { min: 0, max: 8, initial: MAP_ZOOM },
    map: { grayline: true },
    styles: {
      pass: { color: colors.path, width: [[0, 2.5], [6, 4]], casing: "#80000000" },
      nearby: { color: colors.grid, width: 1.5, dashed: true },
      end: { color: "#000000", width: 1, radius: 5 },
      home: { fill: text, color: "#000000", width: 1, radius: 5 },
      sat: { fill: "#FFFFFF", color: colors.path, width: 3, radius: 7 },
    },
    markers,
    lines,
    circles,
  }
}

/// The line under the map that says what is on it.
export const MAP_KEY = "Solid while it is above your horizon, from the green dot to the red. The ringed dot is where it is now, and the shaded circle is where it can be heard from."
