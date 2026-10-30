// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The extension through its HOOKS — what the app actually calls. A reference
// is "PP", its ISO country, a dash and four digits, so the controls learn
// their country from a callsign; and an activation is five different
// callsigns in a UTC day, which is the scorer's whole job.

import { test } from "node:test"
import assert from "node:assert/strict"

import { fixtureOperation, fixtureQso, loadExtension, typeRefText } from "./sdkGapTesting.ts"

const ppota = await loadExtension(() => import("./index.ts"))

type Transforms = { pattern: string; replacement: string; flags?: string }[]

async function inputOf(method: "operationControls" | "loggingControls", stationCall: string, qso?: Record<string, unknown>) {
  const controls = (await ppota.runHook("activity", method, { operation: fixtureOperation({ stationCall }), qso })) as any[]
  return controls[0].input as { placeholder: string; transforms: Transforms; refType: string }
}

test("the activation control takes our own country; the hunting control the other station's", async () => {
  const activation = await inputOf("operationControls", "LU1ABC", fixtureQso({ their: { call: "EA4XYZ" } }))
  assert.equal(activation.refType, "ppotaActivation")
  assert.equal(activation.placeholder, "PPAR-0001")
  assert.equal(typeRefText("0004", activation.transforms), "PPAR-0004")

  const hunting = await inputOf("loggingControls", "LU1ABC", fixtureQso({ their: { call: "EA4XYZ" } }))
  assert.equal(hunting.refType, "ppota")
  assert.equal(hunting.placeholder, "PPES-0001")
  assert.equal(typeRefText("0042", hunting.transforms), "PPES-0042")
})

test("each of the program's countries is the ISO one", async () => {
  assert.equal((await inputOf("operationControls", "CT1ABC")).placeholder, "PPPT-0001")
  assert.equal((await inputOf("operationControls", "CX2ABC")).placeholder, "PPUY-0001")
  assert.equal((await inputOf("operationControls", "CE3ABC")).placeholder, "PPCL-0001")
})

test("a reference typed without its punctuation, or in the old form, gets the rest", async () => {
  const { transforms } = await inputOf("operationControls", "LU1ABC")
  assert.equal(typeRefText("AR0004", transforms), "PPAR-0004")
  assert.equal(typeRefText("PPAR0004", transforms), "PPAR-0004")
  assert.equal(typeRefText("AR-0004", transforms), "PPAR-0004")
  assert.equal(typeRefText("PPAR-0004", transforms), "PPAR-0004")
  assert.equal(typeRefText("0004, 0005", transforms), "PPAR-0004, PPAR-0005")
  assert.equal(typeRefText("0004 0005", transforms), "PPAR-0004, PPAR-0005")
  // Another country's reference is left in its own country.
  assert.equal(typeRefText("ES0001", transforms), "PPES-0001")
  assert.equal(typeRefText("PPES-0001", transforms), "PPES-0001")
})

test("a multi-operator station takes its country from the first call", async () => {
  const { placeholder, transforms } = await inputOf("operationControls", "EA1ABC, EA2DEF")
  assert.equal(placeholder, "PPES-0001")
  assert.equal(typeRefText("0004", transforms), "PPES-0004")
})

test("a bare PP is not read as a country", async () => {
  const { transforms } = await inputOf("operationControls", "")
  assert.equal(typeRefText("PP0004", transforms), "PP0004")
})

test("a station nobody can place gets no guessed country", async () => {
  const { transforms } = await inputOf("operationControls", "")
  assert.equal(typeRefText("0004", transforms), "0004")
  assert.equal(typeRefText("UY0001", transforms), "PPUY-0001")
})

test("a reference validates and normalizes with no network", async () => {
  const valid = (await ppota.runHook("ref:ppota", "validateRef", { ref: { type: "ppota", ref: "ppar-0004" } })) as {
    valid: boolean
    normalized: string
  }
  assert.deepEqual(valid, { valid: true, normalized: "PPAR-0004" })

  for (const ref of ["AR-0004", "PPAR0004", "PPAR-004", "PPARG-0004", "PPAR-00004"]) {
    const result = (await ppota.runHook("ref:ppota", "validateRef", { ref: { type: "ppota", ref } })) as { valid: boolean }
    assert.equal(result.valid, false, ref)
  }
})

const VILLAGE = { type: "ppotaActivation", ref: "PPAR-0004" }

function contact(i: number, call: string, extra: Record<string, unknown> = {}) {
  return {
    uuid: `q${i}`,
    startAtMillis: Date.UTC(2026, 6, 1, 12, i),
    band: "40m",
    mode: "SSB",
    our: { call: "LU1ABC" },
    their: { call },
    ...extra,
  }
}

async function score(qsos: Record<string, unknown>[]) {
  return (await ppota.runHook("scoring", "scoreQsos", {
    operation: { uuid: "op", stationCall: "LU1ABC", refs: [VILLAGE] },
    qsos,
    ref: VILLAGE,
  })) as {
    qsoScores: Record<string, { value: number; dupe?: boolean }>
    operationSummary: { activation: { activated: boolean; summary: string; label: string } }
  }
}

test("five different callsigns activate a reference", async () => {
  const result = await score(["LU2AAA", "LU3BBB", "CX1CCC", "EA4DDD", "LW5ECI"].map((call, i) => contact(i, call)))
  assert.equal(result.operationSummary.activation.activated, true)
})

test("four callsigns do not, however many times each is worked on other bands and modes", async () => {
  // Rules §2.3: the same callsign on another band or mode does not stand in
  // for a fifth station.
  const result = await score([
    contact(0, "LU2AAA"),
    contact(1, "LU3BBB"),
    contact(2, "CX1CCC"),
    contact(3, "EA4DDD"),
    contact(4, "LU2AAA", { band: "20m", mode: "CW" }),
  ])
  assert.equal(result.qsoScores.q4.dupe, true)
  assert.equal(result.operationSummary.activation.activated, false)
  assert.equal(result.operationSummary.activation.summary, "4/5")
})

test("the same station at a second reference is a new hunted reference, but not a second callsign", async () => {
  const result = await score([
    contact(0, "LU2AAA", { refs: [{ type: "ppota", ref: "PPAR-0100" }] }),
    contact(1, "LU2AAA", { refs: [{ type: "ppota", ref: "PPAR-0101" }] }),
    contact(2, "LU3BBB"),
    contact(3, "CX1CCC"),
    contact(4, "EA4DDD"),
  ])
  assert.notEqual(result.qsoScores.q1.dupe, true)
  assert.equal(result.operationSummary.activation.summary, "4/5")
  assert.match(result.operationSummary.activation.label, /P2P/)
})

test("the same callsign counts again on a new UTC day", async () => {
  // Rules §2.4: each UTC day needs its own five, and yesterday's stations are
  // fair game.
  const day = (i: number, call: string, d: number) => ({ ...contact(i, call), startAtMillis: Date.UTC(2026, 6, d, 12, i) })
  const calls = ["LU2AAA", "LU3BBB", "CX1CCC", "EA4DDD", "LW5ECI"]
  const result = (await ppota.runHook("scoring", "scoreQsos", {
    operation: { uuid: "op", stationCall: "LU1ABC", refs: [VILLAGE] },
    qsos: [...calls.map((c, i) => day(i, c, 1)), ...calls.map((c, i) => day(10 + i, c, 2))],
    ref: VILLAGE,
  })) as { daySections: { scores: { activation: { activated: boolean } } }[] }
  assert.deepEqual(result.daySections.map((d) => d.scores.activation.activated), [true, true])
})
