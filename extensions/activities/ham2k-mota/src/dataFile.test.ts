// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The mill list's mapper, fed rows in the shape the published CSV uses. Every
// mill carries a validity window and `21991231` is the list's "no end date",
// so the trap is a mapper that ignores the column and resurrects every retired
// mill.

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

test("keeps mills with an open validity window and drops retired ones", () => {
  const entries = mapCsv([
    {
      Reference: "X00001",
      Name: "De Vlijt",
      District: "Noord-Holland",
      Function: "Windmill",
      Latitude: "52.4",
      Longitude: "4.8",
      "Maidenhead Locator": "JO22HK",
      "valid to": "21991231",
    },
    { Reference: "X00002", Name: "Gone", District: "Utrecht", Latitude: "52.1", Longitude: "5.1", "valid to": "20180101" },
  ])

  assert.deepEqual(entries.map((e) => e.key), ["X00001"])
  assert.equal(entries[0].subCategory, "Noord-Holland")
  assert.equal(entries[0].data.type, "Windmill")
  // Published upper-case; HaLo compares grids as plain strings, so the tail
  // has to be in the conventional lower case.
  assert.equal(entries[0].data.grid, "JO22hk")
})
