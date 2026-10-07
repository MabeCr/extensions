// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { test } from "node:test"

import { buildCatalog, ELEMENTS_URL, LIST_URL, parseElements, parseList } from "./data.ts"
import { findPlace, observerFromGrid, roundedPlace } from "./location.ts"
import { clock, minElevation, nextPasses } from "./passes.ts"
import { loadExtension } from "./sdkGapTesting.ts"

// Elements as CelesTrak served them on 2026-10-06 (the amateur group).
const AO7 = { OBJECT_NAME: "OSCAR 7 (AO-7)", OBJECT_ID: "1974-089B", EPOCH: "2026-10-06T20:57:22.256064", MEAN_MOTION: 12.5369988, ECCENTRICITY: 0.00119476, INCLINATION: 101.991, RA_OF_ASC_NODE: 294.2846, ARG_OF_PERICENTER: 278.5192, MEAN_ANOMALY: 203.4257, EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: "U", NORAD_CAT_ID: 7530, ELEMENT_SET_NO: 999, REV_AT_EPOCH: 37451, BSTAR: 9.5510357e-5, MEAN_MOTION_DOT: -3.1e-7, MEAN_MOTION_DDOT: 0 }
const FO29 = { OBJECT_NAME: "JAS-2 (FO-29)", OBJECT_ID: "1996-046B", EPOCH: "2026-10-06T19:16:29.539488", MEAN_MOTION: 13.53278743, ECCENTRICITY: 0.03500586, INCLINATION: 98.5144, RA_OF_ASC_NODE: 113.3665, ARG_OF_PERICENTER: 166.6099, MEAN_ANOMALY: 194.463, EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: "U", NORAD_CAT_ID: 24278, ELEMENT_SET_NO: 999, REV_AT_EPOCH: 48826, BSTAR: 0.000042211991, MEAN_MOTION_DOT: 8e-8, MEAN_MOTION_DDOT: 0 }

// The Ham2K list as it is today, faults included: FO-29's number has a stray digit,
// SO-125 has none, and CAS-4A has a number CelesTrak publishes nothing for.
const LIST = [
  { name: "AO-7", number: 7530, modulation: "linear", uplinks: [{ mode: "linear", lowerMHz: 145.85, upperMHz: 145.95 }], downlinks: [{ mode: "linear", lowerMHz: 29.4, upperMHz: 29.5 }] },
  { name: "FO-29", number: 424278, modulation: "linear", uplinks: [{ mode: "linear", lowerMHz: 145.9, upperMHz: 146 }], downlinks: [{ mode: "linear", lowerMHz: 435.8, upperMHz: 435.9 }] },
  { name: "SO-125", modulation: "fm", uplinks: [], downlinks: [] },
  { name: "CAS-4A", number: 42761, modulation: "linear", uplinks: [], downlinks: [] },
  { name: "", number: 1 },
]
const ELEMENTS = [AO7, FO29, { NORAD_CAT_ID: "bad" }]

test("the list is read defensively", () => {
  const list = parseList(LIST)
  assert.deepEqual(list.map((s) => s.name), ["AO-7", "FO-29", "SO-125", "CAS-4A"]) // the nameless entry is dropped
  assert.equal(list[2].norad, undefined)
  assert.deepEqual(parseList({ not: "an array" }), [])
  assert.deepEqual(parseList([{ name: "X", uplinks: [{ lowerMHz: "x", upperMHz: 1 }, null] }])[0].uplinks, [])
  assert.deepEqual([...parseElements(ELEMENTS).keys()], [7530, 24278])
})

test("our corrections fix FO-29's number, and a bird with no elements is kept without them", () => {
  const catalog = buildCatalog(parseList(LIST), parseElements(ELEMENTS))
  const by = Object.fromEntries(catalog.map((s) => [s.name, s]))
  assert.equal(by["AO-7"].omm?.NORAD_CAT_ID, 7530)
  assert.equal(by["FO-29"].norad, 24278, "the list's 424278 is corrected")
  assert.equal(by["FO-29"].omm?.NORAD_CAT_ID, 24278)
  assert.equal(by["SO-125"].omm, undefined)
  assert.equal(by["CAS-4A"].omm, undefined)
  assert.equal(catalog.length, 4, "nothing is dropped for lacking data")
  // A correction replaces; it does not need the list to have the field.
  const fixed = buildCatalog(parseList(LIST), parseElements(ELEMENTS), { "SO-125": { norad: 7530 } })
  assert.equal(fixed.find((s) => s.name === "SO-125")?.omm?.NORAD_CAT_ID, 7530)
})

test("grid squares are read, rounded and refused", () => {
  assert.deepEqual(observerFromGrid("EL95"), { lat: 25.5, lon: -81 })
  const six = observerFromGrid("el95vs")!
  assert.ok(Math.abs(six.lat - 25.77) < 0.05 && Math.abs(six.lon - -80.2) < 0.1)
  for (const bad of ["", "E", "EL9", "ZZ99", "99AA", "EL95vsxx", 5, undefined, null]) assert.equal(observerFromGrid(bad), null)
  // A device position becomes the center of its six-character square, a few kilometers across.
  const place = roundedPlace(25.7617, -80.1918)!
  assert.equal(place.grid, "EL95vs")
  assert.notEqual(place.lat, 25.7617)
  assert.ok(Math.abs(place.lat - 25.7617) < 0.05 && Math.abs(place.lon - -80.1918) < 0.1)
})

test("the pass settings: the minimum elevation is held to 0 to 60, and times name their zone", () => {
  assert.equal(minElevation(undefined), 10)
  assert.equal(minElevation({ minElevation: 0 }), 0)
  assert.equal(minElevation({ minElevation: 25 }), 25)
  assert.equal(minElevation({ minElevation: 90 }), 60)
  assert.equal(minElevation({ minElevation: -3 }), 10)
  assert.equal(minElevation({ minElevation: "20" }), 10)
  const at = Date.parse("2026-10-07T14:05:00Z")
  assert.equal(clock(at, at, true), "14:05Z")
  assert.equal(clock(at + 24 * 3_600_000, at, true), "10-08 14:05Z")
})

test("passes across the catalog come out soonest first, only for birds with elements", () => {
  const catalog = buildCatalog(parseList(LIST), parseElements(ELEMENTS))
  const passes = nextPasses(catalog, { lat: 25.76, lon: -80.19 }, Date.parse("2026-10-07T00:00:00Z"), 10)
  assert.ok(passes.length > 3)
  assert.deepEqual([...new Set(passes.map((p) => p.satellite.name))].sort(), ["AO-7", "FO-29"])
  passes.slice(1).forEach((p, i) => assert.ok(p.aos >= passes[i].aos))
  assert.ok(passes.every((p) => p.maxElevation >= 10))
})

const ctx = { online: true }

test("the panel asks for a place, then shows passes from cached feeds, and survives a feed failing", async () => {
  let offline = false
  const fetched: string[] = []
  let device: { latitude: number; longitude: number } | null = null
  const storage = new Map<string, unknown>()
  const ext = await loadExtension(() => import("./index.ts"), {
    hostCalls: {
      getLocation: () => device,
      kvGet: (params) => storage.get(String(params.key)) ?? null,
      kvSet: (params) => void storage.set(String(params.key), params.value),
      fetch: (params) => {
        const url = String(params.url)
        fetched.push(url)
        if (offline) throw new Error("network down")
        if (url === LIST_URL) return { status: 200, body: JSON.stringify(LIST) }
        if (url === ELEMENTS_URL) return { status: 200, body: JSON.stringify(ELEMENTS) }
        return { status: 404, body: "" }
      },
    },
  })
  const render = (config: Record<string, unknown>, nowMs: number, operation: Record<string, unknown> = {}) =>
    ext.runHook(
      "panel",
      "render",
      { panelKey: "passes", operation, qsoCount: 0, reason: "", config, clock: { nowMillis: nowMs, realNowMillis: nowMs } },
      { ctx },
    ) as Promise<{ kind: string; content: string }>

  const t0 = Date.parse("2026-10-07T00:00:00Z")

  // No device location, no typed grid, no operation grid.
  assert.match((await render({}, t0)).content, /No location/)
  assert.equal(fetched.length, 0, "nothing is fetched before there is a place to work out")

  // A typed grid works, and the operation's grid is the last resort.
  const typed = (await render({ grid: "EL95vs", utc: true }, t0)).content
  assert.match(typed, /\*\*Next passes\*\* for EL95vs · min 10° · 2 of 4 satellites tracked/)
  assert.match(typed, /\| AO-7 \|/)
  assert.match(typed, /Z \|/, "UTC times carry a Z")
  assert.match(typed, /Orbits from CelesTrak, 00:00Z/)
  assert.match((await render({}, t0, { grid: "FN31" })).content, /for FN31/)

  // The device's own position wins, rounded to its square.
  device = { latitude: 41.7, longitude: -72.7 }
  assert.match((await render({ grid: "EL95vs" }, t0)).content, /for FN31[a-x]{2} /)

  // Within the cache window nothing is fetched again; an outage later falls back to the stored copy.
  const before = fetched.length
  await render({ grid: "EL95vs" }, t0 + 60_000)
  assert.equal(fetched.length, before)
  offline = true
  const later = (await render({ grid: "EL95vs" }, t0 + 30 * 3_600_000)).content
  assert.match(later, /2 of 4 satellites tracked/, "stale elements are better than none")
})
