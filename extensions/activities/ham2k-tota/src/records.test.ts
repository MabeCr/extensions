// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The tower list and the ADIF import, through the registered hooks.
//
// The list is the one here behind the API key — without it a build has no
// towers at all — and publishes every number as a STRING, so a mapper that
// tests `typeof === 'number'` leaves every tower without coordinates, grid,
// distance or a place on the map. The import reads the SIG/MY_SIG pair every
// reference program writes, so it must check WHOSE pair it is.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

const tota = await loadExtension(() => import("./index.ts"))

function dataFile() {
  const hook = tota.hooks.find((h) => h.category === "dataFile" && h.key === "ham2k-tota-all-towers")
  assert.ok(hook, "no ham2k-tota-all-towers data file")
  return hook.hook as { url: string | (() => string); jsonToLookupEntry: (entry: unknown) => Record<string, any> | null }
}

test("the list URL carries the key, which is what the list needs", () => {
  // Presence only: a copy of the literal here would be a second place to
  // rotate it.
  const { url } = dataFile()
  const resolved = typeof url === "function" ? url() : url
  assert.ok(new URL(resolved).searchParams.get("key"), "the tower list is requested without its key")
})

test("the mapper keeps the award's fields, with the numbers it publishes as strings parsed", () => {
  const { jsonToLookupEntry } = dataFile()
  const entries = [{ ref: "OKR-0001", name: "Ještěd", lat: "50.730000", lon: "15.000000", height: "94.00" }]
    .map((e) => jsonToLookupEntry(e))
    .filter((e) => e != null)

  assert.equal(entries.length, 1)
  const [tower] = entries
  assert.equal(tower.key, "OKR-0001")
  assert.equal(tower.subCategory, "OKR")
  assert.equal(tower.name, "Ještěd")
  assert.ok(Math.abs(tower.lat - 50.73) < 0.001)
  assert.ok(Math.abs(tower.lon - 15.0) < 0.001)
  assert.equal(tower.data.grid, "JO70mr")
  // Parsed in `data` too, so a consumer reading `data.lat` gets the shape
  // every other award puts there.
  assert.equal(typeof tower.data.lat, "number")
  // The whole published record is kept.
  assert.equal(tower.data.height, "94.00")
})

type ImportResult = { refs: { type: string; ref: string; for?: string }[] } | null

async function importFrom(fields: Record<string, string>): Promise<ImportResult> {
  const results = (await tota.runHook("adifImport", "refsForRecords", { records: [{ fields }] })) as ImportResult[]
  assert.equal(results.length, 1)
  return results[0]
}

const activation = { type: "totaActivation", ref: "OKR-0001", for: "operation" }

test("the import reads the activation it wrote", async () => {
  assert.deepEqual((await importFrom({ my_sig: "TOTA", my_sig_info: "OKR-0001" }))?.refs, [activation])
})

test("the import normalizes a reference written in lower case", async () => {
  // Ref types are compared as strings downstream; an unnormalized reference
  // matches nothing it should.
  assert.deepEqual((await importFrom({ my_sig: "tota", my_sig_info: "okr-0001" }))?.refs, [activation])
})

test("the import declines a record whose SIG names another program", async () => {
  // The reference is TOTA's own shape on purpose: a foreign-looking one is
  // turned away by the pattern before the SIG guard is consulted, and the
  // test would pass with the guard deleted.
  assert.equal(await importFrom({ sig: "POTA", sig_info: "OKR-0001", my_sig: "POTA", my_sig_info: "OKR-0001" }), null)
})

test("the import keeps a reference its pattern rejects", async () => {
  // Malformed, not foreign — the SIG already named TOTA. The pattern flags it
  // through decorateRef; it does not decide survival.
  assert.deepEqual((await importFrom({ my_sig: "TOTA", my_sig_info: "not a reference" }))?.refs, [
    { type: "totaActivation", ref: "NOT A REFERENCE", for: "operation" },
  ])
})

test("the import reads the other station's tower too, onto the contact", async () => {
  assert.deepEqual((await importFrom({ sig: "TOTA", sig_info: "OKR-0001", my_sig: "TOTA", my_sig_info: "OKR-0001" }))?.refs, [
    { type: "tota", ref: "OKR-0001" },
    activation,
  ])
})
