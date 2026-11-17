// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { test } from "node:test"

import type { PanelScene, PanelScenePatch } from "@ham2k/extension-sdk"

import { buildCatalog, parseElements, parseList } from "./data.ts"
import { buildDetail, completePass, DEFAULT_THEME } from "./detail.ts"
import { ELEMENTS, LIST } from "./fixtures.ts"
import { liveFrame, liveTarget, stillMoving } from "./live.ts"
import { findPasses, footprintKm, lookAt, satrecFromOmm, subPoint } from "./orbit.ts"
import { buildDetailScene } from "./scene.ts"
import { elevationText, headingText, liveSpot, skyTrack } from "./sky.ts"

const ao7 = buildCatalog(parseList(LIST), parseElements(ELEMENTS), {}).find((s) => s.name === "AO-7")!
const satrec = satrecFromOmm(ao7.omm!)
const miami = { lat: 25.76, lon: -80.19 }
const listed = findPasses(satrec, miami, Date.parse("2026-10-07T00:00:00Z"), 24, 10).reduce((a, b) => (b.maxElevation > a.maxElevation ? b : a))
const mid = Math.round((listed.aos + listed.los) / 2)

/// The scene as the app would hold it, and the patch laid over it as the app lays one: a path that names nothing fails, as the app refuses it.
function apply(scene: PanelScene, patch: PanelScenePatch): PanelScene {
  const copy = structuredClone(scene) as unknown as Record<string, unknown>
  for (const step of patch) {
    assert.ok("merge" in step, "only merges are sent")
    let at: unknown = copy
    for (const key of step.merge) {
      at = Array.isArray(at) ? at.find((item) => item?.id === key) : (at as Record<string, unknown>)?.[key]
      assert.ok(at, `nothing at ${step.merge.join(" / ")}`)
    }
    Object.assign(at as object, step.value)
  }
  return copy as unknown as PanelScene
}

function page(tab: "sky" | "map", drawnAt: number) {
  const detail = buildDetail(ao7, miami, listed, drawnAt, true, tab)
  const scene = buildDetailScene(detail)
  const pass = completePass(ao7, miami, listed, drawnAt)
  const target = liveTarget("pane", tab, ao7, miami, pass, skyTrack(satrec, miami, pass), DEFAULT_THEME, [...scene.layers.map((l) => l.id), ...(scene.controls ?? []).map((c) => c.id)])!
  return { scene, target }
}

test("on the Sky page, the satellite and the numbers in the corners move by a patch, and every step names something the page has", () => {
  const { scene, target } = page("sky", mid)
  const later = mid + 20_000
  const patch = liveFrame(target, later)
  const moved = apply(scene, patch) as unknown as { layers: { id: string; x: number; y: number; text?: { literal?: string } }[] }
  const layer = (id: string) => moved.layers.find((l) => l.id === id)!
  const look = lookAt(satrec, miami, later)!
  const spot = liveSpot(target.track, target.pass, later, look)!
  assert.ok(Math.abs(layer("satNow").x + 24 - spot.x) < 0.1 && Math.abs(layer("satNow").y + 24 - spot.y) < 0.1)
  assert.equal(layer("elNow").text!.literal, elevationText(look.elevation))
  assert.equal(layer("azNow").text!.literal, headingText(look.azimuth))
  assert.ok(patch.some((s) => "merge" in s && s.merge[1] === "dnFreq"), "the Doppler readout too")
  // The plot itself is never sent again.
  assert.ok(!patch.some((s) => "merge" in s && s.merge[1] === "sky"))
})

test("a Sky page drawn before rise has no satellite on it, and nothing is sent for it; after set it stops", () => {
  const { target } = page("sky", listed.aos - 60_000)
  assert.deepEqual(liveFrame(target, mid), [], "the draw at rise adds the satellite, and the patches follow from there")
  assert.equal(stillMoving(target, listed.los + 1000), false)
})

test("on the Map page, the satellite's dot and its footprint move, up or not", () => {
  for (const at of [mid, listed.aos - 30 * 60_000]) {
    const { scene, target } = page("map", at)
    const later = at + 5_000
    const moved = apply(scene, liveFrame(target, later)) as unknown as { controls: { id: string; markers: { id: string; lat: number; lon: number }[]; circles: { id: string; km: number }[] }[] }
    const map = moved.controls.find((c) => c.id === "passMap")!
    const here = subPoint(satrec, later)!
    const sat = map.markers.find((m) => m.id === "sat")!
    assert.ok(Math.abs(sat.lat - here.lat) < 0.01 && Math.abs(sat.lon - here.lon) < 0.01)
    assert.equal(map.circles.find((c) => c.id === "footprint")!.km, Math.round(footprintKm(here.altKm)))
    assert.equal(stillMoving(target, listed.los + 3_600_000), true, "a map keeps moving for as long as it is open")
  }
})
