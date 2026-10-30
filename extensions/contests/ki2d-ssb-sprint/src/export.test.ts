// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The Cabrillo file, as the sponsor's page specifies it, and the ADIF
// export's delegation to the core exporter.

import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"
import manifest from "../manifest.json" with { type: "json" }

const contest = await loadExtension(() => import("./index.ts"), {
  hostCalls: { getSettings: () => ({ operatorName: 'Sebastian Delmont', operatorEmail: 'ki2d@example.com' }) },
})

let delegated: { category: string; args: Record<string, unknown>; key: string | null | undefined }[] = []
const polo = (globalThis as unknown as { __polo: Record<string, unknown> }).__polo
polo.invokeLocal = async (category: string, _method: string, args: Record<string, unknown>, _online: unknown, key?: string | null) => {
  delegated.push({ category, args, key })
  return [{ ok: true, value: { content: '<CALL:4>W0AW <EOR>' } }]
}

beforeEach(() => {
  delegated = []
})

const OPERATION = {
  uuid: 'op-1',
  stationCall: 'KI2D',
  grid: 'FN30',
  refs: [{ type: 'ssb-sprint', ourName: 'SEB', ourLocation: 'NY', operator: 'SINGLE-OP', power: 'HIGH' }],
}

const QSOS = [
  {
    uuid: 'q1',
    their: { call: 'N3QE' },
    band: '20m',
    mode: 'USB',
    freq: 14240.2,
    startAtMillis: Date.UTC(2026, 10, 1, 0, 1),
    refs: [{ type: 'ssb-sprint', ourSerial: 5, theirSerial: '2', name: 'TIM', location: 'MD' }],
  },
]

async function exported(exportType: string, operation: Record<string, unknown> = OPERATION) {
  return (await contest.runHook('export', 'generateExport', { operation, qsos: QSOS, exportType })) as { filename: string; content: string }
}

test("the Cabrillo log is the sponsor's example, field for field", async () => {
  const { filename, content } = await exported('ssb-sprint-cabrillo')
  assert.equal(filename, 'KI2D.log')
  const lines = content.trim().split('\n')
  assert.deepEqual(lines, [
    'START-OF-LOG: 3.0',
    'CREATED-BY: Ham2K Logger',
    'CALLSIGN: KI2D',
    'CONTEST: NA-SPRINT-SSB',
    'CATEGORY-OPERATOR: SINGLE-OP',
    'CATEGORY-ASSISTED: NON-ASSISTED',
    'CATEGORY-BAND: ALL',
    'CATEGORY-POWER: HIGH',
    'CATEGORY-MODE: SSB',
    'CATEGORY-TRANSMITTER: ONE',
    'LOCATION: NY',
    'NAME: Sebastian Delmont',
    'EMAIL: ki2d@example.com',
    'OPERATORS: KI2D',
    'QSO: 14240 PH 2026-11-01 0001 KI2D 5 SEB NY N3QE 2 TIM MD',
    'END-OF-LOG:',
  ])
  assert.equal(delegated.length, 0, 'a Cabrillo file is written here, not delegated')
})

test("undeclared, the header claims only what every entry is", async () => {
  const { content } = await exported('ssb-sprint-cabrillo', { uuid: 'op-2', stationCall: 'KI2D', refs: [{ type: 'ssb-sprint' }] })
  assert.deepEqual(content.split('\n').filter((line) => line.startsWith('CATEGORY-')), [
    'CATEGORY-BAND: ALL',
    'CATEGORY-MODE: SSB',
    'CATEGORY-TRANSMITTER: ONE',
  ])
})

test("the ADIF export delegates once, to the core exporter alone, as this contest's log", async () => {
  const result = await exported('ssb-sprint-adif')
  assert.equal(delegated.length, 1)
  assert.equal(delegated[0].key, 'adif')
  assert.equal(delegated[0].args.mainHandler, manifest.key)
  assert.match(result.filename, /\.adi$/)
})

test("an exportType it never offered is declined, not delegated", async () => {
  assert.equal((await exported('adif')).content, '')
  assert.equal(delegated.length, 0)
})

test("each QSO's ADIF carries the contest and both exchanges", async () => {
  const fields = await contest.runHook('adifFields', 'fieldsForOneQSO', { qso: QSOS[0], operation: OPERATION })
  assert.deepEqual(fields, [
    { name: 'CONTEST_ID', value: 'NA-SPRINT-SSB' },
    { name: 'STX', value: '5' },
    { name: 'SRX', value: '2' },
    { name: 'STX_STRING', value: '5 SEB NY' },
    { name: 'SRX_STRING', value: '2 TIM MD' },
  ])
})
