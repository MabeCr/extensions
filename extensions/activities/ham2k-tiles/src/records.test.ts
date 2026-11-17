// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The ADIF records, through the registered hooks. What tilesontheair.com's
// importer reads is MY_GRIDSQUARE, and it warns when that disagrees with the
// tile being claimed — so Tiles' own export makes it name the tile, and every
// other export leaves the station's grid alone.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

const tiles = await loadExtension(() => import("./index.ts"))

const fieldsOf = (record: { name: string; value: string }[]) => Object.fromEntries(record.map((f) => [f.name, f.value]))

async function fields(operation: Record<string, unknown>, qso: Record<string, unknown> = {}, mainHandler?: boolean) {
  return fieldsOf((await tiles.runHook("adifFields", "fieldsForOneQSO", {
    qso: { their: { call: "W1AW" }, ...qso },
    operation,
    mainHandler,
  })) as { name: string; value: string }[])
}

const ACTIVATION = { type: "tilesActivation", ref: "EM73UU" }

test("an activation is MY_SIG=TILES with the tile in MY_SIG_INFO, and a hunted tile SIG/SIG_INFO", async () => {
  assert.deepEqual(await fields({ grid: "EM73uu", refs: [ACTIVATION] }, { refs: [{ type: "tiles", ref: "FN42HN" }] }), {
    SIG: "TILES",
    SIG_INFO: "FN42HN",
    MY_SIG: "TILES",
    MY_SIG_INFO: "EM73UU",
  })
})

test("in Tiles' own export, a station grid outside the tile gives way to it", async () => {
  // A 4-character grid, or one left from before the operator moved.
  assert.equal((await fields({ grid: "EM73", refs: [ACTIVATION] }, {}, true)).MY_GRIDSQUARE, "EM73uu")
  assert.equal((await fields({ grid: "EM73ut", refs: [ACTIVATION] }, {}, true)).MY_GRIDSQUARE, "EM73uu")
  assert.equal((await fields({ refs: [ACTIVATION] }, {}, true)).MY_GRIDSQUARE, "EM73uu")
})

test("a finer grid inside the tile is kept, and other exports never touch the grid", async () => {
  assert.equal((await fields({ grid: "EM73uu42", refs: [ACTIVATION] }, {}, true)).MY_GRIDSQUARE, undefined)
  assert.equal((await fields({ grid: "EM73ut", refs: [ACTIVATION] })).MY_GRIDSQUARE, undefined)
})

test("there is one export, the activator's: Tiles credits chasers from the activator's log", () => {
  const exports = tiles.hooks.filter((h) => h.category === "export")
  assert.deepEqual(exports.map((h) => h.key), ["ham2k-tiles"])
})

test("a Tiles log read back in recovers both sides", async () => {
  const [result] = (await tiles.runHook("adifImport", "refsForRecords", {
    records: [{ fields: { sig: "TILES", sig_info: "fn42hn", my_sig: "TILES", my_sig_info: "em73uu" } }],
  })) as ({ refs?: { type: string; ref: string }[] } | null)[]
  const all = (result?.refs ?? []).map((r) => `${r.type}:${r.ref}`).sort()
  assert.deepEqual(all, ["tiles:FN42HN", "tilesActivation:EM73UU"])
})

test("an activation ref that is no tile never overwrites the station's grid", async () => {
  // An imported MY_SIG_INFO, say, that was never a 6-character grid.
  assert.equal((await fields({ grid: "FN31pr", refs: [{ type: "tilesActivation", ref: "FN42" }] }, {}, true)).MY_GRIDSQUARE, undefined)
})
