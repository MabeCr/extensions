// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// Where the map is in the scene. The world is drawn once, at the size the zoom gives it, and the host scrolls it along the
// pane's width: native, with no call back to the extension. Its height is the one thing a scroll along the width cannot
// move, so the map is never taller than the pane has room for, and that is what limits the zoom.
//
// Everything here is in logical pixels, which are scene units: the scene is as tall as the pane and as wide as the map.

import { MAP_HEIGHT, MAP_TOP, MAP_WIDTH } from "./world.ts"

export interface Pane {
  width: number
  height: number
}

/// What the pane keeps for its controls, above the map and under it, in pixels.
export interface Chrome {
  top: number
  bottom: number
}

export const MAX_ZOOM = 16
/// A scene is at most this wide.
export const MAX_SCENE = 8192
export const ZOOM_STEP = 1.5

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

export interface Geometry {
  pane: Pane
  chrome: Chrome
  /// The zoom the map is drawn at, 1 being the whole world as wide as the pane allows.
  zoom: number
  /// The most it can be, from the pane's height.
  zoomMax: number
  /// Pixels to a map unit.
  k: number
  /// The scene: as wide as the map, or the pane if that is wider, and as tall as the pane.
  width: number
  height: number
  /// Where the map's corner is in the scene: centered when the map is narrower than the pane, and in the band between the controls.
  x0: number
  y0: number
  mapWidth: number
  mapHeight: number
  /// The farthest the scene scrolls.
  scrollMax: number
}

export function geometryOf(pane: Pane, chrome: Chrome, zoom: number): Geometry {
  const band = Math.max(80, pane.height - chrome.top - chrome.bottom)
  // The whole world, as large as the pane allows it in both directions.
  const k0 = Math.min(pane.width / MAP_WIDTH, band / MAP_HEIGHT)
  // More than the pane's height has room for would not fit, and a scene this wide is the most there is.
  const zoomMax = Math.max(1, Math.min(MAX_ZOOM, band / (MAP_HEIGHT * k0), MAX_SCENE / (MAP_WIDTH * k0)))
  // Not a number is the whole world; any number, however large, is held to the most there is.
  const z = clamp(Number.isNaN(zoom) ? 1 : zoom, 1, zoomMax)
  const k = k0 * z
  const mapWidth = MAP_WIDTH * k
  const mapHeight = MAP_HEIGHT * k
  const width = Math.max(Math.round(pane.width), Math.ceil(mapWidth))
  return {
    pane,
    chrome,
    zoom: +z.toFixed(4),
    zoomMax: +zoomMax.toFixed(4),
    k,
    width,
    height: Math.round(pane.height),
    x0: (width - mapWidth) / 2,
    y0: chrome.top + (band - mapHeight) / 2,
    mapWidth,
    mapHeight,
    scrollMax: Math.max(0, width - Math.round(pane.width)),
  }
}

/// A coordinate in map units (see world.ts): two to a degree.
export function project(lat: number, lon: number): { x: number; y: number } {
  const y = (MAP_TOP - clamp(lat, MAP_TOP - MAP_HEIGHT / 2, MAP_TOP)) * 2
  return { x: +((lon + 180) * 2).toFixed(1), y: +y.toFixed(1) }
}

/// A coordinate in the scene.
export function sceneOf(g: Geometry, lat: number, lon: number): { x: number; y: number } {
  const p = project(lat, lon)
  return { x: +(g.x0 + p.x * g.k).toFixed(1), y: +(g.y0 + p.y * g.k).toFixed(1) }
}

/// A scroll position kept inside the scene.
export const scrollIn = (g: Geometry, scroll: number): number => clamp(Number.isFinite(scroll) ? scroll : 0, 0, g.scrollMax)

/// Which map unit across (0 to 720) is in the middle of the pane when the scene is scrolled to `scroll`.
export const centerOf = (g: Geometry, scroll: number): number => clamp((scroll + g.pane.width / 2 - g.x0) / g.k, 0, MAP_WIDTH)

/// The scroll that puts a map unit across in the middle of the pane.
export const scrollFor = (g: Geometry, unit: number): number => scrollIn(g, g.x0 + unit * g.k - g.pane.width / 2)

export interface View {
  zoom: number
  /// How far the scene is scrolled, in pixels.
  scroll: number
}

/// The view, for the pane and its chrome, after the zoom changes by `factor`, about the middle of the pane: the same place stays there.
export function zoomedBy(pane: Pane, chrome: Chrome, view: View, factor: number): View {
  const before = geometryOf(pane, chrome, view.zoom)
  const unit = centerOf(before, scrollIn(before, view.scroll))
  const after = geometryOf(pane, chrome, view.zoom * (Number.isFinite(factor) && factor > 0 ? factor : 1))
  return { zoom: after.zoom, scroll: scrollFor(after, unit) }
}

export const WORLD: View = { zoom: 1, scroll: 0 }

/// The longitude of the middle of a Maidenhead square of four or six characters, or undefined when it is not one.
export function gridLongitude(grid: unknown): number | undefined {
  const m = typeof grid === "string" ? /^([A-R])[A-R](\d)\d(?:([A-X])[A-X])?/i.exec(grid.trim()) : null
  if (!m) return undefined
  const field = m[1].toUpperCase().charCodeAt(0) - 65
  const square = Number(m[2])
  // A field is 20 degrees across, a square 2, a subsquare a twenty-fourth of that: the middle of the smallest the grid names.
  const lon = -180 + field * 20 + square * 2
  return m[3] ? lon + (m[3].toUpperCase().charCodeAt(0) - 65) * (2 / 24) + 1 / 24 : lon + 1
}

/// How much of the world the map opens on where the operator is known: a country and its neighbors, as far as the pane allows.
export const HOME_ZOOM = 2

/// Where the map opens: the operator's longitude in the middle at a useful zoom if the operation has a grid, or the whole world.
export function openingView(pane: Pane, chrome: Chrome, grid: unknown): View {
  const lon = gridLongitude(grid)
  return lon === undefined ? viewAt(pane, chrome, 0, 1) : viewAt(pane, chrome, lon, HOME_ZOOM)
}

/// A coordinate in the middle of the pane at a zoom: the view that shows it.
export function viewAt(pane: Pane, chrome: Chrome, lon: number, zoom: number): View {
  const g = geometryOf(pane, chrome, zoom)
  return { zoom: g.zoom, scroll: scrollFor(g, (lon + 180) * 2) }
}

export interface Region {
  value: string
  label: string
  lat: number
  lon: number
  /// Asked for; the pane's height may allow less.
  zoom: number
}

export const REGIONS: Region[] = [
  { value: "world", label: "World", lat: 20, lon: 0, zoom: 1 },
  { value: "north-america", label: "North America", lat: 45, lon: -100, zoom: 2.2 },
  { value: "south-america", label: "South America", lat: -18, lon: -60, zoom: 2.4 },
  { value: "europe", label: "Europe", lat: 52, lon: 15, zoom: 4 },
  { value: "africa", label: "Africa", lat: 2, lon: 20, zoom: 2.4 },
  { value: "asia", label: "Asia", lat: 38, lon: 95, zoom: 2.2 },
  { value: "oceania", label: "Oceania", lat: -25, lon: 150, zoom: 3 },
]

export const regionView = (pane: Pane, chrome: Chrome, value: string): View | undefined => {
  const r = REGIONS.find((o) => o.value === value)
  return r ? viewAt(pane, chrome, r.lon, r.zoom) : undefined
}
