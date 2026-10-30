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
// The list and the elements are the app's own offline datasets (see datasets.ts): the app downloads them, keeps them across restarts and
// refreshes them every few days, and this file reads the rows. AMSAT's reports are fetched here, and kept in memory for ten minutes.

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
/// The categories the two datasets are stored under, which is where the rows are read from.
export const LIST_CATEGORY = "km4be-satellite-list"
export const ORBITS_CATEGORY = "km4be-satellite-orbits"
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
    const norad = noradOf(s, corrections)
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

/// When each feed last failed, so a feed that is down is not asked for again on every redraw (the panel draws every minute) but after
/// `BACKOFF_MS`.
const failedAt = new Map<string, number>()
const BACKOFF_MS = 2 * 60_000
/// A slow server is given up on in this long, so that a render is not held for the host's whole allowance for one feed.
export const FETCH_TIMEOUT_MS = 8_000

/// For tests: forget which feeds have failed.
export const forgetFailures = (): void => failedAt.clear()

/// What has been fetched, by key.
const memory = new Map<string, Cached>()
onForget(() => {
  failedAt.clear()
  memory.clear()
  catalogMemo = undefined
  reading = undefined
  statusMemo = undefined
})

/// The copy under `key` while younger than `maxAge`; otherwise fetched and returned; and when the fetch fails, or one failed a moment
/// ago, whatever copy there is, however old. It is kept in memory only: a feed worth keeping longer is a dataset (datasets.ts).
export async function cachedJson(key: string, url: string, maxAge: number, now: number, ctx: HookContext): Promise<{ data: unknown; at: number } | null> {
  const have = memory.get(key) ?? null
  if (have && now >= have.at && now - have.at < maxAge) return { data: have.data, at: have.at }
  const failed = failedAt.get(key)
  const backingOff = failed !== undefined && now >= failed && now - failed < BACKOFF_MS
  if (ctx.online && !backingOff) {
    try {
      const response = await host.fetch(url, { timeout: FETCH_TIMEOUT_MS })
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`)
      const data = JSON.parse(response.body) as JSONValue
      memory.set(key, { at: now, data })
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
  /// When the newest element set was made; 0 when there are none.
  elementsAt: number
}

/// How long what has been read stands: the datasets change every few days, so a read is good for ten minutes, and while there is
/// nothing yet (the app is still downloading it) another is tried in a few seconds.
const READ_EVERY_MS = 10 * 60_000
const READ_AGAIN_MS = 3_000
/// Orbits are asked for this many at a time.
const READ_BATCH = 24

let catalogMemo: { readAt: number; catalog: Catalog } | undefined
let reading: Promise<Catalog> | undefined

/// The NORAD number a satellite is placed by, with our corrections applied; undefined where there is none to use.
export function noradOf(s: ListedSatellite, corrections: Record<string, CuratedInfo> = curated as Record<string, CuratedInfo>): number | undefined {
  const info = corrections[s.name] ?? {}
  return info.norad === null ? undefined : (info.norad ?? s.norad)
}

/// The moment an element set was made, in milliseconds: its epoch is UTC, though it is written without a zone.
const epochOf = (omm: Omm): number => {
  const at = Date.parse(/Z|[+-]\d\d:?\d\d$/.test(omm.EPOCH) ? omm.EPOCH : `${omm.EPOCH}Z`)
  return Number.isFinite(at) ? at : 0
}

async function readCatalog(): Promise<Catalog> {
  try {
    const rows = (await host.dbLookupSelectAll(LIST_CATEGORY, "")) as { key: string; name?: string; data?: Record<string, unknown> }[]
    // The app returns at most a hundred rows.
    if (rows.length >= 100) host.log("km4be-satellite-info: the satellite list is a hundred rows or more, and the app gives no more than that")
    const list = parseList([...rows].sort((a, b) => a.key.localeCompare(b.key, "en", { numeric: true })).map((r) => ({ name: r.name ?? r.key, ...(r.data ?? {}) })))
    const wanted = [...new Set(list.flatMap((s) => noradOf(s) ?? []))]
    const found: unknown[] = []
    for (let i = 0; i < wanted.length; i += READ_BATCH) {
      const batch = await Promise.all(wanted.slice(i, i + READ_BATCH).map((id) => host.dbLookupSelectOne(ORBITS_CATEGORY, String(id))))
      for (const row of batch) found.push(row?.data)
    }
    const elements = parseElements(found)
    let elementsAt = 0
    for (const omm of elements.values()) elementsAt = Math.max(elementsAt, epochOf(omm))
    return { satellites: buildCatalog(list, elements), elementsAt }
  } catch (error) {
    host.log(`km4be-satellite-info: reading the satellite datasets: ${error instanceof Error ? error.message : String(error)}`)
    return { satellites: [], elementsAt: 0 }
  }
}

/// The catalog from the app's datasets, read again at most every ten minutes. Until the app has downloaded them it is empty.
export async function loadCatalog(_ctx: HookContext, now: number): Promise<Catalog> {
  const memo = catalogMemo
  const complete = !!memo && memo.catalog.satellites.length > 0 && memo.catalog.elementsAt > 0
  if (memo && now >= memo.readAt && now - memo.readAt < (complete ? READ_EVERY_MS : READ_AGAIN_MS)) return memo.catalog
  // Panes asking together share one read.
  reading ??= readCatalog().finally(() => (reading = undefined))
  const catalog = await reading
  catalogMemo = { readAt: now, catalog }
  return catalog
}

/// Makes the copy of AMSAT's reports out of date, so the next read fetches them again: after an operator
/// has sent one, so that it shows up in the marks as soon as AMSAT has it.
export function expireStatus(): void {
  for (const [key, copy] of memory) if (key.startsWith("status-")) memory.set(key, { ...copy, at: 0 })
  failedAt.clear()
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
