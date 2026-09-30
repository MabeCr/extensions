// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The English lighthouse list's mapper, fed a row in the shape the published
// JSON uses (ham2k.com/data/cached/ela/ELA_References.json). The trap is the
// column name: the file underscores it, `NAME_OF_LIGHTHOUSE`, and a spaced
// `NAME OF LIGHTHOUSE` key reads nothing and stores every lighthouse nameless.

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

test("reads the underscored `NAME_OF_LIGHTHOUSE` column", () => {
  const entries = mapJson([
    { ELA: "ENG 001", NAME_OF_LIGHTHOUSE: "Beachy Head", LOCATION: "East Sussex", LATITUDE: "50.7361", LONGITUDE: "0.2494" },
  ])

  assert.equal(entries.length, 1)
  assert.equal(entries[0].key, "ENG 001")
  assert.equal(entries[0].name, "Beachy Head")
})
