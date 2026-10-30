// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// Every page the map can draw, held to the rules the app holds a scene to (sceneRules.ts). The app refuses a scene whole, with an error
// that names the rule, when it breaks one, and a rule a test does not hold the map to is one the first phone finds out.

import assert from "node:assert/strict"
import { test } from "node:test"

import type { BoardSpot } from "@ham2k/extension-sdk"

import { forgetPlaces } from "./board.ts"
import { loadExtension } from "./sdkGapTesting.ts"
import { violations } from "./sceneRules.ts"
import type { SceneLike } from "./sceneRules.ts"

const now = Date.parse("2026-10-30T12:00:00Z")
const PLACES: Record<string, { lat: number; lon: number; name: string }> = {
  "pota/US-0001": { lat: 41.5, lon: -72.7, name: "A Park" },
  "pota/US-0002": { lat: 35.1, lon: -106.6, name: "Another Park" },
  "pota/DE-0001": { lat: 52.4, lon: 13.4, name: "Ein Park" },
}
const spot = (call: string, ref: string, band = "20m", freq = 14074): BoardSpot => ({
  their: { call },
  freq,
  band,
  mode: "FT8",
  refs: [{ type: "pota", ref }],
  spot: { timeInMillis: now - 5 * 60_000, source: "pota", label: `${ref}: A Park` },
  annotations: { worked: false, isSelf: false, notices: [] },
})
const BOARD = [spot("A1A", "US-0001"), spot("B2B", "US-0002", "40m", 7200), spot("C3C", "DE-0001")]

let panes = 0
async function panel(size: { width: number; height: number } | undefined, board: BoardSpot[] = BOARD, grid?: string) {
  forgetPlaces()
  const id = ++panes
  const ext = await loadExtension(() => import("./index.ts"), {
    hostCalls: {
      dbLookupSelectOne: (params) => {
        const found = PLACES[`${params.category}/${params.key}`]
        return found ? { category: String(params.category), key: String(params.key), name: found.name, lat: found.lat, lon: found.lon } : null
      },
      suggestQso: () => ({ accepted: true }),
      showMessage: () => undefined,
    },
  })
  const context = { online: true, getSpots: async () => board }
  const args = (config: Record<string, unknown>) => ({
    panelKey: "map",
    instanceId: `rules-${id}`,
    operation: { uuid: "op-1", ...(grid ? { grid } : {}) },
    qsoCount: 0,
    reason: "",
    config,
    clock: { nowMillis: now, realNowMillis: now },
    ...(size ? { environment: { version: 1, ...size, typography: { label: { scaledFontSize: 12 }, body: { scaledFontSize: 14 } } } } : {}),
  })
  return {
    render: async () => ((await ext.runHook("panel", "render", args({}), { ctx: context })) as { scene: SceneLike & { width: number; height: number } }).scene,
    event: async (controlId: string, action: string, extra: { text?: string; value?: number } = {}) =>
      ext.runHook("panel", "onEvent", { ...args({}), event: { controlId, action, phase: "commit", sequence: 1, ...extra } }, { ctx: context }),
  }
}

test("the checker names a zoom strip that is fixed, which is what the app refused", () => {
  const strip = { id: "stretch", kind: "zoom", label: "Zoom", event: "stretch", min: 1, max: 3, x: 0, y: 0, width: 100, height: 30 }
  const scene = (patch: object, scrolls = true): SceneLike => ({
    values: { scroll: 0 },
    strings: {},
    layers: [],
    ...(scrolls ? { scroll: { axis: "x", value: "scroll", event: "scrolled" } } : {}),
    controls: [{ ...strip, ...patch }],
  })
  assert.deepEqual(violations(scene({})), [])
  assert.deepEqual(violations(scene({ fixed: true })), ["stretch: a zoom strip is fixed, and has to scroll with the scene"])
  assert.deepEqual(violations(scene({ event: undefined })), ["stretch: a zoom strip sends no event"])
  assert.deepEqual(violations(scene({ min: 2, max: 2 })), ["stretch: a zoom strip whose factors are 2 to 2 has nothing to zoom to"])
  assert.deepEqual(violations(scene({}, false)), ["stretch: a zoom strip is in a scene that does not scroll"])
  assert.deepEqual(violations({ values: {}, strings: {}, layers: [{ id: "chrome", fixed: true }], controls: [] }), ["chrome is fixed in a scene that does not scroll"])
})

test("the map is as the app wants it, on every size of pane, with spots and without, and after each thing that can be done to it", async () => {
  const sizes = [undefined, { width: 0, height: 0 }, { width: 390, height: 700 }, { width: 360, height: 600 }, { width: 800, height: 360 }, { width: 700, height: 900 }, { width: 150, height: 150 }]
  for (const size of sizes) {
    for (const [board, grid] of [[BOARD, undefined], [BOARD, "FN31pr"], [[], undefined]] as const) {
      const label = `${size ? `${size.width}×${size.height}` : "no size"}, ${board.length} spots${grid ? ", opened at home" : ""}`
      const p = await panel(size, [...board], grid)
      assert.deepEqual(violations(await p.render()), [], `the map at ${label}`)
      for (const [id, action, extra] of [
        ["band", "filter", { text: "40m" }],
        ["band", "filter", { text: "" }],
        ["dot:A1A", "pick", {}],
        ["zoomIn", "zoomIn", {}],
        ["stretch", "stretch", { value: 1.3 }],
        ["list", "scrolled", { value: 40 }],
        ["region", "region", { text: "europe" }],
        ["region", "region", { text: "world" }],
        ["zoomOut", "zoomOut", {}],
      ] as const) {
        await p.event(id, action, extra)
        assert.deepEqual(violations(await p.render()), [], `the map at ${label} after ${action}`)
      }
    }
  }
})
