// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// The spots on the map are the host's own: the board the Spots panel shows, from every source the operator has, through
// `ctx.getSpots`. A board spot says what it is at by a reference (`US-1234` of type `pota`) and carries no coordinates, so a
// spot is placed by looking its reference up in the table the award's own extension keeps (`dbLookupSelectOne`, whose category is
// the reference's type). A spot with no reference, a DX cluster spot say, or one whose award is not installed, has no place.

import { host } from "@ham2k/extension-sdk"
import type { BoardSpot, GetSpotsOptions, HookContext } from "@ham2k/extension-sdk"

import { bandOf } from "./spots.ts"
import type { MapSpot } from "./spots.ts"

interface Place {
  lat: number
  lon: number
  name: string
}

/// Where each reference is, once looked up: a park does not move, so it is asked for once. A reference that was not found is
/// asked for again after ten minutes, since the table it is in may arrive after the map does.
const places = new Map<string, { at: number; place: Place | null }>()
const MISS_MILLIS = 10 * 60_000
/// How many lookups go at once.
const BATCH = 24

/// For tests: forget every place.
export const forgetPlaces = (): void => places.clear()

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n)

async function lookup(type: string, ref: string, now: number): Promise<Place | null> {
  const key = `${type}/${ref}`
  const seen = places.get(key)
  if (seen && (seen.place || now - seen.at < MISS_MILLIS)) return seen.place
  let place: Place | null = null
  try {
    const row = await host.dbLookupSelectOne(type, ref)
    if (row && finite(row.lat) && finite(row.lon) && Math.abs(row.lat) <= 90 && Math.abs(row.lon) <= 180) place = { lat: row.lat, lon: row.lon, name: row.name ?? "" }
  } catch (error) {
    host.log(`km4be-spot-maps: looking up ${key}: ${error instanceof Error ? error.message : String(error)}`)
  }
  places.set(key, { at: now, place })
  return place
}

export interface Board {
  /// Every spot the board gave, placed or not.
  total: number
  /// The ones with a place, one per station (its newest), newest first.
  spots: MapSpot[]
  /// Whether the host answers for the board at all.
  available: boolean
}

export interface BoardOptions {
  /// The operator's own filtered board, or all of it.
  filter: "user" | "all"
  maxAgeMinutes: number
  operationUuid?: string
}

/// The board, placed.
export async function loadBoard(ctx: HookContext, options: BoardOptions, now: number): Promise<Board> {
  if (typeof ctx.getSpots !== "function") return { total: 0, spots: [], available: false }
  const ask: GetSpotsOptions = { filter: options.filter, maxAgeMinutes: options.maxAgeMinutes, annotate: true }
  if (options.operationUuid) ask.operationUuid = options.operationUuid
  let board: BoardSpot[] = []
  try {
    board = await ctx.getSpots(ask)
  } catch (error) {
    host.log(`km4be-spot-maps: the board: ${error instanceof Error ? error.message : String(error)}`)
  }
  return { total: board.length, spots: await place(board, now), available: true }
}

/// Board spots as map spots: one per station, the newest, with a place. The references are looked up a few at a time.
export async function place(board: BoardSpot[], now: number): Promise<MapSpot[]> {
  // The newest spot of each station first, so that its reference is the one looked up.
  const newest = new Map<string, BoardSpot>()
  for (const s of board) {
    const call = (s.their?.call ?? "").trim().toUpperCase()
    if (!call) continue
    const seen = newest.get(call)
    if (!seen || (s.spot?.timeInMillis ?? 0) > (seen.spot?.timeInMillis ?? 0)) newest.set(call, s)
  }
  const wanted = new Map<string, { type: string; ref: string }>()
  for (const s of newest.values()) for (const r of s.refs ?? []) if (r?.type && r?.ref) wanted.set(`${r.type}/${r.ref}`, { type: r.type, ref: r.ref })
  const keys = [...wanted.values()]
  for (let i = 0; i < keys.length; i += BATCH) await Promise.all(keys.slice(i, i + BATCH).map((k) => lookup(k.type, k.ref, now)))

  const spots: MapSpot[] = []
  for (const [call, s] of newest) {
    for (const r of s.refs ?? []) {
      const found = places.get(`${r.type}/${r.ref}`)?.place
      if (!found) continue
      const freq = s.freq ?? 0
      spots.push({
        call,
        band: bandOf(s.band, freq),
        freq,
        mode: s.mode ?? "",
        ref: r.ref,
        refType: r.type,
        park: found.name,
        label: s.spot?.label ?? "",
        lat: found.lat,
        lon: found.lon,
        millis: s.spot?.timeInMillis ?? 0,
        source: s.spot?.source ?? "",
        worked: s.annotations?.worked === true,
      })
      break
    }
  }
  return spots.sort((a, b) => b.millis - a.millis || a.call.localeCompare(b.call))
}
