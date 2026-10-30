// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { test } from "node:test"

import { centerOf, geometryOf, gridLongitude, MAX_SCENE, openingView, project, REGIONS, regionView, scrollFor, scrollIn, sceneOf, viewAt, zoomedBy } from "./geo.ts"
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

test("at zoom 1 the whole world is as wide as the pane, and the zoom stops where the map would be taller than the pane has room for", () => {
  const g = geometryOf(phone, chrome, 1)
  assert.equal(g.zoom, 1)
  assert.equal(g.width, 390)
  assert.equal(g.height, 700)
  assert.equal(g.scrollMax, 0, "nothing to scroll at the whole world")
  assert.ok(Math.abs(g.mapWidth - 390) < 0.01)
  // The most it can be is the one that makes the map as tall as the band between the controls.
  const band = 700 - chrome.top - chrome.bottom
  const top = geometryOf(phone, chrome, 99)
  assert.equal(top.zoom, top.zoomMax)
  assert.ok(Math.abs(top.mapHeight - band) < 0.5, `${top.mapHeight} against ${band}`)
  assert.ok(top.width > 390 && top.scrollMax === top.width - 390)
  assert.ok(top.zoomMax > 2 && top.zoomMax < 4, `${top.zoomMax}: a phone held upright zooms to about three`)
})

test("the map is centered in the band between the controls, and in the pane when it is narrower", () => {
  const g = geometryOf(phone, chrome, 1)
  const band = 700 - chrome.top - chrome.bottom
  assert.ok(Math.abs(g.y0 - (chrome.top + (band - g.mapHeight) / 2)) < 0.01)
  assert.ok(g.y0 > chrome.top && g.y0 + g.mapHeight < 700 - chrome.bottom)
  // A pane on its side is short: the map is as tall as it can be, narrower than the pane, and there is no zoom to be had.
  const wide = geometryOf(sideways, chrome, 5)
  assert.equal(wide.zoomMax, 1)
  assert.equal(wide.zoom, 1)
  assert.equal(wide.width, 800)
  assert.ok(wide.x0 > 0 && Math.abs(wide.x0 * 2 + wide.mapWidth - 800) < 0.5, "centered across")
})

test("a zoom that is not a number, or is below 1, or is more than the pane allows, is held to what there is", () => {
  const z = (n: number) => geometryOf(phone, chrome, n).zoom
  assert.equal(z(0.2), 1)
  assert.equal(z(-4), 1)
  assert.equal(z(Number.NaN), 1)
  assert.equal(z(Infinity), geometryOf(phone, chrome, 1000).zoomMax)
  assert.equal(z(2), 2)
  // No scene is wider than a scene may be.
  assert.ok(geometryOf({ width: 2000, height: 4000 }, chrome, 99).width <= MAX_SCENE)
})

test("a coordinate is a place in the scene, inside the map", () => {
  const g = geometryOf(phone, chrome, 2)
  const west = sceneOf(g, 84, -180)
  const east = sceneOf(g, -58, 180)
  assert.ok(Math.abs(west.x - g.x0) < 0.1 && Math.abs(west.y - g.y0) < 0.1)
  assert.ok(Math.abs(east.x - (g.x0 + g.mapWidth)) < 0.1 && Math.abs(east.y - (g.y0 + g.mapHeight)) < 0.1)
  assert.ok(Math.abs(g.mapWidth / g.mapHeight - MAP_WIDTH / MAP_HEIGHT) < 0.001, "its own shape, whatever the zoom")
})

test("a scroll is kept inside the scene, and the middle of the pane and the scroll that puts a place there are each other's inverse", () => {
  const g = geometryOf(phone, chrome, 2.5)
  assert.equal(scrollIn(g, -50), 0)
  assert.equal(scrollIn(g, 1e9), g.scrollMax)
  assert.equal(scrollIn(g, Number.NaN), 0)
  for (const unit of [200, 360, 500]) assert.ok(Math.abs(centerOf(g, scrollFor(g, unit)) - unit) < 0.01, `${unit}`)
  // At the edges the pane cannot be centered on a place: the scene ends first, and it comes as near as the scene allows.
  assert.equal(scrollFor(g, 0), 0)
  assert.equal(scrollFor(g, MAP_WIDTH), g.scrollMax)
  assert.ok(centerOf(g, 0) > 100, "the middle of the pane at the west end is not the west edge")
})

test("zooming keeps the middle of the pane where it was, and a factor that makes no sense changes nothing", () => {
  // From a place the pane can be centered on, and not one at the edge of the scene, which it could not stay centered on.
  const start = viewAt(phone, chrome, 0, 2)
  const before = centerOf(geometryOf(phone, chrome, start.zoom), start.scroll)
  for (const factor of [1.5, 1 / 1.5, 1.2]) {
    const next = zoomedBy(phone, chrome, start, factor)
    const after = centerOf(geometryOf(phone, chrome, next.zoom), next.scroll)
    assert.ok(Math.abs(after - before) < 0.5, `${factor}: ${before} became ${after}`)
  }
  assert.deepEqual(zoomedBy(phone, chrome, start, Number.NaN), start)
  assert.deepEqual(zoomedBy(phone, chrome, start, -2), start)
  // Zooming out past the whole world, or in past the most, stops there.
  assert.equal(zoomedBy(phone, chrome, start, 0.01).zoom, 1)
  assert.equal(zoomedBy(phone, chrome, start, 1000).zoom, geometryOf(phone, chrome, 1).zoomMax)
})

test("a region is the view that has its longitude in the middle at its zoom, as far as the pane allows", () => {
  assert.equal(regionView(phone, chrome, "nowhere"), undefined)
  assert.deepEqual(new Set(REGIONS.map((r) => r.value)).size, REGIONS.length, "each is named once")
  const na = regionView(phone, chrome, "north-america")!
  const g = geometryOf(phone, chrome, na.zoom)
  assert.ok(Math.abs(na.zoom - 2.2) < 0.01)
  // North America is at the west end of the map: the pane comes as near its middle as the scene reaches, a little east of it.
  const wanted = (-100 + 180) * 2
  assert.ok(centerOf(g, na.scroll) >= wanted - 0.5 && centerOf(g, na.scroll) - wanted < 15, `${centerOf(g, na.scroll)} for ${wanted}`)
  // Africa is not, and is exactly in the middle.
  const africa = regionView(phone, chrome, "africa")!
  assert.ok(Math.abs(centerOf(geometryOf(phone, chrome, africa.zoom), africa.scroll) - (20 + 180) * 2) < 0.5)
  // Europe is asked for at 4, which a phone held upright cannot show: it gets the most the pane has room for.
  const europe = regionView(phone, chrome, "europe")!
  assert.equal(europe.zoom, geometryOf(phone, chrome, 1).zoomMax)
  // And the whole world is the whole world, with nothing to scroll.
  assert.deepEqual(regionView(phone, chrome, "world"), { zoom: 1, scroll: 0 })
  // On a pane on its side there is only the one zoom, and every region is that.
  assert.ok(REGIONS.every((r) => regionView(sideways, chrome, r.value)!.zoom === 1))
})

test("a grid square is a longitude, to the middle of the smallest square it names", () => {
  assert.ok(Math.abs(gridLongitude("FN31")! - -73) < 0.001, "four characters: the square's middle")
  assert.ok(Math.abs(gridLongitude("EM79vo")! - -84.2083) < 0.01, "six: the subsquare’s")
  assert.ok(Math.abs(gridLongitude("jo22")! - 5) < 0.001, "in any case")
  assert.ok(Math.abs(gridLongitude("  RR99xx ")! - 179.96) < 0.1)
  for (const bad of ["", "ZZ99", "FN", "F3N1", "EM7", 12, null, undefined, {}]) assert.equal(gridLongitude(bad), undefined, String(bad))
})

test("the map opens on the operator's side of the world, or on the whole of it where there is no grid", () => {
  assert.deepEqual(openingView(phone, chrome, undefined), { zoom: 1, scroll: 0 })
  assert.deepEqual(openingView(phone, chrome, "nonsense"), { zoom: 1, scroll: 0 })
  const home = openingView(phone, chrome, "EM79vo")
  assert.equal(home.zoom, 2)
  assert.ok(Math.abs(centerOf(geometryOf(phone, chrome, home.zoom), home.scroll) - (-84.2083 + 180) * 2) < 1, "its longitude is in the middle")
  // A pane that cannot zoom opens on the whole world whoever the operator is.
  assert.equal(openingView(sideways, chrome, "EM79vo").zoom, 1)
})
