// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The extension through its HOOKS — what the app actually calls. A reference
// is its ISO country plus "-H" and four digits, so the controls learn their
// prefix from a callsign; and an activation is five different callsigns in a
// UTC day, which is the scorer's whole job.

import { test } from "node:test"
import assert from "node:assert/strict"

import { fixtureOperation, fixtureQso, loadExtension, typeRefText } from "./sdkGapTesting.ts"

const hota = await loadExtension(() => import("./index.ts"))

type Transforms = { pattern: string; replacement: string; flags?: string }[]

async function inputOf(method: "operationControls" | "loggingControls", stationCall: string, qso?: Record<string, unknown>) {
  const controls = (await hota.runHook("activity", method, { operation: fixtureOperation({ stationCall }), qso })) as any[]
  return controls[0].input as { placeholder: string; transforms: Transforms; refType: string }
}

test("the activation control takes our own country; the hunting control the other station's", async () => {
  const activation = await inputOf("operationControls", "YO3BEE", fixtureQso({ their: { call: "SP9ABC" } }))
  assert.equal(activation.refType, "hotaActivation")
  assert.equal(activation.placeholder, "RO-H0001")
  assert.equal(typeRefText("0142", activation.transforms), "RO-H0142")

  const hunting = await inputOf("loggingControls", "YO3BEE", fixtureQso({ their: { call: "SP9ABC" } }))
  assert.equal(hunting.refType, "hota")
  assert.equal(hunting.placeholder, "PL-H0001")
  assert.equal(typeRefText("H0042", hunting.transforms), "PL-H0042")
})

test("the country is HOTA's ISO one, not the DXCC entity's prefix", async () => {
  // Scotland and Hawaii are their own DXCC entities, but HOTA files them
  // under GB and US.
  assert.equal((await inputOf("operationControls", "GM4ABC")).placeholder, "GB-H0001")
  assert.equal((await inputOf("operationControls", "KH6ABC")).placeholder, "US-H0001")
})

test("a reference typed without its punctuation gets it, and a list keeps its comma", async () => {
  const { transforms } = await inputOf("operationControls", "YO3BEE")
  assert.equal(typeRefText("RO0142", transforms), "RO-H0142")
  assert.equal(typeRefText("ROH0142", transforms), "RO-H0142")
  assert.equal(typeRefText("RO-0142", transforms), "RO-H0142")
  assert.equal(typeRefText("RO-H0142", transforms), "RO-H0142")
  assert.equal(typeRefText("0142, 0143", transforms), "RO-H0142, RO-H0143")
  assert.equal(typeRefText("0142 0143", transforms), "RO-H0142, RO-H0143")
  // Another country's reference is left in its own country.
  assert.equal(typeRefText("HU0001", transforms), "HU-H0001")
})

test("a station nobody can place gets no guessed country", async () => {
  const { transforms } = await inputOf("operationControls", "")
  assert.equal(typeRefText("0142", transforms), "0142")
  assert.equal(typeRefText("FR0195", transforms), "FR-H0195")
})

test("a reference validates and normalizes with no network, and links to its page", async () => {
  const valid = (await hota.runHook("ref:hota", "validateRef", { ref: { type: "hota", ref: "ro-h0001" } })) as {
    valid: boolean
    normalized: string
  }
  assert.deepEqual(valid, { valid: true, normalized: "RO-H0001" })

  for (const ref of ["RO-0001", "RO-H001", "ROU-H0001", "RO-H00001"]) {
    const result = (await hota.runHook("ref:hota", "validateRef", { ref: { type: "hota", ref } })) as { valid: boolean }
    assert.equal(result.valid, false, ref)
  }

  const link = (await hota.runHook("ref:hotaActivation", "linkForRef", { ref: { type: "hotaActivation", ref: "FR-H0195" } })) as {
    url: string
  }
  assert.equal(link.url, "https://cqhota.app/ref/FR-H0195")
})

const SITE = { type: "hotaActivation", ref: "RO-H0001" }

function contact(i: number, call: string, extra: Record<string, unknown> = {}) {
  return {
    uuid: `q${i}`,
    startAtMillis: Date.UTC(2026, 6, 1, 12, i),
    band: "20m",
    mode: "SSB",
    our: { call: "YO3BEE" },
    their: { call },
    ...extra,
  }
}

async function score(qsos: Record<string, unknown>[]) {
  return (await hota.runHook("scoring", "scoreQsos", {
    operation: { uuid: "op", stationCall: "YO3BEE", refs: [SITE] },
    qsos,
    ref: SITE,
  })) as {
    qsoScores: Record<string, { value: number; dupe?: boolean }>
    operationSummary: { activation: { activated: boolean; summary: string; label: string } }
  }
}

test("five different callsigns activate a site", async () => {
  const result = await score(["W1AW", "SP9ABC", "G4ABC", "DL1ABC", "F4JXY"].map((call, i) => contact(i, call)))
  assert.equal(result.operationSummary.activation.activated, true)
})

test("four callsigns do not, however many times each is worked on other bands and modes", async () => {
  // HOTA counts callsigns, not band/mode slots: the fifth contact here is a
  // station already in the log.
  const result = await score([
    contact(0, "W1AW"),
    contact(1, "SP9ABC"),
    contact(2, "G4ABC"),
    contact(3, "DL1ABC"),
    contact(4, "W1AW", { band: "40m", mode: "CW" }),
  ])
  assert.equal(result.qsoScores.q4.dupe, true)
  assert.equal(result.operationSummary.activation.activated, false)
  assert.equal(result.operationSummary.activation.summary, "4/5")
})

test("the same station at a second site is a new hunted site, but not a second callsign", async () => {
  // HOTA to HOTA with a partner on two sites: the hunter side gains the
  // second site, the activation still has one callsign from it.
  const result = await score([
    contact(0, "SP9ABC", { refs: [{ type: "hota", ref: "PL-H0001" }] }),
    contact(1, "SP9ABC", { refs: [{ type: "hota", ref: "PL-H0002" }] }),
    contact(2, "W1AW"),
    contact(3, "G4ABC"),
    contact(4, "DL1ABC"),
  ])
  assert.notEqual(result.qsoScores.q1.dupe, true)
  assert.equal(result.operationSummary.activation.summary, "4/5")
  assert.match(result.operationSummary.activation.label, /H&H/)
})

test("one contact with a station on two sites is one callsign toward the five", async () => {
  // Both sites go to the hunter side, and the record is written once per
  // site, but HOTA counts callsigns: three stations are three, not six.
  const twoSites = { refs: [{ type: "hota", ref: "PL-H0001" }, { type: "hota", ref: "PL-H0002" }] }
  const result = await score([contact(0, "SP9A", twoSites), contact(1, "SP9B", twoSites), contact(2, "SP9C", twoSites)])
  assert.equal(result.operationSummary.activation.activated, false)
  assert.equal(result.operationSummary.activation.summary, "3/5")
})

test("a station worked at a site and again with none is still one callsign", async () => {
  const result = await score([
    contact(0, "SP9ABC", { refs: [{ type: "hota", ref: "PL-H0001" }] }),
    contact(1, "SP9ABC"),
    contact(2, "W1AW"),
    contact(3, "G4ABC"),
    contact(4, "DL1ABC"),
  ])
  assert.equal(result.qsoScores.q1.dupe, true)
  assert.equal(result.operationSummary.activation.activated, false)
  assert.equal(result.operationSummary.activation.summary, "4/5")
})

test("the same callsign counts again on a new UTC day", async () => {
  // Activations are daily: each day needs its own five, and yesterday's
  // stations are fair game.
  const day = (i: number, call: string, d: number) => ({ ...contact(i, call), startAtMillis: Date.UTC(2026, 6, d, 12, i) })
  const calls = ["W1AW", "SP9ABC", "G4ABC", "DL1ABC", "F4JXY"]
  const result = (await hota.runHook("scoring", "scoreQsos", {
    operation: { uuid: "op", stationCall: "YO3BEE", refs: [SITE] },
    qsos: [...calls.map((c, i) => day(i, c, 1)), ...calls.map((c, i) => day(10 + i, c, 2))],
    ref: SITE,
  })) as { daySections: { scores: { activation: { activated: boolean } } }[] }
  assert.deepEqual(result.daySections.map((d) => d.scores.activation.activated), [true, true])
})
