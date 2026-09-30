// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The lighthouse list's mapper, fed a row in the shape the published GeoJSON
// uses. A BLHA reference has a space INSIDE it (`BEL 001`), so the trap is a
// cleanup that normalises whitespace rather than trimming only the ends — it
// stores a key no activation or spot will ever match.

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

test("keeps the space INSIDE a `BEL 001` reference while trimming the ends", () => {
  const entries = mapJson([
    {
      type: "Feature",
      properties: { reference: " BEL 001 ", name: "Oostende" },
      geometry: { type: "Point", coordinates: [2.93, 51.23] },
    },
  ])
  assert.deepEqual(entries.map((e) => e.key), ["BEL 001"])
})
