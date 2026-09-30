// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The reference list, the ADIF record and the ADIF import, through the
// registered hooks.
//
// LLOTA is POTA-shaped: a contact crediting several lakes is submitted as one
// record per lake, and LLOTA_REF / MY_LLOTA_REF carry the full list — so the
// import has to read that list rather than SIG_INFO, which names only the
// first. It also reads the SIG/MY_SIG pair every reference program writes,
// so it must check WHOSE pair it is.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

const llota = await loadExtension(() => import("./index.ts"))

test("the list is read by reference_code, and scoped by its country part", () => {
  const hook = llota.hooks.find((h) => h.category === "dataFile" && h.key === "ham2k-llota-all-references")
  assert.ok(hook, "no ham2k-llota-all-references data file")
  const mapper = hook.hook.jsonToLookupEntry as (entry: unknown) => Record<string, any> | null
  const entries = [{ reference_code: "LLUS-0001", name: "Lake Placid", latitude: 44.28, longitude: -73.98 }]
    .map((e) => mapper(e))
    .filter((e) => e != null)

  assert.equal(entries.length, 1)
  assert.equal(entries[0].key, "LLUS-0001")
  assert.equal(entries[0].subCategory, "LLUS")
  assert.ok(Math.abs(entries[0].lat - 44.28) < 0.001)
  assert.ok(entries[0].data.grid, "no grid derived")
  // The field the live list publishes; reading any other leaves every lake
  // nameless with nothing else noticing.
  assert.equal(entries[0].name, "Lake Placid")
})

test("a multi-lake contact is split into one record per lake", async () => {
  const sets = (await llota.runHook("adifFields", "fieldCombinationsForOneQSO", {
    qso: { their: { call: "W1AW" }, refs: [{ type: "llota", ref: "LLUS-9001" }, { type: "llota", ref: "LLUS-9002" }] },
    operation: { refs: [{ type: "llotaActivation", ref: "LLUS-0001" }] },
  })) as { name: string; value: string }[][]
  const records = sets.map((set) => Object.fromEntries(set.map((f) => [f.name, f.value])))

  assert.equal(records.length, 2)
  assert.equal(records[0].LLOTA_REF, "LLUS-9001")
  assert.equal(records[1].LLOTA_REF, "LLUS-9002")
  assert.equal(records[0].MY_LLOTA_REF, "LLUS-0001")
})

type ImportResult = { refs: { type: string; ref: string; for?: string }[] } | null

async function importFrom(fields: Record<string, string>): Promise<ImportResult> {
  const results = (await llota.runHook("adifImport", "refsForRecords", { records: [{ fields }] })) as ImportResult[]
  assert.equal(results.length, 1)
  return results[0]
}

const activation = (ref = "LLUS-0001") => ({ type: "llotaActivation", ref, for: "operation" })

test("the import reads the activation it wrote", async () => {
  assert.deepEqual((await importFrom({ my_sig: "LLOTA", my_sig_info: "LLUS-0001" }))?.refs, [activation()])
})

test("the import normalizes a reference written in lower case", async () => {
  // Ref types are compared as strings downstream; an unnormalized reference
  // matches nothing it should.
  assert.deepEqual((await importFrom({ my_sig: "llota", my_sig_info: "llus-0001" }))?.refs, [activation()])
})

test("the import declines a record whose SIG names another program", async () => {
  // The reference is LLOTA's own shape on purpose: a foreign-looking one is
  // turned away by the pattern before the SIG guard is consulted, and the
  // test would pass with the guard deleted.
  assert.equal(await importFrom({ sig: "POTA", sig_info: "LLUS-0001", my_sig: "POTA", my_sig_info: "LLUS-0001" }), null)
})

test("the import keeps a reference its pattern rejects", async () => {
  // Malformed, not foreign — the SIG already named LLOTA. The pattern flags
  // it through decorateRef; it does not decide survival.
  assert.deepEqual((await importFrom({ my_sig: "LLOTA", my_sig_info: "not a reference" }))?.refs, [activation("NOT A REFERENCE")])
})

test("the import reads the other station's lake too, onto the contact", async () => {
  assert.deepEqual((await importFrom({ sig: "LLOTA", sig_info: "LLUS-0001", my_sig: "LLOTA", my_sig_info: "LLUS-0001" }))?.refs, [
    { type: "llota", ref: "LLUS-0001" },
    activation(),
  ])
})

test("LLOTA_REF keeps an n-fer an n-fer", async () => {
  // SIG_INFO names only the primary lake; preferring it imports a two-lake
  // contact as a one-lake one.
  assert.deepEqual((await importFrom({ sig: "LLOTA", sig_info: "LLUS-0001", llota_ref: "LLUS-0001,LLUS-00019" }))?.refs, [
    { type: "llota", ref: "LLUS-0001" },
    { type: "llota", ref: "LLUS-00019" },
  ])
})

test("MY_LLOTA_REF carries a multi-lake activation", async () => {
  assert.deepEqual((await importFrom({ my_llota_ref: "LLUS-0001,LLUS-00019" }))?.refs, [activation(), activation("LLUS-00019")])
})
