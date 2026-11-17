// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The extension through its HOOKS — what the app actually calls. A tile is a
// 6-character grid square, so a reference decorates with no lookup and the
// one nearby is wherever the operator stands; and an activation is one QSO
// in a UTC day, which is the scorer's whole job.

import { test } from "node:test"
import assert from "node:assert/strict"

import { fixtureOperation, loadExtension, typeRefText } from "./sdkGapTesting.ts"

const tiles = await loadExtension(() => import("./index.ts"))

type Transforms = { pattern: string; replacement: string; flags?: string }[]

async function inputOf(method: "operationControls" | "loggingControls", operation: Record<string, any> = {}) {
  const controls = (await tiles.runHook("activity", method, { operation: fixtureOperation(operation) })) as any[]
  return controls[0].input as { placeholder: string; transforms: Transforms; refType: string }
}

test("the activation control offers the operation's own tile; the hunting control a generic one", async () => {
  const activation = await inputOf("operationControls", { grid: "FN42hn37" })
  assert.equal(activation.refType, "tilesActivation")
  assert.equal(activation.placeholder, "FN42HN")
  assert.equal(typeRefText("fn42 hn", activation.transforms), "fn42hn")

  // Four characters are a hundred tiles, so they name none.
  assert.equal((await inputOf("operationControls", { grid: "FN42" })).placeholder, "FN42HN")

  const hunting = await inputOf("loggingControls", { grid: "EM73uu" })
  assert.equal(hunting.refType, "tiles")
  assert.equal(hunting.placeholder, "FN42HN")
})

test("a tile validates and normalizes with no network", async () => {
  const valid = (await tiles.runHook("ref:tiles", "validateRef", { ref: { type: "tiles", ref: " fn42hn " } })) as {
    valid: boolean
    normalized: string
  }
  assert.deepEqual(valid, { valid: true, normalized: "FN42HN" })

  for (const ref of ["FN42", "FN42HN37", "SN42HN", "FN42HZ", "F142HN"]) {
    const result = (await tiles.runHook("ref:tiles", "validateRef", { ref: { type: "tiles", ref } })) as { valid: boolean }
    assert.equal(result.valid, false, ref)
  }
})

test("a tile decorates as its grid square, placed at its centre", async () => {
  const ref = (await tiles.runHook("ref:tilesActivation", "decorateRef", { ref: { type: "tilesActivation", ref: "fn42hn" } })) as any
  assert.equal(ref.ref, "FN42HN")
  assert.equal(ref.grid, "FN42hn")
  assert.equal(ref.name, "Grid square FN42hn")
  assert.equal(ref.label, "Tiles FN42HN")
  assert.equal(ref.lat, 42.5625)
  assert.equal(ref.lon, -71.375)

  const invalid = (await tiles.runHook("ref:tiles", "decorateRef", { ref: { type: "tiles", ref: "FN42" } })) as any
  assert.match(invalid.name, /Invalid tile/)
  assert.equal(invalid.lat, undefined)
})

test("only the activation titles the operation", async () => {
  const at = await tiles.runHook("ref:tilesActivation", "suggestOperationTitle", { ref: { type: "tilesActivation", ref: "fn42hn" } })
  assert.deepEqual(at, { at: "FN42HN" })
  assert.equal(await tiles.runHook("ref:tiles", "suggestOperationTitle", { ref: { type: "tiles", ref: "FN42HN" } }), null)
})

test("nearby is the tile the operator is standing in; a search finds a tile typed in full", async () => {
  const nearby = (await tiles.runHook("activity", "suggest", { operation: {}, location: { lat: 42.55, lon: -71.37 } })) as any[]
  assert.deepEqual(nearby.map((s) => [s.type, s.ref, s.distance]), [["tilesActivation", "FN42HN", 0]])

  const typed = (await tiles.runHook("activity", "suggest", { operation: {}, searchTerm: "em73uu", scoped: true })) as any[]
  assert.deepEqual(typed.map((s) => s.ref), ["EM73UU"])

  assert.deepEqual(await tiles.runHook("activity", "suggest", { operation: {}, searchTerm: "Stone Mountain" }), [])
  assert.deepEqual(await tiles.runHook("activity", "suggest", { operation: {} }), [])
})

const TILE = { type: "tilesActivation", ref: "EM73UU" }

function contact(i: number, call: string, extra: Record<string, unknown> = {}) {
  return {
    uuid: `q${i}`,
    startAtMillis: Date.UTC(2026, 9, 1, 12, i),
    band: "20m",
    mode: "SSB",
    our: { call: "KK4ODA" },
    their: { call },
    ...extra,
  }
}

async function score(qsos: Record<string, unknown>[]) {
  return (await tiles.runHook("scoring", "scoreQsos", {
    operation: { uuid: "op", stationCall: "KK4ODA", refs: [TILE] },
    qsos,
    ref: TILE,
  })) as {
    qsoScores: Record<string, { value: number; dupe?: boolean }>
    operationSummary: { activation: { activated: boolean; summary: string; label: string } }
    daySections: { scores: { activation: { activated: boolean } } }[]
  }
}

test("one QSO activates a tile", async () => {
  const result = await score([contact(0, "W1AW")])
  assert.equal(result.operationSummary.activation.activated, true)
})

test("a station worked again on the same band and mode is a duplicate; on another band it is not", async () => {
  const result = await score([contact(0, "W1AW"), contact(1, "W1AW"), contact(2, "W1AW", { band: "40m" })])
  assert.equal(result.qsoScores.q1.dupe, true)
  assert.notEqual(result.qsoScores.q2.dupe, true)
})

test("a rover worked again from the next tile is a new contact, and tile to tile is T3", async () => {
  const result = await score([
    contact(0, "AC1RH", { refs: [{ type: "tiles", ref: "FN42HN" }] }),
    contact(1, "AC1RH", { refs: [{ type: "tiles", ref: "FN42HM" }] }),
  ])
  assert.notEqual(result.qsoScores.q1.dupe, true)
  assert.match(result.operationSummary.activation.label, /T3/)
})

test("every UTC day is its own activation", async () => {
  const result = await score([contact(0, "W1AW"), { ...contact(1, "W1AW"), startAtMillis: Date.UTC(2026, 9, 2, 0, 5) }])
  assert.notEqual(result.qsoScores.q1.dupe, true)
  assert.deepEqual(result.daySections.map((d) => d.scores.activation.activated), [true, true])
})

test("a rover working the same station from the next tile the same day activates both tiles", async () => {
  // Two segments of one operation: EM73UU, then EM73UV after 12:15.
  const A = { type: "tilesActivation", ref: "EM73UU" }
  const B = { type: "tilesActivation", ref: "EM73UV" }
  const opA = { uuid: "op", stationCall: "KK4ODA", refs: [A] }
  const opB = { uuid: "op", stationCall: "KK4ODA", refs: [B] }
  const at = (i: number, call: string) => ({ ...contact(i, call), startAtMillis: Date.UTC(2026, 9, 1, 12, i * 10) })
  const result = (await tiles.runHook("scoring", "scoreQsos", {
    operation: opB,
    qsos: [at(0, "W1AW"), at(1, "N1XYZ"), at(2, "W1AW"), at(3, "W1AW")],
    ref: B,
    segments: [{ fromMillis: 0, operation: opA }, { fromMillis: Date.UTC(2026, 9, 1, 12, 15), operation: opB }],
  })) as { qsoScores: Record<string, { value: number; dupe?: boolean }>; operationSummary: { activation: { activated: boolean } } }

  assert.notEqual(result.qsoScores.q2.dupe, true)
  assert.equal(result.qsoScores.q2.value, 1)
  // Within the one tile, the same band and mode is still a duplicate.
  assert.equal(result.qsoScores.q3.dupe, true)
  assert.equal(result.operationSummary.activation.activated, true)
})
