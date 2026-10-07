// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// POTA's activator spots turned into map markers. The API gives each spot the
// park's latitude and longitude, so there is no park table to carry and no
// per-park lookup.

import { bandForFrequency } from "@ham2k/lib-operation-data"

import { onScreen, toScene, WORLD } from "./view.ts"
import type { View } from "./view.ts"
import { MAP_HEIGHT, MAP_TOP, MAP_WIDTH } from "./world.ts"

/// One element of `https://api.pota.app/spot/activator`, as far as the map reads it.
export interface PotaApiSpot {
  activator?: string
  frequency?: string
  mode?: string
  reference?: string
  name?: string
  spotTime?: string
  comments?: string
  latitude?: number | null
  longitude?: number | null
}

export interface MapSpot {
  call: string
  band: string
  /// kHz, as POTA reports it; 0 when it gave none.
  freq: number
  mode: string
  ref: string
  park: string
  lat: number
  lon: number
  millis: number
}

export const BANDS = ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m", "2m", "70cm"] as const

/// One hue to a band, the low bands warm and the high ones cool, so a cluster
/// reads as "the same band" at a glance. `other` is for what the table lacks.
export const BAND_COLORS: Record<string, string> = {
  "160m": "#8c564b",
  "80m": "#d62728",
  "60m": "#ff7f0e",
  "40m": "#e6ab02",
  "30m": "#bcbd22",
  "20m": "#2ca02c",
  "17m": "#17becf",
  "15m": "#1f77b4",
  "12m": "#9467bd",
  "10m": "#e377c2",
  "6m": "#f4a6d7",
  "2m": "#c7c7c7",
  "70cm": "#ffffff",
  other: "#8a8a8a",
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n)

/// Spots that can be placed, one per activator (their newest), newest first. A
/// QRT spot, or one with no coordinates, has nothing to draw.
export function parseSpots(raw: PotaApiSpot[]): MapSpot[] {
  const byCall = new Map<string, MapSpot>()
  for (const s of raw) {
    const call = (s.activator ?? "").trim().toUpperCase()
    if (!call || /QRT/i.test(s.comments ?? "")) continue
    if (!finite(s.latitude) || !finite(s.longitude)) continue
    if (Math.abs(s.latitude) > 90 || Math.abs(s.longitude) > 180) continue

    const millis = Date.parse((s.spotTime ?? "") + "Z")
    const seen = byCall.get(call)
    if (seen && (Number.isNaN(millis) ? 0 : millis) <= seen.millis) continue

    const freq = parseFloat(s.frequency ?? "")
    byCall.set(call, {
      call,
      band: (freq && bandForFrequency(freq)) || "other",
      freq: freq || 0,
      mode: s.mode ?? "",
      ref: s.reference ?? "",
      park: s.name ?? "",
      lat: s.latitude,
      lon: s.longitude,
      millis: Number.isNaN(millis) ? 0 : millis,
    })
  }
  return [...byCall.values()].sort((a, b) => b.millis - a.millis || a.call.localeCompare(b.call))
}

/// Where a coordinate falls in the map's own units (see world.ts).
export function project(lat: number, lon: number): { x: number; y: number } {
  const y = (MAP_TOP - Math.max(MAP_TOP - MAP_HEIGHT / 2, Math.min(MAP_TOP, lat))) * 2
  return { x: +((lon + 180) * 2).toFixed(1), y: +y.toFixed(1) }
}

/// `band` is a band name, or `all`.
export const filterBand = (spots: MapSpot[], band: string): MapSpot[] =>
  band === "all" ? spots : spots.filter((s) => s.band === band)

export const MARKER_RADIUS = 3.2

/// A scene allows 64 controls and the pane's own take eight, so only the newest
/// dots on screen can be clicked; the picker reaches the rest.
export const MAX_CLICKABLE = 56

/// A spot in scene units under `view`.
const placed = (s: MapSpot, view: View) => toScene(view, project(s.lat, s.lon))

/// The spots inside the window, newest first. A dot half off the edge counts.
export const visibleSpots = (spots: MapSpot[], view: View = WORLD): MapSpot[] =>
  spots.filter((s) => onScreen(placed(s, view), MARKER_RADIUS * 2.2))

/// The click target for a dot: exactly the dot, centered on it.
export function dotHitArea(spot: MapSpot, view: View = WORLD): { x: number; y: number; width: number; height: number } {
  const { x, y } = placed(spot, view)
  const size = MARKER_RADIUS * 2
  return { x: +(x - MARKER_RADIUS).toFixed(1), y: +(y - MARKER_RADIUS).toFixed(1), width: size, height: size }
}

/// The markers as a self-contained SVG document the size of the scene. Oldest
/// first, so the freshest spot is on top where parks overlap. Dots keep their
/// size however far the map is zoomed. The `selected` call, if it is among
/// them, is ringed and drawn last of all.
export function markersSvg(spots: MapSpot[], selected = "", view: View = WORLD): string {
  const dot = (s: MapSpot) => {
    const { x, y } = placed(s, view)
    return `<circle cx="${x}" cy="${y}" r="${MARKER_RADIUS}" fill="${BAND_COLORS[s.band] ?? BAND_COLORS.other}"/>`
  }
  const ring = (s: MapSpot) => {
    const { x, y } = placed(s, view)
    return `<circle cx="${x}" cy="${y}" r="${MARKER_RADIUS * 2.2}" fill="none" stroke="#fff" stroke-width="1.6"/>`
  }
  const chosen = spots.find((s) => s.call === selected)
  const dots = visibleSpots(spots, view).reverse().map(dot).join("")
  const picked = chosen && onScreen(placed(chosen, view), MARKER_RADIUS * 2.2) ? ring(chosen) + dot(chosen) : ""
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MAP_WIDTH} ${MAP_HEIGHT}"><g stroke="#000" stroke-opacity="0.55" stroke-width="0.8">${dots}</g>${picked}</svg>`
}

/// A dropdown holds at most 64 options; the newest spots are the ones listed.
export const MAX_PICKER_SPOTS = 60

export function spotOptions(spots: MapSpot[]): { label: string; value: string }[] {
  return [
    { label: "No station selected", value: "" },
    ...spots.slice(0, MAX_PICKER_SPOTS).map((s) => ({ label: `${s.call} · ${s.band} · ${s.ref}`, value: s.call })),
  ]
}

const ago = (millis: number): string => {
  const minutes = Math.max(0, Math.round(millis / 60_000))
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min ago`
}

/// The line under the map for the selected station.
export function detailsLine(spot: MapSpot | undefined, nowMillis: number): string {
  if (!spot) return "Pick a station to see where it is."
  const tuned = [spot.band, spot.mode, spot.freq ? `${spot.freq} kHz` : ""].filter(Boolean).join(" ")
  const where = [spot.ref, spot.park].filter(Boolean).join(" ")
  const when = spot.millis ? ago(nowMillis - spot.millis) : ""
  return [spot.call, tuned, where, when].filter(Boolean).join(" · ")
}

/// `HH:MMZ`, the clock the spots are posted in.
export const clockUtc = (millis: number): string => new Date(millis).toISOString().slice(11, 16) + "Z"

export function summary(shown: number, total: number, band: string): string {
  const noun = (n: number) => `${n} ${n === 1 ? "activator" : "activators"}`
  return band === "all" ? noun(total) : `${noun(shown)} on ${band} (of ${total})`
}
