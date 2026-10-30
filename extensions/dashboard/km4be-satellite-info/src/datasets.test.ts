// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { test } from "node:test"

import manifest from "../manifest.json" with { type: "json" }
import { ELEMENTS_URL, LIST_CATEGORY, LIST_URL, loadCatalog, noradOf, ORBITS_CATEGORY, parseList } from "./data.ts"
import { datasetCalls } from "./datasetTesting.ts"
import type { Downloaded } from "./datasetTesting.ts"
import { listFile, orbitsFile } from "./datasets.ts"
import { AO7, ELEMENTS, LIST } from "./fixtures.ts"
import { forgetAll } from "./memory.ts"
import { loadExtension } from "./sdkGapTesting.ts"

const t0 = Date.parse("2026-10-07T00:00:00Z")

async function catalogFrom(files: Downloaded, extra: Record<string, (params: Record<string, unknown>) => unknown> = {}) {
  forgetAll()
  const datasets = datasetCalls(files)
  await loadExtension(() => import("./index.ts"), { hostCalls: { ...datasets.hostCalls, ...extra } })
  return { datasets, catalog: await loadCatalog({ online: true } as never, t0) }
}

test("the two datasets are the app's: registered, declared, and pointed at the same two files as before", async () => {
  const ext = await loadExtension(() => import("./index.ts"), {})
  const keys = ext.hooks.filter((h) => h.category === "dataFile").map((h) => (h.hook as { key: string }).key)
  assert.deepEqual(keys.sort(), [`${manifest.key}-list`, `${manifest.key}-orbits`])
  assert.ok((manifest.hooks as string[]).includes("dataFile"), "the manifest says it has them")
  assert.equal(listFile.url, LIST_URL)
  assert.equal(orbitsFile.url, ELEMENTS_URL)
  assert.deepEqual([listFile.fetchType, orbitsFile.fetchType], ["json", "json"])
  assert.equal(listFile.category, LIST_CATEGORY)
  assert.equal(orbitsFile.category, ORBITS_CATEGORY)
})

test("the orbits are kept for three days, which is as long as they are good for, and the list for a week", () => {
  assert.equal(orbitsFile.maxAgeInDays, 3)
  assert.equal(listFile.maxAgeInDays, 7)
})

test("an entry of the list is a row by name that keeps its frequencies, and one without a name is dropped", () => {
  const row = listFile.jsonToLookupEntry!(LIST[0] as Record<string, any>)!
  assert.equal(row.key, (LIST[0] as { name: string }).name)
  assert.equal(row.name, row.key)
  assert.deepEqual(Object.keys(row.data!).sort(), ["downlinks", "modulation", "number", "uplinks"])
  assert.equal(listFile.jsonToLookupEntry!({ number: 1 }), null)
  assert.equal(listFile.jsonToLookupEntry!({ name: "  " }), null)
})

test("an element set is a row by NORAD number that keeps the whole set, and one that could not place a satellite is dropped", () => {
  const row = orbitsFile.jsonToLookupEntry!(AO7)!
  assert.equal(row.key, "7530")
  assert.equal(row.name, AO7.OBJECT_NAME)
  assert.deepEqual(row.data, AO7)
  assert.equal(orbitsFile.jsonToLookupEntry!({ NORAD_CAT_ID: "bad", EPOCH: "2026-10-06T20:57:22" }), null)
  assert.equal(orbitsFile.jsonToLookupEntry!({ NORAD_CAT_ID: 25544 }), null, "no epoch")
})

test("the catalog is what the app has downloaded: every satellite listed, and an orbit for each that has one", async () => {
  const { catalog } = await catalogFrom({ list: LIST, orbits: ELEMENTS })
  assert.equal(catalog.satellites.length, parseList(LIST).length)
  const tracked = catalog.satellites.filter((s) => s.omm).map((s) => s.name)
  assert.ok(tracked.length >= 2)
  const ao7 = catalog.satellites.find((s) => s.name === "AO-7")!
  assert.equal(ao7.omm?.NORAD_CAT_ID, 7530)
  assert.ok(ao7.downlinks.length > 0, "with its frequencies")
})

test("the orbits' age is when their newest element set was made, which is what says how good they are", async () => {
  const { catalog } = await catalogFrom({ list: LIST, orbits: ELEMENTS })
  assert.equal(catalog.elementsAt, Date.parse("2026-10-06T20:57:22.256Z"), "the epoch is UTC though it is written without a zone")
  const { catalog: none } = await catalogFrom({ list: LIST, orbits: null })
  assert.equal(none.elementsAt, 0)
  assert.equal(none.satellites.length, parseList(LIST).length, "the list is shown with its frequencies and no passes while the orbits are on their way")
  assert.ok(none.satellites.every((s) => !s.omm))
})

test("nothing downloaded yet is an empty catalog, and so is a host that cannot be read", async () => {
  assert.equal((await catalogFrom({ list: null, orbits: null })).catalog.satellites.length, 0)
  const broken = await catalogFrom(
    { list: LIST, orbits: ELEMENTS },
    {
      dbLookupSelectAll: () => {
        throw new Error("no database")
      },
    },
  )
  assert.deepEqual(broken.catalog, { satellites: [], elementsAt: 0 })
})

test("an orbit is asked for once for each satellite that has a NORAD number, by that number, our corrections applied", async () => {
  const { datasets } = await catalogFrom({ list: LIST, orbits: ELEMENTS })
  const asked = datasets.calls.filter((c) => c.startsWith("one ")).map((c) => c.split(" ")[2])
  const wanted = [...new Set(parseList(LIST).flatMap((s) => noradOf(s) ?? []))].map(String)
  assert.deepEqual(asked.sort(), wanted.sort())
  assert.equal(new Set(asked).size, asked.length, "none twice")
  assert.equal(datasets.calls.filter((c) => c === `all ${LIST_CATEGORY}`).length, 1)
})
