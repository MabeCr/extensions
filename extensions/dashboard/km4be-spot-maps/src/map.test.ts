// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// The map of the host's spot board: where a spot is placed from, what the scene is, and what the events do.

import assert from "node:assert/strict"
import { test } from "node:test"

import type { BoardSpot } from "@ham2k/extension-sdk"

import manifest from "../manifest.json" with { type: "json" }
import { forgetPlaces, loadBoard, place } from "./board.ts"
import { MAX_DOTS } from "./scene.ts"
import { loadExtension } from "./sdkGapTesting.ts"
import { bandOf, detailsLine, filterBand, summary } from "./spots.ts"
import type { MapSpot } from "./spots.ts"

const now = Date.parse("2026-10-30T12:00:00Z")
const minutesAgo = (n: number) => now - n * 60_000

/// Where each reference is, as the award extensions' tables have it: pota/US-0001 and so on.
const PLACES: Record<string, { lat: number; lon: number; name: string }> = {
  "pota/US-0001": { lat: 41.5, lon: -72.7, name: "A Park" },
  "pota/US-0002": { lat: 35.1, lon: -106.6, name: "Another Park" },
  "sota/W1/HA-001": { lat: 44.3, lon: -71.3, name: "Mount Washington" },
  "pota/DE-0001": { lat: 52.4, lon: 13.4, name: "Ein Park" },
}
const lookups: string[] = []
const suggested: unknown[] = []
const messages: { text: string }[] = []
let accepted = true
let refuse = false

const spot = (call: string, extra: Partial<BoardSpot> = {}, ref = "pota/US-0001", ago = 5): BoardSpot => {
  const [type, ...rest] = ref.split("/")
  return {
    their: { call },
    freq: 14074,
    band: "20m",
    mode: "FT8",
    refs: [{ type, ref: rest.join("/") }],
    spot: { timeInMillis: minutesAgo(ago), source: "pota", label: `${rest.join("/")}: A Park • CT` },
    annotations: { worked: false, isSelf: false, notices: [] },
    ...extra,
  }
}

const ctx = { online: true }
let panes = 0

const environment = { version: 1, width: 390, height: 700, typography: { label: { scaledFontSize: 12 }, body: { scaledFontSize: 14 } } }
const sideways = { ...environment, width: 800, height: 360 }

async function panel(board: BoardSpot[], options: { grid?: string; environment?: typeof environment; config?: Record<string, unknown>; getSpots?: (o: unknown) => BoardSpot[] } = {}) {
  forgetPlaces()
  lookups.length = 0
  suggested.length = 0
  messages.length = 0
  accepted = true
  refuse = false
  const id = ++panes
  const asked: unknown[] = []
  const ext = await loadExtension(() => import("./index.ts"), {
    hostCalls: {
      dbLookupSelectOne: (params) => {
        const key = `${params.category}/${params.key}`
        lookups.push(key)
        const found = PLACES[key]
        return found ? { category: String(params.category), key: String(params.key), name: found.name, lat: found.lat, lon: found.lon } : null
      },
      suggestQso: (params) => {
        suggested.push(params)
        if (refuse) throw new Error("not allowed")
        return { accepted }
      },
      showMessage: (params) => void messages.push({ text: String(params.text) }),
    },
  })
  const context = {
    ...ctx,
    getSpots: async (o?: unknown) => {
      asked.push(o)
      return options.getSpots ? options.getSpots(o) : board
    },
  }
  const args = (config: Record<string, unknown>) => ({
    panelKey: "map",
    instanceId: `map-${id}`,
    operation: { uuid: "op-1", ...(options.grid ? { grid: options.grid } : {}) },
    qsoCount: 0,
    reason: "",
    config,
    clock: { nowMillis: now, realNowMillis: now },
    environment: options.environment ?? environment,
  })
  const config = options.config ?? {}
  return {
    asked,
    descriptors: async () => (await ext.runHook("panel", "getPanels", {}, { ctx: context })) as { preview?: string; on?: string[]; form?: { key: string }[] }[],
    render: async () =>
      (await ext.runHook("panel", "render", args(config), { ctx: context })) as {
        title?: string
        triggers?: string[]
        scene: {
          width: number
          height: number
          values: Record<string, number>
          strings: Record<string, string>
          layers: { id: string; x: number; y: number; width: number; height: number; fixed?: boolean; stretch?: boolean; svg?: string }[]
          controls: { id: string; kind: string; x?: number; y?: number; width?: number; height?: number; fixed?: boolean; disabled?: boolean; event?: string; min?: number; max?: number; options?: { value: string }[] }[]
          scroll?: { axis: string; value: string; event: string }
          layout?: unknown
        }
      },
    event: async (controlId: string, action: string, extra: { text?: string; value?: number } = {}) =>
      (await ext.runHook("panel", "onEvent", { ...args(config), event: { controlId, action, phase: "commit", sequence: 1, ...extra } }, { ctx: context })) as {
        values: Record<string, number>
        strings?: Record<string, string>
      },
  }
}

// ---------------------------------------------------------------------------- the board, placed

test("loading the board needs the host's kernel first, and places one station once, by its newest spot", async () => {
  await panel([])
  const out = await place(
    [
      spot("km4be", {}, "pota/US-0001", 30),
      spot("KM4BE", { freq: 7200, band: "40m", mode: "SSB" }, "pota/US-0002", 5),
      spot("W1AW", {}, "pota/US-0001", 10),
    ],
    now,
  )
  assert.deepEqual(out.map((s) => s.call), ["KM4BE", "W1AW"], "newest first, one to a station")
  assert.equal(out[0].band, "40m")
  assert.equal(out[0].ref, "US-0002")
  assert.deepEqual([out[0].lat, out[0].lon, out[0].park], [35.1, -106.6, "Another Park"], "where its reference is, from the table")
  assert.equal(out[0].refType, "pota")
  assert.equal(out[0].label, "US-0002: A Park • CT")
})

test("a reference is looked up once, however many spots are at it, and a miss is asked again only after ten minutes", async () => {
  await panel([])
  await place([spot("A1A"), spot("B2B"), spot("C3C")], now)
  assert.deepEqual(lookups, ["pota/US-0001"], "one lookup for three spots at one park")
  await place([spot("A1A"), spot("D4D")], now + 60_000)
  assert.equal(lookups.length, 1, "known: not asked again")

  // A reference that is not found, because its table has not arrived yet, is asked for again when ten minutes have gone.
  const missing = spot("E5E", {}, "pota/US-9999")
  assert.deepEqual(await place([missing], now), [])
  assert.equal(lookups.filter((k) => k === "pota/US-9999").length, 1)
  await place([missing], now + 5 * 60_000)
  assert.equal(lookups.filter((k) => k === "pota/US-9999").length, 1, "not yet")
  await place([missing], now + 11 * 60_000)
  assert.equal(lookups.filter((k) => k === "pota/US-9999").length, 2, "now")
})

test("a spot with no reference, or one that is nowhere, has no dot; any award's reference is placed", async () => {
  await panel([])
  const out = await place(
    [
      spot("CLUSTER", { refs: undefined }),
      spot("NOREF", { refs: [] }),
      spot("LOST", {}, "pota/US-9999"),
      spot("SUMMIT", { freq: 14285, mode: "SSB" }, "sota/W1/HA-001"),
      spot("", {}),
      spot("DE1ABC", {}, "pota/DE-0001"),
    ],
    now,
  )
  assert.deepEqual(out.map((s) => s.call).sort(), ["DE1ABC", "SUMMIT"])
  assert.equal(out.find((s) => s.call === "SUMMIT")!.refType, "sota")
  assert.equal(out.find((s) => s.call === "SUMMIT")!.ref, "W1/HA-001", "a summit's reference has a slash in it")
})

test("a place that is not on the earth is not a place", async () => {
  await panel([])
  PLACES["pota/BAD-1"] = { lat: 120, lon: 10, name: "x" }
  PLACES["pota/BAD-2"] = { lat: 10, lon: 400, name: "x" }
  PLACES["pota/BAD-3"] = { lat: Number.NaN, lon: 10, name: "x" }
  const out = await place([spot("A", {}, "pota/BAD-1"), spot("B", {}, "pota/BAD-2"), spot("C", {}, "pota/BAD-3"), spot("D")], now)
  assert.deepEqual(out.map((s) => s.call), ["D"])
  for (const k of ["pota/BAD-1", "pota/BAD-2", "pota/BAD-3"]) delete PLACES[k]
})

test("the band is the one the board names, or the one the frequency is in, or other", () => {
  assert.equal(bandOf("20m", 14074), "20m")
  assert.equal(bandOf(undefined, 7200), "40m")
  assert.equal(bandOf("nonsense", 7200), "40m")
  assert.equal(bandOf(undefined, 0), "other")
  assert.equal(bandOf(undefined, 123), "other")
})

test("the board is asked for with the operation and the operator's choice, annotated, and a host with no board gives none", async () => {
  const p = await panel([spot("A1A")])
  await p.render()
  assert.deepEqual(p.asked[0], { filter: "all", maxAgeMinutes: 30, annotate: true, operationUuid: "op-1" })

  const user = await panel([spot("A1A")], { config: { source: "user", maxAgeMinutes: 90 } })
  await user.render()
  assert.deepEqual(user.asked[0], { filter: "user", maxAgeMinutes: 90, annotate: true, operationUuid: "op-1" })
  // Nonsense is the default; the age is held between five minutes and four hours.
  for (const [given, held] of [[1, 5], [999, 240], ["x", 30], [-3, 30], [45.7, 45]] as const) {
    const q = await panel([], { config: { maxAgeMinutes: given } })
    await q.render()
    assert.equal((q.asked[0] as { maxAgeMinutes: number }).maxAgeMinutes, held, String(given))
  }
  assert.deepEqual(await loadBoard({ online: true } as never, { filter: "all", maxAgeMinutes: 30 }, now), { total: 0, spots: [], available: false })
})

// ---------------------------------------------------------------------------- the scene

test("the map is a scene that scrolls along the pane, and nothing is laid out", async () => {
  const p = await panel([spot("A1A"), spot("B2B", { freq: 7200, band: "40m" }, "pota/US-0002"), spot("NOPLACE", { refs: [] })])
  const { scene, triggers, title } = await p.render()
  assert.deepEqual(scene.scroll, { axis: "x", value: "scroll", event: "scrolled" })
  assert.equal(scene.layout, undefined)
  assert.equal(scene.height, 700, "as tall as the pane")
  assert.equal(scene.width, 390, "at the whole world, as wide as it")
  assert.equal(scene.values.scroll, 0)
  assert.deepEqual(triggers, [], "no timer: the host says when the spots change")
  assert.equal(title, "Spot Map")
  assert.equal(scene.strings.summary, "2 stations · 1 with no place")
  assert.deepEqual(scene.layers.filter((l) => l.id.startsWith("dot:")).map((l) => l.id).sort(), ["dot:A1A", "dot:B2B"])
  assert.equal(scene.layers.find((l) => l.id === "world")!.stretch, true, "the world stretches while a zoom is dragged")
})

test("it opens on the operator's side of the world, zoomed, when the operation has a grid, and on the whole world when it has none", async () => {
  const none = (await (await panel([spot("A1A")])).render()).scene
  assert.equal(none.width, 390)
  assert.equal(none.values.scroll, 0)
  const home = (await (await panel([spot("A1A")], { grid: "FN31pr" })).render()).scene
  assert.ok(Math.abs(home.width - 1560) < 2, `${home.width}: zoom 4`)
  assert.ok(home.values.scroll > 0 && home.values.scroll < home.width - 390, "scrolled to somewhere inside the scene")
  assert.equal(home.strings.region, "", "a view of its own, not one of the regions")
  // A pane on its side opens as far in, and is as tall as the pane.
  const flat = (await (await panel([spot("A1A")], { grid: "FN31pr", environment: sideways })).render()).scene
  assert.ok(flat.width > 800 && flat.height === sideways.height)
  assert.ok(flat.layers.some((l) => l.id === "dot:A1A"), "the operator's own side of the world has its stations in view")
})

test("each dot is a layer and a tap area of its own, a fingertip wide and inside the scene", async () => {
  const p = await panel([spot("A1A"), spot("B2B", {}, "pota/US-0002"), spot("C3C", {}, "pota/DE-0001")])
  const { scene } = await p.render()
  const taps = scene.controls.filter((c) => c.id.startsWith("dot:"))
  assert.equal(taps.length, 3)
  for (const t of taps) {
    assert.deepEqual([t.kind, t.event, t.width, t.height], ["button", "pick", 36, 36])
    assert.ok(t.x! >= 0 && t.x! + 36 <= scene.width && t.y! >= 0 && t.y! + 36 <= scene.height)
    const dot = scene.layers.find((l) => l.id === t.id)!
    assert.ok(Math.abs(t.x! + 18 - (dot.x + dot.width / 2)) < 20 && Math.abs(t.y! + 18 - (dot.y + dot.height / 2)) < 20, "over its dot, or as near as the scene's edge lets it be")
  }
})

test("the controls stay where they are as the map scrolls, and the dropdowns, text and button are among them", async () => {
  const { scene } = await (await panel([spot("A1A")])).render()
  for (const id of ["band", "region", "summary", "details", "log", "zoomIn", "zoomOut", "panUp", "panDown"]) assert.equal(scene.controls.find((c) => c.id === id)!.fixed, true, `${id} stays`)
  assert.equal(scene.layers.find((c) => c.id === "chrome")!.fixed, true)
  assert.deepEqual(scene.controls.find((c) => c.id === "band")!.options!.slice(0, 2).map((o) => o.value), ["all", "160m"])
  assert.deepEqual(scene.controls.find((c) => c.id === "region")!.options!.map((o) => o.value), ["world", "usa", "north-america", "south-america", "europe", "africa", "asia", "oceania"])
  // Nothing overlaps the map's own band: the dropdowns are above it and the details under it.
  const log = scene.controls.find((c) => c.id === "log")!
  assert.ok(log.y! + log.height! <= scene.height)
})

test("there is a strip to zoom on where the pane is tall enough to zoom, and none where it is not", async () => {
  const tall = (await (await panel([spot("A1A")])).render()).scene
  const strip = tall.controls.find((c) => c.id === "stretch")!
  assert.equal(strip.kind, "zoom")
  assert.equal(strip.fixed, undefined, "it scrolls with the scene, as the app requires of a zoom strip")
  assert.equal(strip.x, 0)
  assert.equal(strip.width, tall.width, "and is as long as the scene, so that it is under the pane wherever that is scrolled to")
  assert.ok(strip.min! <= 1 && strip.max! > 1, `factors from ${strip.min} to ${strip.max}`)
  assert.equal(strip.min, 1, "at the whole world there is no zooming out")
  assert.equal(tall.controls.find((c) => c.id === "zoomOut")!.disabled, true)
  assert.equal(tall.controls.find((c) => c.id === "zoomIn")!.disabled, false)
  // A pane on its side zooms as well: a short pane shows less of the map's height, not less zoom.
  const flat = (await (await panel([spot("A1A")], { environment: sideways })).render()).scene
  assert.equal(flat.controls.find((c) => c.id === "stretch")!.kind, "zoom")
  assert.equal(flat.controls.find((c) => c.id === "zoomIn")!.disabled, false)
  // At the whole world there is nowhere to pan to.
  assert.equal(tall.controls.find((c) => c.id === "panUp")!.disabled, true)
  assert.equal(tall.controls.find((c) => c.id === "panDown")!.disabled, true)
})

test("a station already worked is the same dot but faint", async () => {
  const { scene } = await (await panel([spot("OLD", { annotations: { worked: true, isSelf: false, notices: [] } }), spot("NEW", {}, "pota/US-0002")])).render()
  assert.match(scene.layers.find((l) => l.id === "dot:OLD")!.svg!, /fill-opacity="0.35"/)
  assert.doesNotMatch(scene.layers.find((l) => l.id === "dot:NEW")!.svg!, /fill-opacity/)
})

test("only the newest few hundred stations are drawn, so that the scene stays within what a scene holds", async () => {
  PLACES["pota/US-0001"] = PLACES["pota/US-0001"]
  const many = Array.from({ length: MAX_DOTS + 60 }, (_, i) => spot(`K${i}ABC`, {}, "pota/US-0001", i % 120))
  const { scene } = await (await panel(many, { config: { maxAgeMinutes: 240 } })).render()
  assert.equal(scene.layers.filter((l) => l.id.startsWith("dot:")).length, MAX_DOTS)
  assert.ok(scene.controls.length <= 256 && scene.layers.length <= 512)
  assert.match(scene.strings.summary, /^260 stations/)
})

test("the descriptor takes the host's word for a change, has its settings and a picture, and the bundle asks for what it uses", async () => {
  const [d] = await (await panel([])).descriptors()
  assert.deepEqual(d.on, ["spots", "operation"])
  assert.deepEqual(d.form!.map((f) => f.key), ["source", "maxAgeMinutes"])
  assert.ok(d.preview!.startsWith("<svg") && d.preview!.length < 262_144)
  for (const banned of ["<text", "<image", "<script", "<foreignObject", "href="]) assert.ok(!d.preview!.includes(banned), banned)
  assert.equal(manifest.api, 12)
  assert.equal((manifest as { requiresRadioWrite?: boolean }).requiresRadioWrite, true, "tapping a station in the log tunes the radio, as the Spots panel does")
  assert.equal((manifest as { domains?: string[] }).domains, undefined, "and nothing is fetched")
})

// ---------------------------------------------------------------------------- the events

test("the band dropdown filters the dots, and the summary says how many of how many", async () => {
  const p = await panel([spot("A1A"), spot("B2B", { freq: 7200, band: "40m" }, "pota/US-0002")])
  const answer = await p.event("band", "filter", { text: "40m" })
  assert.equal(answer.strings!.band, "40m")
  assert.equal(answer.strings!.summary, "1 station on 40m (of 2)")
  assert.deepEqual((await p.render()).scene.layers.filter((l) => l.id.startsWith("dot:")).map((l) => l.id), ["dot:B2B"])
  assert.deepEqual(answer.values, {}, "an answer that moves nothing names no scroll")
  await p.event("band", "filter", { text: "" })
  assert.equal((await p.render()).scene.strings.band, "all")
})

test("tapping a dot picks the station: it is ringed, the details say who it is, and the button says whom it will log", async () => {
  const p = await panel([spot("A1A"), spot("B2B", { freq: 7200, band: "40m", mode: "SSB" }, "pota/US-0002")])
  const before = (await p.render()).scene
  assert.equal(before.layers.some((l) => l.id === "ring"), false)
  assert.equal(before.controls.find((c) => c.id === "log")!.disabled, true, "nothing to log until one is picked")
  assert.equal(before.strings.details, "Tap a dot to see who it is.")

  const answer = await p.event("dot:B2B", "pick")
  assert.match(answer.strings!.details, /^B2B · 40m SSB 7200 kHz · US-0002: A Park • CT · 5 min ago$/)
  const after = (await p.render()).scene
  assert.ok(after.layers.some((l) => l.id === "ring"))
  assert.ok(after.layers.findIndex((l) => l.id === "ring") > after.layers.findIndex((l) => l.id === "dot:B2B"), "over the dots")
  const log = after.controls.find((c) => c.id === "log")!
  assert.equal(log.disabled, false)
})

test("a station that has gone from the board is let go of", async () => {
  let board = [spot("A1A"), spot("B2B", {}, "pota/US-0002")]
  const p = await panel([], { getSpots: () => board })
  await p.event("dot:B2B", "pick")
  assert.match((await p.render()).scene.strings.details, /^B2B/)
  board = [spot("A1A")]
  assert.equal((await p.render()).scene.strings.details, "Tap a dot to see who it is.")
})

test("Use in the log puts the picked station in the logging fields: its call, frequency, band, mode and reference, for this operation", async () => {
  const p = await panel([spot("B2B", { freq: 7200, band: "40m", mode: "SSB" }, "pota/US-0002")])
  await p.event("dot:B2B", "pick")
  await p.event("log", "log")
  assert.deepEqual(suggested, [{ qso: { their: { call: "B2B" }, freq: 7200, band: "40m", mode: "SSB", refs: [{ type: "pota", ref: "US-0002" }] }, operationUuid: "op-1" }])
  assert.deepEqual(messages.map((m) => m.text), ["B2B is in the log's fields."])
})

test("the log is told only what is known: no band for a frequency no band holds, and a summit's reference as it is", async () => {
  const p = await panel([spot("ODD", { freq: undefined, band: undefined, mode: undefined }, "sota/W1/HA-001")])
  await p.event("dot:ODD", "pick")
  await p.event("log", "log")
  assert.deepEqual((suggested[0] as { qso: unknown }).qso, { their: { call: "ODD" }, refs: [{ type: "sota", ref: "W1/HA-001" }] })
})

test("when the host will not take it, or no operation is open, or there is nothing picked, it says so and does not pretend", async () => {
  const p = await panel([spot("A1A")])
  await p.event("log", "log")
  assert.deepEqual(suggested, [], "nothing picked: nothing asked")

  await p.event("dot:A1A", "pick")
  accepted = false
  await p.event("log", "log")
  assert.match(messages.at(-1)!.text, /Open the operation/)

  refuse = true
  await p.event("log", "log")
  assert.equal(messages.at(-1)!.text, "Could not put A1A in the log.")
})

test("a scroll that has come to rest is kept and sent back as it was; zooming keeps the middle and says where the pane is now", async () => {
  const p = await panel([spot("A1A")])
  // Zoom by a step: wider than the pane, and the scroll in the answer is where the middle of the pane stays.
  const zoomed = await p.event("zoomIn", "zoomIn")
  const wide = (await p.render()).scene
  assert.ok(wide.width > 390 && wide.height === 700)
  assert.equal(wide.values.scroll, zoomed.values.scroll)
  assert.ok(wide.values.scroll > 0)
  // The operator scrolls, and the pane is not told to move.
  const answer = await p.event("list", "scrolled", { value: 77 })
  assert.deepEqual(answer, { values: {} })
  assert.equal((await p.render()).scene.values.scroll, 77)
  // Nonsense is not a place; a place past the end is the end.
  await p.event("list", "scrolled", { value: Number.NaN })
  assert.equal((await p.render()).scene.values.scroll, 77)
  await p.event("list", "scrolled", { value: 1e6 })
  assert.equal((await p.render()).scene.values.scroll, wide.width - 390)
})

test("a drag along the strip zooms by its factor, the step buttons by a step, and neither goes past what there is", async () => {
  const p = await panel([spot("A1A")])
  const widthOf = async () => (await p.render()).scene.width
  assert.equal(await widthOf(), 390)
  await p.event("stretch", "stretch", { value: 2 })
  const two = await widthOf()
  assert.ok(Math.abs(two - 780) < 2, `${two}`)
  await p.event("stretch", "stretch", { value: 0.5 })
  assert.equal(await widthOf(), 390, "back to the world")
  await p.event("zoomOut", "zoomOut")
  assert.equal(await widthOf(), 390, "no further out than the world")
  for (let i = 0; i < 20; i++) await p.event("zoomIn", "zoomIn")
  const most = (await p.render()).scene
  assert.equal(most.controls.find((c) => c.id === "zoomIn")!.disabled, true, "the most the pane's height allows")
  assert.ok(most.width < 8192)
  await p.event("stretch", "stretch", { value: Number.NaN })
  assert.equal((await p.render()).scene.width, most.width, "a factor that is not a number changes nothing")
})

test("choosing a region shows it, and the dropdown names it for as long as it is where the view is", async () => {
  const p = await panel([spot("A1A")])
  const answer = await p.event("region", "region", { text: "africa" })
  assert.equal(answer.strings!.region, "africa")
  const scene = (await p.render()).scene
  assert.equal(scene.strings.region, "africa")
  assert.equal(scene.values.scroll, answer.values.scroll)
  assert.ok(scene.width > 390)
  // Scrolling away from it is a view of its own.
  await p.event("list", "scrolled", { value: (answer.values.scroll ?? 0) + 40 })
  assert.equal((await p.render()).scene.strings.region, "")
  await p.event("region", "region", { text: "world" })
  assert.equal((await p.render()).scene.width, 390)
  // A region that is not one changes nothing.
  const before = (await p.render()).scene.width
  await p.event("region", "region", { text: "atlantis" })
  assert.equal((await p.render()).scene.width, before)
})

test("an answer names only what the scene has, for every event the map takes", async () => {
  const p = await panel([spot("A1A")])
  const scene = (await p.render()).scene
  const known = new Set([...Object.keys(scene.strings), ...Object.keys(scene.values)])
  for (const [id, action, extra] of [
    ["band", "filter", { text: "20m" }],
    ["dot:A1A", "pick", {}],
    ["log", "log", {}],
    ["zoomIn", "zoomIn", {}],
    ["stretch", "stretch", { value: 1.2 }],
    ["region", "region", { text: "europe" }],
    ["list", "scrolled", { value: 10 }],
  ] as const) {
    const answer = await p.event(id, action, extra)
    for (const key of [...Object.keys(answer.values), ...Object.keys(answer.strings ?? {})]) assert.ok(known.has(key), `${action}: ${key}`)
  }
})

test("two panes keep their own band, station and view", async () => {
  const p = await panel([spot("A1A"), spot("B2B", { freq: 7200, band: "40m" }, "pota/US-0002")])
  await p.event("band", "filter", { text: "40m" })
  await p.event("zoomIn", "zoomIn")
  // Another pane of the same extension: a fresh instance id, its own state.
  const other = await panel([spot("A1A")])
  const scene = (await other.render()).scene
  assert.equal(scene.strings.band, "all")
  assert.equal(scene.width, 390)
})

// ---------------------------------------------------------------------------- the words

test("the details line names the station, its tuning, where it is, how long ago, and whether it was worked", () => {
  const s: MapSpot = { call: "KM4BE", band: "20m", freq: 14074, mode: "FT8", ref: "US-0001", refType: "pota", park: "A Park", label: "", lat: 0, lon: 0, millis: now - 5 * 60_000, source: "pota", worked: false }
  assert.equal(detailsLine(s, now), "KM4BE · 20m FT8 14074 kHz · US-0001 A Park · 5 min ago")
  assert.equal(detailsLine({ ...s, label: "US-0001: A Park • CT", worked: true }, now), "KM4BE · 20m FT8 14074 kHz · US-0001: A Park • CT · 5 min ago · worked before")
  assert.equal(detailsLine({ ...s, millis: now - 90 * 60_000 }, now), "KM4BE · 20m FT8 14074 kHz · US-0001 A Park · 1 h 30 min ago")
  assert.equal(detailsLine({ ...s, millis: now - 5_000 }, now).split(" · ").at(-1), "just now")
  assert.equal(detailsLine(undefined, now), "Tap a dot to see who it is.")
})

test("the summary counts the stations on a band and the ones there is no place for", () => {
  assert.equal(summary(5, 5, 0, "all"), "5 stations")
  assert.equal(summary(1, 1, 0, "all"), "1 station")
  assert.equal(summary(3, 9, 0, "20m"), "3 stations on 20m (of 9)")
  assert.equal(summary(9, 9, 4, "all"), "9 stations · 4 with no place")
  assert.equal(filterBand([{ band: "20m" }, { band: "40m" }] as MapSpot[], "20m").length, 1)
  assert.equal(filterBand([{ band: "20m" }, { band: "40m" }] as MapSpot[], "all").length, 2)
})

test("the up and down buttons move the band of latitudes: stations farther north or south leave it and come back", async () => {
  const p = await panel([spot("A1A"), spot("B2B", {}, "pota/US-0002"), spot("C3C", {}, "pota/DE-0001")])
  const ids = async () => (await p.render()).scene.layers.filter((l) => l.id.startsWith("dot:")).map((l) => l.id)
  await p.event("region", "region", { text: "europe" })
  assert.ok((await ids()).includes("dot:C3C"), "Berlin is in Europe")
  const before = (await p.render()).scene.layers.find((l) => l.id === "world")!.svg
  for (let i = 0; i < 4; i++) await p.event("panDown", "panDown")
  assert.notEqual((await p.render()).scene.layers.find((l) => l.id === "world")!.svg, before, "the band is another one")
  assert.ok(!(await ids()).includes("dot:C3C"), "south of Berlin by now")
  const south = (await p.render()).scene
  assert.equal(south.controls.find((c) => c.id === "panDown")!.disabled, true, "at the bottom of the map")
  assert.equal(south.controls.find((c) => c.id === "panUp")!.disabled, false)
  for (let i = 0; i < 6; i++) await p.event("panUp", "panUp")
  assert.ok((await ids()).includes("dot:C3C"), "and back")
})
