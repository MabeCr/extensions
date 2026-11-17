// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// POTA's activation ADIF export, through its `export` hook. The file is
// written by the core ADIF exporter; what POTA decides is what it asks for.
// POTA's uploader reads MY_POTA_REF/POTA_REF as lists, so an n-fer is ONE file
// whose records name every park, and a park-to-park contact is ONE record —
// a file per park, or a record per hunted park, submits the same contact
// twice. A state-park sponsor's file that includes POTA's fields is the
// opposite: it counts a record per hunted park. The other traps:
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
    { type: "potaActivation", ref: "US-0002", name: "Second Park" },
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
    { operation, qsos, exportType: "potaActivation-adif", exportKey: "ham2k-pota-adif", includePrivateData: false },
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

const options = (op: Record<string, unknown>) =>
  pota.runHook("export", "suggestExportOptions", { operation: op, qsos }, { key: "ham2k-pota" }) as Promise<Record<string, unknown>[]>

test("an n-fer is one file, named for every park, that says it is the only upload", async () => {
  const [option, ...more] = await options(operation)
  assert.equal(more.length, 0, "a second option is a second upload of the same contacts")
  assert.equal(option.exportType, "potaActivation-adif", "the per-type export settings stay where operators set them")
  assert.equal(option.label, "ADIF for POTA US-0001, US-0002")
  assert.match(option.filename as string, /N0DEV at US-0001,US-0002\.adi$/)
  // Every park's contacts, not one park's slice.
  assert.equal(option.refType, "potaActivation")
  assert.equal(option.ref, undefined)
  assert.equal((option.templateData as Record<string, unknown>).ref, "US-0001,US-0002", "one park here narrows the file to that park's contacts")
  assert.match(option.instructions as string, /single file for multiple parks/)
  assert.match(option.instructions as string, /\[pota\.app\]\(https:\/\/pota\.app\//)
})

test("a single park's file still points at the uploader", async () => {
  const [option] = await options({ ...operation, refs: [{ type: "potaActivation", ref: "US-0001" }] })
  assert.match(option.filename as string, /N0DEV at US-0001\.adi$/)
  assert.doesNotMatch(option.instructions as string, /parks/)
  assert.match(option.instructions as string, /pota\.app/)
})

test("no activation, no POTA file", async () => {
  // A log that only hunts parks is the Hunter Log's business.
  assert.deepEqual(await options({ ...operation, refs: [] }), [])
})

test("the file claims every park, and each contact keeps its own segment", async () => {
  delegated = []
  answer = [{ ok: true, value: { content: "x" } }]
  const segments = [{ fromMillis: 0, operation: { ...operation, refs: [{ type: "potaActivation", ref: "US-0001" }] } }]
  await pota.runHook(
    "export",
    "generateExport",
    { operation, qsos, segments, exportType: "potaActivation-adif", exportKey: "ham2k-pota-adif" },
    { key: "ham2k-pota" },
  )
  // Narrowing the operation to one park writes a file whose MY_POTA_REF drops
  // the others; narrowing the segments makes a park moved to at a break claim
  // the contacts made before it.
  const refs = (delegated[0].args.operation as typeof operation).refs.filter((r) => r.type === "potaActivation").map((r) => r.ref)
  assert.deepEqual(refs, ["US-0001", "US-0002"])
  assert.deepEqual(delegated[0].args.segments, segments)
})

test("refuses the plain ADIF it delegates to", async () => {
  // Answering for the "adif" type makes the delegation recurse into itself.
  delegated = []
  await assert.rejects(
    pota.runHook("export", "generateExport", { operation, qsos, exportType: "adif", exportKey: "ham2k-pota-adif" }, { key: "ham2k-pota" }),
    /unknown export/,
  )
  assert.equal(delegated.length, 0)
})

test("refuses a per-park option listed by an older POTA", async () => {
  // A panel opened before the update still holds a key naming one park; a file
  // written for it would claim every park under that park's name.
  delegated = []
  await assert.rejects(
    pota.runHook("export", "generateExport", { operation, qsos, exportType: "potaActivation-adif", exportKey: "ham2k-pota-adif:US-0001" }, { key: "ham2k-pota" }),
    /unknown export/,
  )
  assert.equal(delegated.length, 0)
})

const severalParks = { refs: [{ type: "pota", ref: "US-0003" }, { type: "pota", ref: "US-0004" }] }

test("a contact with a station at several parks is one record listing them all", async () => {
  // A record per hunted park submits the same contact once per park.
  assert.deepEqual(await pota.runHook("adifFields", "fieldCombinationsForOneQSO", { qso: severalParks, operation, mainHandler: true }), [])
  const fields = (await pota.runHook("adifFields", "fieldsForOneQSO", {
    qso: { refs: [{ type: "pota", ref: "US-0003" }, { type: "pota", ref: "US-0004" }] },
    operation,
  })) as { name: string; value: string }[]
  const value = (name: string) => fields.find((f) => f.name === name)?.value
  assert.equal(value("POTA_REF"), "US-0003,US-0004")
  assert.equal(value("MY_POTA_REF"), "US-0001,US-0002")
})

test("a state-park file that includes POTA's fields has a record per hunted park", async () => {
  // Georgia's sponsor: "n-fer contacts must be listed separately with
  // <SIG_INFO> for each park"; Texas and Florida score a record per park too.
  // One joined record leaves every park after the first out of their count.
  type Field = { name: string; value: string }
  const sets = (await pota.runHook("adifFields", "fieldCombinationsForOneQSO", { qso: severalParks, operation, mainHandler: false })) as Field[][]
  const value = (set: Field[], name: string) => set.find((f) => f.name === name)?.value
  assert.deepEqual(sets.map((set) => value(set, "SIG_INFO")), ["US-0003", "US-0004"])
  assert.deepEqual(sets.map((set) => value(set, "POTA_REF")), ["US-0003", "US-0004"])
  for (const set of sets) assert.equal(value(set, "MY_POTA_REF"), "US-0001,US-0002")
})

test("a delegation that fails fails POTA's export, naming what failed", async () => {
  // The export panel shows this message and nothing else says which extension
  // broke the file.
  answer = [{ ok: false, error: "ham2k-satellites: adifFields failed" }]
  await assert.rejects(generate(), /ham2k-satellites/)
})

const sigFieldNames = ["SIG", "SIG_INFO", "MY_SIG", "MY_SIG_INFO"]
const fieldsFor = async (args: Record<string, unknown>) => {
  const fields = (await pota.runHook("adifFields", "fieldsForOneQSO", {
    qso: { refs: [{ type: "pota", ref: "US-0003" }, { type: "pota", ref: "US-0004" }] },
    operation,
    ...args,
  })) as { name: string; value: string }[]
  return fields.map((f) => f.name)
}

test("POTA's own files name the parks in POTA_REF alone unless the operator picks both", async () => {
  // The default, which an app showing the choice sends when it is untouched.
  assert.deepEqual(await fieldsFor({ mainHandler: true, exportSettings: { choices: { sigFields: "potaRef" } } }), ["POTA_REF", "MY_POTA_REF"])
  const both = await fieldsFor({ mainHandler: true, exportSettings: { choices: { sigFields: "both" } } })
  for (const name of [...sigFieldNames, "POTA_REF", "MY_POTA_REF"]) assert.ok(both.includes(name), name)
})

test("an app too old to show the choice keeps SIG_INFO in POTA's own files", async () => {
  // It sends no pick, the default included, and its operator has no setting
  // to get SIG_INFO back with.
  for (const args of [{ mainHandler: true }, { mainHandler: true, exportSettings: {} }]) {
    const names = await fieldsFor(args)
    for (const name of sigFieldNames) assert.ok(names.includes(name), name)
  }
})

test("files that are not POTA's own keep SIG_INFO whatever POTA's pick", async () => {
  // The full export is the operator's own record; a state-park sponsor reads
  // SIG_INFO out of the contest file that includes POTA's fields.
  for (const args of [{}, { mainHandler: false, exportSettings: { choices: { sigFields: "potaRef" } } }]) {
    const names = await fieldsFor(args)
    for (const name of sigFieldNames) assert.ok(names.includes(name), name)
  }
})

test("both POTA file types offer the park-fields choice, defaulting to POTA_REF only", async () => {
  const types = (await pota.runHook("export", "getExportTypes", {}, { key: "ham2k-pota" })) as Record<string, unknown>[]
  const hunter = (await pota.runHook("export", "getExportTypes", {}, { key: "ham2k-pota-hunter" })) as Record<string, unknown>[]
  for (const definition of [...types, ...hunter]) {
    const [choice] = definition.choices as { key: string; default: string; options: { value: string }[] }[]
    assert.equal(choice.key, "sigFields", String(definition.exportType))
    assert.equal(choice.default, "potaRef")
    assert.deepEqual(choice.options.map((o) => o.value), ["potaRef", "both"])
  }
  assert.deepEqual([...types, ...hunter].map((d) => d.exportType), ["potaActivation-adif", "pota-hunter"])
})
