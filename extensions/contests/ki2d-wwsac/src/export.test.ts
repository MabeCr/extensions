// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The Cabrillo file, in the columns of the sponsor's N1MM file, and the ADIF
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
  refs: [{ type: 'wwsac', ref: '2026-10-27', ourAgeGroup: 'OM', power: 'LOW' }],
}

const QSOS = [
  {
    uuid: 'q1',
    their: { call: 'K1ABC', sent: '57' },
    our: { sent: '59' },
    band: '20m',
    mode: 'USB',
    freq: 14225.4,
    startAtMillis: Date.UTC(2026, 9, 27, 1, 2),
    refs: [{ type: 'wwsac', ageGroup: 'YL' }],
  },
  {
    uuid: 'q2',
    their: { call: 'VE3XYZ' },
    band: '40m',
    mode: 'LSB',
    freq: 7175,
    startAtMillis: Date.UTC(2026, 9, 27, 1, 30),
    refs: [{ type: 'wwsac' }],
  },
]

async function exported(exportType: string, operation: Record<string, unknown> = OPERATION) {
  return (await contest.runHook('export', 'generateExport', { operation, qsos: QSOS, exportType })) as { filename: string; content: string }
}

test("the Cabrillo log is WWSAC's, with report and age group each way", async () => {
  const { filename, content } = await exported('wwsac-cabrillo')
  assert.match(filename, /WWSAC-2026-10-27/)
  assert.match(filename, /\.log$/)
  assert.deepEqual(content.trim().split('\n'), [
    'START-OF-LOG: 3.0',
    'CREATED-BY: Ham2K Logger',
    'CALLSIGN: KI2D',
    'CONTEST: WWSAC',
    'CATEGORY-OPERATOR: SINGLE-OP',
    'CATEGORY-BAND: ALL',
    'CATEGORY-POWER: LOW',
    'CATEGORY-MODE: SSB',
    'CATEGORY-TRANSMITTER: ONE',
    'NAME: Sebastian Delmont',
    'EMAIL: ki2d@example.com',
    'OPERATORS: KI2D',
    'GRID-LOCATOR: FN30',
    'QSO: 14225 PH 2026-10-27 0102 KI2D 59 OM K1ABC 57 YL',
    'QSO: 7175  PH 2026-10-27 0130 KI2D 59 OM VE3XYZ 59 -',
    'END-OF-LOG:',
  ])
  assert.equal(delegated.length, 0, 'a Cabrillo file is written here, not delegated')
})

test("the ADIF export delegates once, to the core exporter alone, as this contest's log", async () => {
  const result = await exported('wwsac-adif')
  assert.equal(delegated.length, 1)
  assert.equal(delegated[0].key, 'adif')
  assert.equal(delegated[0].args.mainHandler, manifest.key)
  assert.match(result.filename, /WWSAC-2026-10-27.*\.adi$/)
})

test("an exportType it never offered is declined, not delegated", async () => {
  assert.equal((await exported('adif')).content, '')
  assert.equal(delegated.length, 0)
})

test("each QSO's ADIF carries the contest and both age groups", async () => {
  const fields = await contest.runHook('adifFields', 'fieldsForOneQSO', { qso: QSOS[0], operation: OPERATION })
  assert.deepEqual(fields, [
    { name: 'CONTEST_ID', value: 'WWSAC' },
    { name: 'STX_STRING', value: 'OM' },
    { name: 'SRX_STRING', value: 'YL' },
  ])
  assert.deepEqual(await contest.runHook('adifFields', 'fieldsForOneQSO', { qso: QSOS[0], operation: { refs: [] } }), [])
})

test("an age group the rules don't know is exported as typed, for the log checker to judge", async () => {
  const misheard = { ...QSOS[0], refs: [{ type: 'wwsac', ageGroup: 'ol' }] }
  const { content } = (await contest.runHook('export', 'generateExport', { operation: OPERATION, qsos: [misheard], exportType: 'wwsac-cabrillo' })) as { content: string }
  assert.match(content, /K1ABC 57 OL\n/)
  const fields = (await contest.runHook('adifFields', 'fieldsForOneQSO', { qso: misheard, operation: OPERATION })) as { name: string; value: string }[]
  assert.deepEqual(fields.find((f) => f.name === 'SRX_STRING'), { name: 'SRX_STRING', value: 'OL' })
})
