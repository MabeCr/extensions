// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Suggestions for a map the operator panned, through the HOOK. The trap: a
// viewport answered like a nearby list — the nearest 30 around its
// center — fills a circle and leaves the corners of the map empty however far
// the operator pans.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

// More than the nearby cap, spread across the view.
const rows = Array.from({ length: 40 }, (_, i) => ({ key: `W2/GC-${1000 + i}`, name: `Reference ${i}`, lat: 40 + i * 0.02, lon: -75 + i * 0.02 }))
let asked: string[] = []

const extension = await loadExtension(() => import("./index.ts"), {
  hostCalls: {
    dbLookupSelectInBounds: () => (asked.push("bounds"), rows),
    dbLookupSelectByLocation: () => (asked.push("location"), rows),
  },
})

const suggest = async (args: Record<string, unknown>) => {
  asked = []
  return (await extension.runHook("activity", "suggest", args)) as unknown[]
}

const location = { lat: 40.2, lon: -74.8 }

test("a panned map is answered with everything in its view", async () => {
  const suggestions = await suggest({ location, bounds: { south: 39.9, west: -75.1, north: 40.9, east: -74.1 } })
  assert.deepEqual(asked, ["bounds"])
  assert.equal(suggestions.length, rows.length)
})

test("without a view, the nearest few around the operation", async () => {
  const suggestions = await suggest({ location })
  assert.deepEqual(asked, ["location"])
  assert.equal(suggestions.length, 30)
})

test("an outline names where it comes from, for the map's credits", async () => {
  const answer = (await extension.runHook("ref:sotaActivation", "geojsonUrlForRef", { ref: { type: "sotaActivation", ref: "W2/GC-116" } })) as { sourceName?: string }
  assert.equal(answer.sourceName, "sotl.as")
})
