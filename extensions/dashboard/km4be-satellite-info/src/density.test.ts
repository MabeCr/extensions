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
  assert.deepEqual({ ...COMFORTABLE, headRow: 0 }, { padding: 12, gap: 8, rowGap: 4, button: 56, headRow: 0 })
  // The back button and the tabs of a pass's page are a little smaller than they are drawn by default, the compact ones more.
  assert.ok(COMPACT.headRow < COMFORTABLE.headRow && COMFORTABLE.headRow < 40 && COMPACT.headRow >= 28)
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
type LayoutNode = { row?: { control?: string; width?: number }[]; control?: string; spacing?: number; height?: number; padding?: number | number[]; spacer?: number; scene?: boolean }
type TestLayer = { id: string; x: number; y: number; width: number; icon?: { name: string; color: string }; text?: { literal?: string; value?: string; size: number; color: string; fontFamily: string } }
const layersOf = (scene: unknown): TestLayer[] => (scene as { layers: TestLayer[] }).layers
type Geometry = { id: string; kind?: string; x?: number; y?: number; width?: number; height?: number; opacity?: number }
/// Where the list's controls are in its artwork, by the kind of control.
const geometry = (scene: { controls: Geometry[] }) => {
  const of = (test: (id: string) => boolean) => scene.controls.filter((c) => test(c.id) && c.opacity !== 0)
  return { stars: of((id) => id.startsWith("star:")), rows: of((id) => /^open:.*:row\d+$/.test(id)) }
}
/// Every row's text, in the order of the list: there is no page, so all of them are in the scene.
const allRows = (strings: Record<string, string>) =>
  Object.keys(strings)
    .filter((k) => /^row\d+$/.test(k))
    .sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)))
    .map((k) => strings[k])
/// How many spaces separate the first two columns: what is left of the title row's start after the name column.
const nameGap = (columns: string, names: string[]) => columns.indexOf("Type") - Math.max("Sat".length, ...names.map((n) => n.length))

test("a desktop pane's list is as wide as the pane, with the roomy spacing", async () => {
  const p = await panel({ width: 1000, height: 700 })
  const scene = (await p.render(cfg)) as unknown as { width: number; height: number; controls: Geometry[]; strings: Record<string, string>; layers: TestLayer[]; scroll: { axis: string } }
  // It scrolls, and is as wide as the pane, so that it is drawn as it is. Nothing is laid out: every piece has its place.
  assert.equal(scene.width, 1000)
  assert.ok(scene.height >= 700)
  assert.equal(scene.scroll.axis, "y")
  const { stars, rows } = geometry(scene)
  assert.ok(stars.length > 5 && stars.length === rows.length, "every pass, not five")
  for (const c of stars) assert.deepEqual([c.x, c.width, c.height], [12, 56, 44], "a star is a button wide, inside the padding")
  for (const c of rows) assert.deepEqual([c.kind, c.x, c.width, c.height], ["button", 68, 1000 - 24 - 56, 44], "the line after it is one hit area")
  // The chevron at its end is an icon, which the hit area under it makes work.
  assert.equal(layersOf(scene).filter((l) => /^chevron\d+$/.test(l.id)).length, rows.length)
  // The key to the marks is drawn under the rows, as the marks are, with the whole words where they fit.
  assert.deepEqual(layersOf(scene).filter((l) => l.id.startsWith("keyText-")).map((l) => l.text!.literal), ["heard", "telemetry only", "not heard"])
  const names = allRows(scene.strings).map((r) => r.split(/ +/)[0])
  assert.equal(nameGap(scene.strings.columns, names), 2, "two spaces between columns")
  assert.ok(allRows(scene.strings).every((r) => !/\+1\b/.test(r)))
})

test("the same list in a phone's pane is packed tighter, and has the same controls", async () => {
  const wide = (await (await panel({ width: 1000, height: 700 })).render(cfg)) as unknown as { controls: Geometry[]; strings: Record<string, string> }
  const phone = await panel({ width: 390, height: 700 })
  const tight = (await phone.render(cfg)) as unknown as { width: number; controls: Geometry[]; strings: Record<string, string>; layers: TestLayer[] }

  assert.deepEqual(tight.controls.filter((c) => /^(star|open):/.test(c.id)).map((c) => c.id), wide.controls.filter((c) => /^(star|open):/.test(c.id)).map((c) => c.id), "the same rows; only their places differ")
  assert.equal(tight.width, 390)
  const { stars, rows } = geometry(tight)
  for (const c of stars) assert.deepEqual([c.x, c.width, c.height], [8, 44, 36], "narrower and shorter than a desktop's")
  for (const c of rows) assert.deepEqual([c.x, c.width, c.height], [52, 390 - 16 - 44, 36])
  // The key fits the phone's width, shortened if it has to be.
  const keys = layersOf(tight).filter((l) => l.id.startsWith("keyText-"))
  assert.equal(keys.length, 3)
  assert.ok(keys.every((l) => l.x + l.width <= tight.width), "within the pane")
  const tightNames = allRows(tight.strings).map((r) => r.split(/ +/)[0])
  assert.equal(nameGap(tight.strings.columns, tightNames), 1, "one space between columns")
  assert.ok(tight.strings.columns.length < (wide.strings.columns as string).length)
})

test("the phone's list shows tomorrow's passes as +1, and every line fits", async () => {
  const phone = await panel({ width: 390, height: 700 })
  // From six in the evening, so the next day's worth of passes crosses midnight; and the whole day is one scroll.
  const evening = t0 + 18 * 3_600_000
  const scene = await phone.render({ ...cfg, minElevation: 0 }, evening)
  const lines = allRows(scene.strings)
  assert.ok(lines.length > 5)
  assert.ok(lines.some((l) => /\d\d:\d\dZ\+1\b/.test(l)), "something is tomorrow")
  assert.ok(lines.every((l) => !/\d\d-\d\d /.test(l)), "and no line carries a date")
  // About what fits between a 44-pixel button and a chevron on 390 pixels in a monospaced face: 36 characters.
  assert.ok(lines.every((l) => l.length <= 36), `the longest is ${Math.max(...lines.map((l) => l.length))}: ${[...lines].sort((a, b) => b.length - a.length)[0]}`)
})

test("the Spacing setting overrides the pane's size", async () => {
  const star = (scene: unknown) => geometry(scene as { controls: Geometry[] }).stars[0]
  const bigButTight = await (await panel({ width: 1000, height: 700 })).render({ ...cfg, density: "compact" })
  assert.deepEqual([star(bigButTight).x, star(bigButTight).width, star(bigButTight).height], [8, 44, 36])
  // A pane that is not wide, with the roomy spacing asked for, and room enough still for every column.
  const smallButRoomy = await (await panel({ width: 470, height: 700 })).render({ ...cfg, density: "comfortable" })
  assert.deepEqual([star(smallButRoomy).x, star(smallButRoomy).width, star(smallButRoomy).height], [12, 56, 44])
  const roomyNames = allRows(smallButRoomy.strings).map((r) => r.split(/ +/)[0])
  assert.equal(nameGap(smallButRoomy.strings.columns, roomyNames), 2)
  // And a host that does not report the pane's size gets the roomy layout.
  const unknown = await (await panel()).render(cfg)
  assert.deepEqual([star(unknown).x, star(unknown).width, star(unknown).height], [12, 56, 44])
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
