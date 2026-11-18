// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// A pass on a map of the world (extension API 25): the ground track, the line on the Earth straight
// under the satellite, solid while it is above your horizon, and dashed from where the satellite is now to where the pass begins;
// where it rises and sets for you; where it is now, with the circle of ground it can be heard from;
// and you. The app draws the map, and zooms and pans it, with no call back to the extension.

import type { PanelSceneControl } from "@ham2k/extension-sdk"

import type { Observer, Pass } from "./orbit.ts"
import { footprintKm, subPoint } from "./orbit.ts"
import type { SkyColors } from "./sky.ts"
import type { SatRec } from "./vendor/satellite.js/index.js"

/// The furthest ahead of a pass that the dashed track is drawn, a bit over an orbit: for a later pass it would only be a long
/// scribble across the map, so it is left out until the pass is near. A point of the line is 15 seconds.
export const TRACK_REACH_MS = 2 * 3_600_000
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
/// What the app draws under the pass. Every pan and zoom redraws it all on a phone, and the state and province lines, the
/// grid of latitude and longitude and the night shading are what make that slow, so by default they are left out: the
/// coast and the country borders show the way. `full` puts them back.
export const MAP_UNDER_FAST = { grayline: false, divisions: "#00000000", graticule: "#00000000" }
export const MAP_UNDER_FULL = { grayline: true }

export function passMap(satrec: SatRec, observer: Observer, pass: Pass, now: number, colors: SkyColors, text: string, full = false): PanelSceneControl {
  const during = groundTrack(satrec, pass.aos, pass.los)
  // The dashed track is how the satellite gets to the pass: from where it is now, so that its dot is the line's start, to
  // where the pass begins, as far back as it reaches. Under way, or after, there is none; and none runs on past the pass.
  // Its start is where the satellite was at the last full draw, which is behind the dot, so the dot stays on the line as it
  // moves between draws.
  const from = Math.max(now, pass.aos - TRACK_REACH_MS)
  const reaches = pass.aos - now <= TRACK_REACH_MS
  const before = reaches && from < pass.aos ? groundTrack(satrec, from, pass.aos) : []
  const here = subPoint(satrec, now)
  const home = { lat: +observer.lat.toFixed(3), lon: +observer.lon.toFixed(3) }

  const lines = [
    ...(before.length > 1 ? [{ id: "before", points: before, style: "nearby" }] : []),
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
    map: full ? MAP_UNDER_FULL : MAP_UNDER_FAST,
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
