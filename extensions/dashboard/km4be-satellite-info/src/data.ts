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

export const LIST_URL = "https://polo.ham2k.com/data/satellites.json"
export const ELEMENTS_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=amateur&FORMAT=json"
const LIST_MAX_AGE_MS = 24 * 3_600_000
const ELEMENTS_MAX_AGE_MS = 6 * 3_600_000

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
  /// The right NORAD number, where the list's is wrong.
  norad?: number
  /// Names AMSAT's status page knows it by, when not the list's own name.
  amsat?: string[]
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
    const norad = info.norad ?? s.norad
    return { ...s, norad, info, omm: norad === undefined ? undefined : elements.get(norad) }
  })
}

interface Cached {
  at: number
  data: JSONValue
}

/// The copy under `key` in the device's storage while younger than `maxAge`; otherwise fetched,
/// stored and returned; and when the fetch fails, whatever copy there is, however old.
async function cachedJson(key: string, url: string, maxAge: number, now: number, ctx: HookContext): Promise<{ data: unknown; at: number } | null> {
  const stored = (await host.kvGet(key)) as Cached | null
  const have = stored && typeof stored.at === "number" ? stored : null
  if (have && now - have.at < maxAge) return { data: have.data, at: have.at }
  if (ctx.online) {
    try {
      const response = await host.fetch(url)
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`)
      const data = JSON.parse(response.body) as JSONValue
      await host.kvSet(key, { at: now, data } satisfies Cached)
      return { data, at: now }
    } catch (error) {
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

export async function loadCatalog(ctx: HookContext, now: number): Promise<Catalog> {
  const [list, elements] = await Promise.all([
    cachedJson("list", LIST_URL, LIST_MAX_AGE_MS, now, ctx),
    cachedJson("elements", ELEMENTS_URL, ELEMENTS_MAX_AGE_MS, now, ctx),
  ])
  return {
    satellites: buildCatalog(parseList(list?.data), parseElements(elements?.data)),
    elementsAt: elements?.at ?? 0,
  }
}
