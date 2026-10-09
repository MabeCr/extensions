// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { test } from "node:test"

import { buildCatalog, ELEMENTS_URL, LIST_URL, parseElements, parseList, statusUrl } from "./data.ts"
import { ELEMENTS, LIST, SUMMARY } from "./fixtures.ts"
import { forgetAll } from "./memory.ts"
import { clock, table } from "./passes.ts"
import type { Cells } from "./passes.ts"
import { COMFORTABLE, COMPACT, isCompact } from "./scene.ts"
import { loadExtension } from "./sdkGapTesting.ts"
import { LEGEND, LEGEND_COMPACT } from "./status.ts"

const t0 = Date.parse("2026-10-07T00:00:00Z")
void buildCatalog
void parseElements
void parseList

// --- which spacing a pane gets ---------------------------------------------------------------------

test("a small pane gets the tight spacing, a large one the roomy, and the setting can decide", () => {
  const phone = { width: 390, height: 700 }
  const sideways = { width: 800, height: 360 }
  const desktop = { width: 1000, height: 700 }
  assert.equal(isCompact({}, phone), true)
  assert.equal(isCompact({}, sideways), true, "a phone on its side is short")
  assert.equal(isCompact({}, desktop), false)
  assert.equal(isCompact({}, { width: 479, height: 900 }), true)
  assert.equal(isCompact({}, { width: 480, height: 520 }), false)
  assert.equal(isCompact({}, { width: 480, height: 519 }), true)
  // A host that does not say how big the pane is gets what the panel has always had.
  assert.equal(isCompact({}, undefined), false)
  assert.equal(isCompact({}, { width: 0, height: 0 }), false)
  // The setting overrides the size, either way; anything else is Automatic.
  assert.equal(isCompact({ density: "compact" }, desktop), true)
  assert.equal(isCompact({ density: "comfortable" }, phone), false)
  assert.equal(isCompact({ density: "auto" }, phone), true)
  assert.equal(isCompact({ density: "nonsense" }, desktop), false)
})

test("the roomy spacing is exactly what the panel had, so a desktop pane looks as it did", () => {
  assert.deepEqual(COMFORTABLE, { padding: 12, gap: 8, rowGap: 4, button: 56 })
  assert.ok(COMPACT.padding < COMFORTABLE.padding && COMPACT.gap < COMFORTABLE.gap && COMPACT.rowGap <= COMFORTABLE.rowGap && COMPACT.button < COMFORTABLE.button)
  assert.ok(COMPACT.rowHeight !== undefined && COMPACT.rowHeight >= 40, "rows are no shorter than a thumb can hit")
})

test("a start on another day is a count of days after today when short, and a date when not", () => {
  const now = Date.parse("2026-10-07T14:00:00Z")
  const tomorrow = Date.parse("2026-10-08T02:05:00Z")
  assert.equal(clock(tomorrow, now, true), "10-08 02:05Z")
  assert.equal(clock(tomorrow, now, true, false, true), "02:05Z+1")
  assert.equal(clock(tomorrow, now, true, true, true), "02:05:00Z+1")
  assert.equal(clock(Date.parse("2026-10-07T20:05:00Z"), now, true, false, true), "20:05Z", "today has nothing added")
  assert.equal(clock(Date.parse("2026-10-09T02:05:00Z"), now, true, false, true), "02:05Z+2")
  // Over a month's end it is still the next day.
  assert.equal(clock(Date.parse("2026-11-01T02:05:00Z"), Date.parse("2026-10-31T20:00:00Z"), true, false, true), "02:05Z+1")
})

test("one space between columns instead of two takes six characters off a line", () => {
  const rows: Cells[] = [
    { name: "AO-7", type: "SSB", start: "00:05Z", max: "46°", path: "S→NNW", length: "22m", mark: "✔" },
    { name: "BeliefSat-0", type: "Dig", start: "02:05Z+1", max: "9°", path: "NNE→SSW", length: "105m", mark: "◐" },
  ]
  const wide = table(rows)
  const tight = table(rows, " ")
  assert.equal(wide.lines[1].length - tight.lines[1].length, 6)
  assert.equal(wide.columns.length - tight.columns.length, 6)
  // Still lined up.
  tight.lines.forEach((line, i) => {
    assert.equal(line.indexOf(rows[i].start), tight.columns.indexOf("Start"))
    assert.equal(line.indexOf(rows[i].path), tight.columns.indexOf("Path"))
  })
})

// --- through the panel -------------------------------------------------------------------------

const ctx = { online: true }
let panes = 0

async function panel(environment?: { width: number; height: number }) {
  forgetAll()
  const id = ++panes
  const ext = await loadExtension(() => import("./index.ts"), {
    hostCalls: {
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
  const args = (config: Record<string, unknown>, at: number) => ({
    panelKey: "passes",
    instanceId: `density-${id}`,
    operation: {},
    qsoCount: 0,
    reason: "",
    config,
    clock: { nowMillis: at, realNowMillis: at },
    ...(environment ? { environment } : {}),
  })
  type Node = LayoutNode
  type Scene = { controls: { id: string; opacity?: number }[]; strings: Record<string, string>; layout: { column: Node[]; padding: number; spacing: number } }
  return {
    render: async (config: Record<string, unknown>, at = t0) => ((await ext.runHook("panel", "render", args(config, at), { ctx })) as { scene: Scene }).scene,
    event: async (config: Record<string, unknown>, at: number, controlId: string, action: string, extra: { text?: string } = {}) =>
      ext.runHook("panel", "onEvent", { ...args(config, at), event: { controlId, action, phase: "activate", sequence: 1, ...extra } }, { ctx }),
  }
}

const cfg = { grid: "EL95vs", utc: true, minElevation: 0 }
type LayoutNode = { row?: { control?: string; width?: number }[]; control?: string; spacing?: number; height?: number; padding?: number | number[]; spacer?: number }
const rowNodes = (nodes: LayoutNode[]) => nodes.filter((n) => n.row?.some((c) => c.control?.startsWith("star:")))
/// How many spaces separate the first two columns: what is left of the title row's start after the name column.
const nameGap = (columns: string, names: string[]) => columns.indexOf("Type") - Math.max("Sat".length, ...names.map((n) => n.length))

test("a desktop pane's list is laid out as it always was", async () => {
  const p = await panel({ width: 1000, height: 700 })
  const scene = await p.render(cfg)
  assert.equal(scene.layout.padding, 12)
  assert.equal(scene.layout.spacing, 8)
  const rows = rowNodes(scene.layout.column)
  assert.equal(rows.length, 5)
  for (const row of rows) {
    assert.equal(row.spacing, 4)
    assert.equal(row.height, undefined, "rows are as tall as their buttons")
    assert.deepEqual(row.row!.filter((c) => c.width).map((c) => c.width), [56, 56])
  }
  assert.deepEqual(scene.layout.column.find((n) => n.control === "columns")!.padding, [60, 0, 60, 0])
  assert.equal(scene.strings.legend, LEGEND)
  const names = [0, 1, 2, 3, 4].map((i) => scene.strings[`row${i}`]?.split(/ +/)[0]).filter(Boolean)
  assert.equal(nameGap(scene.strings.columns, names), 2, "two spaces between columns")
  assert.ok([0, 1, 2, 3, 4].every((i) => !/\+1\b/.test(scene.strings[`row${i}`] ?? "")))
})

test("the same list in a phone's pane is packed tighter, and has the same controls", async () => {
  const wide = await (await panel({ width: 1000, height: 700 })).render(cfg)
  const phone = await panel({ width: 390, height: 700 })
  const tight = await phone.render(cfg)

  assert.deepEqual(tight.controls.map((c) => c.id), wide.controls.map((c) => c.id), "only the layout differs")
  assert.equal(tight.layout.padding, 8)
  assert.equal(tight.layout.spacing, 3)
  const rows = rowNodes(tight.layout.column)
  for (const row of rows) {
    assert.equal(row.spacing, 2)
    assert.equal(row.height, 40)
    assert.deepEqual(row.row!.filter((c) => c.width).map((c) => c.width), [44, 44])
  }
  assert.deepEqual(tight.layout.column.find((n) => n.control === "columns")!.padding, [46, 0, 46, 0])
  const pager = (scene: typeof tight) => scene.layout.column.find((n) => n.row?.some((c) => c.control === "prev"))!
  assert.equal(pager(tight).height, 40, "the pager is no taller than a row")
  assert.equal(pager(wide).height, undefined, "and on a desktop is as it was")
  assert.equal(tight.strings.legend, LEGEND_COMPACT)
  assert.ok(LEGEND_COMPACT.length < 40 && LEGEND.length > 55)
  const tightNames = [0, 1, 2, 3, 4].map((i) => tight.strings[`row${i}`]?.split(/ +/)[0]).filter(Boolean)
  assert.equal(nameGap(tight.strings.columns, tightNames), 1, "one space between columns")
  assert.ok(tight.strings.columns.length < wide.strings.columns.length)

  // A row of the stack, rough: what the five rows and the gaps between all the lines take, comfortable against compact.
  const stack = (rowHeight: number, gap: number, lines: number) => 5 * rowHeight + gap * (lines - 1)
  assert.ok(stack(40, 3, 11) + 16 < stack(48, 8, 11) + 24, "a good deal less")
})

test("a later page of the phone's list shows tomorrow's passes as +1 and every line fits", async () => {
  const phone = await panel({ width: 390, height: 700 })
  const config = { ...cfg, minElevation: 0 }
  const lines: string[] = []
  // From six in the evening, so the next day's worth of passes crosses midnight.
  const evening = t0 + 18 * 3_600_000
  for (let page = 0; page < 8; page++) {
    const scene = await phone.render(config, evening)
    lines.push(...[0, 1, 2, 3, 4].map((i) => scene.strings[`row${i}`]).filter(Boolean))
    await phone.event(config, evening, "next", "next")
  }
  assert.ok(lines.some((l) => /\d\d:\d\dZ\+1\b/.test(l)), "something is tomorrow")
  assert.ok(lines.every((l) => !/\d\d-\d\d /.test(l)), "and no line carries a date")
  // About what fits between two 44-pixel buttons on 390 pixels in a monospaced face: 36 characters.
  assert.ok(lines.every((l) => l.length <= 36), `the longest is ${Math.max(...lines.map((l) => l.length))}: ${lines.sort((a, b) => b.length - a.length)[0]}`)
})

test("the Spacing setting overrides the pane's size", async () => {
  const bigButTight = await (await panel({ width: 1000, height: 700 })).render({ ...cfg, density: "compact" })
  assert.equal(bigButTight.layout.padding, 8)
  const smallButRoomy = await (await panel({ width: 390, height: 700 })).render({ ...cfg, density: "comfortable" })
  assert.equal(smallButRoomy.layout.padding, 12)
  assert.equal(smallButRoomy.layout.spacing, 8)
  const roomyNames = [0, 1, 2, 3, 4].map((i) => smallButRoomy.strings[`row${i}`]?.split(/ +/)[0]).filter(Boolean)
  assert.equal(nameGap(smallButRoomy.strings.columns, roomyNames), 2)
  // And a host that does not report the pane's size gets the roomy layout.
  assert.equal((await (await panel()).render(cfg)).layout.padding, 12)
})

test("the pass's page is packed tighter in a phone's pane too, and as it was on a desktop's", async () => {
  type Sceneish = { layout: { column: unknown[]; padding: number; spacing: number } }
  const open = async (environment?: { width: number; height: number }) => {
    const p = await panel(environment)
    const list = await p.render(cfg)
    const target = list.controls.find((c) => c.id.startsWith("open:") && c.opacity !== 0)!
    await p.event(cfg, t0, target.id, "open")
    return (await p.render(cfg)) as unknown as Sceneish
  }
  const desktop = await open({ width: 1000, height: 700 })
  assert.equal(desktop.layout.padding, 12)
  assert.equal(desktop.layout.spacing, 8)
  const phone = await open({ width: 390, height: 700 })
  assert.equal(phone.layout.padding, 8)
  assert.equal(phone.layout.spacing, 3)
})
