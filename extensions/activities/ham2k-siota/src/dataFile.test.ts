// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The silo list's mapper, fed a row in the shape the published CSV uses. SiOTA
// names its columns its own way (`SILO_CODE`, `LNG`), so the trap is a mapper
// written from another award's list: every silo comes out keyless or
// positionless, and nothing downstream says so.

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

test("reads its own column names and keeps the published locator", () => {
  const entries = mapCsv([
    { SILO_CODE: "VK-ABC123", NAME: "Wallup", LOCALITY: "Wallup", STATE: "VIC", LOCATOR: "QF12ab", LAT: "-36.4", LNG: "142.3" },
  ])

  assert.equal(entries.length, 1)
  assert.equal(entries[0].key, "VK-ABC123")
  // The Australian state, which is how a VK operator narrows a search.
  assert.equal(entries[0].subCategory, "VIC")
  assert.equal(entries[0].data.grid, "QF12ab")
  assert.ok(Math.abs(entries[0].lat - -36.4) < 0.001)
})
