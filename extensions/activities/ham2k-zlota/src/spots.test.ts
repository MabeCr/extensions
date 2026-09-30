// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The ZLOTA spot feed through the `spots` HOOK, against a stubbed `fetch`. The
// feed emits ONE ROW PER REFERENCE, rows of one spot sharing an `id`; mapped
// row by row, a station at two places shows as two spots.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

const FEED = [
  { id: 7, activator: "zl1abc", reference: "ZLH/AA-001", frequency: "14285", mode: "SSB", referenced_time: "2026-07-01T12:00:00Z", name: "Angelus Hut" },
  { id: 7, activator: "zl1abc", reference: "ZLI/AA-002", frequency: "14285", mode: "SSB", referenced_time: "2026-07-01T12:00:00Z", name: "Some Island" },
]

const zlota = await loadExtension(() => import("./index.ts"), {
  hostCalls: { fetch: () => ({ status: 200, body: JSON.stringify(FEED) }) },
})

test("rows sharing an id fold back into one spot carrying every reference", async () => {
  const spots = (await zlota.runHook("spots", "fetchSpots", {}, { ctx: { online: true } })) as any[]
  assert.equal(spots.length, 1)
  assert.equal(spots[0].refs.length, 2)
  assert.equal(spots[0].their.call, "ZL1ABC")
  assert.equal(spots[0].spot.label, "ZLI/AA-002 ZLH/AA-001")
})
