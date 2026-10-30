// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// The stations on the map, and what is said of them. Where they come from is board.ts.

import { bandForFrequency } from "@ham2k/lib-operation-data"

export interface MapSpot {
  call: string
  band: string
  /// kHz, as the board gives it; 0 when it gave none.
  freq: number
  mode: string
  /// The reference the station is at, and what kind it is (`pota`, `sota`, ...), which is also where its place was looked up.
  ref: string
  refType: string
  park: string
  /// The source's own words about the spot, such as `US-1234: A Park • CT`.
  label: string
  lat: number
  lon: number
  millis: number
  /// Which spot source it came from, for the details.
  source: string
  /// Whether the operation has already worked the station, as the board says it.
  worked: boolean
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

/// The band a spot is on: the one the board names if the map has a color for it, else the one its frequency is in, else `other`.
export const bandOf = (band: string | undefined, freqKHz: number): string => (band && band in BAND_COLORS ? band : (freqKHz && bandForFrequency(freqKHz)) || "other")

/// `band` is a band name, or `all`.
export const filterBand = (spots: MapSpot[], band: string): MapSpot[] => (band === "all" ? spots : spots.filter((s) => s.band === band))

const ago = (millis: number): string => {
  const minutes = Math.max(0, Math.round(millis / 60_000))
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min ago`
}

/// The lines under the map for the selected station.
export function detailsLine(spot: MapSpot | undefined, nowMillis: number): string {
  if (!spot) return "Tap a dot to see who it is."
  const tuned = [spot.band, spot.mode, spot.freq ? `${spot.freq} kHz` : ""].filter(Boolean).join(" ")
  const where = spot.label || [spot.ref, spot.park].filter(Boolean).join(" ")
  const when = spot.millis ? ago(nowMillis - spot.millis) : ""
  return [spot.call, tuned, where, when, spot.worked ? "worked before" : ""].filter(Boolean).join(" · ")
}

/// `HH:MMZ`, the clock the spots are posted in.
export const clockUtc = (millis: number): string => new Date(millis).toISOString().slice(11, 16) + "Z"

/// How many stations are on the map, of how many the board has: the ones on a band, and the ones there is no place for.
export function summary(shown: number, placed: number, unplaced: number, band: string): string {
  const noun = (n: number) => `${n} ${n === 1 ? "station" : "stations"}`
  const base = band === "all" ? noun(placed) : `${noun(shown)} on ${band} (of ${placed})`
  return unplaced > 0 ? `${base} · ${unplaced} with no place` : base
}
