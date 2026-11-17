// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The panel through its hooks, against a stand-in host: which calls it
// draws and how, how it arranges and explains them, and what a tap does.

import { test } from "node:test"
import assert from "node:assert/strict"

import { fixtureOperation, loadExtension } from "./sdkGapTesting.ts"

const drafts: Record<string, unknown>[] = []
let draftAccepted = true
const scoreBatches: number[] = []
let findCallsAsked = 0

const partialCalls = await loadExtension(() => import("./index.ts"), {
  hostCalls: {
    dbLookupFindCalls: (params) =>
      String(params.call).startsWith("K1A")
        ? [
            { key: "K1ABD", match: "partial", data: { rate: 900 } },
            ...Array.from({ length: 26 }, (_, i) => ({ key: `K1A${String.fromCharCode(65 + i)}Z`, match: "partial", data: { rate: 1 } })),
          ]
        : [],
    draftSuggestionsPost: () => ({ accepted: true }),
    draftSuggestionsClear: () => null,
    updateDraft: (params) => {
      drafts.push(params)
      return { accepted: draftAccepted }
    },
  },
})

const contest = fixtureOperation({ uuid: "op-contest", refs: [{ type: "cqww", contest: true }] })
const park = fixtureOperation({ uuid: "op-park", refs: [{ type: "potaActivation", ref: "US-0001" }] })

const ctx = {
  findCalls: async (call: string, options: Record<string, unknown>) => {
    findCallsAsked++
    if (!call.startsWith("K1A")) return []
    if (options.operation) return [{ call: "K1ABC", match: "partial", count: 1, lastAtMillis: 1 }]
    if (options.refType) return [{ call: "K1AX", match: "partial", count: 2, lastAtMillis: 1 }]
    return [
      { call: "K1AB", match: "oneEdit", count: 3, lastAtMillis: Date.UTC(2025, 5, 1) },
      { call: "K1A", match: "exact", count: 1, lastAtMillis: null },
    ]
  },
  scoreCandidates: async (candidates: Record<string, unknown>) => {
    scoreBatches.push(Object.keys(candidates).length)
    return {
      ...Object.fromEntries(Object.keys(candidates).map((call) => [call, { notices: [], alerts: [] }])),
      ...("K1ABC" in candidates ? { K1ABC: { notices: ["duplicate"], alerts: [] } } : {}),
      ...("K1AX" in candidates ? { K1AX: { notices: ["newMult"], alerts: [] } } : {}),
    }
  },
}

const environment = {
  width: 400,
  height: 300,
  brightness: "light",
  colors: { onSurface: "#111111", onSurfaceVariant: "#555555", error: "#BB0000" },
  typography: { mono: { fontFamily: "Mono", fontSize: 14 }, label: { fontFamily: null, fontSize: 12 } },
}

let tick = 0
const render = (operation: Record<string, unknown>, call: string, config: Record<string, unknown> = {}, options: { ctx?: unknown; environment?: unknown } = {}) => {
  // Far enough apart that each render asks afresh, as a keystroke a while
  // after the last does.
  tick += 10_000
  return partialCalls.runHook(
    "panel",
    "render",
    {
      panelKey: "matches",
      operation,
      qso: { their: { call }, mode: "CW", band: "20m" },
      qsoCount: 0,
      config,
      reason: "qso",
      environment: options.environment ?? environment,
      clock: { nowMillis: tick, realNowMillis: tick },
    },
    { ctx: (options.ctx ?? ctx) as never },
  ) as Promise<{ kind: string; scene: Record<string, any> }>
}

const calls = (scene: Record<string, any>) => scene.controls.filter((c: { id: string }) => c.id.startsWith("pick:")).map((c: { label: string }) => c.label)
const callLayer = (scene: Record<string, any>, call: string) => {
  const index = calls(scene).indexOf(call)
  // The call's first run of letters: the ones typed, in the call's own colour.
  return scene.layers.find((layer: { id: string }) => layer.id === `c${index}-call-0`)
}

test("the panel lists more calls than the line offers, likeliest first", async () => {
  const { kind, scene } = await render(contest, "K1A")
  assert.equal(kind, "scene")
  const shown = calls(scene)
  assert.equal(shown.length, 30, "SCP's rows past the logs' fill it to thirty")
  assert.deepEqual(shown.slice(0, 4), ["K1ABC", "K1AX", "K1A", "K1AB"])
})

// The panel reads a call the way the line under the call info does, so the
// operator never has to learn two codes.
test("a dupe is red and struck through, a mult is orange and bold, the call typed is green and bold, one worked here is bold", async () => {
  const { scene } = await render(contest, "K1A")
  const dupe = callLayer(scene, "K1ABC")
  assert.equal(dupe.text.color, "#BB0000")
  assert.equal(dupe.text.fontWeight, 400, "a dupe's red and strike say it; bold is kept for the call typed")
  assert.ok(scene.layers.some((layer: { id: string }) => layer.id === `c${calls(scene).indexOf("K1ABC")}-strike`))
  assert.deepEqual([callLayer(scene, "K1AX").text.color, callLayer(scene, "K1AX").text.fontWeight], ["#C2500F", 700])
  assert.deepEqual([callLayer(scene, "K1A").text.color, callLayer(scene, "K1A").text.fontWeight], ["#1AA01A", 700])
  assert.deepEqual([callLayer(scene, "K1AB").text.color, callLayer(scene, "K1AB").text.fontWeight], ["#111111", 400])
  assert.equal(scene.layers.filter((layer: { id: string }) => layer.id.endsWith("-strike")).length, 1, "only the dupe is struck")
})

// `scoreCandidates` rejects more than twenty calls: thirty shown must be asked
// about in batches, or the last ten would show no verdicts.
test("the verdicts for thirty calls are asked twenty at a time", async () => {
  scoreBatches.length = 0
  await render(contest, "K1A")
  assert.deepEqual(scoreBatches, [20, 10])
})

test("arranged by source, each call is under the strongest place it was found, and by match the close ones come first", async () => {
  const bySource = (await render(contest, "K1A", { arrange: "source" })).scene
  const titles = bySource.layout.grid.map((group: { style?: { title?: string } }) => group.style?.title)
  assert.deepEqual(titles, ["Worked here", "In this contest before", "In your logs", "Super Check Partial"])
  assert.deepEqual(bySource.layout.grid[0].grid.length, 1, "K1ABC alone was worked here")

  const byMatch = (await render(contest, "K1A", { arrange: "match" })).scene
  assert.deepEqual(
    byMatch.layout.grid.map((group: { style?: { title?: string } }) => group.style?.title),
    ["Containing what you typed", "One character off"],
  )
  const oneOff = byMatch.layout.grid[1].grid.map((node: { cell: string }) => byMatch.controls.find((c: { cell: string }) => c.cell === node.cell).label)
  assert.deepEqual(oneOff, ["K1AB"])
})

test("explained, each call says what the scorers and the sources said of it", async () => {
  const { scene } = await render(contest, "K1A", { explain: true })
  const why = (call: string) => scene.layers.find((layer: { id: string }) => layer.id === `c${calls(scene).indexOf(call)}-why`).text.literal
  assert.equal(why("K1ABC"), "Dupe · Worked here")
  assert.equal(why("K1AX"), "New mult · In this contest 2× before")
  assert.equal(why("K1AB"), "3× in your logs, last in 2025 · One character off")
  assert.equal(why("K1ABD"), "In SCP")
})

// Placing the panel is the operator asking for it: Only for Contests keeps
// the line quiet outside a contest, never the panel.
test("the panel lists calls outside a contest too", async () => {
  const { scene } = await render(park, "K1A")
  assert.ok(calls(scene).length > 0)
})

test("under three characters, the panel asks for more and searches nothing", async () => {
  findCallsAsked = 0
  const { scene } = await render(contest, "K1")
  assert.equal(findCallsAsked, 0)
  assert.equal(scene.controls[0].label, "Type three or more characters of a call")
})

// Each letter says how the call differs from what was typed, so the
// operator sees at a glance which character the call turns on.
test("each letter is green where the call adds one", async () => {
  const { scene } = await render(contest, "K1A")
  const runs = (call: string) =>
    scene.layers
      .filter((layer: { id: string }) => layer.id.startsWith(`c${calls(scene).indexOf(call)}-call-`))
      .map((layer: { text: { literal: string; color: string } }) => [layer.text.literal, layer.text.color])
  assert.deepEqual(runs("K1AB"), [["K1A", "#111111"], ["B", "#00B400"]])
  assert.deepEqual(runs("K1ABC"), [["K1A", "#BB0000"], ["BC", "#00B400"]], "a dupe's typed letters stay red")
})

// A tap is a pick, as from the line: the call changes and the exchange the
// operator already typed stays.
test("a tap puts the call in the call field, and nothing else", async () => {
  drafts.length = 0
  await partialCalls.runHook(
    "panel",
    "onEvent",
    {
      panelKey: "matches",
      operation: contest,
      qsoCount: 0,
      config: {},
      reason: "event",
      event: { controlId: "pick:K1ABD", action: "pick", phase: "activate", sequence: 1 },
    },
    { ctx: ctx as never },
  )
  assert.deepEqual(drafts, [{ patch: { their: { call: "K1ABD" } }, operationUuid: "op-contest" }])
})

// The line and the panel wake for the same keystroke; without the shared
// search every keystroke would ask each source twice.
test("the line and the panel asking about one keystroke search once", async () => {
  findCallsAsked = 0
  tick += 10_000
  const clock = { nowMillis: tick, realNowMillis: tick }
  const qso = { their: { call: "K1AB" }, mode: "CW", band: "20m" }
  await partialCalls.runHook(
    "assistant",
    "observe",
    { assistantKey: "suggest", operation: contest, qso, qsoCount: 0, config: {}, reasons: ["qso"], clock },
    { ctx: ctx as never },
  )
  const asked = findCallsAsked
  await partialCalls.runHook(
    "panel",
    "render",
    { panelKey: "matches", operation: contest, qso, qsoCount: 0, config: {}, reason: "qso", environment, clock: { ...clock, realNowMillis: tick + 500 } },
    { ctx: ctx as never },
  )
  assert.equal(asked, 3)
  assert.equal(findCallsAsked, asked, "the panel took the line's answer")
})

const pick = (call: string, operation: Record<string, unknown> = contest) =>
  partialCalls.runHook(
    "panel",
    "onEvent",
    { panelKey: "matches", operation, qsoCount: 0, config: {}, reason: "event", event: { controlId: `pick:${call}`, action: "pick", phase: "activate", sequence: 1 } },
    { ctx: ctx as never },
  )

// The line keeps its list while a pick stands; without the same here, a tap
// would replace the thirty calls with the picked call's own matches, and a
// wrong tap could only be put right by typing the call again.
test("after a tap the panel keeps the list it was picked from, the pick marked, until the field reads anything else", async () => {
  const before = calls((await render(contest, "K1A")).scene)
  await pick("K1AB")
  const after = (await render(contest, "K1AB")).scene
  assert.deepEqual(calls(after), before)
  assert.equal(callLayer(after, "K1AB").text.color, "#1AA01A", "the pick reads as the call the field holds")
  assert.equal(after.layers.find((layer: { id: string }) => layer.id === `c${calls(after).indexOf("K1AB")}-call-1`)?.text.literal, "B", "its letters still against the text typed")
  const typedOver = (await render(contest, "W1AW")).scene
  assert.equal(typedOver.controls[0].label, "No calls match W1AW", "anything else typed leaves the held list for a search of its own")
})

// A tap the app refuses must say so, or the operator sees nothing happen.
test("a tap the app refuses fails the action, so the pane says so", async () => {
  draftAccepted = false
  try {
    await assert.rejects(pick("K1AB"), /could not be put in the call field/)
  } finally {
    draftAccepted = true
  }
})

// Laid out at the unscaled size, a larger OS text size would run each
// coloured run into the next.
test("the letters are placed at the size the OS text scaling draws them", async () => {
  const large = { ...environment, typography: { ...environment.typography, mono: { fontFamily: "Mono", fontSize: 14, scaledFontSize: 21 } } }
  const { scene } = await render(contest, "K1A", {}, { environment: large })
  const second = scene.layers.find((layer: { id: string }) => layer.id === `c${calls(scene).indexOf("K1AB")}-call-1`)
  assert.equal(second.x, 6 + Math.round(3 * 21 * 0.6))
  assert.equal(second.text.size, 14, "the text keeps its unscaled size; the app scales it")
})

// Unmarked, a dupe would look as safe to pick as any call.
test("when the scorers fail, the calls still show, and the pane says dupes and mults went unchecked", async () => {
  const failing = { ...ctx, scoreCandidates: async () => Promise.reject(new Error("scorer broke")) }
  const { scene } = await render(contest, "K1A", {}, { ctx: failing })
  assert.ok(calls(scene).length > 0)
  assert.equal(scene.layout.style?.title, "Dupes and mults could not be checked")
})

test("when a source fails and others answer, their calls show, and the pane says some may be missing", async () => {
  const failing = { ...ctx, findCalls: async (call: string, options: Record<string, unknown>) => (options.operation ? Promise.reject(new Error("log unreadable")) : ctx.findCalls(call, options)) }
  const { scene } = await render(contest, "K1A", {}, { ctx: failing })
  assert.ok(calls(scene).length > 0)
  assert.equal(scene.layout.style?.title, "Some sources didn't answer: calls may be missing")
})

