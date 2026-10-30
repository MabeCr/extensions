// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// The list scrolls: every pass of the day in one scene, under a header and over a key that stay where they are.

import assert from "node:assert/strict"
import { test } from "node:test"

import { ELEMENTS_URL, LIST_URL, statusUrl } from "./data.ts"
import { ELEMENTS, LIST, SUMMARY } from "./fixtures.ts"
import { forgetAll } from "./memory.ts"
import { buildScene, listLook, MAX_ROWS } from "./scene.ts"
import type { Model, Row } from "./scene.ts"
import { datasetCalls } from "./datasetTesting.ts"
import { loadExtension } from "./sdkGapTesting.ts"

const ctx = { online: true }
let panes = 0
const t0 = Date.parse("2026-10-07T00:00:00Z")
const cfg = { grid: "EL95vs", minElevation: 0, utc: true }

interface Layer {
  id: string
  x: number
  y: number
  width: number
  height: number
  fixed?: boolean
  blocksPointer?: boolean
  svg?: string
  icon?: { name: string }
  text?: { value?: string; literal?: string }
}
interface Control {
  id: string
  kind: string
  x?: number
  y?: number
  width?: number
  height?: number
  after?: string
  fixed?: boolean
  opacity?: number
}
interface Scene {
  width: number
  height: number
  values: Record<string, number>
  strings: Record<string, string>
  layers: Layer[]
  controls: Control[]
  scroll?: { axis: string; value: string; event: string }
  layout?: unknown
}

const environment = { version: 1, width: 411, height: 700, colors: { surface: "#101418", primary: "#4a90d9" }, typography: { mono: { fontFamily: "RobotoMono", fontSize: 13, scaledFontSize: 13 } } }

async function panel() {
  forgetAll()
  const id = ++panes
  const settings = new Map<string, unknown>()
  const ext = await loadExtension(() => import("./index.ts"), {
    hostCalls: {
      ...datasetCalls().hostCalls,
      getLocation: () => null,
      kvGet: () => null,
      kvSet: () => undefined,
      getSettings: () => ({ extensions: { "extension_km4be-satellite-info": Object.fromEntries(settings) } }),
      setSettings: (params) => {
        for (const [k, v] of Object.entries(params.values as Record<string, unknown>)) settings.set(k, v)
      },
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
    instanceId: `scroll-${id}`,
    operation: {},
    qsoCount: 0,
    reason: "",
    config,
    clock: { nowMillis: at, realNowMillis: at },
    environment,
  })
  return {
    render: async (config: Record<string, unknown>, at: number) => ((await ext.runHook("panel", "render", args(config, at), { ctx })) as { scene: Scene }).scene,
    event: async (config: Record<string, unknown>, at: number, controlId: string, action: string, extra: { text?: string; value?: number } = {}) =>
      (await ext.runHook("panel", "onEvent", { ...args(config, at), event: { controlId, action, phase: "commit", sequence: 1, ...extra } }, { ctx })) as { values: Record<string, number>; strings?: Record<string, string> },
  }
}

const rowCount = (scene: Scene) => Object.keys(scene.strings).filter((k) => /^row\d+$/.test(k)).length

test("the list is a scene that scrolls: as wide as the pane, as long as its rows, with nothing laid out", async () => {
  const p = await panel()
  const scene = await p.render(cfg, t0)
  assert.deepEqual(scene.scroll, { axis: "y", value: "scroll", event: "scrolled" })
  assert.equal(scene.layout, undefined, "a scrolling scene is not laid out")
  assert.equal(scene.width, 411)
  assert.ok(scene.height >= 700, "at least the pane's height")
  assert.equal(scene.values.scroll, 0, "it starts at the top")
  assert.equal(scene.layers.every((l) => l.y + l.height <= scene.height + 1), true, "every layer is inside the scene")
})

test("the header stays: its pieces are fixed at the top, over a background that takes the touches, and the rows start under it", async () => {
  const p = await panel()
  const scene = await p.render(cfg, t0)
  const bg = scene.layers.find((l) => l.id === "headBg")!
  assert.deepEqual([bg.x, bg.y, bg.width, bg.fixed, bg.blocksPointer], [0, 0, 411, true, true])
  assert.match(bg.svg!, /fill="#101418"/, "in the pane's own color, so the rows do not show through")
  for (const id of ["mode", "utc", "header", "hint"]) {
    const c = scene.controls.find((o) => o.id === id)!
    assert.equal(c.fixed, true, `${id} stays`)
    assert.ok(c.y! + c.height! <= bg.height + 1, `${id} is on the header`)
  }
  assert.equal(scene.layers.find((l) => l.id === "columns")!.fixed, true, "the titles stay")
  // The first row starts where the header ends, so that at the top of the scroll nothing is hidden by it.
  const first = scene.controls.find((c) => c.id.startsWith("star:"))!
  assert.equal(first.y, bg.height)
  // The header is drawn after the rows, which is what puts it over them.
  const ids = scene.layers.map((l) => l.id)
  assert.ok(ids.indexOf("headBg") > ids.indexOf("row0") && ids.indexOf("headBg") > ids.indexOf(`row${rowCount(scene) - 1}`))
})

test("the key stays at the bottom of the pane, and the scroll runs on past the last row by as much", async () => {
  const p = await panel()
  const scene = await p.render(cfg, t0)
  const foot = scene.layers.find((l) => l.id === "footBg")!
  assert.deepEqual([foot.fixed, foot.blocksPointer], [true, true])
  assert.equal(foot.y + foot.height, 700, "at the bottom of the pane")
  for (const k of ["heard", "telemetry", "notHeard"]) {
    assert.equal(scene.layers.find((l) => l.id === `key-${k}`)!.fixed, true)
    assert.equal(scene.layers.find((l) => l.id === `keyText-${k}`)!.fixed, true)
    assert.ok(scene.layers.find((l) => l.id === `key-${k}`)!.y >= foot.y)
  }
  const lastStar = [...scene.controls].reverse().find((c) => c.id.startsWith("star:"))!
  assert.ok(lastStar.y! + lastStar.height! + foot.height <= scene.height, "the last row can be scrolled clear of the key")
})

test("each row is a star and a hit area, placed after its own text so that the header is drawn over them", async () => {
  const p = await panel()
  const scene = await p.render(cfg, t0)
  const n = rowCount(scene)
  assert.ok(n > 5)
  for (let i = 0; i < n; i++) {
    const star = scene.controls.filter((c) => c.id.startsWith("star:"))[i]
    const open = scene.controls.filter((c) => /^open:.*:row\d+$/.test(c.id))[i]
    assert.equal(star.after, `row${i}`)
    assert.equal(open.after, `row${i}`)
    assert.equal(open.kind, "button")
    assert.equal(open.y, star.y, "on the same line")
    assert.ok(scene.layers.some((l) => l.id === `chevron${i}` && l.icon!.name === "chevron-right"))
  }
  // Not fixed: they scroll.
  assert.ok(scene.controls.filter((c) => c.id.startsWith("star:")).every((c) => !c.fixed))
})

test("the most rows a scene can hold leave room for the header's controls and layers, in both counts", () => {
  const rows: Row[] = Array.from({ length: MAX_ROWS }, (_, i) => ({ name: `SAT-${i}`, favorite: false, text: `SAT-${i}   FM   12:00Z   45°  N→S   10m`, mark: i % 2 ? "heard" : null, live: false, los: i }))
  const look = listLook(environment, true)
  const model: Model = { header: "h", hint: "x", mode: "all", utc: true, columns: "Sat", legend: true, compact: true, rows, more: 0, look, size: 13, scroll: 0 }
  const scene = buildScene(model)
  assert.ok(scene.controls!.length <= 256, `${scene.controls!.length} controls`)
  assert.ok(scene.layers!.length <= 512, `${scene.layers!.length} layers`)
  assert.ok(Object.keys(scene.strings!).length <= 256, `${Object.keys(scene.strings!).length} strings`)
  assert.equal(scene.controls!.filter((c) => c.id.startsWith("star:")).length, MAX_ROWS)
  // And the row after it is not in the model: the list is cut there, and says so.
  assert.equal(MAX_ROWS * 2 + 4 <= 256, true)
})

test("where the list is scrolled to is kept, and sent back as it was, so the pane is not moved", async () => {
  const p = await panel()
  assert.equal((await p.render(cfg, t0)).values.scroll, 0)
  const answer = await p.event(cfg, t0, "list", "scrolled", { value: 187 })
  assert.deepEqual(answer, { values: { utc: 1 } }, "an answer that names the UTC switch, which every list has")
  assert.equal((await p.render(cfg, t0 + 60_000)).values.scroll, 187)
  // Nonsense is not a place: a number only, and never above the top.
  await p.event(cfg, t0, "list", "scrolled", { value: -50 })
  assert.equal((await p.render(cfg, t0)).values.scroll, 0)
  await p.event(cfg, t0, "list", "scrolled", { value: 120 })
  await p.event(cfg, t0, "list", "scrolled", {})
  await p.event(cfg, t0, "list", "scrolled", { value: Number.NaN })
  assert.equal((await p.render(cfg, t0)).values.scroll, 120)
})

test("a star does not move the list; choosing All or Favorites takes it back to the top", async () => {
  const p = await panel()
  await p.event(cfg, t0, "list", "scrolled", { value: 240 })
  const scene = await p.render(cfg, t0)
  const star = scene.controls.find((c) => c.id.startsWith("star:"))!
  const answer = await p.event(cfg, t0, star.id, "star")
  assert.equal(answer.values.scroll, undefined, "an answer to a star does not name the scroll")
  assert.equal((await p.render(cfg, t0)).values.scroll, 240)

  // A different list starts at its top: the scene drawn after the answer has the scroll at 0, which moves the pane. The answer
  // itself names only the switch and the UTC value, which the view the pane is on and the view it goes to both have.
  const mode = await p.event(cfg, t0, "mode", "mode", { text: "favorites" })
  assert.deepEqual(mode, { values: { utc: 1 }, strings: { mode: "favorites" } })
  assert.equal((await p.render(cfg, t0)).values.scroll, 0)
})

test("coming back from a pass's page finds the list where it was left", async () => {
  const p = await panel()
  await p.event(cfg, t0, "list", "scrolled", { value: 310 })
  const scene = await p.render(cfg, t0)
  const open = scene.controls.find((c) => /^open:.*:row\d+$/.test(c.id))!
  await p.event(cfg, t0, open.id, "open")
  assert.equal((await p.render(cfg, t0)).strings.tab, "sky")
  await p.event(cfg, t0, "back", "back")
  const back = await p.render(cfg, t0)
  assert.ok(back.scroll)
  assert.equal(back.values.scroll, 310)
})

test("an answer to any event on the list names only what every list has", async () => {
  const p = await panel()
  const scene = await p.render(cfg, t0)
  const known = new Set([...Object.keys(scene.strings), ...Object.keys(scene.values)])
  for (const [id, action, extra] of [
    ["mode", "mode", { text: "favorites" }],
    ["mode", "mode", { text: "all" }],
    ["utc", "utc", { value: 1 }],
    ["list", "scrolled", { value: 100 }],
  ] as const) {
    const answer = await p.event(cfg, t0, id, action, extra)
    for (const key of [...Object.keys(answer.values), ...Object.keys(answer.strings ?? {})]) assert.ok(known.has(key), `${action}: ${key} is not in the scene`)
  }
})

test("the hint has a line to itself, or two when its words are long enough to wrap", () => {
  const rows: Row[] = [{ name: "AO-7", favorite: false, text: "AO-7  SSB  12:00Z  45°  N→S  10m", mark: null, live: false, los: 1 }]
  const look = listLook(environment, true)
  const model = (hint: string): Model => ({ header: "h", hint, mode: "all", utc: true, columns: "Sat", legend: true, compact: true, rows, more: 0, look, size: 13, scroll: 0 })
  const heightOf = (hint: string) => buildScene(model(hint)).controls!.find((c) => c.id === "hint")!.height!
  const short = heightOf("Next: AO-7 in 6 min")
  const long = heightOf("AO-7 and 3 more up now, 12 min left · Next: SO-50 in 12 min · Orbits are 14 h old.")
  assert.ok(short < long, `${short} and ${long}`)
  assert.equal(long, short * 2, "two lines at most")
  assert.equal(heightOf(""), short, "and one line for no words")
  assert.equal(heightOf("x".repeat(600)), long, "however long the words")
})
