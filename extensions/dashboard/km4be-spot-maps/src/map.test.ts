// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { test } from "node:test"

import { loadExtension } from "./sdkGapTesting.ts"
import { filterBand, markersSvg, parseSpots, project, summary } from "./spots.ts"
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
  assert.equal(first.strings.summary, "2 activators")
  assert.equal((first.layers[1].svg.match(/<circle/g) ?? []).length, 2)

  const patch = (await ext.runHook(
    "panel",
    "onEvent",
    { ...args, event: { controlId: "band", action: "filter", phase: "commit", sequence: 1, text: "40m" } },
    { ctx: { online: true } },
  )) as { strings: Record<string, string> }
  assert.equal(patch.strings.band, "40m")
  assert.equal(patch.strings.summary, "1 activator on 40m (of 2)")
  assert.equal(((await scene()).layers[1].svg.match(/<circle/g) ?? []).length, 1)
})
