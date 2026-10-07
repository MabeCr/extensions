// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// POTA's activator spots turned into map markers. The API gives each spot the
// park's latitude and longitude, so there is no park table to carry and no
// per-park lookup.

import { bandForFrequency } from "@ham2k/lib-operation-data"

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

const MARKER_RADIUS = 3.2

/// The markers as a self-contained SVG document the size of the map. Oldest
/// first, so the freshest spot is on top where parks overlap.
export function markersSvg(spots: MapSpot[]): string {
  const dots = [...spots]
    .reverse()
    .map((s) => {
      const { x, y } = project(s.lat, s.lon)
      return `<circle cx="${x}" cy="${y}" r="${MARKER_RADIUS}" fill="${BAND_COLORS[s.band] ?? BAND_COLORS.other}"/>`
    })
    .join("")
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MAP_WIDTH} ${MAP_HEIGHT}"><g stroke="#000" stroke-opacity="0.55" stroke-width="0.8">${dots}</g></svg>`
}

export function summary(shown: number, total: number, band: string): string {
  const noun = (n: number) => `${n} ${n === 1 ? "activator" : "activators"}`
  return band === "all" ? noun(total) : `${noun(shown)} on ${band} (of ${total})`
}
