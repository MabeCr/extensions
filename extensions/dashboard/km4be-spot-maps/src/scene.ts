// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// The map as a scene that scrolls (extension API 12). The world is one layer, drawn at the size the zoom gives it and marked to
// stretch, so that a zoom drag has something to show while it lasts; each station is a layer and a tap area of its own, so that a
// dot keeps its size however far the map is stretched; and the controls are fixed over the pane, which scrolls under them.
// A scene that scrolls is not laid out: every piece has its place, worked out here from the pane's size.

import type { PanelScene, PanelSceneControl } from "@ham2k/extension-sdk"

import { REGIONS, sceneOf } from "./geo.ts"
import type { Chrome, Geometry, Pane } from "./geo.ts"
import { BAND_COLORS, BANDS } from "./spots.ts"
import type { MapSpot } from "./spots.ts"
import { BORDER_PATH, LAND_PATH, MAP_HEIGHT, MAP_WIDTH } from "./world.ts"

export const PAD = 8
export const DROPDOWN_HEIGHT = 56
export const BUTTON_HEIGHT = 44
/// The strip along the bottom of the map where a drag zooms, and the buttons that zoom by a step.
export const STRIP_HEIGHT = 30
export const ZOOM_BUTTON = 36

/// A dot's radius and the side of the area that takes a tap on it, in pixels: a fingertip, not the dot.
export const DOT_RADIUS = 5
export const HIT = 36
/// Each station is a layer and a control of its own, and a scene holds 512 and 256: this many is as many as fit with the pane's own.
export const MAX_DOTS = 200

/// What one line of the host's own text takes, with the operator's text scaling.
export interface Lines {
  label: number
  body: number
}

export const DEFAULT_LINES: Lines = { label: 18, body: 20 }

export function linesOf(environment: { typography?: { label?: { scaledFontSize: number }; body?: { scaledFontSize: number } } } | undefined): Lines {
  const line = (face: { scaledFontSize: number } | undefined, fallback: number) => (face && face.scaledFontSize > 0 ? Math.ceil(face.scaledFontSize * 1.4) : fallback)
  return { label: line(environment?.typography?.label, DEFAULT_LINES.label), body: line(environment?.typography?.body, DEFAULT_LINES.body) }
}

/// What the pane keeps over the map (the two dropdowns, and the line saying how many stations) and under it (the station's details, two
/// lines, and the button to log it).
export function chromeOf(lines: Lines): Chrome {
  return {
    top: PAD + DROPDOWN_HEIGHT + 4 + lines.label + 4,
    bottom: 4 + lines.body * 2 + 6 + BUTTON_HEIGHT + PAD,
  }
}

/// The world as the one SVG it is drawn from: ocean, land and borders, in map units, whatever size it is shown at.
export const WORLD_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MAP_WIDTH} ${MAP_HEIGHT}">` +
  `<rect width="${MAP_WIDTH}" height="${MAP_HEIGHT}" fill="#10243a"/>` +
  `<path d="${LAND_PATH}" fill="#2b3f4f" stroke="none"/>` +
  `<path d="${BORDER_PATH}" fill="none" stroke="#4d6577" stroke-width="0.3"/></svg>`

/// The world cut to a band of latitudes: the map units from `top` down, `height` of them.
export const worldSvg = (top: number, height: number): string =>
  WORLD_SVG.replace(`viewBox="0 0 ${MAP_WIDTH} ${MAP_HEIGHT}"`, `viewBox="0 ${+top.toFixed(2)} ${MAP_WIDTH} ${+height.toFixed(2)}" preserveAspectRatio="none"`)

export interface MapModel {
  pane: Pane
  lines: Lines
  g: Geometry
  /// The stations to draw, newest first, and the one picked.
  spots: MapSpot[]
  selected: string
  band: string
  region: string
  scroll: number
  summary: string
  details: string
  /// The button that puts the station in the log.
  logLabel: string
  canLog: boolean
}

export const DOT_PREFIX = "dot:"

const dotSvg = (s: MapSpot): string => {
  const c = BAND_COLORS[s.band] ?? BAND_COLORS.other
  const r = DOT_RADIUS
  const size = r * 2 + 4
  const half = size / 2
  // A station already worked is the same dot, hollow: there to be seen, and not what the operator is looking for.
  const fill = s.worked ? `fill="${c}" fill-opacity="0.35"` : `fill="${c}"`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><circle cx="${half}" cy="${half}" r="${r}" ${fill} stroke="#000" stroke-opacity="0.6" stroke-width="1"/></svg>`
}

const ringSvg = (): string => {
  const size = DOT_RADIUS * 2 + 14
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${DOT_RADIUS + 5}" fill="none" stroke="#ffffff" stroke-width="2"/></svg>`
}

export function buildScene(m: MapModel): PanelScene {
  const { g, pane } = m
  const W = Math.round(pane.width)
  const H = Math.round(pane.height)
  const chrome = g.chrome
  const bandBottom = H - chrome.bottom
  const layers: PanelScene["layers"] = [{ id: "world", x: g.x0, y: g.y0, width: g.mapWidth, height: g.mapHeight, stretch: true, svg: worldSvg(g.winTop, g.winHeight) }]
  const controls: PanelSceneControl[] = []

  // The stations, oldest first so that the newest is on top where they overlap, as a layer and a tap area each.
  const shown = m.spots.filter((s) => sceneOf(g, s.lat, s.lon).inside).slice(0, MAX_DOTS).reverse()
  const size = DOT_RADIUS * 2 + 4
  for (const s of shown) {
    const p = sceneOf(g, s.lat, s.lon)
    layers.push({ id: DOT_PREFIX + s.call, x: +(p.x - size / 2).toFixed(1), y: +(p.y - size / 2).toFixed(1), width: size, height: size, svg: dotSvg(s) })
  }
  const picked = shown.find((s) => s.call === m.selected)
  if (picked) {
    const p = sceneOf(g, picked.lat, picked.lon)
    const ring = DOT_RADIUS * 2 + 14
    layers.push({ id: "ring", x: +(p.x - ring / 2).toFixed(1), y: +(p.y - ring / 2).toFixed(1), width: ring, height: ring, svg: ringSvg() })
  }
  for (const s of shown) {
    const p = sceneOf(g, s.lat, s.lon)
    // Inside the scene, so that a station at the edge still has an area to tap.
    const x = Math.min(Math.max(p.x - HIT / 2, 0), g.width - HIT)
    const y = Math.min(Math.max(p.y - HIT / 2, 0), g.height - HIT)
    controls.push({ id: DOT_PREFIX + s.call, kind: "button", label: `${s.call} ${s.band} ${s.ref}`.trim(), event: "pick", x: +x.toFixed(1), y: +y.toFixed(1), width: HIT, height: HIT })
  }

  // The strip along the bottom of the map where a drag zooms; anywhere else a drag scrolls. It is drawn, so that it can be found.
  const canZoom = g.zoomMax > 1.0001
  const stripY = bandBottom - STRIP_HEIGHT
  const bar = `<rect x="${PAD}" y="${STRIP_HEIGHT / 2 - 2}" width="${W - 2 * PAD}" height="4" rx="2" fill="#7f8791" fill-opacity="0.7"/>`
  const arrows = `<path d="M${PAD + 6} ${STRIP_HEIGHT / 2}l8 -6v12zM${W - PAD - 6} ${STRIP_HEIGHT / 2}l-8 -6v12z" fill="#7f8791"/>`
  const buttonX = W - PAD - ZOOM_BUTTON
  const buttons = (
    [
      ["zoomIn", "Zoom in", "M11 18h14M18 11v14", g.zoom < g.zoomMax - 0.0001],
      ["zoomOut", "Zoom out", "M11 18h14", g.zoom > 1.0001],
      ["panUp", "Show farther north", "M11 21l7 -7l7 7", g.canPan && g.winTop > 0.01],
      ["panDown", "Show farther south", "M11 15l7 7l7 -7", g.canPan && g.winTop + g.winHeight < MAP_HEIGHT - 0.01],
    ] as const
  ).map(([id, label, glyph, on], i) => {
    const y = chrome.top + 4 + i * (ZOOM_BUTTON + 6)
    controls.push({ id, kind: "button", label, event: id, x: buttonX, y, width: ZOOM_BUTTON, height: ZOOM_BUTTON, disabled: !on, fixed: true })
    return `<g transform="translate(${buttonX} ${y})" opacity="${on ? 1 : 0.35}"><circle cx="18" cy="18" r="17" fill="#1a1d21" fill-opacity="0.85" stroke="#9aa4ad"/><path d="${glyph}" stroke="#ffffff" stroke-width="2.4" fill="none" stroke-linecap="round"/></g>`
  })
  layers.push({
    id: "chrome",
    x: 0,
    y: 0,
    width: W,
    height: H,
    fixed: true,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${canZoom ? `<g transform="translate(0 ${stripY})">${bar}${arrows}</g>` : ""}${buttons.join("")}</svg>`,
  })
  if (canZoom) {
    // The factors are of the zoom as it is now: down to 1, and up to what the pane's height allows. The strip scrolls with the scene, as
    // the app requires of a zoom strip, and is as long as the scene, so that it is under the pane wherever the scene is scrolled to; the
    // ruler that shows where it is, is drawn on the fixed layer above.
    controls.push({ id: "stretch", kind: "zoom", label: "Zoom", event: "stretch", min: +(1 / g.zoom).toFixed(4), max: +(g.zoomMax / g.zoom).toFixed(4), x: 0, y: stripY, width: g.width, height: STRIP_HEIGHT })
  }

  // Over the map: the two dropdowns, and how many stations there are.
  const left = 124
  controls.push(
    {
      id: "band",
      kind: "nativeDropdown",
      label: "Band",
      value: "band",
      event: "filter",
      options: [{ label: "All bands", value: "all" }, ...BANDS.map((b) => ({ label: b, value: b }))],
      x: PAD,
      y: PAD,
      width: left,
      height: DROPDOWN_HEIGHT,
      fixed: true,
    },
    {
      id: "region",
      kind: "nativeDropdown",
      label: "Region",
      value: "region",
      event: "region",
      placeholder: "Custom view",
      options: REGIONS.map((r) => ({ label: r.label, value: r.value })),
      x: PAD + left + PAD,
      y: PAD,
      width: W - 3 * PAD - left,
      height: DROPDOWN_HEIGHT,
      fixed: true,
    },
    { id: "summary", kind: "nativeText", label: "Stations shown", value: "summary", align: "start", x: PAD, y: PAD + DROPDOWN_HEIGHT + 4, width: W - 2 * PAD, height: m.lines.label, fixed: true },
    // Under the map: who is picked, and the button to put them in the log.
    { id: "details", kind: "nativeText", label: "Selected station", value: "details", align: "start", x: PAD, y: bandBottom + 4, width: W - 2 * PAD, height: m.lines.body * 2, fixed: true },
    {
      id: "log",
      kind: "nativeButton",
      label: m.logLabel,
      icon: "book-plus",
      variant: "filled",
      event: "log",
      x: PAD,
      y: H - PAD - BUTTON_HEIGHT,
      width: W - 2 * PAD,
      height: BUTTON_HEIGHT,
      disabled: !m.canLog,
      fixed: true,
    },
  )

  return {
    version: 1,
    // As wide as the map, which the pane scrolls along; as tall as the pane.
    width: g.width,
    height: g.height,
    values: { scroll: m.scroll },
    strings: { band: m.band, region: m.region, summary: m.summary, details: m.details },
    layers,
    controls,
    scroll: { axis: "x", value: "scroll", event: "scrolled" },
  }
}

