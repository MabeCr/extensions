// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// Where the map is in the scene. The world is drawn at the size the zoom gives it and the host scrolls it along the pane's width: native,
// with no call back to the extension. Along its height a scroll cannot move it, so the map is cut there instead: only a band of
// latitudes is drawn, as tall as the pane has room for, and which band is the extension's to choose: it is the region asked for, the
// place the zoom was made about, or one moved up or down with the buttons. That is what lets the zoom go as far in as there is any
// point to, however short the pane.
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
/// How far the up and down buttons move the band, as a share of its height.
export const PAN_STEP = 0.35

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

export interface Geometry {
  pane: Pane
  chrome: Chrome
  /// The zoom the map is drawn at, 1 being the whole world as large as the pane allows in both directions.
  zoom: number
  /// The most it can be: the farthest in there is any point to, or the widest a scene may be.
  zoomMax: number
  /// Pixels to a map unit.
  k: number
  /// The scene: as wide as the map, or the pane if that is wider, and as tall as the pane.
  width: number
  height: number
  /// The band of latitudes that is drawn: the map units down from the top that it starts at, and how many it spans.
  winTop: number
  winHeight: number
  /// Where the band is centered, kept inside the map.
  cy: number
  /// Whether the band is less than the whole map, so that it can be moved.
  canPan: boolean
  /// Where the drawn map is in the scene: centered across when it is narrower than the pane, and in the band between the controls.
  x0: number
  y0: number
  mapWidth: number
  /// The height of the drawn band in pixels: the layer the world is in.
  mapHeight: number
  /// The farthest the scene scrolls.
  scrollMax: number
}

export function geometryOf(pane: Pane, chrome: Chrome, zoom: number, cy: number = MAP_HEIGHT / 2): Geometry {
  const band = Math.max(80, pane.height - chrome.top - chrome.bottom)
  // The whole world, as large as the pane allows it in both directions.
  const k0 = Math.min(pane.width / MAP_WIDTH, band / MAP_HEIGHT)
  const zoomMax = Math.max(1, Math.min(MAX_ZOOM, MAX_SCENE / (MAP_WIDTH * k0)))
  // Not a number is the whole world; any number, however large, is held to the most there is.
  const z = clamp(Number.isNaN(zoom) ? 1 : zoom, 1, zoomMax)
  const k = k0 * z
  const winHeight = Math.min(MAP_HEIGHT, band / k)
  const centered = clamp(Number.isFinite(cy) ? cy : MAP_HEIGHT / 2, winHeight / 2, MAP_HEIGHT - winHeight / 2)
  const mapWidth = MAP_WIDTH * k
  const mapHeight = winHeight * k
  const width = Math.max(Math.round(pane.width), Math.ceil(mapWidth))
  return {
    pane,
    chrome,
    zoom: +z.toFixed(4),
    zoomMax: +zoomMax.toFixed(4),
    k,
    width,
    height: Math.round(pane.height),
    winTop: centered - winHeight / 2,
    winHeight,
    cy: centered,
    canPan: winHeight < MAP_HEIGHT - 0.01,
    x0: (width - mapWidth) / 2,
    y0: chrome.top + (band - mapHeight) / 2,
    mapWidth,
    mapHeight,
    scrollMax: Math.max(0, width - Math.round(pane.width)),
  }
}

/// A coordinate in the map's own units (see world.ts): two to a degree.
export function project(lat: number, lon: number): { x: number; y: number } {
  const y = (MAP_TOP - clamp(lat, MAP_TOP - MAP_HEIGHT / 2, MAP_TOP)) * 2
  return { x: +((lon + 180) * 2).toFixed(1), y: +y.toFixed(1) }
}

/// A coordinate in the scene, and whether it is inside the band that is drawn.
export function sceneOf(g: Geometry, lat: number, lon: number): { x: number; y: number; inside: boolean } {
  const p = project(lat, lon)
  const y = g.y0 + (p.y - g.winTop) * g.k
  return { x: +(g.x0 + p.x * g.k).toFixed(1), y: +y.toFixed(1), inside: y >= g.y0 - 0.5 && y <= g.y0 + g.mapHeight + 0.5 }
}

/// A scroll position kept inside the scene.
export const scrollIn = (g: Geometry, scroll: number): number => clamp(Number.isFinite(scroll) ? scroll : 0, 0, g.scrollMax)

/// Which map unit across (0 to 720) is in the middle of the pane when the scene is scrolled to `scroll`.
export const centerOf = (g: Geometry, scroll: number): number => clamp((scroll + g.pane.width / 2 - g.x0) / g.k, 0, MAP_WIDTH)

/// The scroll that puts a map unit across in the middle of the pane.
export const scrollFor = (g: Geometry, unit: number): number => scrollIn(g, g.x0 + unit * g.k - g.pane.width / 2)

/// What the pane is showing of the map: the zoom, how far across it is scrolled, and the middle of the band of latitudes.
export interface View {
  zoom: number
  /// How far the scene is scrolled, in pixels.
  scroll: number
  /// The middle of the band, in map units down from the top.
  cy: number
}

export const WORLD: View = { zoom: 1, scroll: 0, cy: MAP_HEIGHT / 2 }

/// The view after the zoom changes by `factor`, about the middle of the pane: the same place stays there.
export function zoomedBy(pane: Pane, chrome: Chrome, view: View, factor: number): View {
  const before = geometryOf(pane, chrome, view.zoom, view.cy)
  const unit = centerOf(before, scrollIn(before, view.scroll))
  const after = geometryOf(pane, chrome, view.zoom * (Number.isFinite(factor) && factor > 0 ? factor : 1), before.cy)
  return { zoom: after.zoom, scroll: scrollFor(after, unit), cy: after.cy }
}

/// The view with the band moved up (-1) or down (1) by a step of its height, and held inside the map.
export function pannedBy(pane: Pane, chrome: Chrome, view: View, direction: -1 | 1): View {
  const g = geometryOf(pane, chrome, view.zoom, view.cy)
  const moved = geometryOf(pane, chrome, g.zoom, g.cy + direction * PAN_STEP * g.winHeight)
  return { zoom: g.zoom, scroll: scrollIn(g, view.scroll), cy: moved.cy }
}

/// A coordinate in the middle of the pane at a zoom: the view that shows it.
export function viewAt(pane: Pane, chrome: Chrome, lat: number, lon: number, zoom: number): View {
  const unit = project(lat, lon)
  const g = geometryOf(pane, chrome, zoom, unit.y)
  return { zoom: g.zoom, scroll: scrollFor(g, unit.x), cy: g.cy }
}

export interface Region {
  value: string
  label: string
  /// The box that is to fill the pane, in degrees.
  south: number
  north: number
  west: number
  east: number
}

export const REGIONS: Region[] = [
  { value: "world", label: "World", south: -58, north: 84, west: -180, east: 180 },
  { value: "usa", label: "Continental US", south: 24, north: 50, west: -126, east: -66 },
  { value: "north-america", label: "North America", south: 8, north: 72, west: -168, east: -52 },
  { value: "south-america", label: "South America", south: -56, north: 13, west: -82, east: -34 },
  { value: "europe", label: "Europe", south: 35, north: 71, west: -12, east: 42 },
  { value: "africa", label: "Africa", south: -35, north: 37, west: -18, east: 52 },
  { value: "asia", label: "Asia", south: -10, north: 75, west: 25, east: 150 },
  { value: "oceania", label: "Oceania", south: -48, north: 0, west: 110, east: 180 },
]

/// The view that fills the pane with a region: as far in as the whole box still fits in both directions, and its middle in the middle.
export function regionView(pane: Pane, chrome: Chrome, value: string): View | undefined {
  const r = REGIONS.find((o) => o.value === value)
  if (!r) return undefined
  if (r.value === "world") return { ...WORLD }
  const band = Math.max(80, pane.height - chrome.top - chrome.bottom)
  const k0 = Math.min(pane.width / MAP_WIDTH, band / MAP_HEIGHT)
  // A little room round the box, so that what is at its edge is not at the pane's.
  const byWidth = pane.width / ((r.east - r.west) * 2 * k0)
  const byHeight = band / ((r.north - r.south) * 2 * k0)
  return viewAt(pane, chrome, (r.south + r.north) / 2, (r.west + r.east) / 2, Math.min(byWidth, byHeight) * 0.96)
}

/// The region a view shows, to a hair, or undefined for a view of its own.
export function regionOf(pane: Pane, chrome: Chrome, view: View): Region | undefined {
  return REGIONS.find((r) => {
    const v = regionView(pane, chrome, r.value)
    return !!v && Math.abs(v.zoom - view.zoom) < 0.001 && Math.abs(v.scroll - view.scroll) < 1 && Math.abs(v.cy - view.cy) < 0.5
  })
}

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

/// The latitude of the middle of a Maidenhead square of four or six characters, or undefined when it is not one.
export function gridLatitude(grid: unknown): number | undefined {
  const m = typeof grid === "string" ? /^[A-R]([A-R])\d(\d)(?:[A-X]([A-X]))?/i.exec(grid.trim()) : null
  if (!m) return undefined
  const field = m[1].toUpperCase().charCodeAt(0) - 65
  const square = Number(m[2])
  // A field is 10 degrees tall, a square 1, a subsquare a twenty-fourth of that.
  const lat = -90 + field * 10 + square
  return m[3] ? lat + (m[3].toUpperCase().charCodeAt(0) - 65) * (1 / 24) + 1 / 48 : lat + 0.5
}

/// How far in the map opens where the operator is known: a country and its neighbors.
export const HOME_ZOOM = 4

/// Where the map opens: the operator's place in the middle at a useful zoom if the operation has a grid, or the whole world.
export function openingView(pane: Pane, chrome: Chrome, grid: unknown): View {
  const lat = gridLatitude(grid)
  const lon = gridLongitude(grid)
  return lat === undefined || lon === undefined ? { ...WORLD } : viewAt(pane, chrome, lat, lon, HOME_ZOOM)
}
