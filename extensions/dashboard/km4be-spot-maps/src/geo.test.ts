// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { test } from "node:test"

import { centerOf, geometryOf, gridLatitude, gridLongitude, MAX_SCENE, openingView, pannedBy, project, REGIONS, regionOf, regionView, scrollFor, scrollIn, sceneOf, viewAt, WORLD, zoomedBy } from "./geo.ts"
import type { Chrome } from "./geo.ts"
import { MAP_HEIGHT, MAP_WIDTH } from "./world.ts"

const chrome: Chrome = { top: 100, bottom: 120 }
const phone = { width: 390, height: 700 }
const sideways = { width: 800, height: 360 }

test("a coordinate lands in the map's own units, two to a degree, and is kept inside the map", () => {
  assert.deepEqual(project(84, -180), { x: 0, y: 0 })
  assert.deepEqual(project(0, 0), { x: 360, y: 168 })
  assert.deepEqual(project(84, 180), { x: 720, y: 0 })
  assert.equal(project(89, 0).y, 0, "north of the map is its top edge")
  assert.equal(project(-80, 0).y, MAP_HEIGHT, "and south of it its bottom")
})

test("at zoom 1 the whole world fits the pane, and the zoom goes in as far as there is a point to, however short the pane", () => {
  const g = geometryOf(phone, chrome, 1)
  assert.equal(g.zoom, 1)
  assert.equal(g.width, 390)
  assert.equal(g.height, 700)
  assert.equal(g.scrollMax, 0, "nothing to scroll at the whole world")
  assert.equal(g.canPan, false, "the whole height is drawn")
  assert.ok(Math.abs(g.mapWidth - 390) < 0.01)
  const top = geometryOf(phone, chrome, 99)
  assert.equal(top.zoom, top.zoomMax)
  assert.ok(top.zoomMax >= 8, `${top.zoomMax}: far enough in for a country`)
  assert.ok(top.width > 390 && top.scrollMax === top.width - 390)
  // The map is not taller than the band, however far in: it is cut, not stretched.
  const band = 700 - chrome.top - chrome.bottom
  assert.ok(Math.abs(top.mapHeight - band) < 0.5, `${top.mapHeight} against ${band}`)
  assert.ok(top.canPan && top.winHeight < MAP_HEIGHT / 4)
  // A pane on its side zooms too, which it could not when the whole height had to fit.
  assert.ok(geometryOf(sideways, chrome, 99).zoomMax > 8)
})

test("the map is centered in the band between the controls, and in the pane when it is narrower", () => {
  const g = geometryOf(phone, chrome, 1)
  const band = 700 - chrome.top - chrome.bottom
  assert.ok(Math.abs(g.y0 - (chrome.top + (band - g.mapHeight) / 2)) < 0.01)
  assert.ok(g.y0 > chrome.top && g.y0 + g.mapHeight < 700 - chrome.bottom)
  const wide = geometryOf(sideways, chrome, 1)
  assert.equal(wide.width, 800)
  assert.ok(wide.x0 > 0 && Math.abs(wide.x0 * 2 + wide.mapWidth - 800) < 0.5, "centered across")
})

test("a zoom that is not a number, or is below 1, or is more than there is, is held to what there is", () => {
  const z = (n: number) => geometryOf(phone, chrome, n).zoom
  assert.equal(z(0.2), 1)
  assert.equal(z(-4), 1)
  assert.equal(z(Number.NaN), 1)
  assert.equal(z(Infinity), geometryOf(phone, chrome, 1000).zoomMax)
  assert.equal(z(2), 2)
  assert.ok(geometryOf({ width: 2000, height: 4000 }, chrome, 99).width <= MAX_SCENE)
})

test("the band of latitudes is kept inside the map, wherever it is asked to be", () => {
  const z = geometryOf(phone, chrome, 6, 0)
  assert.ok(Math.abs(z.winTop) < 0.001, "asked for the north pole, it starts at the top edge")
  const south = geometryOf(phone, chrome, 6, 1e6)
  assert.ok(Math.abs(south.winTop + south.winHeight - MAP_HEIGHT) < 0.001, "and at the bottom edge for the south")
  assert.equal(geometryOf(phone, chrome, 6, Number.NaN).cy, MAP_HEIGHT / 2)
  assert.equal(geometryOf(phone, chrome, 1, 10).cy, MAP_HEIGHT / 2, "the whole map has only the one band")
})

test("a coordinate is a place in the scene, and is inside only when its latitude is in the band that is drawn", () => {
  const g = geometryOf(phone, chrome, 1)
  const west = sceneOf(g, 84, -180)
  const east = sceneOf(g, -58, 180)
  assert.ok(Math.abs(west.x - g.x0) < 0.1 && Math.abs(west.y - g.y0) < 0.1)
  assert.ok(Math.abs(east.x - (g.x0 + g.mapWidth)) < 0.1 && Math.abs(east.y - (g.y0 + g.mapHeight)) < 0.1)
  assert.ok(west.inside && east.inside)
  assert.ok(Math.abs(g.mapWidth / g.mapHeight - MAP_WIDTH / MAP_HEIGHT) < 0.001, "its own shape at the whole world")
  // Zoomed in on Europe, a place in the Antarctic is not in the band, and one in Berlin is, where its latitude puts it.
  const view = regionView(phone, chrome, "europe")!
  const eu = geometryOf(phone, chrome, view.zoom, view.cy)
  assert.equal(sceneOf(eu, -70, 0).inside, false)
  const berlin = sceneOf(eu, 52.5, 13.4)
  assert.ok(berlin.inside && berlin.y > eu.y0 && berlin.y < eu.y0 + eu.mapHeight)
})

test("a scroll is kept inside the scene, and the middle of the pane and the scroll that puts a place there are each other's inverse", () => {
  const g = geometryOf(phone, chrome, 2.5)
  assert.equal(scrollIn(g, -50), 0)
  assert.equal(scrollIn(g, 1e9), g.scrollMax)
  assert.equal(scrollIn(g, Number.NaN), 0)
  for (const unit of [200, 360, 500]) assert.ok(Math.abs(centerOf(g, scrollFor(g, unit)) - unit) < 0.01, `${unit}`)
  assert.equal(scrollFor(g, 0), 0)
  assert.equal(scrollFor(g, MAP_WIDTH), g.scrollMax)
  assert.ok(centerOf(g, 0) > 50, "the middle of the pane at the west end is not the west edge")
})

test("zooming keeps the middle of the pane where it was, and a factor that makes no sense changes nothing", () => {
  const start = viewAt(phone, chrome, 20, 10, 2)
  const before = centerOf(geometryOf(phone, chrome, start.zoom, start.cy), start.scroll)
  for (const factor of [1.5, 1 / 1.5, 1.2]) {
    const next = zoomedBy(phone, chrome, start, factor)
    const after = centerOf(geometryOf(phone, chrome, next.zoom, next.cy), next.scroll)
    assert.ok(Math.abs(after - before) < 0.5, `${factor}: ${before} became ${after}`)
    // The latitude stays too, and the place does not drift north or south.
    assert.ok(Math.abs(next.cy - start.cy) < 0.5 || next.zoom < start.zoom, `${factor}: ${start.cy} became ${next.cy}`)
  }
  assert.deepEqual(zoomedBy(phone, chrome, start, Number.NaN), start)
  assert.deepEqual(zoomedBy(phone, chrome, start, -2), start)
  assert.equal(zoomedBy(phone, chrome, start, 0.01).zoom, 1)
  assert.equal(zoomedBy(phone, chrome, start, 1000).zoom, geometryOf(phone, chrome, 1).zoomMax)
})

test("the band moves up and down by a part of its height, and stops at the top and the bottom of the map", () => {
  const start = viewAt(phone, chrome, 15, -100, 8)
  const g = geometryOf(phone, chrome, start.zoom, start.cy)
  const up = pannedBy(phone, chrome, start, -1)
  assert.ok(up.cy < start.cy && Math.abs(start.cy - up.cy - 0.35 * g.winHeight) < 0.5)
  assert.equal(up.zoom, start.zoom)
  assert.equal(up.scroll, start.scroll, "across is the scene's own scroll")
  const down = pannedBy(phone, chrome, start, 1)
  assert.ok(down.cy > start.cy)
  let top = start
  for (let i = 0; i < 40; i++) top = pannedBy(phone, chrome, top, -1)
  assert.ok(Math.abs(geometryOf(phone, chrome, top.zoom, top.cy).winTop) < 0.001, "the north edge, and no further")
  let bottom = start
  for (let i = 0; i < 40; i++) bottom = pannedBy(phone, chrome, bottom, 1)
  const b = geometryOf(phone, chrome, bottom.zoom, bottom.cy)
  assert.ok(Math.abs(b.winTop + b.winHeight - MAP_HEIGHT) < 0.001, "the south edge, and no further")
  // At the whole world there is nowhere to go.
  assert.deepEqual(pannedBy(phone, chrome, WORLD, 1), WORLD)
})

test("a region fills the pane with its own box: as far in as all of it still fits, with its middle in the middle", () => {
  assert.equal(regionView(phone, chrome, "nowhere"), undefined)
  assert.deepEqual(new Set(REGIONS.map((r) => r.value)).size, REGIONS.length, "each is named once")
  const na = regionView(phone, chrome, "north-america")!
  assert.ok(na.zoom > 2.5, `${na.zoom}: North America is the pane's width, not a corner of the world`)
  const g = geometryOf(phone, chrome, na.zoom, na.cy)
  // All of its width is in the pane, and its middle is where the pane's is, or as near as the scene's west end lets it be.
  const west = sceneOf(g, 40, -168).x - na.scroll
  const east = sceneOf(g, 40, -52).x - na.scroll
  assert.ok(west >= -1 && east <= 391, `${west} to ${east} in a pane 390 wide`)
  // Europe is much farther in, and Africa's longitude is in the middle exactly.
  const europe = regionView(phone, chrome, "europe")!
  assert.ok(europe.zoom > na.zoom * 1.8, `${europe.zoom}`)
  const africa = regionView(phone, chrome, "africa")!
  assert.ok(Math.abs(centerOf(geometryOf(phone, chrome, africa.zoom, africa.cy), africa.scroll) - (17 + 180) * 2) < 1)
  // Every region's whole box is inside the band that is drawn.
  for (const r of REGIONS) {
    const v = regionView(phone, chrome, r.value)!
    const rg = geometryOf(phone, chrome, v.zoom, v.cy)
    assert.ok(sceneOf(rg, r.north, r.west).inside || r.value === "world", `${r.value}: north edge`)
    assert.ok(sceneOf(rg, r.south, r.east).inside, `${r.value}: south edge`)
  }
  // On a pane on its side every region is farther in than the world, which it could not be before.
  assert.ok(REGIONS.filter((r) => r.value !== "world").every((r) => regionView(sideways, chrome, r.value)!.zoom > 1))
  assert.deepEqual(regionView(phone, chrome, "world"), WORLD)
})

test("a view is the region it shows, to a hair, and a view of its own is none", () => {
  for (const r of REGIONS) assert.equal(regionOf(phone, chrome, regionView(phone, chrome, r.value)!)?.value, r.value)
  const eu = regionView(phone, chrome, "europe")!
  assert.equal(regionOf(phone, chrome, pannedBy(phone, chrome, eu, 1)), undefined)
  assert.equal(regionOf(phone, chrome, { ...eu, scroll: eu.scroll + 30 }), undefined)
})

test("a grid square is a longitude and a latitude, to the middle of the smallest square it names", () => {
  assert.ok(Math.abs(gridLongitude("FN31")! - -73) < 0.001, "four characters: the square's middle")
  assert.ok(Math.abs(gridLatitude("FN31")! - 41.5) < 0.001)
  assert.ok(Math.abs(gridLongitude("EM79vo")! - -84.2083) < 0.01, "six: the subsquare’s")
  assert.ok(Math.abs(gridLatitude("EM79vo")! - 39.6042) < 0.01)
  assert.ok(Math.abs(gridLongitude("jo22")! - 5) < 0.001, "in any case")
  assert.ok(Math.abs(gridLatitude("jo22")! - 52.5) < 0.001)
  assert.ok(Math.abs(gridLongitude("  RR99xx ")! - 179.96) < 0.1)
  for (const bad of ["", "ZZ99", "FN", "F3N1", "EM7", 12, null, undefined, {}]) {
    assert.equal(gridLongitude(bad), undefined, String(bad))
    assert.equal(gridLatitude(bad), undefined, String(bad))
  }
})

test("the map opens on the operator's place, zoomed in on it, or on the whole of the world where there is no grid", () => {
  assert.deepEqual(openingView(phone, chrome, undefined), WORLD)
  assert.deepEqual(openingView(phone, chrome, "nonsense"), WORLD)
  const home = openingView(phone, chrome, "EM79vo")
  assert.equal(home.zoom, 4)
  const g = geometryOf(phone, chrome, home.zoom, home.cy)
  assert.ok(Math.abs(centerOf(g, home.scroll) - (-84.2083 + 180) * 2) < 1, "its longitude is in the middle")
  assert.ok(sceneOf(g, 39.6042, -84.2083).inside, "and its latitude is in the band")
  // A pane on its side zooms the same.
  assert.equal(openingView(sideways, chrome, "EM79vo").zoom, 4)
})
