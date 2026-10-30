// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The contest through its `scoring` HOOK — one call over a log, the way the
// app scores an operation — rather than by folding a scoresheet QSO by QSO the
// way scorer.test.ts does. That file pins the rules in isolation; this one
// pins what the operator is shown once they are applied together, and it fails
// if the hook stops being registered at all (the SDK harness in sdkGapTesting.ts).

import { test } from "node:test"
import assert from "node:assert/strict"

import { fixtureOperation, loadExtension } from "./sdkGapTesting.ts"

const cqww = await loadExtension(() => import("./index.ts"))

const ref = { type: "cqww", mode: "SSB" }
/// A US station: "our continent" is NA and "our country" K, which is what the
/// per-QSO points below are relative to.
const operation = fixtureOperation({ stationCall: "N0DEV", refs: [ref] })

const qso = (call: string, band = "20m") => ({
  uuid: `${call}-${band}`,
  startAtMillis: Date.UTC(2026, 0, 1, 12, 0, 0),
  band,
  mode: "SSB",
  their: { call },
})

test("points follow the worked station's distance, and every one is a zone and a country", async () => {
  // CQWW pays 3 points across continents, 0 inside your own country — and a
  // contact that scores nothing can still bring multipliers, which is the part
  // a scorer that returned early on zero points would silently lose.
  const result = (await cqww.runHook("scoring", "scoreQsos", {
    operation,
    ref,
    qsos: [qso("DL1ABC"), qso("JA1XYZ"), qso("W1AW")],
  })) as {
    qsoScores: Record<string, { value: number }>
    operationSummary: Record<string, { total: number; points: number; mults: number; label?: string; longSummary?: string }>
  }

  assert.equal(result.qsoScores["DL1ABC-20m"].value, 3, "Germany, another continent")
  assert.equal(result.qsoScores["JA1XYZ-20m"].value, 3, "Japan, another continent")
  assert.equal(result.qsoScores["W1AW-20m"].value, 0, "same country")

  const summary = result.operationSummary.cqww
  assert.equal(summary.points, 6)
  assert.equal(summary.mults, 6, "three zones and three countries, all new on 20m")
  assert.equal(summary.total, 36, "points × mults is the score the operator reads")
  assert.equal(summary.label, "CQWW SSB: 36 points")
  // Zones and countries are different things to chase; the split says which
  // the log is short of.
  assert.equal(summary.longSummary?.split("\n")[0], "3 QSOs, 6 pts × 6 mults (3 zones, 3 countries)")
})

test("the same country on a second band is a fresh multiplier", async () => {
  // Multipliers are per band in CQWW; counting them once for the operation
  // would under-report every multi-band log.
  const result = (await cqww.runHook("scoring", "scoreQsos", {
    operation,
    ref,
    qsos: [qso("DL1ABC", "20m"), qso("DL1ABC", "40m")],
  })) as { operationSummary: Record<string, { mults: number }> }

  assert.equal(result.operationSummary.cqww.mults, 4, "zone and country, on each of two bands")
})

test("the activity search offers all three runnings, the nearest first, labelled as the operation will show them", async (t) => {
  // Mid October: SSB is days away, CW a month, RTTY eleven months. Ranking by
  // a fixed order instead of the calendar would lead with RTTY all year.
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 15) })
  const suggestions = (await cqww.runHook("activity", "suggest", { searchTerm: "cq" })) as {
    mode: string
    name: string
    label: string
    shortLabel: string
    relevance: number
  }[]

  const ranked = [...suggestions].sort((a, b) => b.relevance - a.relevance).map((s) => s.mode)
  assert.deepEqual(ranked, ["SSB", "CW", "RTTY"])

  // Each names the weekend it runs — RTTY already past, so next year's.
  const dates = Object.fromEntries(suggestions.map((s) => [s.mode, s.name.split(" • ")[1]]))
  assert.deepEqual(dates, { SSB: "2026-10-24", CW: "2026-11-28", RTTY: "2027-09-25" })

  // A suggestion is saved verbatim; a label that differs from decorateRef's
  // would change the moment the operation is edited.
  const ssb = suggestions.find((s) => s.mode === "SSB")!
  const decorated = (await cqww.runHook("ref:cqww", "decorateRef", { ref: { type: "cqww", mode: "SSB" } })) as { label: string; shortLabel: string }
  assert.equal(ssb.label, decorated.label)
  assert.equal(ssb.shortLabel, decorated.shortLabel)
})

test("an operation already running CQ WW is offered nothing", async () => {
  // A suggestion has no `ref` for the picker's duplicate guard to match, so
  // tapping one would replace the configured ref and lose its zone.
  const configured = fixtureOperation({ stationCall: "N0DEV", refs: [{ type: "cqww", mode: "CW", zone: "5" }] })
  assert.deepEqual(await cqww.runHook("activity", "suggest", { operation: configured, searchTerm: "cq" }), [])
})

test("the activity search stays out of unrelated searches", async () => {
  assert.deepEqual(await cqww.runHook("activity", "suggest", { searchTerm: "pota" }), [])
})

test("a contest links to its rules, configured or not", async () => {
  // A contest ref names an event, so what there is to read is its rules — and
  // they are worth reading before the exchange is filled in, when the ref
  // holds no value yet.
  for (const ref of [{ type: "cqww", ref: "CQWW" }, { type: "cqww" }]) {
    const link = (await cqww.runHook("ref:cqww", "linkForRef", { ref })) as { url: string } | null
    assert.equal(link?.url, "https://www.cqww.com/rules.htm")
  }
})

// A segmented operation: the SDK's scoring harness hands each QSO the ref its
// own segment restates. The first segment starts at the timeline's floor,
// `-1 << 62`, the way the app writes it.
const DAWN = -4611686018427387904
const segmentQso = (i: number, call: string, mode = "CW") => ({
  uuid: `q${i}`,
  startAtMillis: Date.UTC(2026, 2, 28, 12, i),
  band: "20m",
  mode,
  our: { call: "N0DEV" },
  their: { call },
})
const segment = (fromMillis: number, mode: string) => ({
  fromMillis,
  operation: { uuid: "op", stationCall: "N0DEV", refs: [{ type: "cqww", mode }] },
})

test("a segment that changes the contest mode changes what scores", async () => {
  // An operator who switches CQ WW from CW to SSB mid-log: the CW contact
  // after the switch is off-mode. A harness that ignored the segments would
  // score both.
  const cw = { type: "cqww", mode: "CW" }
  const later = segmentQso(10, "JA1ABC")
  const result = (await cqww.runHook("scoring", "scoreQsos", {
    operation: fixtureOperation({ stationCall: "N0DEV", refs: [cw] }),
    ref: cw,
    qsos: [segmentQso(0, "DL1ABC"), later],
    segments: [segment(DAWN, "CW"), segment(later.startAtMillis, "SSB")],
  })) as {
    qsoScores: Record<string, { value: number; alerts?: string[] }>
    operationSummary: Record<string, { qsos: number }>
  }

  assert.equal(result.operationSummary.cqww.qsos, 1)
  assert.ok(result.qsoScores.q0.value > 0)
  assert.equal(result.qsoScores.q10.value, 0)
  assert.ok(result.qsoScores.q10.alerts?.includes("invalidMode"))
})

test("a single segment is not a timeline: the ref passed in is the one scored", async () => {
  // One segment restating SSB, a CW selection ref, SSB contacts: the harness
  // takes its unsegmented path, so the CW ref stands and nothing scores.
  const cw = { type: "cqww", mode: "CW" }
  const result = (await cqww.runHook("scoring", "scoreQsos", {
    operation: fixtureOperation({ stationCall: "N0DEV", refs: [cw] }),
    ref: cw,
    qsos: [segmentQso(0, "DL1ABC", "SSB"), segmentQso(10, "JA1ABC", "SSB")],
    segments: [segment(DAWN, "SSB")],
  })) as { operationSummary: Record<string, { qsos: number }> }

  assert.equal(result.operationSummary.cqww.qsos, 0)
})

test("the ref states the rules for its operator class, and only what they forbid", async () => {
  // The host forces a switch off for any ref holding `false`, and reads an
  // absent key as no say: a ref re-decorated after the class changed has to
  // drop the `false` the old class left on it.
  const decorate = async (extra: Record<string, unknown>) =>
    (await cqww.runHook("ref:cqww", "decorateRef", { ref: { type: "cqww", mode: "CW", ...extra } })) as Record<string, unknown>

  const single = await decorate({ operator: "SINGLE-OP" })
  assert.equal(single.assistance, false)
  assert.equal(single.selfSpotting, false)

  const assisted = await decorate({ operator: "SINGLE-OP-ASSISTED", assistance: false })
  assert.equal("assistance" in assisted, false)
  // Nobody self-spots in CQ WW, whatever the class — undeclared included.
  assert.equal(assisted.selfSpotting, false)
  assert.equal((await decorate({})).selfSpotting, false)

  // A suggestion is stored without ever being decorated, so it carries the
  // rule that holds for every class.
  const suggestions = (await cqww.runHook("activity", "suggest", { searchTerm: "cq" })) as Record<string, unknown>[]
  assert.ok(suggestions.every((s) => s.selfSpotting === false && !("assistance" in s)))
})

test("the setup form shows the rules line that follows the operator class", async () => {
  const controls = (await cqww.runHook("activity", "operationControls", { operation })) as {
    input: { form: { elements: { type: string; key?: string; text?: string; visibleWhen?: { field: string; equals: unknown[] } }[] } }
  }[]
  const elements = controls[0].input.form.elements
  const notes = elements.filter((el) => el.type === "markdown")
  const shownFor = (op: string) => notes.filter((el) => el.visibleWhen?.equals.includes(op)).map((el) => el.text)
  assert.deepEqual(shownFor("SINGLE-OP"), ["🔴 Assistance: OFF, 🔴 Self-spotting: OFF"])
  assert.deepEqual(shownFor("MULTI-ONE"), ["🟢 Assistance: ON, 🔴 Self-spotting: OFF"])
  // After the exchange questions, before the entry ones.
  const at = (key: string) => elements.findIndex((el) => el.key === key)
  const first = elements.indexOf(notes[0])
  assert.ok(at("qth") < first && first < at("operator"))
})
