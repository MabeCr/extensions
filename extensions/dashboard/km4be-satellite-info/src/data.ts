// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// The catalog: the satellites worth showing, the orbital elements that place
// them, and what we know about each that the feeds do not say.
//
//   list      polo.ham2k.com/data/satellites.json   name, NORAD number, uplinks and downlinks
//   elements  CelesTrak, the `amateur` group (OMM JSON)   where each bird is
//   curated   data/satellites.json (ours)           what the feeds get wrong or lack
//
// Both feeds are cached on the device and a failed fetch falls back to the
// last good copy, so a flaky connection on a hilltop shows stale data rather
// than none. CelesTrak asks to be polled no more than every couple of hours.

import { host } from "@ham2k/extension-sdk"
import type { HookContext, JSONValue } from "@ham2k/extension-sdk"

import curated from "./data/satellites.json" with { type: "json" }
import type { Omm } from "./orbit.ts"
import { onForget } from "./memory.ts"
import { parseSummary } from "./status.ts"
import type { StatusRow } from "./status.ts"

export const LIST_URL = "https://polo.ham2k.com/data/satellites.json"
export const ELEMENTS_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=amateur&FORMAT=json"
export const statusUrl = (hours: number): string => `https://amsat.org/status/api/v1/summary.php?hours=${hours}`
const LIST_MAX_AGE_MS = 24 * 3_600_000
const ELEMENTS_MAX_AGE_MS = 6 * 3_600_000
const STATUS_MAX_AGE_MS = 10 * 60_000

export interface Link {
  mode: string
  lowerMHz: number
  upperMHz: number
}

/// One bird as the Ham2K list gives it.
export interface ListedSatellite {
  name: string
  norad?: number
  modulation: string
  uplinks: Link[]
  downlinks: Link[]
}

/// What we add to a bird, from data/satellites.json. Every field is optional.
export interface CuratedInfo {
  /// The right NORAD number, where the list's is wrong; null when the list's is wrong and
  /// the right one is not known, so no orbit is used rather than another satellite's.
  norad?: number | null
  /// Names AMSAT's status page knows it by, when not the list's own name.
  amsat?: string[]
  /// Replace the list's frequencies, where they are wrong.
  uplinks?: Link[]
  downlinks?: Link[]
  /// How a linear transponder turns sidebands over: `inverting`, `non-inverting`, or a note where it
  /// differs by mode. Only for the satellites an authority states it of.
  inversion?: string
  ctcssHz?: number
  beaconMHz?: number
  links?: { label: string; url: string }[]
  tips?: string
}

export interface Satellite extends ListedSatellite {
  info: CuratedInfo
  /// Absent for a bird CelesTrak publishes no elements for: it is listed, but no pass can be worked out.
  omm?: Omm
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined)
const str = (v: unknown): string => (typeof v === "string" ? v : "")

function parseLinks(v: unknown): Link[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((l) => {
    const lower = num(l?.lowerMHz)
    const upper = num(l?.upperMHz)
    return lower === undefined || upper === undefined ? [] : [{ mode: str(l?.mode), lowerMHz: lower, upperMHz: upper }]
  })
}

/// The list's entries that have a name, with the rest read defensively: it is a
/// hand-kept file with typos in it (see data/satellites.json).
export function parseList(raw: unknown): ListedSatellite[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((e) => {
    const name = str(e?.name).trim()
    if (!name) return []
    return [{ name, norad: num(e?.number), modulation: str(e?.modulation), uplinks: parseLinks(e?.uplinks), downlinks: parseLinks(e?.downlinks) }]
  })
}

/// CelesTrak's OMM objects by NORAD number.
export function parseElements(raw: unknown): Map<number, Omm> {
  const out = new Map<number, Omm>()
  if (!Array.isArray(raw)) return out
  for (const e of raw) {
    const id = num(e?.NORAD_CAT_ID)
    if (id !== undefined && typeof e?.EPOCH === "string") out.set(id, e as Omm)
  }
  return out
}

/// The list joined to the elements, with our corrections applied first. A
/// correction can only fill in or replace; a bird is never dropped here.
export function buildCatalog(
  list: ListedSatellite[],
  elements: Map<number, Omm>,
  corrections: Record<string, CuratedInfo> = curated as Record<string, CuratedInfo>,
): Satellite[] {
  return list.map((s) => {
    const info = corrections[s.name] ?? {}
    const norad = info.norad === null ? undefined : (info.norad ?? s.norad)
    return {
      ...s,
      norad,
      uplinks: info.uplinks ?? s.uplinks,
      downlinks: info.downlinks ?? s.downlinks,
      info,
      omm: norad === undefined ? undefined : elements.get(norad),
    }
  })
}

interface Cached {
  at: number
  data: JSONValue
}

/// When each feed last failed, so a feed that is down is not asked for again on every redraw
/// (the panel draws every minute) but after `BACKOFF_MS`.
const failedAt = new Map<string, number>()
const BACKOFF_MS = 2 * 60_000

/// For tests: forget which feeds have failed.
export const forgetFailures = (): void => failedAt.clear()

/// What has been read or fetched, by key: the same copies as the device's storage holds, kept
/// where they cost nothing to read. Storage is read once, the first time a key is wanted.
const memory = new Map<string, Cached>()
onForget(() => {
  failedAt.clear()
  memory.clear()
  catalogMemo = undefined
  statusMemo = undefined
})

/// The copy under `key` while younger than `maxAge`; otherwise fetched, stored and returned; and
/// when the fetch fails, or one failed a moment ago, whatever copy there is, however old. The copy
/// comes from memory if it has been read before, and from the device's storage if not.
export async function cachedJson(key: string, url: string, maxAge: number, now: number, ctx: HookContext): Promise<{ data: unknown; at: number } | null> {
  let have = memory.get(key) ?? null
  if (!have) {
    const stored = (await host.kvGet(key)) as Cached | null
    have = stored && typeof stored.at === "number" ? stored : null
    if (have) memory.set(key, have)
  }
  if (have && now >= have.at && now - have.at < maxAge) return { data: have.data, at: have.at }
  const failed = failedAt.get(key)
  const backingOff = failed !== undefined && now >= failed && now - failed < BACKOFF_MS
  if (ctx.online && !backingOff) {
    try {
      const response = await host.fetch(url)
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`)
      const data = JSON.parse(response.body) as JSONValue
      const fresh = { at: now, data } satisfies Cached
      memory.set(key, fresh)
      await host.kvSet(key, fresh)
      failedAt.delete(key)
      return { data, at: now }
    } catch (error) {
      failedAt.set(key, now)
      host.log(`km4be-satellite-info: ${url}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return have ? { data: have.data, at: have.at } : null
}

export interface Catalog {
  satellites: Satellite[]
  /// When the element sets were fetched; 0 when there are none.
  elementsAt: number
}

/// The catalog as last built, and which copies of the feeds it was built from. Building it is
/// reading a hundred orbits and a list of satellites, which is only worth doing when a feed has
/// changed, not at every redraw.
let catalogMemo: { listAt: number; elementsAt: number; catalog: Catalog } | undefined

export async function loadCatalog(ctx: HookContext, now: number): Promise<Catalog> {
  const [list, elements] = await Promise.all([
    cachedJson("list", LIST_URL, LIST_MAX_AGE_MS, now, ctx),
    cachedJson("elements", ELEMENTS_URL, ELEMENTS_MAX_AGE_MS, now, ctx),
  ])
  const listAt = list?.at ?? 0
  const elementsAt = elements?.at ?? 0
  if (catalogMemo && catalogMemo.listAt === listAt && catalogMemo.elementsAt === elementsAt) return catalogMemo.catalog

  const catalog = { satellites: buildCatalog(parseList(list?.data), parseElements(elements?.data)), elementsAt }
  catalogMemo = { listAt, elementsAt, catalog }
  return catalog
}

/// AMSAT's report summary for the last `hours`, kept ten minutes, and the last good copy if the
/// fetch fails; empty when there is none at all. Reports come in a few an hour, so the panel's
/// minute-by-minute redraws have no business asking for them that often.
export async function loadStatus(ctx: HookContext, now: number, hours: number): Promise<StatusRow[]> {
  const summary = await cachedJson(`status-${hours}`, statusUrl(hours), STATUS_MAX_AGE_MS, now, ctx)
  const key = `${hours}|${summary?.at ?? 0}`
  if (statusMemo?.key === key) return statusMemo.rows
  const rows = parseSummary(summary?.data)
  statusMemo = { key, rows }
  return rows
}

let statusMemo: { key: string; rows: StatusRow[] } | undefined
