// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The WCA castle list's mapper, fed a row in the shape the published CSV
// uses. WCA is the one list here that publishes its position as a single
// `COORDINATES` column holding "lat,lon"; reading it as two columns stores
// every castle with no position at all.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

const extension = await loadExtension(() => import("./index.ts"))

/// Runs header-keyed rows through the registered mapper the way the kernel's
/// `mapCsvBatch` does: one null-prototype object per row, nulls dropped.
function mapCsv(rows: Record<string, string>[]): Record<string, any>[] {
  const hook = extension.hooks.find((h) => h.category === "dataFile")!.hook as { csvToLookupEntry: (row: unknown) => unknown }
  return rows
    .map((row) => hook.csvToLookupEntry(Object.assign(Object.create(null), row)))
    .filter((x) => x !== null && x !== undefined) as Record<string, any>[]
}

test("splits the single COORDINATES column into lat and lon", () => {
  const entries = mapCsv([
    { REF: "ON-00558", PREFIX: "ON", "CLEAN NAME": "Kasteel van Beersel", "CLEAN LOCATION": "Vlaams-Brabant", COORDINATES: "50.766,4.307" },
  ])

  assert.equal(entries.length, 1)
  assert.ok(Math.abs(entries[0].lat - 50.766) < 0.001)
  assert.ok(Math.abs(entries[0].lon - 4.307) < 0.001)
  assert.equal(entries[0].data.location, "Vlaams-Brabant")
  assert.equal(entries[0].subCategory, "ON")
})
