// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// What is up now, on one sky plot.

import assert from "node:assert/strict"
import { test } from "node:test"

import { buildCatalog, ELEMENTS_URL, LIST_URL, parseElements, parseList, statusUrl } from "./data.ts"
import { DEFAULT_THEME } from "./detail.ts"
import { ELEMENTS, LIST, SUMMARY } from "./fixtures.ts"
import { forgetAll } from "./memory.ts"
import { findPasses, satrecFromOmm } from "./orbit.ts"
import type { SatellitePass } from "./passes.ts"
import { loadExtension } from "./sdkGapTesting.ts"
import { SKY_SIZE } from "./sky.ts"
import { buildNow, buildNowScene, DOT, HIT, upNow, upNowHint } from "./upnow.ts"

const ctx = { online: true }
let panes = 0
const t0 = Date.parse("2026-10-07T00:00:00Z")
const cfg = { grid: "EL95vs", minElevation: 0, utc: true }

const catalog = buildCatalog(parseList(LIST), parseElements(ELEMENTS), {})
const ao7 = catalog.find((s) => s.name === "AO-7")!
const noOrbit = catalog.find((s) => s.name === "CAS-4A")!
const miami = { lat: 25.76, lon: -80.19 }
const passes = findPasses(satrecFromOmm(ao7.omm!), miami, t0, 24, 10)
const best = passes.reduce((a, b) => (b.maxElevation > a.maxElevation ? b : a))
const mid = Math.round((best.aos + best.los) / 2)
const asPass = (p: (typeof passes)[number], satellite = ao7): SatellitePass => ({ ...p, satellite })

interface Layer {
  id: string
  svg?: string
  text?: { literal?: string }
}
interface Control {
  id: string
  kind: string
  x?: number
  y?: number
  width?: number
  height?: number
  options?: { value: string }[]
}
interface Scene {
  width: number
  strings: Record<string, string>
  values: Record<string, number>
  layers: Layer[]
  controls: Control[]
  layout?: unknown
  scroll?: unknown
}

async function panel(settings = new Map<string, unknown>()) {
  forgetAll()
  const id = ++panes
  const ext = await loadExtension(() => import("./index.ts"), {
    hostCalls: {
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
    instanceId: `now-${id}`,
    operation: {},
    qsoCount: 0,
    reason: "",
    config,
    clock: { nowMillis: at, realNowMillis: at },
  })
  return {
    settings,
    render: async (config: Record<string, unknown>, at: number) => (await ext.runHook("panel", "render", args(config, at), { ctx })) as { scene: Scene; triggers?: string[]; title?: string },
    event: async (config: Record<string, unknown>, at: number, controlId: string, action: string, extra: { text?: string; value?: number } = {}) =>
      (await ext.runHook("panel", "onEvent", { ...args(config, at), event: { controlId, action, phase: "activate", sequence: 1, ...extra } }, { ctx })) as { values: Record<string, number>; strings?: Record<string, string> },
  }
}

test("a pass that is under way is a dot where its satellite is; one that is not, or has no orbit, is nothing", () => {
  const now = asPass(best)
  const dots = upNow([now], miami, [], mid)
  assert.equal(dots.length, 1)
  const [dot] = dots
  assert.equal(dot.name, "AO-7")
  assert.equal(dot.los, best.los)
  assert.ok(dot.elevation >= 0 && dot.elevation <= 90)
  assert.ok(dot.azimuth >= 0 && dot.azimuth < 360)
  // On the plot, inside its circle.
  assert.ok(Math.hypot(dot.x - SKY_SIZE / 2, dot.y - SKY_SIZE / 2) <= 150 + 0.01)
  assert.equal(dot.favorite, false)
  assert.equal(upNow([now], miami, ["AO-7"], mid)[0].favorite, true)
  // Before it rises and after it sets, it is not up.
  assert.deepEqual(upNow([now], miami, [], best.aos - 1000), [])
  assert.deepEqual(upNow([now], miami, [], best.los + 1000), [])
  // No orbit, nowhere to be.
  assert.deepEqual(upNow([{ ...asPass(best), satellite: noOrbit }], miami, [], mid), [])
  // Two satellites are two dots, by name.
  const second = { ...asPass(best), satellite: { ...ao7, name: "AAA-1" } }
  assert.deepEqual(upNow([now, second], miami, [], mid).map((d) => d.name), ["AAA-1", "AO-7"])
})

test("the satellite moves: a minute on, it is somewhere else", () => {
  const [a] = upNow([asPass(best)], miami, [], mid)
  const [b] = upNow([asPass(best)], miami, [], mid + 60_000)
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 1)
})

test("the line over the plot says how many are up, or that none is and what is next", () => {
  assert.equal(upNowHint(1, ""), "1 satellite is up now. Tap one to open its pass.")
  assert.equal(upNowHint(3, "Next: SO-50 in 12 min"), "3 satellites are up now. Tap one to open its pass.")
  assert.equal(upNowHint(0, "Next: SO-50 in 12 min"), "Nothing is up right now. Next: SO-50 in 12 min")
  assert.equal(upNowHint(0, ""), "Nothing is up right now.")
})

test("the plot has the grid, a dot for each satellite, a ring round a favorite, and a name placed beside each", () => {
  const dots = upNow([asPass(best), { ...asPass(best), satellite: { ...ao7, name: "AAA-1" } }], miami, ["AAA-1"], mid)
  const { svg, labels, compass } = buildNow(dots, DEFAULT_THEME)
  assert.ok(svg.startsWith("<svg") && svg.endsWith("</svg>"))
  assert.equal((svg.match(/<circle[^>]*fill="none" stroke-opacity/g) ?? []).length, 0)
  // Three rings of the grid, and a dot each, and a ring for the one that is a favorite.
  assert.equal((svg.match(/r="[\d.]+"\/>/g) ?? []).length >= 3, true)
  assert.equal((svg.match(new RegExp(`r="${DOT}"`, "g")) ?? []).length, 2)
  assert.equal((svg.match(/stroke="#f9a825"/g) ?? []).length, 1, "only the favorite")
  assert.deepEqual(labels.map((l) => l.text.literal).sort(), ["AAA-1", "AO-7"])
  assert.deepEqual(compass.map((l) => l.id), ["north", "south", "east", "west"])
  // The names are on the plot, and not over each other.
  for (const l of labels) assert.ok(l.x >= 0 && l.x + l.width <= SKY_SIZE + 1 && l.y >= 0 && l.y + l.height <= SKY_SIZE + 1)
  const [a, b] = labels
  assert.equal(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height, false, "apart")
})

test("a tap area over each dot is big enough for a finger and inside the plot, and opens its pass", () => {
  const dots = upNow([asPass(best)], miami, [], mid)
  const scene = buildNowScene({ mode: "now", utc: true, hint: "x", compact: true, dots, ...buildNow(dots, DEFAULT_THEME) })
  const tap = scene.controls!.find((c) => c.id.startsWith("open:AO-7:"))!
  assert.deepEqual([tap.kind, tap.width, tap.height], ["button", HIT, HIT])
  assert.ok(tap.x! >= 0 && tap.y! >= 0 && tap.x! + HIT <= SKY_SIZE && tap.y! + HIT <= SKY_SIZE)
  // Centered on the dot, unless the dot is at the edge.
  assert.ok(Math.abs(tap.x! + HIT / 2 - dots[0].x) <= HIT / 2 && Math.abs(tap.y! + HIT / 2 - dots[0].y) <= HIT / 2)
  assert.ok(tap.id.endsWith(":up"))
  assert.equal(scene.controls!.find((c) => c.id === "mode")!.options!.length, 3)
})

test("choosing Up now shows the sky: what is up, its dots to tap, and a redraw every few seconds", async () => {
  const p = await panel()
  const answer = await p.event(cfg, mid, "mode", "mode", { text: "now" })
  assert.deepEqual(answer, { values: { utc: 1 }, strings: { mode: "now" } })
  const { scene, triggers, title } = await p.render(cfg, mid)
  assert.equal(scene.strings.mode, "now")
  assert.match(scene.strings.hint, /^1 satellite is up now\. Tap one to open its pass\.$/)
  assert.deepEqual(triggers, ["tick:3"])
  assert.equal(title, "Satellites")
  assert.ok(scene.layout, "a laid-out scene, as a pass's page is")
  assert.equal(scene.scroll, undefined, "and not the scrolling list")
  assert.deepEqual(scene.controls.find((c) => c.id === "mode")!.options!.map((o) => o.value), ["all", "favorites", "now"])
  assert.deepEqual(scene.layers.filter((l) => /^up\d+$/.test(l.id)).map((l) => l.text!.literal), ["AO-7"])
  assert.ok(scene.layers.some((l) => l.id === "sky" && l.svg!.includes("<circle")))
  assert.equal(scene.controls.filter((c) => c.id.endsWith(":up")).length, 1)
  // The choice is kept for the next time the app is opened.
  assert.equal(p.settings.get("mode"), "now")
})

test("the dot moves between two draws of the plot", async () => {
  const p = await panel()
  await p.event(cfg, mid, "mode", "mode", { text: "now" })
  const place = (scene: Scene) => {
    const tap = scene.controls.find((c) => c.id.endsWith(":up"))!
    return [tap.x, tap.y]
  }
  const first = place((await p.render(cfg, mid)).scene)
  const later = place((await p.render(cfg, mid + 90_000)).scene)
  assert.notDeepEqual(first, later)
})

test("with nothing up the plot is empty and says what is next, and the pane opens on the sky when that was its last view", async () => {
  const settings = new Map<string, unknown>()
  const p = await panel(settings)
  await p.event(cfg, t0, "mode", "mode", { text: "now" })
  const { scene } = await p.render(cfg, best.aos - 30 * 60_000)
  assert.match(scene.strings.hint, /^Nothing is up right now\. Next: \S+ in .+$/)
  assert.equal(scene.controls.filter((c) => c.id.endsWith(":up")).length, 0)
  assert.equal(scene.layers.filter((l) => /^up\d+$/.test(l.id)).length, 0)
  // A pane started afterwards, with the settings as they were left, is on the sky.
  const again = await panel(settings)
  assert.equal((await again.render(cfg, best.aos - 30 * 60_000)).scene.strings.mode, "now")
})

test("a tap on a dot opens that pass, and Back comes back to the sky, not to a list", async () => {
  const p = await panel()
  await p.event(cfg, mid, "mode", "mode", { text: "now" })
  const tap = (await p.render(cfg, mid)).scene.controls.find((c) => c.id.endsWith(":up"))!
  await p.event(cfg, mid, tap.id, "open")
  const page = (await p.render(cfg, mid)).scene
  assert.equal(page.strings.tab, "sky")
  assert.match(page.strings.title, /^AO-7 · /)
  await p.event(cfg, mid, "back", "back")
  const back = (await p.render(cfg, mid)).scene
  assert.equal(back.strings.mode, "now")
  assert.ok(back.controls.some((c) => c.id.endsWith(":up")))
  // And the lists are one tap away, starting at their top.
  await p.event(cfg, mid, "mode", "mode", { text: "all" })
  const list = (await p.render(cfg, mid)).scene
  assert.equal(list.strings.mode, "all")
  assert.deepEqual(list.scroll, { axis: "y", value: "scroll", event: "scrolled" })
  assert.equal(list.values.scroll, 0)
})

test("a satellite that is a favorite is ringed on the plot", async () => {
  const p = await panel(new Map<string, unknown>([["favorites", ["AO-7"]]]))
  await p.event(cfg, mid, "mode", "mode", { text: "now" })
  const sky = (await p.render(cfg, mid)).scene.layers.find((l) => l.id === "sky")!
  assert.ok(sky.svg!.includes('stroke="#f9a825"'))
})
