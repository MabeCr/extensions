// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The reference list's mapper, the ADIF records and the export, through the
// registered hooks. The traps: a CSV that starts with a byte-order mark, and
// an uploader that refuses a file spanning two UTC days.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

const ppota = await loadExtension(() => import("./index.ts"))

/// The ADIF writer is the host's, so a test stands in for it and keeps what
/// each export handed it.
const delegated: { qsos: { uuid: string }[] }[] = []
;(globalThis as unknown as { __polo: Record<string, unknown> }).__polo.invokeLocal = async (_c: string, _m: string, args: never) => {
  delegated.push(args)
  return [{ key: "adif", ok: true, value: { content: "<EOH>\n" } }]
}

function mapCsv(rows: Record<string, string>[]) {
  const hook = ppota.hooks.find((h) => h.category === "dataFile" && h.key === "ham2k-ppota-all-references")
  assert.ok(hook, "no ham2k-ppota-all-references data file")
  assert.equal(hook.hook.category, "ppota", "the data file must fill the table referenceActivity reads")
  assert.equal(hook.hook.fetchType, "csv")
  const mapper = hook.hook.csvToLookupEntry as (row: Record<string, string>) => Record<string, any> | null
  return rows.map((row) => mapper(row)).filter((entry) => entry != null)
}

/// One row as the live export publishes it, today.
const CSV_ROW = {
  code: "PPAR-0333",
  name: "Quehué, La Pampa",
  country: "Argentina",
  country_code: "AR",
  region: "La Pampa",
  locality: "Municipio de Quehué",
  type: "Pueblo",
  latitude: "-37.121557",
  longitude: "-64.514809",
  grid: "FF72RV",
  activated: "false",
  activation_count: "0",
}

test("the list files each reference under its country, with its place and grid", () => {
  const [village] = mapCsv([CSV_ROW])
  assert.equal(village.key, "PPAR-0333")
  assert.equal(village.subCategory, "AR")
  assert.equal(village.name, "Quehué, La Pampa")
  assert.equal(village.lat, -37.121557)
  assert.equal(village.lon, -64.514809)
  assert.equal(village.data.location, "Municipio de Quehué, La Pampa")
  assert.equal(village.data.type, "Pueblo")
  // Published upper-case; the app writes the subsquare in lower case.
  assert.equal(village.data.grid, "FF72rv")
})

test("a first header still carrying its byte-order mark is read all the same", () => {
  const { code, ...rest } = CSV_ROW
  const [village] = mapCsv([{ "﻿code": code, ...rest }])
  assert.equal(village?.key, "PPAR-0333")
})

test("a row with no grid gets one from its coordinates, and a malformed code is dropped", () => {
  const entries = mapCsv([
    { ...CSV_ROW, code: "PPES-0001", grid: "", latitude: "40.4168", longitude: "-3.7038", locality: "" },
    { ...CSV_ROW, code: "AR-0001" },
  ])
  assert.deepEqual(entries.map((e) => e.key), ["PPES-0001"])
  assert.equal(entries[0].data.grid, "IN80dk")
  assert.equal(entries[0].data.location, "La Pampa")
})

const fieldsOf = (record: { name: string; value: string }[]) => Object.fromEntries(record.map((f) => [f.name, f.value]))

test("an activation is MY_SIG=PPOTA with the reference in MY_SIG_INFO", async () => {
  const fields = (await ppota.runHook("adifFields", "fieldsForOneQSO", {
    qso: { their: { call: "LU2AAA" } },
    operation: { refs: [{ type: "ppotaActivation", ref: "PPAR-0004" }] },
  })) as { name: string; value: string }[]
  assert.deepEqual(fieldsOf(fields), { MY_SIG: "PPOTA", MY_SIG_INFO: "PPAR-0004" })
})

test("a contact with an activator on two references becomes one record per reference", async () => {
  const records = (await ppota.runHook("adifFields", "fieldCombinationsForOneQSO", {
    qso: { their: { call: "LU2AAA" }, refs: [{ type: "ppota", ref: "PPAR-0100" }, { type: "ppota", ref: "PPAR-0101" }] },
    operation: { refs: [{ type: "ppotaActivation", ref: "PPAR-0004" }] },
  })) as { name: string; value: string }[][]

  assert.deepEqual(records.map(fieldsOf), [
    { MY_SIG: "PPOTA", MY_SIG_INFO: "PPAR-0004", SIG: "PPOTA", SIG_INFO: "PPAR-0100" },
    { MY_SIG: "PPOTA", MY_SIG_INFO: "PPAR-0004", SIG: "PPOTA", SIG_INFO: "PPAR-0101" },
  ])
})

test("there is no hunter export: PPOTA credits hunters from the activator's log", () => {
  const exports = ppota.hooks.filter((h) => h.category === "export")
  assert.deepEqual(exports.map((h) => h.key), ["ham2k-ppota"])
})

const operation = { stationCall: "LU1ABC", refs: [{ type: "ppotaActivation", ref: "PPAR-0004" }] }
const at = (day: number, hour: number) => Date.UTC(2026, 9, day, hour, 0)
const qso = (uuid: string, millis: number, extra: Record<string, unknown> = {}) => ({
  uuid,
  startAtMillis: millis,
  band: "40m",
  mode: "SSB",
  their: { call: uuid.toUpperCase() },
  ...extra,
})

async function optionsFor(qsos: Record<string, unknown>[]) {
  return (await ppota.runHook("export", "suggestExportOptions", { operation, qsos })) as {
    exportKey: string
    label: string
    filename: string
    qsoCount?: number
    templateData: Record<string, string>
  }[]
}

test("an activation inside one UTC day is one file per reference, as without the split", async () => {
  const options = await optionsFor([qso("a", at(1, 18)), qso("b", at(1, 23))])
  assert.deepEqual(options.map((o) => o.exportKey), ["ham2k-ppota-adif:PPAR-0004"])
  assert.equal(options[0].templateData.modifier ?? "", "")
})

test("an evening activation across 00:00 UTC is one file per UTC day, each named for its own day", async () => {
  // 21:00–22:00 in Argentina is 00:00–01:00 UTC the next day.
  const options = await optionsFor([qso("a", at(1, 23)), qso("b", at(2, 0)), qso("c", at(2, 1), { deleted: true })])
  assert.deepEqual(options.map((o) => o.exportKey), [
    "ham2k-ppota-adif@2026-10-01:PPAR-0004",
    "ham2k-ppota-adif@2026-10-02:PPAR-0004",
  ])
  assert.deepEqual(options.map((o) => o.templateData.modifier), ["2026-10-01", "2026-10-02"])
  assert.notEqual(options[0].filename, options[1].filename)
  assert.match(options[1].filename, /^2026-10-02 /)
  // Each day's own count, the deleted contact left out.
  assert.deepEqual(options.map((o) => o.qsoCount), [1, 1])
})

test("a day's file carries only that day's contacts", async () => {
  const qsos = [qso("t", 0), qso("a", at(1, 23)), qso("b", at(2, 0)), qso("c", at(2, 1))]
  for (const day of ["2026-10-01", "2026-10-02"]) {
    await ppota.runHook("export", "generateExport", {
      operation,
      qsos,
      exportType: "ppotaActivation-adif",
      exportKey: `ham2k-ppota-adif@${day}:PPAR-0004`,
    })
  }
  // A contact with no time at all joins the first day.
  assert.deepEqual(delegated.slice(-2).map((d) => d.qsos.map((q) => q.uuid)), [["t", "a"], ["b", "c"]])
})

test("a day with only deleted contacts is no day", async () => {
  const options = await optionsFor([qso("a", at(1, 23)), qso("b", at(2, 0), { deleted: true })])
  assert.deepEqual(options.map((o) => o.exportKey), ["ham2k-ppota-adif:PPAR-0004"])
})
