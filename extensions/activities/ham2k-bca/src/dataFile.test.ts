// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The castle list's mapper, fed rows in the shape the published GeoJSON uses.
// Everything else about this award comes from the SDK's shared
// `referenceActivity`, so this is where its own bugs live: a swapped
// coordinate pair, or a filter that turns a published castle into one that
// does not exist.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

const extension = await loadExtension(() => import("./index.ts"))

/// Runs entries through the registered mapper the way the kernel's
/// `mapJsonBatch` does: one call each, nulls dropped.
function mapJson(entries: unknown[]): Record<string, any>[] {
  const hook = extension.hooks.find((h) => h.category === "dataFile")!.hook as { jsonToLookupEntry: (entry: unknown) => unknown }
  return entries.map((entry) => hook.jsonToLookupEntry(entry)).filter((x) => x !== null && x !== undefined) as Record<string, any>[]
}

/// A feature as the Belgian lists publish it: coordinates are [lon, lat].
const feature = (ref: string, name: string, lon: number, lat: number) => ({
  type: "Feature",
  properties: { reference: ref, name },
  geometry: { type: "Point", coordinates: [lon, lat] },
})

test("reads GeoJSON coordinates as [lon, lat], not [lat, lon]", () => {
  // Beersel is 50.766 N, 4.307 E. Read the other way round it lands in the
  // Indian Ocean, and the nearby list never offers it.
  const entries = mapJson([feature("ON-00558", " Kasteel van Beersel ", 4.307, 50.766)])

  assert.equal(entries.length, 1)
  assert.equal(entries[0].key, "ON-00558")
  assert.ok(Math.abs(entries[0].lat - 50.766) < 0.001)
  assert.ok(Math.abs(entries[0].lon - 4.307) < 0.001)
  // The grid is derived from the pair, so a swap shows up here too.
  assert.match(entries[0].data.grid, /^JO20/)
  // Names arrive padded in the published list.
  assert.equal(entries[0].name, "Kasteel van Beersel")
  assert.equal(entries[0].subCategory, "ON")
})

test("an unforeseen reference shape is stored, not silently dropped", () => {
  // A pattern check here turns a stray space or an unexpected prefix into a
  // castle that simply does not exist, with nothing to show for it.
  const entries = mapJson([feature("ON-1", "Odd but published", 4.0, 50.0), feature("ON-00558", "Beersel", 4.307, 50.766)])
  assert.deepEqual(entries.map((e) => e.key), ["ON-1", "ON-00558"])
})

test("a reference with no code at all is dropped", () => {
  const entries = mapJson([
    feature("", "Nameless", 4.0, 50.0),
    feature("  ", "Blank", 4.0, 50.0),
    feature("ON-00558", "Beersel", 4.307, 50.766),
  ])
  assert.deepEqual(entries.map((e) => e.key), ["ON-00558"])
})
