// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// Every page, at every size a pane can be, including the ones it is for a moment while the host is still laying it out: no rect with a
// negative or empty size, or a place that is not a number. The app refuses a scene whole for one.

import assert from "node:assert/strict"
import { test } from "node:test"

import { buildCatalog, ELEMENTS_URL, LIST_URL, parseElements, parseList, statusUrl } from "./data.ts"
import { ELEMENTS, LIST, SUMMARY } from "./fixtures.ts"
import { forgetAll } from "./memory.ts"
import { findPasses, satrecFromOmm } from "./orbit.ts"
import { datasetCalls } from "./datasetTesting.ts"
import { loadExtension } from "./sdkGapTesting.ts"
import { violations } from "./sceneRules.ts"
import type { SceneLike } from "./sceneRules.ts"

const ctx = { online: true }
let panes = 0
const t0 = Date.parse("2026-10-07T00:00:00Z")
const ao7 = buildCatalog(parseList(LIST), parseElements(ELEMENTS), {}).find((s) => s.name === "AO-7")!
const best = findPasses(satrecFromOmm(ao7.omm!), { lat: 25.76, lon: -80.19 }, t0, 24, 10).reduce((a, b) => (b.maxElevation > a.maxElevation ? b : a))
const mid = Math.round((best.aos + best.los) / 2)
const cfg = { grid: "EL95vs", minElevation: 0, utc: true }

interface Rect {
  id: string
  x?: number
  y?: number
  width?: number
  height?: number
}

/// What is wrong with the rects of a scene: a size that is not above zero, or a place or size that is not a finite number.
function badRects(scene: SceneLike & { width?: number; height?: number }): string[] {
  const out: string[] = []
  const check = (kind: string, r: Rect) => {
    const has = r.x !== undefined || r.y !== undefined || r.width !== undefined || r.height !== undefined
    if (!has) return
    for (const k of ["x", "y", "width", "height"] as const) if (typeof r[k] !== "number" || !Number.isFinite(r[k])) out.push(`${kind} ${r.id}: ${k} is ${String(r[k])}`)
    if (typeof r.width === "number" && r.width <= 0) out.push(`${kind} ${r.id}: width ${r.width}`)
    if (typeof r.height === "number" && r.height <= 0) out.push(`${kind} ${r.id}: height ${r.height}`)
  }
  for (const l of (scene.layers ?? []) as Rect[]) check("layer", l)
  for (const c of (scene.controls ?? []) as Rect[]) check("control", c)
  if (scene.width !== undefined && !(scene.width > 0)) out.push(`the scene's width is ${scene.width}`)
  if (scene.height !== undefined && !(scene.height > 0)) out.push(`the scene's height is ${scene.height}`)
  return out
}

async function panel(width: number | undefined, height: number | undefined) {
  forgetAll()
  const id = ++panes
  const ext = await loadExtension(() => import("./index.ts"), {
    hostCalls: {
      ...datasetCalls().hostCalls,
      getLocation: () => null,
      kvGet: () => null,
      kvSet: () => undefined,
      getSettings: () => ({}),
      setSettings: () => undefined,
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
  const environment = width === undefined ? undefined : { version: 1, width, height, colors: { surface: "#101418" }, typography: { mono: { fontFamily: "RobotoMono", fontSize: 13, scaledFontSize: 13 } } }
  const args = (config: Record<string, unknown>, at: number) => ({
    panelKey: "passes",
    instanceId: `geometry-${id}`,
    operation: {},
    qsoCount: 0,
    reason: "",
    config,
    clock: { nowMillis: at, realNowMillis: at },
    ...(environment ? { environment } : {}),
  })
  return {
    render: async (config: Record<string, unknown>, at: number) => (await ext.runHook("panel", "render", args(config, at), { ctx })) as { scene: SceneLike & { width: number; height: number } },
    event: async (config: Record<string, unknown>, at: number, controlId: string, action: string, extra: { text?: string } = {}) =>
      ext.runHook("panel", "onEvent", { ...args(config, at), event: { controlId, action, phase: "commit", sequence: 1, ...extra } }, { ctx }),
  }
}

/// Sizes a pane is: real ones, the ones before it has been laid out (nothing, a sliver), and the odd ones either side of what the layout
/// assumes.
const SIZES: [number | undefined, number | undefined][] = [
  [undefined, undefined],
  [0, 0],
  [1, 1],
  [40, 40],
  [120, 90],
  [150, 700],
  [220, 150],
  [300, 260],
  [390, 700],
  [390, 40],
  [800, 360],
  [1200, 900],
  [390, 0],
  [0, 700],
]

test("the list, the sky and a pass's pages draw sensible geometry at every size a pane can be", async () => {
  for (const [width, height] of SIZES) {
    const label = `${width}×${height}`
    const p = await panel(width, height)
    const list = await p.render(cfg, mid)
    assert.deepEqual([...violations(list.scene), ...badRects(list.scene)], [], `the list at ${label}`)

    await p.event(cfg, mid, "mode", "mode", { text: "now" })
    const sky = await p.render(cfg, mid)
    assert.deepEqual([...violations(sky.scene), ...badRects(sky.scene)], [], `the sky at ${label}`)
    await p.event(cfg, mid, "mode", "mode", { text: "all" })

    const open = (await p.render(cfg, mid)).scene.controls!.find((c) => /^open:.*:row\d+$/.test(c.id))
    assert.ok(open, `a pass to open at ${label}`)
    await p.event(cfg, mid, open!.id, "open")
    for (const tab of ["sky", "radio", "report"]) {
      await p.event(cfg, mid, `tab_${tab}`, `tab-${tab}`)
      const page = await p.render(cfg, mid)
      assert.deepEqual([...violations(page.scene), ...badRects(page.scene)], [], `the ${tab} page at ${label}`)
    }
  }
})
