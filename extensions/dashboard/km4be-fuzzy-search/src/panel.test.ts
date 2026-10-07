// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { test } from "node:test"

import { loadExtension } from "./sdkGapTesting.ts"

const panel = await loadExtension(() => import("./index.ts"))
const { searchQsos, typedPartial } = await import("./index.ts")
const { escapeMarkdown, highlight, messageMarkdown, resultsMarkdown } = await import("./markdown.ts")

const q = (call: string, startAtMillis: number, extra: Record<string, unknown> = {}) =>
  ({ band: "20m", mode: "SSB", startAtMillis, their: { call }, ...extra }) as never

const log = [q("KM4BE", 3), q("W8ABE", 2), q("VE3BEP", 1), q("K1ABC", 4), q("KM4BE", 1)]
const many = (n: number) => Array.from({ length: n }, (_, i) => q(`K${i}ABE`, i + 1))

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

test("the matched letters are bold, every occurrence, whatever the case", () => {
  assert.equal(highlight("KM4BE", "be"), "KM4**BE**")
  assert.equal(highlight("BEBE1", "BE"), "**BE****BE**1")
  assert.equal(highlight("W8ABE", "zz"), "W8ABE")
  assert.equal(highlight("W8ABE", ""), "W8ABE")
})

test("everything from the log is text, never markup", () => {
  assert.equal(escapeMarkdown("a*b_c[d](e)"), String.raw`a\*b\_c\[d\](e)`)
  const out = resultsMarkdown(searchQsos([q("KM4BE", 1, { their: { call: "KM4BE", name: "**x** [y](http://z) a|b" } })], "be", 5), "be", 0)
  assert.ok(!out.includes("**x**"))
  assert.ok(out.includes(String.raw`\[y\]`))
  assert.ok(out.includes(String.raw`a\|b`))
})

test("a table: a header, an alignment row, then one row of four cells to a station", () => {
  const out = resultsMarkdown(searchQsos([q("KM4BE", 1, { their: { call: "KM4BE", name: "Chris" } })], "be", 5), "be", 0)
  const lines = out.split("\n")
  assert.equal(lines[2], "| Call | Band | Date | Name |")
  assert.equal(lines[3], "|:--|:--|:--|:--|")
  assert.equal(lines[4], "| KM4**BE** | 20m SSB | 1970-01-01 | Chris |")
  assert.equal(lines.length, 5)
})

test("repeat contacts show a count, and a trimmed list says how many are hidden", () => {
  const rows = searchQsos(log, "km4", 10)
  assert.ok(resultsMarkdown(rows, "km4", 0).includes("×2"))
  assert.ok(resultsMarkdown(rows, "km4", 5).includes("showing 1, keep typing"))
  assert.ok(resultsMarkdown(rows, "km4", 0).includes("1 station"))
  assert.ok(messageMarkdown("No match.").startsWith("_"))
})

test("render respects the minimum and reads the operation's log", async () => {
  const render = async (config: Record<string, unknown>, call: string, qsos = log) =>
    (await panel.runHook(
      "panel",
      "render",
      { panelKey: "search", operation: { uuid: "op" }, qsoCount: 5, reason: "", config, qso: { their: { call } } },
      { ctx: { getQsos: async () => qsos } },
    )) as { kind: string; content: string }
  assert.match((await render({}, "b")).content, /at least 2/)
  assert.match((await render({}, "zz")).content, /No logged callsign contains ZZ/)
  const hit = await render({}, "be")
  assert.equal(hit.kind, "markdown")
  assert.match(hit.content, /W8A\*\*BE\*\*/)
  assert.match((await render({ minLetters: 1 }, "b")).content, /VE3\*\*B\*\*EP/)
})

test("fifty stations fit when asked for, with nothing hidden", async () => {
  const content = (
    (await panel.runHook(
      "panel",
      "render",
      { panelKey: "search", operation: { uuid: "op" }, qsoCount: 5, reason: "", config: { maxResults: 50 }, qso: { their: { call: "be" } } },
      { ctx: { getQsos: async () => many(40) } },
    )) as { content: string }
  ).content
  // The header line, a blank, the table's header and alignment row, then 40 stations.
  assert.equal(content.split("\n").length, 44)
  assert.ok(!content.includes("keep typing"))
})
