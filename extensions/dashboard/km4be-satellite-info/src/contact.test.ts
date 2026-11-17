// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { test } from "node:test"

import { buildCatalog, parseElements, parseList } from "./data.ts"
import { ContactFiller, FILL_AFTER_MS, refsWith, satelliteRef } from "./contact.ts"
import { ELEMENTS, LIST } from "./fixtures.ts"

const catalog = buildCatalog(parseList(LIST), parseElements(ELEMENTS), {})
const ao7 = catalog.find((s) => s.name === "AO-7")!

test("the satellite's ref is the Satellites activity's code for its transponder", () => {
  assert.deepEqual(satelliteRef(ao7), { type: "satellite", ref: "AO-7/145.85/linear" })
  assert.deepEqual(satelliteRef({ ...ao7, uplinks: [] }), { type: "satellite", ref: "AO-7" })
})

test("a contact keeps its other refs, loses another satellite's, and is left alone when it has this one", () => {
  const ref = satelliteRef(ao7)!
  const pota = { type: "pota", ref: "US-1234" }
  assert.deepEqual(refsWith([pota, { type: "satellite", ref: "SO-50/145.85/fm" }], ref), [pota, ref])
  assert.deepEqual(refsWith(undefined, ref), [ref])
  assert.equal(refsWith([pota, ref], ref), null)
})

test("filling is for one pass, and ends a few minutes after it sets", () => {
  const filler = new ContactFiller()
  const los = Date.parse("2026-10-07T12:00:00Z")
  assert.equal(filler.refAt(los), null)
  filler.start(ao7, los)
  assert.ok(filler.isFilling("AO-7", los + 60_000))
  assert.equal(filler.isFilling("FO-29", los), false)
  assert.equal(filler.refAt(los + FILL_AFTER_MS - 1)?.ref, "AO-7/145.85/linear")
  assert.equal(filler.refAt(los + FILL_AFTER_MS + 1), null)
  assert.equal(filler.isFilling("AO-7", los), false, "and is off from then on")
})
