// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// A pass drawn the way it is seen: a polar plot of the sky, north up, the
// horizon at the edge and straight overhead at the center, with the satellite's
// path across it.

import { lookAt } from "./orbit.ts"
import type { Observer, Pass } from "./orbit.ts"
import type { SatRec } from "./vendor/satellite.js/index.js"

/// The plot's square, in scene units.
export const SKY_SIZE = 360
const CENTER = SKY_SIZE / 2
/// Radius of the horizon ring, leaving room for the compass letters outside it.
const RADIUS = 150

/// The sizes of what is drawn on the plot, which text written on it has to keep clear of.
export const DOT_RADIUS = { end: 6, peak: 5, now: 11, arrow: 10 }

export interface SkyPoint {
  azimuth: number
  elevation: number
  at: number
}

/// Where the satellite is in the sky, every `stepMs` from rise to set (both ends included).
export function skyTrack(satrec: SatRec, observer: Observer, pass: Pass, stepMs = 10_000): SkyPoint[] {
  const points: SkyPoint[] = []
  const at = (t: number) => {
    const look = lookAt(satrec, observer, t)
    if (look) points.push({ azimuth: look.azimuth, elevation: Math.max(0, look.elevation), at: t })
  }
  for (let t = pass.aos; t < pass.los; t += stepMs) at(t)
  at(pass.los)
  return points
}

/// A point of the sky on the plot: azimuth clockwise from north, elevation 0 at the rim and 90 at the center.
export function skyXY(azimuth: number, elevation: number): { x: number; y: number } {
  const r = ((90 - Math.min(90, Math.max(0, elevation))) / 90) * RADIUS
  const a = (azimuth * Math.PI) / 180
  return { x: +(CENTER + r * Math.sin(a)).toFixed(1), y: +(CENTER - r * Math.cos(a)).toFixed(1) }
}

export interface SkyColors {
  /// Rings and crosshair.
  grid: string
  /// The path.
  path: string
  rise: string
  peak: string
  set: string
}

export const DEFAULT_SKY_COLORS: SkyColors = { grid: "#8a8a8a", path: "#4aa3ff", rise: "#3ac46b", peak: "#ffffff", set: "#ff5a5a" }

/// The plot as a self-contained SVG document: rings at 0, 30 and 60 degrees, a
/// crosshair on the compass points, the path, and dots for rise, peak and set. The
/// compass letters are text layers (see `compassLayers`), not drawn here.
export function skySvg(track: SkyPoint[], pass: Pass, colors: SkyColors = DEFAULT_SKY_COLORS, now?: number): string {
  const ring = (elevation: number) => `<circle cx="${CENTER}" cy="${CENTER}" r="${+(((90 - elevation) / 90) * RADIUS).toFixed(1)}"/>`
  const grid =
    `<g fill="none" stroke="${colors.grid}" stroke-opacity="0.6" stroke-width="1">${[0, 30, 60].map(ring).join("")}` +
    `<path d="M${CENTER} ${CENTER - RADIUS}V${CENTER + RADIUS}M${CENTER - RADIUS} ${CENTER}H${CENTER + RADIUS}"/></g>`

  const line = track.map((p, i) => {
    const { x, y } = skyXY(p.azimuth, p.elevation)
    return `${i ? "L" : "M"}${x} ${y}`
  })
  const path = line.length > 1 ? `<path d="${line.join("")}" fill="none" stroke="${colors.path}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` : ""

  const dot = (azimuth: number, elevation: number, fill: string, r = DOT_RADIUS.end) => {
    const { x, y } = skyXY(azimuth, elevation)
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="#000" stroke-opacity="0.5" stroke-width="1"/>`
  }
  const head = arrowHead(track, pass, colors.path)
  const first = track[0]
  const last = track[track.length - 1]
  const dots = [
    first ? dot(first.azimuth, first.elevation, colors.rise) : "",
    last ? dot(last.azimuth, last.elevation, colors.set) : "",
    dot(pass.maxAzimuth, pass.maxElevation, colors.peak, DOT_RADIUS.peak),
  ].join("")

  // Where it is right now, if the pass is under way: a ring around its place on the path.
  const here = nowSpot(track, pass, now)
  const current = here ? `<circle cx="${here.x}" cy="${here.y}" r="${DOT_RADIUS.now}" fill="none" stroke="${colors.peak}" stroke-width="2"/>` : ""

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SKY_SIZE} ${SKY_SIZE}">${grid}${path}${dots}${head}${current}</svg>`
}

/// Where the satellite is on the plot at `now`, when the pass is under way; null otherwise.
export function nowSpot(track: SkyPoint[], pass: Pass, now?: number): { x: number; y: number } | null {
  if (now === undefined || now < pass.aos || now > pass.los || !track.length) return null
  const near = track.reduce((best, p) => (Math.abs(p.at - now) < Math.abs(best.at - now) ? p : best))
  return skyXY(near.azimuth, near.elevation)
}

/// How far from the peak along the path the arrowhead sits, in plot units: clear of the peak's
/// dot, and not so far it is out by the rim.
const ARROW_OFFSET = 30

/// An arrowhead on the path a little past the peak, pointing the way the satellite is going, so
/// the plot says which end is the rise without anyone reading the colors. A pass that peaks at the
/// very end has no path past the peak, and the head is put before it instead.
export function arrowHead(track: SkyPoint[], pass: Pass, color: string): string {
  const spot = arrowSpot(track, pass)
  if (!spot) return ""
  const { p, d } = spot
  const n = { x: -d.y, y: d.x }
  const corner = (along: number, across: number) => `${+(p.x + d.x * along + n.x * across).toFixed(1)} ${+(p.y + d.y * along + n.y * across).toFixed(1)}`
  return `<path d="M${corner(9, 0)}L${corner(-5, 7)}L${corner(-5, -7)}Z" fill="${color}" stroke="#000" stroke-opacity="0.55" stroke-width="1" stroke-linejoin="round"/>`
}

/// Where the arrowhead goes and which way it points (a unit vector); null when the path is too short for one.
export function arrowSpot(track: SkyPoint[], pass: Pass): { p: { x: number; y: number }; d: { x: number; y: number } } | null {
  if (track.length < 3) return null
  const pts = track.map((p) => skyXY(p.azimuth, p.elevation))
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(b.x - a.x, b.y - a.y)
  const peak = track.reduce((best, p, i) => (Math.abs(p.at - pass.maxElevationAt) < Math.abs(track[best].at - pass.maxElevationAt) ? i : best), 0)

  const walk = (step: 1 | -1) => {
    let i = peak
    let run = 0
    while (i + step >= 0 && i + step < pts.length && run < ARROW_OFFSET) {
      run += dist(pts[i], pts[i + step])
      i += step
    }
    return { i, run }
  }
  const ahead = walk(1)
  const at = ahead.run >= ARROW_OFFSET / 2 ? ahead.i : walk(-1).i

  const from = pts[Math.max(0, at - 1)]
  const to = pts[Math.min(pts.length - 1, at + 1)]
  const length = dist(from, to)
  if (!length) return null
  return { p: pts[at], d: { x: (to.x - from.x) / length, y: (to.y - from.y) / length } }
}

/// N, E, S and W as text layers just outside the rim: SVG text is not a portable text path.
export function compassLayers(color: string) {
  const letter = (id: string, text: string, x: number, y: number) => ({
    id,
    x,
    y,
    width: 24,
    height: 22,
    text: { literal: text, size: 15, color, align: "center" as const, fontWeight: 600 },
  })
  return [
    letter("north", "N", CENTER - 12, 0),
    letter("south", "S", CENTER - 12, SKY_SIZE - 22),
    letter("east", "E", SKY_SIZE - 24, CENTER - 11),
    letter("west", "W", 0, CENTER - 11),
  ]
}
