// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// The two files the catalog is made of, as the app's own offline datasets (`dataFile`): the app downloads each one, keeps it in its
// database, and refreshes it when it is older than `maxAgeInDays`, on its own schedule and whether or not this panel is open. That is
// what lets the orbits outlast a restart (an extension's own `kv` is memory and holds at most 4096 characters an entry) and keeps
// CelesTrak, which blocks addresses that ask too often, to one request every few days. The panel only reads the rows.

import type { DataFileDefinition, HookContext } from "@ham2k/extension-sdk"

import manifest from "../manifest.json" with { type: "json" }
import { ELEMENTS_URL, LIST_CATEGORY, LIST_URL, ORBITS_CATEGORY } from "./data.ts"

const str = (v: unknown): string => (typeof v === "string" ? v : "")

/// The satellites the Ham2K list names, a row each: its frequencies are in the row's data, as the list gives them.
export const listFile: DataFileDefinition = {
  key: `${manifest.key}-list`,
  name: (_args: Record<string, never>, _ctx: HookContext) => "Amateur satellites",
  description: (_args: Record<string, never>, _ctx: HookContext) => "The amateur satellites, with their frequencies and modes",
  url: LIST_URL,
  maxAgeInDays: 7,
  fetchType: "json",
  category: LIST_CATEGORY,
  jsonToLookupEntry: (entry: Record<string, any>) => {
    const name = str(entry?.name).trim()
    // The list is kept by hand: an entry with no name is dropped, and the rest are kept.
    if (!name) return null
    return { key: name, name, data: { number: entry.number, modulation: entry.modulation, uplinks: entry.uplinks, downlinks: entry.downlinks } }
  },
}

/// CelesTrak's amateur group, a row each by NORAD number: the whole element set, which is what places the satellite. The file is kept for
/// three days: an orbit drifts by a kilometer or two a day, which moves a pass by well under a minute.
export const orbitsFile: DataFileDefinition = {
  key: `${manifest.key}-orbits`,
  name: (_args: Record<string, never>, _ctx: HookContext) => "Satellite orbits",
  description: (_args: Record<string, never>, _ctx: HookContext) => "Orbital elements of the amateur satellites, for working out passes",
  url: ELEMENTS_URL,
  maxAgeInDays: 3,
  fetchType: "json",
  category: ORBITS_CATEGORY,
  jsonToLookupEntry: (entry: Record<string, any>) => {
    const id = entry?.NORAD_CAT_ID
    if (typeof id !== "number" || !Number.isFinite(id) || typeof entry?.EPOCH !== "string") return null
    return { key: String(id), name: str(entry.OBJECT_NAME), data: entry }
  },
}
