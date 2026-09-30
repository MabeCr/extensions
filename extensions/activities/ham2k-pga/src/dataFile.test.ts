// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The gmina list's mapper, fed rows in the shape the published CSV uses, and
// the shape of the extension itself. A gmina is an AREA, so the trap in the
// mapper is deriving a grid from its centroid instead of storing the award's
// own; the trap in the registration is scoring an award that counts nothing.

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

test("keeps active gminas and their published grid", () => {
  const entries = mapCsv([
    {
      "PGA REF.": "ZP01",
      GMINA: "Szczecin",
      "GRID LOCATOR": "JO73gl",
      POWIAT: "Szczecin",
      VOIVODESHIP: "Zachodniopomorskie",
      LAT: "53.4285",
      LONG: "14.5528",
      ACTIVE: "YES",
    },
  ])

  assert.equal(entries.length, 1)
  assert.equal(entries[0].key, "ZP01")
  assert.equal(entries[0].name, "Szczecin")
  // The award's own grid, not one derived from the centroid, which lands in
  // whichever square the middle of the gmina happens to fall.
  assert.equal(entries[0].data.grid, "JO73gl")
  assert.equal(entries[0].subCategory, "Szczecin")
  assert.equal(entries[0].data.province, "Zachodniopomorskie")
})

test("drops retired gminas rather than storing them inactive", () => {
  // A retired gmina offered in the picker is one the operator can activate
  // and the award will not credit.
  const entries = mapCsv([
    { "PGA REF.": "ZP01", GMINA: "Active one", ACTIVE: "YES", LAT: "53.4", LONG: "14.5" },
    { "PGA REF.": "ZP02", GMINA: "Retired one", ACTIVE: "NO", LAT: "53.4", LONG: "14.5" },
  ])
  assert.deepEqual(entries.map((e) => e.key), ["ZP01"])
})

test("registers no scoring hook, because the award counts nothing", () => {
  // A gmina is recorded and exported, never measured against a threshold.
  // Registering the shared scorer "for consistency" would show the operator a
  // target the award does not have.
  assert.equal(extension.categories().includes("scoring"), false)
})
