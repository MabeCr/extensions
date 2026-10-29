// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// A spot board looks up every spotted call offline, for what it can show
// without a callbook: a hunted park's state is one, and chasing WAS reads it.
// The trap: an offline lookup that answers nothing at all, when the park is
// in the local database — or one that reaches the network anyway.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

const parks: Record<string, { key: string; name: string; lat: number; lon: number; flags: number; data: Record<string, unknown> }> = {
  "US-0001": { key: "US-0001", name: "Acadia National Park", lat: 44.35, lon: -68.21, flags: 1, data: { grid6: "FN54vi", locationDesc: "US-ME" } },
  "US-0002": { key: "US-0002", name: "A Park Listed Without Its Area", lat: 38.0, lon: -84.5, flags: 1, data: { grid6: "EM78" } },
}
const fetched: string[] = []

const extension = await loadExtension(() => import("./index.ts"), {
  ctx: { online: false },
  hostCalls: {
    dbLookupSelectOne: (params) => parks[params.key as string] ?? null,
    fetch: (params) => {
      fetched.push(String(params.url))
      return { status: 200, body: "null" }
    },
  },
})

const lookup = async (ref: string, location?: string) =>
  (await extension.runHook("lookup", "lookupCall", {
    callInfo: { call: "KI2D" },
    qso: { their: { call: "KI2D" }, refs: [{ type: "pota", ref, ...(location ? { location } : {}) }] },
    operation: {},
  })) as Record<string, unknown>[]

test("offline, a hunted park in the local database gives its state", async () => {
  const [result] = await lookup("US-0001")
  assert.equal(result.state, "ME")
  assert.equal(result.grid, "FN54vi")
})

test("offline, a park missing from the local database is not fetched", async () => {
  assert.deepEqual(await lookup("US-9999"), [])
  assert.deepEqual(fetched, [])
})

// A spot board's profile may not have the parks file yet; the spot itself
// says where its park is.
test("offline, a park missing from the local database takes its state from the spot's ref", async () => {
  const [result] = await lookup("US-3830", "US-KY")
  assert.equal(result.state, "KY")
  assert.equal(result.grid, undefined)
  // A park across several states is in none of them, and its one point is
  // not where the station is — but the station is on it, not at home.
  const [trail] = await lookup("US-4567", "US-GA,US-NC")
  assert.equal(trail.largeArea, true)
  assert.equal(trail.state, undefined)
  assert.equal(trail.grid, undefined)
})

test("a park the local database lists without its area takes its state from the spot's ref", async () => {
  const [result] = await lookup("US-0002", "US-KY")
  assert.equal(result.state, "KY")
  assert.equal(result.grid, "EM78")
})
