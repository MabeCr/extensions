// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { test } from "node:test"

import { buildCatalog, parseElements, parseList } from "./data.ts"
import { buildDetail } from "./detail.ts"
import { ELEMENTS, LIST } from "./fixtures.ts"
import { faded, groundTrack, MAP_ZOOM, passMap, TRACK_MARGIN_MS } from "./map.ts"
import { findPasses, footprintKm, lookAt, satrecFromOmm, subPoint } from "./orbit.ts"
import { DEFAULT_SKY_COLORS } from "./sky.ts"

const catalog = buildCatalog(parseList(LIST), parseElements(ELEMENTS), {})
const ao7 = catalog.find((s) => s.name === "AO-7")!
const satrec = satrecFromOmm(ao7.omm!)
const miami = { lat: 25.76, lon: -80.19 }
const pass = findPasses(satrec, miami, Date.parse("2026-10-07T00:00:00Z"), 24, 10).reduce((a, b) => (b.maxElevation > a.maxElevation ? b : a))
const mid = Math.round((pass.aos + pass.los) / 2)

type MapControl = {
  kind: string
  home: { lat: number; lon: number }
  zoom: { initial: number }
  markers: { id: string; lat: number; lon: number }[]
  lines: { id: string; points: { lat: number; lon: number }[]; style: string }[]
  circles: { id: string; at: string; km: number }[]
}
const control = (now: number) => passMap(satrec, miami, pass, now, DEFAULT_SKY_COLORS, "#ffffff") as unknown as MapControl

test("the point under the satellite is where it is overhead: straight up from there", () => {
  const p = subPoint(satrec, mid)!
  assert.ok(lookAt(satrec, { lat: p.lat, lon: p.lon }, mid)!.elevation > 89.5)
  // AO-7 is about 1,450 km up, and heard about 3,900 km round from the point under it.
  assert.ok(p.altKm > 1350 && p.altKm < 1550, String(p.altKm))
  assert.ok(Math.abs(footprintKm(p.altKm) - 3900) < 300, String(footprintKm(p.altKm)))
})

test("the map shows the pass solid, a quarter hour either side dashed, and you in the middle", () => {
  const map = control(mid)
  assert.equal(map.kind, "map")
  assert.deepEqual(map.home, { lat: 25.76, lon: -80.19 })
  assert.equal(map.zoom.initial, MAP_ZOOM)
  assert.deepEqual(map.lines.map((l) => [l.id, l.style]), [["before", "nearby"], ["after", "nearby"], ["pass", "pass"]])
  const solid = map.lines.find((l) => l.id === "pass")!.points
  // Every point of the solid part is somewhere the satellite is above your horizon.
  const t = (i: number) => Math.min(pass.los, pass.aos + i * 15_000)
  solid.forEach((p, i) => assert.ok(lookAt(satrec, miami, t(i))!.elevation > -0.5, `${i}`))
  const before = map.lines.find((l) => l.id === "before")!.points
  assert.equal(before.length, TRACK_MARGIN_MS / 15_000 + 1)
  // The rise and set dots are the ends of the solid part.
  const byId = Object.fromEntries(map.markers.map((m) => [m.id, m]))
  assert.deepEqual([byId.rise.lat, byId.rise.lon], [solid[0].lat, solid[0].lon])
  assert.deepEqual([byId.set.lat, byId.set.lon], [solid.at(-1)!.lat, solid.at(-1)!.lon])
  assert.deepEqual(Object.keys(byId), ["rise", "set", "home", "sat"], "the satellite last, drawn over the rest")
})

test("the satellite and its footprint are where it is now, up or not", () => {
  for (const now of [mid, pass.aos - 40 * 60_000]) {
    const map = control(now)
    const here = subPoint(satrec, now)!
    const sat = map.markers.find((m) => m.id === "sat")!
    assert.ok(Math.abs(sat.lat - here.lat) < 0.01 && Math.abs(sat.lon - here.lon) < 0.01)
    assert.deepEqual(map.circles.map((c) => [c.id, c.at, c.km]), [["footprint", "sat", Math.round(footprintKm(here.altKm))]])
  }
})

test("longitudes stay between -180 and 180, across the date line too", () => {
  const all = groundTrack(satrec, pass.aos - 3 * 3_600_000, pass.los + 3 * 3_600_000, 60_000)
  assert.ok(all.every((p) => p.lon >= -180 && p.lon <= 180 && Math.abs(p.lat) <= 90))
  assert.ok(all.some((p) => p.lon > 90) && all.some((p) => p.lon < -90), "three hours either side goes round the world")
})

test("a fill is the edge's color, faded", () => {
  assert.equal(faded("#4aa3ff"), "#334aa3ff")
  assert.equal(faded("red"), "red")
})

test("the Map tab has the map and a line saying what is on it; another tab has no map worked out", () => {
  const map = buildDetail(ao7, miami, pass, mid, true, "map")
  assert.ok(map.map)
  assert.equal(buildDetail(ao7, miami, pass, mid, true, "sky").map, undefined)
  const none = buildDetail(catalog.find((s) => s.name === "CAS-4A")!, miami, pass, mid, true, "map")
  assert.equal(none.map, undefined)
})
