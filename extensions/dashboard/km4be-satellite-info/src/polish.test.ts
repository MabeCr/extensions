// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// The small things that make the list and a pass's page easier to read: what is up now and what is next, the marks as
// icons, a pass that is up in its own color, a short tab, the Radio page redrawn while the satellite is overhead, and the
// picture the panel list shows.

import assert from "node:assert/strict"
import { test } from "node:test"

import manifest from "../manifest.json" with { type: "json" }
import { buildCatalog, ELEMENTS_URL, LIST_URL, parseElements, parseList, statusUrl } from "./data.ts"
import { ELEMENTS, LIST, SUMMARY } from "./fixtures.ts"
import { forgetAll } from "./memory.ts"
import { findPasses, satrecFromOmm } from "./orbit.ts"
import { loadExtension } from "./sdkGapTesting.ts"

const ctx = { online: true }
let panes = 0

const catalog = buildCatalog(parseList(LIST), parseElements(ELEMENTS), {})
const ao7 = catalog.find((s) => s.name === "AO-7")!
const miami = { lat: 25.76, lon: -80.19 }
const t0 = Date.parse("2026-10-07T00:00:00Z")
const best = findPasses(satrecFromOmm(ao7.omm!), miami, t0, 24, 10).reduce((a, b) => (b.maxElevation > a.maxElevation ? b : a))
const mid = Math.round((best.aos + best.los) / 2)
const cfg = { grid: "EL95vs", minElevation: 0, utc: true }

interface Layer {
  id: string
  x: number
  width: number
  icon?: { name: string; color: string }
  text?: { value?: string; literal?: string; color: string }
}
interface Content {
  title?: string
  triggers?: string[]
  scene: { width: number; strings: Record<string, string>; layers: Layer[]; controls: { id: string; opacity?: number }[] }
}

async function panel(options: { offline?: () => boolean; environment?: { width: number; height: number } } = {}) {
  forgetAll()
  const id = ++panes
  const ext = await loadExtension(() => import("./index.ts"), {
    hostCalls: {
      getLocation: () => null,
      kvGet: () => null,
      kvSet: () => undefined,
      fetch: (params) => {
        const url = String(params.url)
        if (options.offline?.()) throw new Error("network down")
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
    instanceId: `polish-${id}`,
    operation: {},
    qsoCount: 0,
    reason: "",
    config,
    clock: { nowMillis: at, realNowMillis: at },
    ...(options.environment ? { environment: options.environment } : {}),
  })
  return {
    render: async (config: Record<string, unknown>, at: number) => (await ext.runHook("panel", "render", args(config, at), { ctx })) as Content,
    event: async (config: Record<string, unknown>, at: number, controlId: string, action: string, extra: { text?: string } = {}) =>
      ext.runHook("panel", "onEvent", { ...args(config, at), event: { controlId, action, phase: "activate", sequence: 1, ...extra } }, { ctx }),
    descriptors: async () => (await ext.runHook("panel", "getPanels", {}, { ctx })) as { preview?: string; title: string }[],
    /// Opens the best AO-7 pass of the day, listed some time before it.
    open: async (config: Record<string, unknown>) => {
      const listAt = best.aos - 30 * 60_000
      const list = await ext.runHook("panel", "render", args(config, listAt), { ctx }) as Content
      const wanted = list.scene.controls.filter((c) => c.id.startsWith("open:AO-7:")).find((c) => Math.abs(Number(c.id.split(":")[2]) - best.los) < 120_000)
      assert.ok(wanted, "the best pass is listed")
      await ext.runHook("panel", "onEvent", { ...args(config, listAt), event: { controlId: wanted!.id, action: "open", phase: "activate", sequence: 1 } }, { ctx })
    },
  }
}

const { span, nowAndNext } = await (async () => {
  // The helpers are exported from the extension's own module, which needs the kernel stand-in before it is loaded.
  await loadExtension(() => import("./index.ts"))
  return await import("./index.ts")
})()

test("a span of time is said the way a person says it", () => {
  assert.equal(span(0), "less than a minute")
  assert.equal(span(-5_000), "less than a minute")
  assert.equal(span(1_000), "1 min", "a part of a minute is a minute")
  assert.equal(span(12 * 60_000), "12 min")
  assert.equal(span(89 * 60_000), "89 min")
  assert.equal(span(90 * 60_000), "1 h 30 min")
  assert.equal(span(2 * 3_600_000), "2 h")
  assert.equal(span(13 * 3_600_000 + 20 * 60_000), "13 h 20 min")
})

test("the line over the list says what is up and what is next, and nothing when there is neither", () => {
  const now = t0
  const pass = (name: string, aos: number, los: number) => ({ satellite: { name }, aos, los }) as never
  const up = pass("AO-7", now - 60_000, now + 5 * 60_000)
  const alsoUp = pass("FO-29", now - 1, now + 9 * 60_000)
  const next = pass("SO-50", now + 12 * 60_000, now + 20 * 60_000)
  const later = pass("AO-27", now + 3 * 3_600_000, now + 3 * 3_600_000 + 600_000)

  assert.equal(nowAndNext([up, next, later], now), "AO-7 up now, 5 min left · Next: SO-50 in 12 min")
  assert.equal(nowAndNext([up, alsoUp, next], now), "AO-7 and 1 more up now, 5 min left · Next: SO-50 in 12 min")
  assert.equal(nowAndNext([next, later], now), "Next: SO-50 in 12 min")
  assert.equal(nowAndNext([up], now), "AO-7 up now, 5 min left")
  assert.equal(nowAndNext([later], now), "Next: AO-27 in 3 h")
  assert.equal(nowAndNext([], now), "")
  // A pass that has ended is neither.
  assert.equal(nowAndNext([pass("AO-7", now - 600_000, now - 1)], now), "")
})

test("while a satellite is overhead the list says so and for how long, and its row is in its own color", async () => {
  const p = await panel({ environment: { width: 411, height: 800 } })
  const { scene } = await p.render(cfg, mid)
  assert.match(scene.strings.hint, /^AO-7 up now, \d+ min left/)
  const row = scene.layers.find((l) => l.id === "row0")!
  const name = scene.strings.row0.split(/ +/)[0]
  assert.equal(name, "AO-7", "the pass that is up is first")
  assert.equal(row.text!.color, "#43a047", "green, for a pass that is up")
  assert.match(scene.strings.row0, / now /, "its start says now")
  // The rows that are not up are in the pane's own color.
  const others = scene.layers.filter((l) => /^row[1-4]$/.test(l.id) && scene.strings[l.id])
  assert.ok(others.length > 0 && others.every((l) => l.text!.color !== "#43a047"))
})

test("before the first pass the list says what is next, and the orbits' age is said only when they are old", async () => {
  let offline = false
  const p = await panel({ offline: () => offline })
  const early = await p.render(cfg, best.aos - 30 * 60_000)
  assert.match(early.scene.strings.hint, /^Next: \S+ in \d+ min$|^Next: \S+ in \d+ h/, "and nothing about the orbits, which are minutes old")
  assert.ok(!early.scene.strings.hint.includes("Orbits"))
  // Thirteen hours on with the connection down: the copy is the one fetched then, and says how old it is.
  offline = true
  const later = await p.render(cfg, best.aos - 30 * 60_000 + 13 * 3_600_000)
  assert.match(later.scene.strings.hint, /Orbits are 13 h old\.$/)
})

test("the pane's tab is short on every page, though the panel's name in the list of panels is not", async () => {
  const p = await panel()
  assert.equal((await p.render(cfg, best.aos - 30 * 60_000)).title, "Satellites")
  await p.open(cfg)
  assert.equal((await p.render(cfg, best.aos - 20 * 60_000)).title, "Satellites", "a pass's page")
  await p.event(cfg, best.aos - 20 * 60_000, "tab_report", "tab-report")
  assert.equal((await p.render(cfg, best.aos - 20 * 60_000)).title, "Satellites", "the report page")
  const [descriptor] = await p.descriptors()
  assert.equal(descriptor.title, "KM4BE Satellite Passes")
})

test("the Radio page is redrawn every two seconds while the satellite is overhead, as the Sky page is, and not before", async () => {
  const p = await panel()
  await p.open(cfg)
  const before = best.aos - 5 * 60_000
  await p.event(cfg, before, "tab_radio", "tab-radio")
  const waiting = await p.render(cfg, before)
  assert.equal(waiting.scene.strings.tab, "radio")
  assert.deepEqual(waiting.triggers, [], "not up yet: the panel's own minute is enough")
  const overhead = await p.render(cfg, mid)
  assert.equal(overhead.scene.strings.tab, "radio")
  assert.deepEqual(overhead.triggers, ["tick:2"])
  // The figures for now are not the ones from a moment ago.
  const later = await p.render(cfg, mid + 120_000)
  assert.notEqual(later.scene.strings.radio5, overhead.scene.strings.radio5)
  // The Sky page is still redrawn faster with the countdown on, and the Radio page does not follow that.
  assert.deepEqual((await p.render({ ...cfg, countdown: true }, mid)).triggers, ["tick:2"])
  await p.event(cfg, mid, "tab_sky", "tab-sky")
  assert.deepEqual((await p.render({ ...cfg, countdown: true }, mid)).triggers, ["tick:1"])
})

test("the marks are icons in a column of their own, clear of the text and inside the pane", async () => {
  const p = await panel({ environment: { width: 411, height: 800 } })
  const { scene } = await p.render(cfg, best.aos - 30 * 60_000)
  const lines = scene.layers.filter((l) => /^row\d$/.test(l.id) && scene.strings[l.id])
  const marks = scene.layers.filter((l) => /^mark\d$/.test(l.id))
  assert.equal(marks.length, lines.length, "a mark for every row that has one, and these all do")
  const names = lines.map((l) => scene.strings[l.id].split(/ +/)[0])
  marks.forEach((m, i) => {
    assert.equal(m.icon!.name, names[i] === "AO-7" ? "check-circle" : "circle-half-full")
    assert.ok(m.x >= lines[i].x + lines[i].width, "right of the text")
    assert.ok(m.x + m.width <= scene.width - 40, "left of the chevron")
  })
  const title = scene.layers.find((l) => l.id === "markTitle")!
  assert.equal(title.text!.literal, "Rpt")
  assert.ok(Math.abs(title.x + title.width / 2 - (marks[0].x + marks[0].width / 2)) < 1, "the title is centered over the icons")
})

test("in a wide pane the marks stay by their rows, not at the far edge", async () => {
  const wide = await (await panel({ environment: { width: 800, height: 360 } })).render(cfg, best.aos - 30 * 60_000)
  const mark = wide.scene.layers.find((l) => l.id === "mark0")!
  const row = wide.scene.layers.find((l) => l.id === "row0")!
  assert.ok(mark.x < wide.scene.width / 2, `the mark is at ${mark.x} of ${wide.scene.width}`)
  assert.ok(mark.x >= row.x + row.width, "and still clear of the text")
  const title = wide.scene.layers.find((l) => l.id === "markTitle")!
  assert.ok(Math.abs(title.x + title.width / 2 - (mark.x + mark.width / 2)) < 1, "with its title over it")
  // In a phone's pane there is no room to spare, and the column is at the chevron's side as before.
  const phone = await (await panel({ environment: { width: 390, height: 700 } })).render(cfg, best.aos - 30 * 60_000)
  const phoneMark = phone.scene.layers.find((l) => l.id === "mark0")!
  assert.ok(phoneMark.x > phone.scene.width * 0.7, `${phoneMark.x} of ${phone.scene.width}`)
})

test("the key to the marks fits the pane it is in, from the whole words down to the shortest and the pane's edge", async () => {
  const keyIn = async (width: number) => {
    const { scene } = await (await panel({ environment: { width, height: 700 } })).render(cfg, best.aos - 30 * 60_000)
    const layers = scene.layers.filter((l) => l.id.startsWith("key"))
    assert.equal(layers.length, 6, "three icons and three words")
    return { scene, layers, words: layers.filter((l) => l.id.startsWith("keyText-")).map((l) => l.text!.literal) }
  }
  assert.deepEqual((await keyIn(520)).words, ["heard", "telemetry only", "not heard"], "room for the whole words")
  assert.deepEqual((await keyIn(390)).words.length, 3)
  const narrow = await keyIn(300)
  assert.deepEqual(narrow.words, ["heard", "telemetry", "not heard"], "shortened")
  for (const w of [300, 340, 390, 480, 520]) {
    const { scene, layers } = await keyIn(w)
    assert.ok(layers.every((l) => l.x >= 0 && l.x + l.width <= scene.width), `all within a pane ${w} wide`)
    // In order, one after another, none over the one before.
    const xs = layers.map((l) => l.x)
    assert.deepEqual(xs, [...xs].sort((a, b) => a - b))
  }
})

test("the panel list's picture is a self-contained SVG within its budget, and the bundle declares the API it needs", async () => {
  const p = await panel()
  const [descriptor] = await p.descriptors()
  const svg = descriptor.preview!
  assert.ok(svg.startsWith("<svg") && svg.endsWith("</svg>"))
  assert.ok(svg.length > 500 && svg.length < 262_144, `${svg.length} characters`)
  for (const banned of ["<text", "<image", "<script", "<foreignObject", "href=", "http://www.w3.org/1999/xlink"]) assert.ok(!svg.includes(banned), banned)
  // Icon layers are extension API 12, so that is the least the bundle can declare.
  assert.ok(manifest.api >= 12, `api ${manifest.api}`)
})
