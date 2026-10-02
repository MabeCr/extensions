// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The reference list's mapper and the ADIF records, through the registered
// hooks. The traps: an English name that is often blank, and a contact with
// an activator on two sites, which HOTA wants logged once per site. What
// cqhota.app's importer reads is MY_SIG=HOTA with the site in MY_SIG_INFO.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

const hota = await loadExtension(() => import("./index.ts"))

function mapJson(rows: Record<string, unknown>[]) {
  const hook = hota.hooks.find((h) => h.category === "dataFile" && h.key === "ham2k-hota-all-references")
  assert.ok(hook, "no ham2k-hota-all-references data file")
  assert.equal(hook.hook.category, "hota", "the data file must fill the table referenceActivity reads")
  assert.deepEqual(hook.hook.jsonOptions, { rootPath: "references" })
  const mapper = hook.hook.jsonToLookupEntry as (row: Record<string, unknown>) => Record<string, any> | null
  return rows.map((row) => mapper(row)).filter((entry) => entry != null)
}

test("the list files each site under its country, by its official local name", () => {
  const [site] = mapJson([
    {
      code: "AR-H0003",
      name: "Cordoba Jesuit Block",
      name_local: "Córdoba — Manzana Jesuítica",
      county: "COR",
      era: "renaissance",
      status: "active",
      lat: -31.4173,
      lon: -64.1887,
    },
  ])
  assert.equal(site.key, "AR-H0003")
  assert.equal(site.subCategory, "AR")
  assert.equal(site.name, "Córdoba — Manzana Jesuítica")
  assert.equal(site.data.nameEnglish, "Cordoba Jesuit Block")
  assert.equal(site.data.location, "COR")
  assert.equal(site.data.grid, "FF78vn")
})

test("a site with no English name keeps its local one, and retired or malformed rows are dropped", () => {
  const entries = mapJson([
    { code: "FR-H0095", name: "", name_local: "Tour de l'Horloge (Guînes)", status: "active", lat: 50.87, lon: 1.87 },
    { code: "FR-H0096", name: "Gone", name_local: "Gone", status: "retired", lat: 50, lon: 1 },
    { code: "not-a-ref", name: "Junk", status: "active" },
  ])
  assert.deepEqual(entries.map((e) => e.key), ["FR-H0095"])
  assert.equal(entries[0].name, "Tour de l'Horloge (Guînes)")
  assert.equal(entries[0].data.nameEnglish, undefined)
})

const fieldsOf = (record: { name: string; value: string }[]) => Object.fromEntries(record.map((f) => [f.name, f.value]))

test("an activation is MY_SIG=HOTA with the site in MY_SIG_INFO", async () => {
  const fields = (await hota.runHook("adifFields", "fieldsForOneQSO", {
    qso: { their: { call: "W1AW" } },
    operation: { refs: [{ type: "hotaActivation", ref: "RO-H0001" }] },
  })) as { name: string; value: string }[]
  assert.deepEqual(fieldsOf(fields), { MY_SIG: "HOTA", MY_SIG_INFO: "RO-H0001" })
})

test("a contact with an activator on two sites becomes one record per site", async () => {
  const records = (await hota.runHook("adifFields", "fieldCombinationsForOneQSO", {
    qso: { their: { call: "SP9ABC" }, refs: [{ type: "hota", ref: "PL-H0001" }, { type: "hota", ref: "PL-H0002" }] },
    operation: { refs: [{ type: "hotaActivation", ref: "RO-H0001" }] },
  })) as { name: string; value: string }[][]

  assert.deepEqual(records.map(fieldsOf), [
    { MY_SIG: "HOTA", MY_SIG_INFO: "RO-H0001", SIG: "HOTA", SIG_INFO: "PL-H0001" },
    { MY_SIG: "HOTA", MY_SIG_INFO: "RO-H0001", SIG: "HOTA", SIG_INFO: "PL-H0002" },
  ])
})

test("there is no hunter export: HOTA credits hunters from the activator's log", () => {
  const exports = hota.hooks.filter((h) => h.category === "export")
  assert.deepEqual(exports.map((h) => h.key), ["ham2k-hota"])
})
