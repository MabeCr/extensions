// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// POTA's ADIF import, through `refsForRecords`. The core parser produces no
// references, so this hook is all that keeps an imported POTA log attached to
// its parks. Every reference program writes the same SIG/SIG_INFO pair, so a
// hook that reads it without checking WHOSE it is invents parks on another
// program's records — and one that drops what it cannot parse loses the only
// text a correction could start from.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

const pota = await loadExtension(() => import("./index.ts"))

const refsFor = async (fields: Record<string, string>) => {
  const [result] = (await pota.runHook("adifImport", "refsForRecords", { records: [{ fields }] })) as ({ refs: unknown[] } | null)[]
  return result?.refs ?? null
}

test("recovers hunted and activated parks from a HamRS-style record", async () => {
  assert.deepEqual(await refsFor({ call: "AC9OT", sig: "POTA", sig_info: "K-1467", my_sig: "POTA", my_sig_info: "K-0001" }), [
    { type: "pota", ref: "K-1467" },
    // ADIF flattens an activation onto every record; the hook sees one record,
    // so it has to say the park belongs to the operation.
    { type: "potaActivation", ref: "K-0001", for: "operation" },
  ])
})

test("POTA_REF keeps an n-fer an n-fer", async () => {
  // SIG_INFO names only the primary park; preferring it imports a two-park
  // contact as a one-park one, silently.
  assert.deepEqual(await refsFor({ sig: "POTA", sig_info: "K-1467", pota_ref: "K-1467,K-9999" }), [
    { type: "pota", ref: "K-1467" },
    { type: "pota", ref: "K-9999" },
  ])
})

test("a park written without its dash is repaired on the way in", async () => {
  // Falling back to the raw text for what cannot be parsed must not skip the
  // repair for what can.
  assert.deepEqual(await refsFor({ sig: "POTA", sig_info: "us1234" }), [{ type: "pota", ref: "US-1234" }])
})

test("does not claim another program's SIG_INFO", async () => {
  // A dashed WWFF reference would otherwise import as a park that does not exist.
  assert.equal(await refsFor({ sig: "WWFF", sig_info: "KFF-1234" }), null)
})

test("keeps a SIG_INFO that is not a well-formed park", async () => {
  // The SIG says POTA, so this is a MALFORMED park, not a foreign reference:
  // it imports, decorates as invalid, and can be corrected.
  assert.deepEqual(await refsFor({ sig: "POTA", sig_info: "not a park" }), [{ type: "pota", ref: "NOT A PARK" }])
})
