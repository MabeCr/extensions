// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The Cabrillo log the ARRL's robot reads, and the contest's half of the ADIF
// export. The ADIF file is written by the core `adif` exporter, which this
// hook only DELEGATES to; the kernel's local-invoke seam stands in for it.

import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"
import manifest from "../manifest.json" with { type: "json" }

const contest = await loadExtension(() => import("./index.ts"), {
  hostCalls: { getSettings: () => ({ operatorName: 'Sam Doe', operatorEmail: 'sam@example.com', operatorClub: 'Hudson Valley Contesters' }) },
})

let delegated: { category: string; method: string; args: Record<string, unknown>; key: string | null | undefined }[] = []
const polo = (globalThis as unknown as { __polo: Record<string, unknown> }).__polo
polo.invokeLocal = async (category: string, method: string, args: Record<string, unknown>, _online: unknown, key?: string | null) => {
  delegated.push({ category, method, args, key })
  return [{ ok: true, value: { content: '<CALL:4>W1AW <EOR>' } }]
}

beforeEach(() => {
  delegated = []
})

const OPERATION = {
  uuid: 'op-1',
  stationCall: 'N0DEV',
  grid: 'FN31',
  refs: [{ type: 'arrl-ss', mode: 'CW', entry: 'SO-HIGH', check: '72', section: 'CT', operators: 'n0dev' }],
}

const QSOS = [
  {
    uuid: 'q1',
    their: { call: 'K8MM' },
    band: '20m',
    mode: 'CW',
    freq: 14035,
    startAtMillis: Date.UTC(2026, 10, 7, 21, 0),
    refs: [{ type: 'arrl-ss', ourSerial: 1, theirSerial: '1', theirPrecedence: 'Q', theirCheck: '92', theirSection: 'MI' }],
  },
  {
    uuid: 'q2',
    their: { call: 'VE3ABC' },
    band: '40m',
    mode: 'CW',
    freq: 7035,
    startAtMillis: Date.UTC(2026, 10, 7, 21, 2),
    refs: [{ type: 'arrl-ss', ourSerial: 2 }],
  },
]

async function exportAs(exportType: string) {
  return (await contest.runHook('export', 'generateExport', { operation: OPERATION, qsos: QSOS, exportType })) as { filename: string; content: string }
}

test("the Cabrillo log names the contest and the entry, and carries both exchanges in the ARRL's columns", async () => {
  const { content, filename } = await exportAs('arrl-ss-cabrillo')
  const lines = content.split('\n')
  for (const header of [
    'CONTEST: ARRL-SS-CW',
    'CALLSIGN: N0DEV',
    'OPERATORS: N0DEV',
    'LOCATION: CT',
    'CATEGORY-OPERATOR: SINGLE-OP',
    'CATEGORY-ASSISTED: NON-ASSISTED',
    'CATEGORY-POWER: HIGH',
    'CATEGORY-TRANSMITTER: ONE',
    'CLUB: Hudson Valley Contesters',
    'NAME: Sam Doe',
    'EMAIL: sam@example.com',
  ]) {
    assert.ok(lines.includes(header), `missing ${header}`)
  }
  const qsoLines = lines.filter((line) => line.startsWith('QSO:')).map((line) => line.split(/\s+/).slice(1))
  assert.deepEqual(qsoLines[0], ['14035', 'CW', '2026-11-07', '2100', 'N0DEV', '1', 'B', '72', 'CT', 'K8MM', '1', 'Q', '92', 'MI'])
  // What was not copied is a dash, never a column dropped.
  assert.deepEqual(qsoLines[1].slice(4), ['N0DEV', '2', 'B', '72', 'CT', 'VE3ABC', '0', '-', '-', '-'])
  assert.match(filename, /ARRL-SS-CW/)
})

test("what was typed that isn't a valid value still reaches the Cabrillo log, never a dash", async () => {
  const operation = { ...OPERATION, refs: [{ ...OPERATION.refs[0], section: 'NYC' }] }
  const qsos = [{ ...QSOS[0], refs: [{ type: 'arrl-ss', ourSerial: 1, theirSerial: '1', theirPrecedence: 'X', theirCheck: '7', theirSection: 'ILL' }] }]
  const result = (await contest.runHook('export', 'generateExport', { operation, qsos, exportType: 'arrl-ss-cabrillo' })) as { content: string }
  const lines = result.content.split('\n')
  assert.ok(lines.includes('LOCATION: NYC'))
  const qsoLine = lines.find((line) => line.startsWith('QSO:'))!.split(/\s+/).slice(5)
  assert.deepEqual(qsoLine, ['N0DEV', '1', 'B', '72', 'NYC', 'K8MM', '1', 'X', '7', 'ILL'])
})

test("the ADIF export delegates once, to the core exporter alone, as this contest's log", async () => {
  await exportAs('arrl-ss-adif')
  assert.equal(delegated.length, 1)
  assert.equal(delegated[0].key, 'adif')
  assert.equal(delegated[0].args.mainHandler, manifest.key)
})

test("the ADIF fields carry the contest id and each part of the exchange", async () => {
  const fields = (await contest.runHook('adifFields', 'fieldsForOneQSO', { qso: QSOS[0], operation: OPERATION })) as { name: string; value: string }[]
  assert.deepEqual(Object.fromEntries(fields.map((f) => [f.name, f.value])), {
    CONTEST_ID: 'ARRL-SS-CW',
    STX: '1',
    SRX: '1',
    PRECEDENCE: 'Q',
    CHECK: '92',
    ARRL_SECT: 'MI',
    STX_STRING: '1 B 72 CT',
    SRX_STRING: '1 Q 92 MI',
  })
})

test("only the two export types it offers are answered", async () => {
  const other = await exportAs('pota-adif')
  assert.equal(other.content, '')
})
