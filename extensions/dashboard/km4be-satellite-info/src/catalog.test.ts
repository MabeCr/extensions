// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { test } from "node:test"

import { buildCatalog, parseElements, parseList } from "./data.ts"
import { observerFromGrid, roundedPlace } from "./location.ts"
import { clock, minElevation, nextPasses } from "./passes.ts"
import { ELEMENTS, LIST } from "./fixtures.ts"


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

