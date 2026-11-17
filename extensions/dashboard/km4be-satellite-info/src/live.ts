// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// Moving what moves without drawing the page again (extension API 25). While a pass's Sky page shows
// the satellite overhead, or its Map page is open, a timer once a second works out where the satellite
// is and sends the pane only what changed: the satellite's layer over the plot and the numbers in the
// corners, or the satellite's dot and footprint on the map. The page is still drawn in full now and then
// (see index.ts), which is what adds or takes away whatever comes or goes, such as the satellite at rise.

import type { PanelScenePatch } from "@ham2k/extension-sdk"

import type { Satellite } from "./data.ts"
import { positionLayers, readoutLayers } from "./detail.ts"
import type { Theme } from "./detail.ts"
import { footprintKm, lookAt, satrecFromOmm, subPoint } from "./orbit.ts"
import type { Observer, Pass } from "./orbit.ts"
import { liveDoppler } from "./radio.ts"
import { liveSpot, satelliteLayer } from "./sky.ts"
import type { SkyPoint } from "./sky.ts"
import type { SatRec } from "./vendor/satellite.js/index.js"

/// One pane showing something that moves, as its last full draw left it.
export interface LiveTarget {
  instanceId: string
  tab: "sky" | "map"
  satellite: Satellite
  satrec: SatRec
  observer: Observer
  pass: Pass
  track: SkyPoint[]
  theme: Theme
  /// The layers that draw had, which are all a patch may name.
  layers: Set<string>
}

export function liveTarget(instanceId: string, tab: "sky" | "map", satellite: Satellite, observer: Observer, pass: Pass, track: SkyPoint[], theme: Theme, layers: string[]): LiveTarget | null {
  if (!satellite.omm) return null
  return { instanceId, tab, satellite, satrec: satrecFromOmm(satellite.omm), observer, pass, track, theme, layers: new Set(layers) }
}

/// What to send the pane at `now`: the steps that move what moves; empty when there is nothing on the page to move.
export function liveFrame(t: LiveTarget, now: number): PanelScenePatch {
  if (t.tab === "map") {
    const here = subPoint(t.satrec, now)
    if (!here) return []
    return [
      { merge: ["controls", "passMap", "markers", "sat"], value: { lat: +here.lat.toFixed(3), lon: +here.lon.toFixed(3) } },
      { merge: ["controls", "passMap", "circles", "footprint"], value: { km: Math.round(footprintKm(here.altKm)) } },
    ]
  }
  // The Sky page moves only while the satellite is up, and only what its last draw put there.
  if (!t.layers.has("satNow") || now < t.pass.aos || now > t.pass.los) return []
  const look = lookAt(t.satrec, t.observer, now)
  const spot = liveSpot(t.track, t.pass, now, look ?? undefined)
  if (!look || !spot) return []
  const { x, y, svg } = satelliteLayer(spot, t.theme.sky)
  const steps: PanelScenePatch = [{ merge: ["layers", "satNow"], value: { x, y, svg } }]
  const texts = [...readoutLayers(liveDoppler(t.satellite, t.observer, now, t.satrec), t.theme.text), ...positionLayers(look, t.theme.text)]
  for (const l of texts) if (t.layers.has(l.id)) steps.push({ merge: ["layers", l.id], value: { text: l.text } })
  return steps
}

/// Whether a target still has anything to move: a Sky page until the satellite sets, a map for as long as it is open.
export const stillMoving = (t: LiveTarget, now: number): boolean => t.tab === "map" || now <= t.pass.los
