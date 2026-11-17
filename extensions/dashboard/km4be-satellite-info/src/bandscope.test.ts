// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { test } from "node:test"

import type { BandAnnotation } from "@ham2k/extension-sdk"

import { bandLabels, BandMarks, MAX_LABELED, MOVE_HZ } from "./bandscope.ts"
import type { LabelSettings } from "./bandscope.ts"
import { buildCatalog, parseElements, parseList } from "./data.ts"
import { ELEMENTS, LIST } from "./fixtures.ts"
import { downlinkDoppler, findPasses, rangeRate, satrecFromOmm } from "./orbit.ts"
import type { SatellitePass } from "./passes.ts"
import { linksOf } from "./tracking.ts"

const catalog = buildCatalog(parseList(LIST), parseElements(ELEMENTS), {})
const ao7 = catalog.find((s) => s.name === "AO-7")!
const satrec = satrecFromOmm(ao7.omm!)
const miami = { lat: 25.76, lon: -80.19 }
const best = findPasses(satrec, miami, Date.parse("2026-10-07T00:00:00Z"), 24, 10).reduce((a, b) => (b.maxElevation > a.maxElevation ? b : a))
const pass: SatellitePass = { ...best, satellite: ao7 }
const mid = Math.round((pass.aos + pass.los) / 2)
const on: LabelSettings = { labels: true, favoritesOnly: false, leadMin: 3 }

test("while a satellite is up its downlink is marked where it is heard now, and its uplink a step less prominent", () => {
  const marks = bandLabels([pass], [], on, miami, mid)
  const down = marks.find((m) => m.key === "sat-AO-7-down")!
  const link = linksOf(ao7).down!
  const rate = rangeRate(satrec, miami, mid)!
  assert.equal(down.label, "AO-7 ↓")
  assert.equal(down.type, "known")
  assert.equal(down.importance, "primary")
  assert.equal(down.fromHz, Math.round(downlinkDoppler(link.lowerMHz, rate) * 1e6))
  if (link.upperMHz > link.lowerMHz) assert.equal(down.toHz, Math.round(downlinkDoppler(link.upperMHz, rate) * 1e6))
  assert.equal(down.expiresAt, pass.los + 60_000)
  const up = marks.find((m) => m.key === "sat-AO-7-up")
  if (linksOf(ao7).up) assert.equal(up?.importance, "secondary")
})

test("off, too early, or set, nothing is marked", () => {
  assert.deepEqual(bandLabels([pass], [], { ...on, labels: false }, miami, mid), [])
  assert.deepEqual(bandLabels([pass], [], on, miami, pass.aos - 4 * 60_000), [])
  assert.deepEqual(bandLabels([pass], [], on, miami, pass.los + 1000), [])
  assert.ok(bandLabels([pass], [], on, miami, pass.aos - 2 * 60_000).length > 0, "within the lead time, where it will be at rise")
})

test("favorites only, and a few satellites at most", () => {
  assert.deepEqual(bandLabels([pass], ["RS-44"], { ...on, favoritesOnly: true }, miami, mid), [])
  const many = Array.from({ length: 10 }, (_, i) => ({ ...pass, satellite: { ...ao7, name: `S${i}` } }))
  const names = new Set(bandLabels(many, [], on, miami, mid).map((m) => m.label!.split(" ")[0]))
  assert.equal(names.size, MAX_LABELED)
})

test("a mark is put again only once it has moved, and taken off when its pass is over", async () => {
  const puts: BandAnnotation[][] = []
  const removes: string[][] = []
  const marks = new BandMarks({
    async put(a) {
      puts.push(a)
    },
    async remove(keys) {
      removes.push(keys ?? [])
    },
  })
  const m: BandAnnotation = { type: "known", key: "sat-AO-7-down", label: "AO-7 ↓", fromHz: 145_975_000 }
  await marks.show([m])
  await marks.show([{ ...m, fromHz: m.fromHz + MOVE_HZ - 1 }])
  await marks.show([{ ...m, fromHz: m.fromHz + MOVE_HZ }])
  await marks.show([])
  assert.equal(puts.length, 2)
  assert.deepEqual(removes, [["sat-AO-7-down"]])
})
