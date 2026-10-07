// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// Which part of the map is on screen. A view is a center and a zoom, in the
// map's own units (world.ts); the visible window is the whole map divided by
// the zoom, kept inside the map. The scene stays 720 x 284 units whatever the
// zoom, so everything inside it is placed in scene units by `toScene`.

import { MAP_HEIGHT, MAP_WIDTH, MAP_TOP } from "./world.ts"

export interface View {
  /// The window's center, in map units.
  cx: number
  cy: number
  zoom: number
}

export const MIN_ZOOM = 1
export const MAX_ZOOM = 16
export const ZOOM_STEP = 1.5

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const round = (n: number) => +n.toFixed(2)

export const WORLD: View = { cx: MAP_WIDTH / 2, cy: MAP_HEIGHT / 2, zoom: 1 }

/// A view centered on a coordinate.
export const viewAt = (lat: number, lon: number, zoom: number): View =>
  fit({ cx: (lon + 180) * 2, cy: (MAP_TOP - lat) * 2, zoom })

export const PRESETS: { value: string; label: string; view: View }[] = [
  { value: "world", label: "World", view: WORLD },
  { value: "north-america", label: "North America", view: viewAt(45, -100, 2.2) },
  { value: "south-america", label: "South America", view: viewAt(-18, -60, 2.4) },
  { value: "europe", label: "Europe", view: viewAt(52, 15, 4) },
  { value: "africa", label: "Africa", view: viewAt(2, 20, 2.4) },
  { value: "asia", label: "Asia", view: viewAt(38, 95, 2.2) },
  { value: "oceania", label: "Oceania", view: viewAt(-25, 150, 3) },
]

/// The same view with its center and zoom brought inside the map.
export function fit(view: View): View {
  const zoom = round(clamp(view.zoom, MIN_ZOOM, MAX_ZOOM))
  const halfW = MAP_WIDTH / zoom / 2
  const halfH = MAP_HEIGHT / zoom / 2
  return { zoom, cx: round(clamp(view.cx, halfW, MAP_WIDTH - halfW)), cy: round(clamp(view.cy, halfH, MAP_HEIGHT - halfH)) }
}

/// One zoom step in (`direction` 1) or out (-1), about the same center.
export const zoomed = (view: View, direction: 1 | -1): View =>
  fit({ ...view, zoom: direction > 0 ? view.zoom * ZOOM_STEP : view.zoom / ZOOM_STEP })

/// The preset a view is exactly at, or "" for a custom one.
export const presetOf = (view: View): string =>
  PRESETS.find((p) => p.view.cx === view.cx && p.view.cy === view.cy && p.view.zoom === view.zoom)?.value ?? ""

export const presetView = (value: string): View | undefined => PRESETS.find((p) => p.value === value)?.view

/// The window on the map: its top-left corner and size, in map units.
export function windowOf(view: View): { x: number; y: number; width: number; height: number } {
  const width = MAP_WIDTH / view.zoom
  const height = MAP_HEIGHT / view.zoom
  return { x: view.cx - width / 2, y: view.cy - height / 2, width, height }
}

/// A map point in scene units: the window scaled up to fill the scene.
export function toScene(view: View, point: { x: number; y: number }): { x: number; y: number } {
  const w = windowOf(view)
  return { x: +((point.x - w.x) * view.zoom).toFixed(1), y: +((point.y - w.y) * view.zoom).toFixed(1) }
}

/// Whether a scene point, with `margin` to spare, is on screen.
export const onScreen = (p: { x: number; y: number }, margin = 0): boolean =>
  p.x >= -margin && p.x <= MAP_WIDTH + margin && p.y >= -margin && p.y <= MAP_HEIGHT + margin
