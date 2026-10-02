// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { test } from "node:test"

import { loadExtension } from "./sdkGapTesting.ts"

const panel = await loadExtension(() => import("./index.ts"))
const { renderMatches, searchQsos, typedPartial } = await import("./index.ts")

const q = (call: string, startAtMillis: number, extra: Record<string, unknown> = {}) =>
  ({ band: "20m", mode: "SSB", startAtMillis, their: { call }, ...extra }) as never

const log = [q("KM4BE", 3), q("W8ABE", 2), q("VE3BEP", 1), q("K1ABC", 4), q("KM4BE", 1)]

test("substring match finds the call anywhere in it, newest first", () => {
  assert.deepEqual(searchQsos(log, "be", 10).map((m) => m.call), ["KM4BE", "W8ABE", "VE3BEP"])
})

test("repeat contacts collapse into one row", () => {
  const [m] = searchQsos(log, "km4", 10)
  assert.equal(m.count, 2)
  assert.equal(m.millis, 3)
})

test("limit and empty needle", () => {
  assert.equal(searchQsos(log, "be", 2).length, 2)
  assert.deepEqual(searchQsos(log, "", 10), [])
})

test("event markers are skipped", () => {
  assert.deepEqual(searchQsos([q("BEEP", 1, { band: "event" })], "be", 10), [])
})

test("the partial comes from the cursor segment, else the whole field", () => {
  assert.equal(typedPartial({ their: { call: "k1abc,be" }, callField: { partial: "be" } }), "BE")
  assert.equal(typedPartial({ their: { call: "be" } }), "BE")
  assert.equal(typedPartial(undefined), "")
})

test("table escapes pipes and shows a no-match note", () => {
  assert.match(renderMatches([], "ZZ"), /No logged callsign/)
  assert.match(renderMatches(searchQsos([q("KM4BE", 1, { their: { call: "KM4BE", name: "a|b" } })], "be", 5), "be"), /a\\\|b/)
})

test("render respects the minimum and reads the operation's log", async () => {
  const render = async (config: Record<string, unknown>, call: string) =>
    (await panel.runHook(
      "panel",
      "render",
      { panelKey: "search", operation: { uuid: "op" }, qsoCount: 5, reason: "", config, qso: { their: { call } } },
      { ctx: { getQsos: async () => log } },
    )) as { content: string }
  assert.match((await render({}, "b")).content, /at least 2/)
  assert.match((await render({}, "be")).content, /W8ABE/)
  assert.match((await render({ minLetters: 1 }, "b")).content, /VE3BEP/)
})
