// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The English castle list's mapper, fed rows in the shape the published JSON
// uses. Its traps are the list's own quirks: the reference lives in a column
// named WCA, coordinates arrive as strings, and some references are
// published with a trailing space — an untrimmed pattern check drops those
// castles outright.

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

test("reads the reference from WCA, not from a column named ECA", () => {
  // English castles are catalogued by their WCA code; there is no ECA column,
  // so reading one yields no references at all.
  const entries = mapJson([
    { WCA: "G-00001", NAME_OF_CASTLE: " Windsor Castle ", LOCATION: "Berkshire", LATITUDE: "51.4839", LONGITUDE: "-0.6044" },
  ])

  assert.equal(entries.length, 1)
  assert.equal(entries[0].key, "G-00001")
  assert.equal(entries[0].name, "Windsor Castle")
  assert.equal(entries[0].subCategory, "Berkshire")
  // Coordinates arrive as strings and must be parsed into numbers.
  assert.equal(typeof entries[0].lat, "number")
  assert.ok(Math.abs(entries[0].lat - 51.4839) < 0.001)
  assert.ok(Math.abs(entries[0].lon - -0.6044) < 0.001)
})

test("keeps a reference published with a trailing space", () => {
  // 'G-01516 ' is in the live list exactly like this. Checked before trimming,
  // it fails the pattern and the castle is never stored.
  const entries = mapJson([{ WCA: "G-01516 ", NAME_OF_CASTLE: "Padded", LOCATION: "Kent", LATITUDE: "51.2", LONGITUDE: "0.5" }])
  assert.equal(entries.length, 1)
  assert.equal(entries[0].key, "G-01516")
})

test("keeps a castle whose coordinates do not parse, without inventing a position", () => {
  // The castle is real, it just has no position yet: dropping it costs an
  // activation, and a NaN pair would reach the grid and the map as garbage.
  const entries = mapJson([{ WCA: "G-00002", NAME_OF_CASTLE: "No coords", LOCATION: "Kent", LATITUDE: "", LONGITUDE: "" }])
  assert.equal(entries.length, 1)
  assert.equal(entries[0].lat, undefined)
  assert.equal(entries[0].data.grid, undefined)
})
