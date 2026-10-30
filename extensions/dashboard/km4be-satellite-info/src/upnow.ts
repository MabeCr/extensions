// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// What is up right now, on one sky plot: every satellite that is above the horizon at this moment, as a dot where it is in
// the sky, with its name beside it, and a tap on the dot opens its pass. The plot is the same as the one on a pass's page, so
// north is up, and the rings are 0, 30 and 60 degrees. It is redrawn every few seconds, since a satellite crosses the sky in
// minutes.

import type { PanelScene, PanelSceneControl, PanelSceneLayoutNode } from "@ham2k/extension-sdk"

import type { Theme } from "./detail.ts"
import { placeLabels } from "./labels.ts"
import type { PlacedLabel } from "./labels.ts"
import { lookAt, satrecFromOmm } from "./orbit.ts"
import type { Observer } from "./orbit.ts"
import type { SatellitePass } from "./passes.ts"
import { COMFORTABLE, COMPACT, MODE_OPTIONS, openId } from "./scene.ts"
import type { Mode } from "./scene.ts"
import { compassLayers, SKY_SIZE, skyGrid, skyXY } from "./sky.ts"

/// A satellite that is up: where it is in the pane's plot, and where in the sky.
export interface UpDot {
  name: string
  /// When its pass ends, which with its name says which pass a tap on it opens.
  los: number
  x: number
  y: number
  azimuth: number
  elevation: number
  favorite: boolean
}

/// The radius of a dot, and of the area a finger can hit around it.
export const DOT = 9
export const HIT = 44

/// Every pass that is under way at `now`, as where its satellite is in the sky: the ones above the horizon, by name. A pass
/// without an orbit has nowhere to be, and is left out.
export function upNow(passes: SatellitePass[], observer: Observer, favorites: string[], now: number): UpDot[] {
  const dots: UpDot[] = []
  for (const pass of passes) {
    if (!(pass.aos <= now && pass.los > now) || !pass.satellite.omm) continue
    const look = lookAt(satrecFromOmm(pass.satellite.omm), observer, now)
    if (!look || look.elevation < 0) continue
    const { x, y } = skyXY(look.azimuth, look.elevation)
    dots.push({ name: pass.satellite.name, los: pass.los, x, y, azimuth: look.azimuth, elevation: look.elevation, favorite: favorites.includes(pass.satellite.name) })
  }
  return dots.sort((a, b) => a.name.localeCompare(b.name))
}

/// What the plot says to the operator, over it.
export function upNowHint(count: number, next: string): string {
  if (count === 0) return `Nothing is up right now.${next ? ` ${next}` : ""}`
  return `${count === 1 ? "1 satellite is" : `${count} satellites are`} up now. Tap one to open its pass.`
}

export interface NowModel {
  mode: Mode
  utc: boolean
  hint: string
  compact: boolean
  dots: UpDot[]
  /// The plot: the grid and the dots, and the names beside them, and the compass letters.
  svg: string
  labels: PlacedLabel[]
  compass: ReturnType<typeof compassLayers>
}

const FAVORITE = "#f9a825"

/// The plot and everything on it, for the satellites that are up, in the theme's colors.
export function buildNow(dots: UpDot[], theme: Theme): Pick<NowModel, "svg" | "labels" | "compass"> {
  const compass = compassLayers(theme.text)
  const drawn = dots
    .map((d) => {
      const ring = d.favorite ? `<circle cx="${d.x}" cy="${d.y}" r="${DOT + 4}" fill="none" stroke="${FAVORITE}" stroke-width="2"/>` : ""
      return `${ring}<circle cx="${d.x}" cy="${d.y}" r="${DOT}" fill="${theme.sky.path}" stroke="#ffffff" stroke-opacity="0.85" stroke-width="2"/>`
    })
    .join("")
  const labels = placeLabels(
    dots.map((d, i) => ({ id: `up${i}`, text: d.name, x: d.x, y: d.y, r: DOT + (d.favorite ? 4 : 0), color: theme.text })),
    dots.map((d) => ({ x: d.x, y: d.y, r: DOT + (d.favorite ? 4 : 0) })),
    compass.map((l) => ({ x: l.x, y: l.y, width: l.width, height: l.height })),
    SKY_SIZE,
  )
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SKY_SIZE} ${SKY_SIZE}">${skyGrid(theme.sky)}${drawn}</svg>`, labels, compass }
}

export const nowTapId = (name: string, los: number): string => openId(name, los, "up")

/// The scene: the chips and the switch, the line of words, and the plot, which takes the rest of the pane. A tap area over each
/// dot, large enough for a finger, opens that satellite's pass.
export function buildNowScene(m: NowModel): PanelScene {
  const d = m.compact ? COMPACT : COMFORTABLE
  const controls: PanelSceneControl[] = [
    { id: "mode", kind: "nativeSegmented", label: "Passes to show", value: "mode", event: "mode", options: MODE_OPTIONS },
    { id: "utc", kind: "nativeSwitch", label: "UTC", value: "utc", event: "utc" },
    { id: "hint", kind: "nativeText", label: "What is up", value: "hint" },
  ]
  for (const dot of m.dots) {
    // Inside the plot, so that a dot at its edge still has an area to hit.
    const x = Math.min(Math.max(dot.x - HIT / 2, 0), SKY_SIZE - HIT)
    const y = Math.min(Math.max(dot.y - HIT / 2, 0), SKY_SIZE - HIT)
    controls.push({ id: nowTapId(dot.name, dot.los), kind: "button", label: `Open the ${dot.name} pass`, event: "open", x, y, width: HIT, height: HIT })
  }
  const column: PanelSceneLayoutNode[] = [
    { row: [{ control: "mode", flex: 1 }, { control: "utc" }], spacing: d.gap, crossAxisAlignment: "center" },
    { control: "hint" },
    { scene: true, flex: 1 },
  ]
  return {
    version: 1,
    width: SKY_SIZE,
    height: SKY_SIZE,
    values: { utc: m.utc ? 1 : 0 },
    strings: { mode: m.mode, hint: m.hint },
    layers: [{ id: "sky", x: 0, y: 0, width: SKY_SIZE, height: SKY_SIZE, svg: m.svg }, ...m.compass, ...m.labels],
    controls,
    layout: { column, padding: d.padding, spacing: d.gap, crossAxisAlignment: "stretch" },
  }
}

