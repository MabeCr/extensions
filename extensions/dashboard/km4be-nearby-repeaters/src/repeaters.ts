// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// Repeaters from a pasted CSV, and the arithmetic to sort them by distance.
//
// No repeater directory is queried: RepeaterBook's API wants an approved app
// token, so the operator pastes an export instead. The columns are found by
// header name, since RepeaterBook, CHIRP and a hand-made list each spell them
// differently. Only an output frequency is required; without a latitude and
// longitude a repeater cannot be placed, and is listed after those that can.

export interface Repeater {
  call: string
  place: string
  /// Output (what you listen to), MHz.
  freq: number
  /// Signed offset to transmit on, MHz. 0 for simplex.
  offset: number
  /// CTCSS tone to transmit, Hz, or 0 for none.
  tone: number
  lat?: number
  lon?: number
}

export interface Ranked extends Repeater {
  km?: number
}

const ALIASES: Record<string, string[]> = {
  freq: ["frequency", "freq", "output", "output freq", "output frequency"],
  offset: ["offset"],
  duplex: ["duplex"],
  tone: ["tone", "uplink tone", "pl", "ctcss", "rtonefreq"],
  lat: ["lat", "latitude"],
  lon: ["lon", "long", "lng", "longitude"],
  call: ["call", "callsign"],
  place: ["name", "location", "city", "nearest city"],
}

/// A CSV split into rows of cells. Quoted cells may hold commas and doubled quotes.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ",") { row.push(cell); cell = "" }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++
      row.push(cell); cell = ""
      if (row.some((x) => x.trim())) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some((x) => x.trim())) rows.push(row)
  return rows
}

const num = (s: string | undefined): number | undefined => {
  const n = Number.parseFloat((s ?? "").trim())
  return Number.isFinite(n) ? n : undefined
}

export function parseRepeaters(text: string): Repeater[] {
  const [header, ...rows] = parseCsv(text)
  if (!header) return []
  const names = header.map((h) => h.trim().toLowerCase())
  const col = (key: string): number => ALIASES[key].map((a) => names.indexOf(a)).find((i) => i >= 0) ?? -1

  const [iFreq, iOffset, iDuplex, iTone, iLat, iLon, iCall, iPlace] =
    ["freq", "offset", "duplex", "tone", "lat", "lon", "call", "place"].map(col)
  if (iFreq < 0) return []

  const out: Repeater[] = []
  for (const r of rows) {
    const freq = num(r[iFreq])
    if (freq === undefined || freq <= 0) continue
    let offset = iOffset >= 0 ? (num(r[iOffset]) ?? 0) : 0
    // CHIRP gives an unsigned offset and the direction in a Duplex column.
    const duplex = iDuplex >= 0 ? (r[iDuplex] ?? "").trim() : ""
    if (duplex === "-") offset = -Math.abs(offset)
    else if (duplex === "+") offset = Math.abs(offset)
    else if (duplex === "") { /* keep the sign as written */ }
    else offset = 0
    const lat = iLat >= 0 ? num(r[iLat]) : undefined
    const lon = iLon >= 0 ? num(r[iLon]) : undefined
    const placed = lat !== undefined && lon !== undefined && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
    out.push({
      call: (iCall >= 0 ? r[iCall] ?? "" : "").trim().toUpperCase(),
      place: (iPlace >= 0 ? r[iPlace] ?? "" : "").trim(),
      freq, offset,
      tone: iTone >= 0 ? (num(r[iTone]) ?? 0) : 0,
      ...(placed ? { lat, lon } : {}),
    })
  }
  return out
}

/// Great-circle distance in kilometers.
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)))
}

/// Nearest first. With no position, or for repeaters with none, order is by frequency after the placed ones.
export function rankRepeaters(list: Repeater[], here: { lat: number; lon: number } | null, max: number): Ranked[] {
  const ranked: Ranked[] = list.map((r) =>
    here && r.lat !== undefined && r.lon !== undefined ? { ...r, km: distanceKm(here.lat, here.lon, r.lat, r.lon) } : { ...r })
  ranked.sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity) || a.freq - b.freq)
  return ranked.slice(0, max)
}

/// US national simplex calling channels, MHz.
export const SIMPLEX: { freq: number; label: string }[] = [
  { freq: 52.525, label: "6m FM calling" },
  { freq: 146.52, label: "2m FM calling" },
  { freq: 223.5, label: "1.25m FM calling" },
  { freq: 446.0, label: "70cm FM calling" },
]
