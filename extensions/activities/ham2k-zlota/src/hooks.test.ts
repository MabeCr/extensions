// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The extension through its HOOKS — what the app actually calls — so a
// control that stops carrying its transforms, a reference list read on the
// wrong axes, or a threshold that ignores the kind of place fails here, not
// in the field.

import { test } from "node:test"
import assert from "node:assert/strict"

import { applyRefTransforms, fixtureOperation, fixtureQso, loadExtension, typeRefText } from "./sdkGapTesting.ts"

const zlota = await loadExtension(() => import("./index.ts"))
const controls = (await zlota.runHook("activity", "loggingControls", { operation: fixtureOperation() })) as any[]
const { transforms } = controls[0].input

test("a scheme letter and its code typed bare come out as the full reference", () => {
  // Each scheme's own shape: parks and huts dash a number after letters,
  // beaches and lakes have no letters to dash after.
  assert.equal(typeRefText("POT1234", transforms), "ZLP/OT-1234")
  assert.equal(typeRefText("HAA001", transforms), "ZLH/AA-001")
  assert.equal(typeRefText("B123", transforms), "ZLB/123")
  assert.equal(typeRefText("L1234", transforms), "ZLL/1234")
  assert.equal(typeRefText("ZLPOT1234", transforms), "ZLP/OT-1234")
})

test("the end-anchored rules shape only the reference being typed", () => {
  assert.equal(typeRefText("ZLP/OT-1234,HAA001", transforms), "ZLP/OT-1234,ZLH/AA-001")
  assert.equal(applyRefTransforms("ZLP/OT-1234", transforms), "ZLP/OT-1234")
})

test("the reference list reads x as longitude and y as latitude", () => {
  // The list is drawn from a map layer, so its coordinates are named for
  // screen axes — swapped, every reference lands in the wrong ocean. `name`
  // is the field the live list publishes; reading any other leaves every
  // reference nameless.
  const hook = zlota.hooks.find((h) => h.category === "dataFile" && h.key === "ham2k-zlota-all-references")!.hook
  const mapper = hook.jsonToLookupEntry as (entry: unknown) => any
  const entries = [{ code: "ZLH/AA-001", name: "Angelus Hut", asset_type: "hut", x: 172.7, y: -41.8 }]
    .map((entry) => mapper(entry))
    .filter((entry) => entry !== null && entry !== undefined)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].key, "ZLH/AA-001")
  assert.ok(Math.abs(entries[0].lat - -41.8) < 1e-9)
  assert.ok(Math.abs(entries[0].lon - 172.7) < 1e-9)
  // The kind of place is both the search scope and what sets the bar.
  assert.equal(entries[0].subCategory, "hut")
  assert.equal(entries[0].name, "Angelus Hut")
})

test("a hut activates at one contact and a lighthouse takes four", async () => {
  // The kind of place is the THIRD character of the reference; reading any
  // other shows a lighthouse activator done after one contact.
  const activation = async (ref: string) => {
    const result = (await zlota.runHook("scoring", "scoreQsos", {
      operation: fixtureOperation({ refs: [{ type: "zlotaActivation", ref }] }),
      qsos: [fixtureQso({ uuid: "q0" })],
      ref: { type: "zlotaActivation", ref },
    })) as { operationSummary: { activation?: { summary?: string; activated?: boolean } } }
    return result.operationSummary.activation
  }
  assert.equal((await activation("ZLH/AA-001"))?.activated, true)
  const lighthouse = await activation("ZLB/001")
  assert.equal(lighthouse?.summary, "1/4")
  assert.equal(lighthouse?.activated, false)
})

// ADIF import. Every program writes the same SIG/MY_SIG pair, so reading it
// without checking WHOSE it is invents references on foreign records.
const importOne = async (fields: Record<string, string>) =>
  ((await zlota.runHook("adifImport", "refsForRecords", { records: [{ fields }] })) as unknown[])[0]

test("ADIF import reads its own activation and hunt, whatever their case", async () => {
  const activation = { type: "zlotaActivation", ref: "ZLH/AA-001", for: "operation" }
  assert.deepEqual(await importOne({ my_sig: "ZLOTA", my_sig_info: "ZLH/AA-001" }), { refs: [activation] })
  // Ref types are compared as strings downstream; an unnormalized reference matches nothing.
  assert.deepEqual(await importOne({ my_sig: "zlota", my_sig_info: "zlh/aa-001" }), { refs: [activation] })
  assert.deepEqual(await importOne({ sig: "ZLOTA", sig_info: "ZLH/AA-001", my_sig: "ZLOTA", my_sig_info: "ZLH/AA-001" }), {
    refs: [{ type: "zlota", ref: "ZLH/AA-001" }, activation],
  })
})

test("ADIF import declines another program's SIG, even on a ZLOTA-shaped reference", async () => {
  // A foreign-looking reference would be turned away before the SIG was ever
  // consulted, so the reference here is ZLOTA's own shape.
  assert.equal(await importOne({ sig: "POTA", sig_info: "ZLH/AA-001", my_sig: "POTA", my_sig_info: "ZLH/AA-001" }), null)
})

test("ADIF import keeps a reference that does not match the pattern", async () => {
  // The pattern flags it when decorated; it does not decide whether the
  // operator's text survives.
  assert.deepEqual(await importOne({ my_sig: "ZLOTA", my_sig_info: "not a reference" }), {
    refs: [{ type: "zlotaActivation", ref: "NOT A REFERENCE", for: "operation" }],
  })
})
