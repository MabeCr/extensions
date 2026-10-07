// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { test } from "node:test"

import { loadExtension } from "./sdkGapTesting.ts"
import { fit, presetOf, presetView, toScene, WORLD, zoomed } from "./view.ts"
import { MAX_CLICKABLE, detailsLine, dotHitArea, filterBand, markersSvg, parseSpots, project, spotOptions, summary } from "./spots.ts"
import type { PotaApiSpot } from "./spots.ts"

const spot = (activator: string, extra: Partial<PotaApiSpot> = {}): PotaApiSpot => ({
  activator,
  frequency: "14074",
  mode: "FT8",
  reference: "US-0001",
  name: "A Park",
  spotTime: "2026-09-01T12:00:00",
  comments: "",
  latitude: 40,
  longitude: -75,
  ...extra,
})

test("one spot per activator, newest first, QRT and unplaceable ones dropped", () => {
  const out = parseSpots([
    spot("km4be", { spotTime: "2026-09-01T12:00:00" }),
    spot("KM4BE", { spotTime: "2026-09-01T12:30:00", frequency: "7200", mode: "SSB" }),
    spot("W1AW", { spotTime: "2026-09-01T12:10:00" }),
    spot("N0QRT", { comments: "qrt thanks" }),
    spot("NOLOC", { latitude: null }),
    spot("BADLON", { longitude: 400 }),
  ])
  assert.deepEqual(out.map((s) => s.call), ["KM4BE", "W1AW"])
  assert.equal(out[0].band, "40m")
  assert.equal(out[0].mode, "SSB")
  assert.equal(out[1].band, "20m")
})

test("a frequency no band holds is drawn as other", () => {
  assert.equal(parseSpots([spot("X1X", { frequency: "" })])[0].band, "other")
})

test("projection is equirectangular over the clipped map", () => {
  assert.deepEqual(project(0, 0), { x: 360, y: 168 })
  assert.deepEqual(project(84, -180), { x: 0, y: 0 })
  // Beyond the map's southern edge a marker sits on the edge rather than off it.
  assert.equal(project(-80, 0).y, 284)
})

test("band filter, marker SVG and the summary line", () => {
  const spots = parseSpots([spot("A1A"), spot("B2B", { frequency: "7200" })])
  assert.equal(filterBand(spots, "all").length, 2)
  assert.deepEqual(filterBand(spots, "40m").map((s) => s.call), ["B2B"])
  assert.equal((markersSvg(spots).match(/<circle/g) ?? []).length, 2)
  assert.equal(summary(1, 1, "all"), "1 activator")
  assert.equal(summary(2, 5, "20m"), "2 activators on 20m (of 5)")
})

test("render draws the world and the markers, and the dropdown filters them", async () => {
  const ext = await loadExtension(() => import("./index.ts"), {
    hostCalls: { fetch: () => ({ status: 200, body: JSON.stringify([spot("A1A"), spot("B2B", { frequency: "7200" })]) }) },
  })
  const args = { panelKey: "map", instanceId: "pane-1", operation: {}, qsoCount: 0, reason: "", config: {} }
  const scene = async () =>
    ((await ext.runHook("panel", "render", args, { ctx: { online: true } })) as { kind: string; scene: any }).scene

  const first = await scene()
  assert.deepEqual(first.layers.map((l: { id: string }) => l.id), ["world", "spots"])
  assert.match(first.strings.summary, /^2 activators · updated \d\d:\d\dZ$/)
  assert.equal((first.layers[1].svg.match(/<circle/g) ?? []).length, 2)

  const patch = (await ext.runHook(
    "panel",
    "onEvent",
    { ...args, event: { controlId: "band", action: "filter", phase: "commit", sequence: 1, text: "40m" } },
    { ctx: { online: true } },
  )) as { strings: Record<string, string> }
  assert.equal(patch.strings.band, "40m")
  assert.match(patch.strings.summary, /^1 activator on 40m \(of 2\)/)
  assert.equal(((await scene()).layers[1].svg.match(/<circle/g) ?? []).length, 1)
})

test("the details line names the station, its tuning, its park and how long ago", () => {
  const [a] = parseSpots([spot("A1A", { spotTime: "2026-09-01T12:00:00" })])
  const at = Date.parse("2026-09-01T12:07:00Z")
  assert.equal(detailsLine(a, at), "A1A · 20m FT8 14074 kHz · US-0001 A Park · 7 min ago")
  assert.equal(detailsLine(a, Date.parse("2026-09-01T13:30:00Z")), "A1A · 20m FT8 14074 kHz · US-0001 A Park · 1 h 30 min ago")
  assert.equal(detailsLine(undefined, at), "Pick a station to see where it is.")
})

test("the picker lists none first, then the newest sixty, and the pick is ringed", () => {
  const many = parseSpots(Array.from({ length: 70 }, (_, i) => spot(`K${i}X`, { spotTime: `2026-09-01T12:${String(i % 60).padStart(2, "0")}:00` })))
  const options = spotOptions(many)
  assert.equal(options.length, 61)
  assert.deepEqual(options[0], { label: "No station selected", value: "" })
  const svg = markersSvg(many.slice(0, 3), many[1].call)
  assert.equal((svg.match(/<circle/g) ?? []).length, 3 + 2) // three dots, plus the pick's ring and its repeat on top
  assert.equal((markersSvg(many.slice(0, 3)).match(/<circle/g) ?? []).length, 3)
})

test("picking a station fills the details, the band filter lets go of it, and Refresh fetches again", async () => {
  let fetches = 0
  const ext = await loadExtension(() => import("./index.ts"), {
    hostCalls: {
      fetch: () => {
        fetches += 1
        return { status: 200, body: JSON.stringify([spot("A1A"), spot("B2B", { frequency: "7200" })]) }
      },
    },
  })
  const args = { panelKey: "map", instanceId: "pane-2", operation: {}, qsoCount: 0, reason: "", config: {} }
  const event = async (controlId: string, action: string, text?: string) =>
    ((await ext.runHook(
      "panel",
      "onEvent",
      { ...args, event: { controlId, action, phase: "commit", sequence: 1, text } },
      { ctx: { online: true } },
    )) as { strings: Record<string, string> }).strings

  const picked = await event("spot", "select", "B2B")
  assert.equal(picked.spot, "B2B")
  assert.match(picked.details, /^B2B · 40m FT8 7200 kHz · US-0001 A Park/)

  // B2B is a 40m station, so filtering to 20m drops the pick instead of leaving it dangling.
  const filtered = await event("band", "filter", "20m")
  assert.equal(filtered.spot, "")
  assert.equal(filtered.details, "Pick a station to see where it is.")

  const before = fetches
  await event("spot", "select", "A1A") // inside the cache window: no fetch
  assert.equal(fetches, before)
  await event("refresh", "refresh")
  assert.equal(fetches, before + 1)
})

test("each dot has a click target exactly its size, and clicking it picks the station", async () => {
  const [a] = parseSpots([spot("A1A", { latitude: 0, longitude: 0 })])
  // The dot is centered at (360, 168) with radius 3.2.
  assert.deepEqual(dotHitArea(a), { x: 356.8, y: 164.8, width: 6.4, height: 6.4 })

  const ext = await loadExtension(() => import("./index.ts"), {
    hostCalls: {
      fetch: () => ({
        status: 200,
        body: JSON.stringify(Array.from({ length: 70 }, (_, i) => spot(`K${i}X`, { spotTime: `2026-09-01T12:${String(i % 60).padStart(2, "0")}:00` }))),
      }),
    },
  })
  const args = { panelKey: "map", instanceId: "pane-3", operation: {}, qsoCount: 0, reason: "", config: {} }
  const scene = async () =>
    ((await ext.runHook("panel", "render", args, { ctx: { online: true } })) as { scene: any }).scene

  // The feed is cached across tests in this process; Refresh drops the earlier tests' spots.
  await ext.runHook(
    "panel",
    "onEvent",
    { ...args, event: { controlId: "refresh", action: "refresh", phase: "activate", sequence: 0 } },
    { ctx: { online: true } },
  )
  const { controls } = await scene()
  const dots = controls.filter((c: { kind: string }) => c.kind === "button")
  assert.equal(dots.length, MAX_CLICKABLE)
  assert.ok(controls.length <= 64)
  assert.ok(dots.every((c: { width: number; height: number }) => c.width === 6.4 && c.height === 6.4))

  const target = dots[0].id as string
  const call = target.slice("dot:".length)
  const patch = (await ext.runHook(
    "panel",
    "onEvent",
    { ...args, event: { controlId: target, action: "pick", phase: "activate", sequence: 1 } },
    { ctx: { online: true } },
  )) as { strings: Record<string, string> }
  assert.equal(patch.strings.spot, call)
  assert.ok(patch.strings.details.startsWith(call))
})

test("a view is kept inside the map, zooms in steps and names its preset", () => {
  assert.deepEqual(fit({ cx: 0, cy: 0, zoom: 1 }), WORLD)
  assert.equal(fit({ cx: 360, cy: 142, zoom: 99 }).zoom, 16)
  assert.equal(fit({ cx: 360, cy: 142, zoom: 0.2 }).zoom, 1)
  // Zoomed 4x the window is 180 wide, so its center cannot come closer to an edge than 90.
  assert.equal(fit({ cx: 5, cy: 142, zoom: 4 }).cx, 90)
  assert.equal(zoomed(WORLD, 1).zoom, 1.5)
  assert.equal(zoomed(WORLD, -1).zoom, 1)
  assert.equal(presetOf(WORLD), "world")
  assert.equal(presetOf(presetView("europe")!), "europe")
  assert.equal(presetOf(zoomed(WORLD, 1)), "")
  // The scene is the window scaled up: its center stays put, a corner of the window goes to the corner.
  const two = fit({ cx: 360, cy: 142, zoom: 2 })
  assert.deepEqual(toScene(two, { x: 360, y: 142 }), { x: 360, y: 142 })
  assert.deepEqual(toScene(two, { x: 180, y: 71 }), { x: 0, y: 0 })
  assert.deepEqual(toScene(WORLD, { x: 12.5, y: 7 }), { x: 12.5, y: 7 })
})

test("zoomed in, the base map is cropped, far dots are dropped and near ones keep their size", async () => {
  const near = spot("NEAR", { latitude: 52, longitude: 15 }) // Europe
  const far = spot("FAR", { latitude: -25, longitude: 150 }) // Oceania
  const ext = await loadExtension(() => import("./index.ts"), {
    hostCalls: { fetch: () => ({ status: 200, body: JSON.stringify([near, far]) }) },
  })
  const args = { panelKey: "map", instanceId: "pane-4", operation: {}, qsoCount: 0, reason: "", config: {} }
  const event = async (controlId: string, action: string, text?: string) =>
    (await ext.runHook(
      "panel",
      "onEvent",
      { ...args, event: { controlId, action, phase: "commit", sequence: 1, text } },
      { ctx: { online: true } },
    )) as { strings: Record<string, string> }
  const scene = async () =>
    ((await ext.runHook("panel", "render", args, { ctx: { online: true } })) as { scene: any }).scene
  const dotIds = (sc: any) => sc.controls.filter((c: { kind: string }) => c.kind === "button").map((c: { id: string }) => c.id)

  await event("refresh", "refresh")
  assert.deepEqual(dotIds(await scene()).sort(), ["dot:FAR", "dot:NEAR"])

  const patch = await event("view", "view", "europe")
  assert.equal(patch.strings.view, "europe")
  const eu = await scene()
  assert.deepEqual(dotIds(eu), ["dot:NEAR"])
  assert.match(eu.layers[0].svg, /viewBox="(?!0 0 720 284)/) // cropped, not the whole map
  assert.equal((eu.layers[1].svg.match(/<circle/g) ?? []).length, 1)
  // Europe is centered on 52N 15E, so NEAR's dot is at the middle of the scene.
  const hit = eu.controls.find((c: { id: string }) => c.id === "dot:NEAR")
  assert.equal(hit.width, 6.4)
  assert.ok(Math.abs(hit.x + 3.2 - 360) < 1 && Math.abs(hit.y + 3.2 - 142) < 1)

  // Zooming from a preset makes the view custom; the region dropdown shows its placeholder.
  assert.equal((await event("zoomIn", "zoomIn")).strings.view, "")
  assert.equal((await event("view", "view", "world")).strings.view, "world")
  const world = await scene()
  assert.equal(world.controls.find((c: { id: string }) => c.id === "zoomOut").disabled, true)
  assert.equal(world.controls.find((c: { id: string }) => c.id === "zoomIn").disabled, false)
  assert.ok(world.controls.length <= 64)
})
