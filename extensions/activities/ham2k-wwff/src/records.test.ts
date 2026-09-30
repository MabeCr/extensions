// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The park directory's mapper and the ADIF record, through the registered
// hooks. The traps: a directory that keeps retired parks, a numeric DXCC id
// where `suggest` narrows by prefix, and a contact crediting several parks —
// WWFF names them all in ONE record, so a split would double what the award
// counts.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

const wwff = await loadExtension(() => import("./index.ts"))

/// The kernel's `mapCsvBatch`: each row through the mapper, nulls dropped.
function mapCsv(rows: Record<string, string>[]) {
  const hook = wwff.hooks.find((h) => h.category === "dataFile" && h.key === "ham2k-wwff-all-parks")
  assert.ok(hook, "no ham2k-wwff-all-parks data file")
  const mapper = hook.hook.csvToLookupEntry as (row: Record<string, string>) => Record<string, any> | null
  return rows.map((row) => mapper(row)).filter((entry) => entry != null)
}

test("the directory keeps active parks and files them under the DXCC entity prefix", () => {
  const entries = mapCsv([
    { reference: "KFF-0001", name: "Acadia", status: "active", latitude: "44.35", longitude: "-68.21", iaruLocator: "FN54VH", dxccEnum: "291" },
    { reference: "KFF-9999", name: "Retired", status: "deleted", latitude: "44.0", longitude: "-68.0", dxccEnum: "291" },
  ])

  // A retired park kept here is one the picker offers and the award rejects.
  assert.deepEqual(entries.map((e) => e.key), ["KFF-0001"])
  // The prefix, not the numeric id 291, is what `suggest` narrows by.
  assert.equal(entries[0].subCategory, "K")
  // Published upper-case; grids are compared as plain strings everywhere.
  assert.equal(entries[0].data.grid, "FN54vh")
})

test("a contact crediting several parks stays ONE record, naming them all", async () => {
  // Declaring combinations would split it into a record per park, which the
  // award counts as several contacts.
  const adifFields = wwff.hooks.find((h) => h.category === "adifFields")
  assert.ok(adifFields)
  assert.equal(adifFields.hook.fieldCombinationsForOneQSO, undefined)

  const fields = (await wwff.runHook("adifFields", "fieldsForOneQSO", {
    qso: { their: { call: "W1AW" }, refs: [{ type: "wwff", ref: "KFF-9001" }, { type: "wwff", ref: "KFF-9002" }] },
    operation: { refs: [{ type: "wwffActivation", ref: "KFF-0001" }] },
  })) as { name: string; value: string }[]
  const byName = Object.fromEntries(fields.map((f) => [f.name, f.value]))

  assert.equal(byName.WWFF_REF, "KFF-9001,KFF-9002")
  assert.equal(byName.MY_WWFF_REF, "KFF-0001")
})
