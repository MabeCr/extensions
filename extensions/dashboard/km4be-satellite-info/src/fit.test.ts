// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// The list is set in one monospaced face at a size chosen to fit the pane's room, however large the operator's text.

import assert from "node:assert/strict"
import { test } from "node:test"

import { ELEMENTS_URL, LIST_URL, statusUrl } from "./data.ts"
import { ELEMENTS, LIST, SUMMARY } from "./fixtures.ts"
import { forgetAll } from "./memory.ts"
import { table } from "./passes.ts"
import type { Cells } from "./passes.ts"
import { DEFAULT_LOOK, fitSize, listLook, MIN_ROW_SIZE, rowSize } from "./scene.ts"
import { datasetCalls } from "./datasetTesting.ts"
import { loadExtension } from "./sdkGapTesting.ts"

const ctx = { online: true }
const t0 = Date.parse("2026-10-07T00:00:00Z")
const cfg = { grid: "EL95vs", utc: true, minElevation: 0, listSeconds: true }
let panes = 0

/// A pane as the host reports it: its size, the colors, and the monospaced face with the operator's text scaling.
const environment = (width: number, scale: number, family: string | null = "RobotoMono") => ({
  version: 1,
  width,
  height: 800,
  colors: { primary: "#112233", onSurfaceVariant: "#445566" },
  typography: { mono: { fontFamily: family, fontSize: 13, scaledFontSize: 13 * scale } },
})

async function panel(env?: ReturnType<typeof environment>) {
  forgetAll()
  const id = ++panes
  const ext = await loadExtension(() => import("./index.ts"), {
    hostCalls: {
      ...datasetCalls().hostCalls,
      getLocation: () => null,
      kvGet: () => null,
      kvSet: () => undefined,
      fetch: (params) => {
        const url = String(params.url)
        return url === LIST_URL
          ? { status: 200, body: JSON.stringify(LIST) }
          : url === ELEMENTS_URL
            ? { status: 200, body: JSON.stringify(ELEMENTS) }
            : url === statusUrl(24)
              ? { status: 200, body: JSON.stringify(SUMMARY) }
              : { status: 404, body: "" }
      },
    },
  })
  type Layer = { id: string; x: number; y: number; width: number; icon?: { name: string; color: string }; text: { value?: string; literal?: string; size: number; color: string; fontFamily: string } }
  return async (config: Record<string, unknown> = cfg) =>
    (
      (await ext.runHook(
        "panel",
        "render",
        { panelKey: "passes", instanceId: `fit-${id}`, operation: {}, qsoCount: 0, reason: "", config, clock: { nowMillis: t0, realNowMillis: t0 }, ...(env ? { environment: env } : {}) },
        { ctx },
      )) as { scene: { width: number; layers: Layer[]; strings: Record<string, string> } }
    ).scene
}

const cells = (n: number): Cells[] =>
  Array.from({ length: n }, () => ({ name: "BeliefSat-0", type: "Dig", start: "02:05:00Z+1", max: "9°", path: "NNE→SSW", length: "105m", mark: "✔" }))

test("how large a line can be set is what the pane's room allows, never more than the face's size", () => {
  const look = { ...DEFAULT_LOOK, width: 400, os: 1, size: 13 }
  const long = fitSize(60, look, true)
  const short = fitSize(20, look, true)
  assert.ok(long < short, "a longer line gets smaller text")
  assert.equal(short, 13, "a short one is set at the face's own size")
  assert.ok(fitSize(60, { ...look, os: 1.5 }, true) < long, "the operator's larger text makes room for fewer characters")
  assert.ok(fitSize(60, { ...look, width: 700 }, true) > long, "a wider pane makes room for more")
  assert.equal(rowSize(7), MIN_ROW_SIZE, "and nothing is drawn smaller than it can be read")
  assert.equal(rowSize(12), 12)
})

test("the look comes from what the host reports, and a host that reports nothing gets a fitting default", () => {
  assert.deepEqual(listLook(undefined, true), DEFAULT_LOOK)
  const look = listLook(environment(411, 1.3), true)
  assert.deepEqual([look.width, look.family, look.size, look.text, look.title], [411 - 16, "RobotoMono", 13, "#112233", "#445566"])
  assert.ok(Math.abs(look.os - 1.3) < 1e-9)
  assert.equal(listLook(environment(411, 1), false).width, 411 - 24, "the roomy padding takes more")
  assert.equal(listLook(environment(411, 1, null), true).family, "monospace", "no face named, the generic monospace")
  assert.equal(listLook({ width: 0 }, true).width, DEFAULT_LOOK.width)
})

test("the titles and the rows are drawn as text in one face at one size, in the colors the host gives", async () => {
  const render = await panel(environment(411, 1.3))
  const scene = await render()
  // Every piece of text, the key to the marks included, is in the one face at the one size. The icons are not text.
  const texts = scene.layers.filter((l) => l.text)
  assert.equal(new Set(texts.map((l) => l.text.size)).size, 1)
  assert.equal(new Set(texts.map((l) => l.text.fontFamily)).size, 1)
  const lines = scene.layers.filter((l) => /^(columns|row\d+)$/.test(l.id))
  const rowKeys = Object.keys(scene.strings).filter((k) => /^row\d+$/.test(k))
  assert.ok(rowKeys.length > 5)
  // The rows are first, and the header, which stays and is drawn over them as they scroll under it, after.
  assert.deepEqual(lines.map((l) => l.text.value), [...rowKeys.map((_, i) => `row${i}`), "columns"])
  const titles = lines[lines.length - 1]
  assert.equal(titles.text.fontFamily, "RobotoMono")
  assert.equal(titles.text.color, "#445566")
  assert.ok(lines.slice(0, -1).every((l) => l.text.color === "#112233" || l.text.color === "#43a047"), "the primary color, or green for a pass that is up")
  assert.equal(new Set(lines.map((l) => l.x)).size, 1, "all start at the same place, so the columns line up")
  assert.equal(scene.width, 411, "as wide as the pane, which scrolls")
})

test("on a phone with the operator's text enlarged, the text is made smaller to fit, and every column stays", async () => {
  // Without seconds, which add three characters to every line.
  const plain = { ...cfg, listSeconds: false }
  const normal = await (await panel(environment(411, 1)))(plain)
  const large = await (await panel(environment(411, 1.3)))(plain)
  assert.ok(large.layers[0].text.size < normal.layers[0].text.size, "larger text, more shrunk")
  assert.ok(large.layers[0].text.size >= MIN_ROW_SIZE)
  for (const scene of [normal, large]) {
    assert.match(scene.strings.columns, /^Sat +Type +Start +Max +Path +Len$/, "all the columns")
    assert.ok([0, 1, 2, 3, 4].every((i) => /\d+m/.test(scene.strings[`row${i}`])), "with their lengths")
  }
})

test("when even the smallest readable text will not fit a line, the length goes first, then the transponder's kind", async () => {
  // Seconds on, as the longest lines are.
  const roomy = await (await panel(environment(411, 1)))()
  assert.match(roomy.strings.columns, /Type +Start +Max +Path +Len$/)
  const tight = await (await panel(environment(400, 1.3)))()
  assert.doesNotMatch(tight.strings.columns, /Len/)
  assert.match(tight.strings.columns, /Type/)
  assert.ok(tight.layers[0].text.size >= MIN_ROW_SIZE)
  const tightest = await (await panel(environment(340, 1.3)))()
  assert.match(tightest.strings.columns, /^Sat +Start +Max +Path$/)
  assert.equal(tightest.layers[0].text.size, MIN_ROW_SIZE, "and the text is as small as it is allowed to be")
})

test("leaving columns out keeps the rest lined up under their titles", () => {
  const rows = cells(2)
  const full = table(rows, " ")
  const less = table(rows, " ", ["length", "type"])
  assert.match(less.columns, /^Sat +Start +Max +Path +Rpt$/)
  assert.ok(less.lines[0].length < full.lines[0].length)
  assert.equal(less.lines[0].indexOf("NNE→SSW"), less.columns.indexOf("Path"))
  assert.equal(less.lines[0].indexOf("02:05:00Z+1"), less.columns.indexOf("Start"))
})
