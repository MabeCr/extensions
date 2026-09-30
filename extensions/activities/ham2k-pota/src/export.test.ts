// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// POTA's per-park ADIF export, through its `export` hook. The file is written
// by the core ADIF exporter; what POTA decides is what it asks for. The traps:
// an export type that exists only once a log does leaves the per-type export
// settings with nothing to list; a delegation that names no main handler, or
// the app's own `satellites` key rather than the catalog's, writes a park
// worked through a bird without the PROP_MODE/SAT_NAME POTA's uploader reads —
// an unmatched key contributes nothing, silently; and a delegation whose
// failure is swallowed hands the operator a file that is missing fields.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

const pota = await loadExtension(() => import("./index.ts"))

interface Delegation {
  category: string
  method: string
  args: Record<string, unknown>
  key?: string
}

let delegated: Delegation[] = []
let answer: unknown[] = []

// The kernel stand-in's fan-out, recording what the SDK's `adifForExport`
// hands the core `adif` extension.
const kernel = (globalThis as unknown as { __polo: Record<string, unknown> }).__polo
kernel.invokeLocal = async (category: string, method: string, args: Record<string, unknown>, _online: unknown, key?: string) => {
  delegated.push({ category, method, args, key })
  return answer
}

const operation = {
  uuid: "op",
  stationCall: "N0DEV",
  refs: [
    { type: "potaActivation", ref: "US-0001" },
    { type: "llotaActivation", ref: "LLUS-0787" },
  ],
}
const qsos = [
  {
    uuid: "q0",
    our: { call: "N0DEV", sent: "59" },
    their: { call: "W0ABC", sent: "59" },
    band: "20m",
    mode: "SSB",
    startAtMillis: Date.UTC(2026, 6, 1, 12),
    refs: [{ type: "satellite", ref: "SO-50" }],
  },
]

const generate = () =>
  pota.runHook(
    "export",
    "generateExport",
    { operation, qsos, exportType: "potaActivation-adif", exportKey: "ham2k-pota-adif:US-0001", includePrivateData: false },
    { key: "ham2k-pota" },
  )

test("registers its shared activity type without needing a log", async () => {
  // Asked with no operation and no QSOs, the way the export settings list
  // every type before any operation exists. `reference` is what gives the
  // type the `log.ref` / `log.refName` template sample.
  const types = (await pota.runHook("export", "getExportTypes", {}, { key: "ham2k-pota" })) as Record<string, unknown>[]
  assert.equal(types.length, 1)
  assert.equal(types[0].exportType, "potaActivation-adif")
  assert.equal(types[0].activationType, "potaActivation")
  assert.equal(types[0].templateCategory, "reference")
})

test("a POTA file is POTA's, and asks for the satellite fields by their catalog key", async () => {
  delegated = []
  answer = [{ ok: true, value: { content: "<CALL:5>W0ABC <EOR>" } }]
  const result = (await generate()) as { content: string }
  assert.equal(result.content, "<CALL:5>W0ABC <EOR>")

  assert.equal(delegated.length, 1)
  const [call] = delegated
  assert.equal(call.category, "export")
  assert.equal(call.key, "adif")
  // Without a main handler the core asks every hook, and the LLOTA lake on the
  // same operation lands in POTA's file.
  assert.equal(call.args.mainHandler, "ham2k-pota")
  assert.deepEqual(call.args.includeFieldsFrom, ["ham2k-satellites"])
  // The satellite ref rides to the exporter on the QSO it was logged on.
  assert.deepEqual((call.args.qsos as typeof qsos)[0].refs, [{ type: "satellite", ref: "SO-50" }])
  assert.equal(call.args.includePrivateData, false)
})

test("a delegation that fails fails POTA's export, naming what failed", async () => {
  // The export panel shows this message and nothing else says which extension
  // broke the file.
  answer = [{ ok: false, error: "ham2k-satellites: adifFields failed" }]
  await assert.rejects(generate(), /ham2k-satellites/)
})
