// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Reading ECA back out of an ADIF file, through the `adifImport` hook.
//
// The core parser produces no references, so this hook is all that stands
// between "imported a ECA log" and "imported contacts that belong to no
// castle". Every reference program writes the same SIG/MY_SIG pair, so the trap
// is a hook that reads the pair without checking WHOSE it is: it invents
// references on other programs' records, and the log looks fine afterwards.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

const extension = await loadExtension(() => import("./index.ts"))

const ACTIVATION = "ecaActivation"
const R = "G-00001"

type Imported = { refs: { type: string; ref: string; for?: string }[] } | null

/// One record's answer, the fields keyed lower-case the way the core parser
/// hands them over.
async function importOne(fields: Record<string, string>): Promise<Imported> {
  const results = (await extension.runHook("adifImport", "refsForRecords", { records: [{ fields }] })) as Imported[]
  assert.equal(results.length, 1, "one answer per record, nulls included")
  return results[0]
}

test("reads the activation it wrote, as the operation's", async () => {
  // ADIF flattens an activation onto every record; the hook sees one record,
  // so it has to say the reference belongs to the operation.
  assert.deepEqual(await importOne({ my_sig: "ECA", my_sig_info: R }), { refs: [{ type: ACTIVATION, ref: R, for: "operation" }] })
})

test("reads a record written in lower case", async () => {
  // References are compared as strings downstream, so an unnormalized one
  // matches nothing the list or the scorer knows.
  assert.deepEqual(await importOne({ my_sig: "eca", my_sig_info: R.toLowerCase() }), {
    refs: [{ type: ACTIVATION, ref: R, for: "operation" }],
  })
})

test("declines a record whose SIG names another program", async () => {
  // The reference is this program's OWN shape on purpose: a foreign-looking
  // one is turned away by the pattern before the SIG is ever consulted, and
  // would pass with the SIG check deleted.
  assert.equal(await importOne({ sig: "POTA", sig_info: R, my_sig: "POTA", my_sig_info: R }), null)
})

test("keeps a reference its pattern does not accept", async () => {
  // The SIG says it is ours, so it is a MALFORMED reference, not a foreign
  // one; dropping it loses the only text a correction could start from. The
  // pattern flags it when decorated; it does not decide what survives.
  assert.deepEqual(await importOne({ my_sig: "ECA", my_sig_info: "not a reference" }), {
    refs: [{ type: ACTIVATION, ref: "NOT A REFERENCE", for: "operation" }],
  })
})

test("ignores a hunted reference, having no ref type to hold one", async () => {
  // ECA recognises activations only; importing the other station's
  // reference would invent a ref type no extension answers for.
  assert.equal(await importOne({ sig: "ECA", sig_info: R }), null)
})
