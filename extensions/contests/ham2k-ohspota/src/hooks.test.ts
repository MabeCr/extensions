// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Ohio State Parks On The Air through its HOOKS, the way the app calls them.
// The traps:
//   - the sponsor's checker is automated and reads a Cabrillo ONLY, laid out as
//     their own sample log is, so a header name or a column out of place is an
//     entry it cannot score;
//   - the park the other station sent is guessable from the POTA reference the
//     QSO carries, and a guess written over a DELIBERATELY emptied field submits
//     a park the operator said no to;
//   - the scorer reads refs it does not own (the POTA activation on the
//     operation), so a segment that moves the operator to another park has to
//     reach it as that segment's operation.

import { test } from "node:test"
import assert from "node:assert/strict"

import type { JSONValue } from "@ham2k/extension-sdk"

import { loadExtension } from "./sdkGapTesting.ts"

const oh = await loadExtension(() => import("./index.ts"))

const TYPE = 'ohspota'

/// MPO with a declared HP, on purpose: MPO's own definition names one
/// transmitter and no power, so the Cabrillo takes the transmitter from the
/// category and the power from the declared class.
const SETUP = { type: TYPE, ourPark: 'HOC', ourCategory: 'MPO', ourPower: 'HP' }
const operation: Record<string, JSONValue> = { uuid: 'op-1', stationCall: 'N0DEV', grid: 'EN91', refs: [SETUP] }

test('the setup form asks for our park, our power and our entry category, and nothing else', async () => {
  // The three things the sponsor's Cabrillo header carries. A field the sponsor
  // does not read is a question the operator answers for nothing.
  const [control] = (await oh.runHook('activity', 'operationControls', { operation })) as {
    input: { form: { elements: { type: string; key?: string }[] } }
  }[]
  const keys = control.input.form.elements.filter((e) => e.type === 'field').map((e) => e.key)
  assert.deepEqual(keys, ['ourPark', 'ourPower', 'ourCategory'])
})

test('the only file offered is the Cabrillo', async () => {
  // "No ADIF, no CSV, no Text files - send in a standard Cabrillo file only",
  // and one Cabrillo covers the entry however many parks the operation lists.
  const withParks = { ...operation, refs: [SETUP, { type: 'potaActivation', ref: 'US-2195' }, { type: 'potaActivation', ref: 'US-3051' }] }
  const options = (await oh.runHook('export', 'suggestExportOptions', { operation: withParks, qsos: [] })) as {
    exportType: string
    exportKey?: string
  }[]
  assert.deepEqual(options.map((o) => o.exportKey ?? o.exportType), ['ohspota-cabrillo'])
})

test("the Cabrillo is written the way the sponsor's own sample reads", async () => {
  const qsos = [
    { uuid: 'q1', their: { call: 'W1AW' }, band: '40m', mode: 'CW', freq: 7035, startAtMillis: Date.UTC(2026, 8, 12, 14, 5), refs: [{ type: TYPE, park: 'ALU' }] },
    { uuid: 'q2', their: { call: 'K2DEF', state: 'PA', entityPrefix: 'K' }, band: '40m', mode: 'SSB', freq: 7185, startAtMillis: Date.UTC(2026, 8, 12, 14, 9) },
    { uuid: 'q3', their: { call: 'DL1ABC', entityPrefix: 'DL' }, band: '20m', mode: 'CW', freq: 14035, startAtMillis: Date.UTC(2026, 8, 12, 15, 0) },
  ]
  const result = (await oh.runHook('export', 'generateExport', { exportType: 'ohspota-cabrillo', operation, qsos })) as {
    filename: string
    content: string
  }

  assert.equal(result.filename, '2026-09-12 N0DEV for OSPOTA.log')
  const lines = result.content.split('\n').map((line) => line.trim()).filter((line) => line)
  assert.equal(lines[0], 'START-OF-LOG: 3.0')
  assert.equal(lines[lines.length - 1], 'END-OF-LOG:')
  // `OSPOTA`, from https://ospota.org/Files/OSPOTA_Sample-rev2.log — their
  // checker matches the name as written there.
  for (const header of [
    'CONTEST: OSPOTA',
    'CALLSIGN: N0DEV',
    'LOCATION: HOC',
    'GRID-LOCATOR: EN91',
    'CATEGORY-OPERATOR: MPO',
    'CATEGORY-POWER: HIGH',
    'CATEGORY-MODE: MIXED',
    'CATEGORY-TRANSMITTER: SINGLE',
  ]) {
    assert.ok(lines.includes(header), `missing ${header}`)
  }

  const qsoLines = result.content.split('\n').filter((line) => line.startsWith('QSO:'))
  assert.equal(qsoLines.length, 3)
  // Fixed-width columns: frequency, mode, date, time, our call and park, their
  // call and park.
  assert.equal(qsoLines[0], 'QSO: 7035  CW 2026-09-12 1405 N0DEV              HOC          W1AW              ALU         ')
  // No park: their state stands in; SSB is written PH.
  assert.match(qsoLines[1], / PH /)
  assert.match(qsoLines[1], / PA +$/)
  // Outside the US and in no park: DX.
  assert.match(qsoLines[2], / DX +$/)
})

type Patch = { refs?: Record<string, JSONValue>[]; their?: Record<string, JSONValue> } | null

async function decorate(refs: Record<string, JSONValue>[]): Promise<Patch> {
  return (await oh.runHook('activity', 'processQsoBeforeSave', {
    operation: { stationCall: 'N0DEV', refs: [{ type: TYPE }] },
    qso: { band: '40m', mode: 'CW', their: { call: 'W1AW' }, refs },
  })) as Patch
}

test('the park they sent reaches their.exchange, and is recorded on our ref', async () => {
  // The QSO row's exchange column reads `their.exchange`, and nothing generic
  // reads this contest's own ref.
  const patch = await decorate([{ type: TYPE, park: 'ada' }])
  assert.equal(patch?.their?.exchange, 'ADA')
  assert.equal('call' in (patch?.their ?? {}), false, 'a narrow patch, not a rewrite of their station')
  assert.deepEqual(patch?.refs, [{ type: TYPE, park: 'ADA' }])
})

test('a park nobody typed comes from the POTA reference the QSO carries', async () => {
  const patch = await decorate([{ type: 'pota', ref: 'US-1932' }])
  assert.deepEqual(patch?.refs, [{ type: TYPE, park: 'ADA' }])
  assert.equal(patch?.their?.exchange, 'ADA')
})

test('a park the operator emptied stays empty, whatever POTA reference is still on the row', async () => {
  // They clear it BECAUSE the station was not in a park this time, while the
  // hunter chip from the last contact is still there.
  const cleared: Record<string, JSONValue>[][] = [[{ type: TYPE, park: '' }], [{ type: 'pota', ref: 'US-1932' }, { type: TYPE, park: '' }]]
  for (const refs of cleared) {
    const patch = await decorate(refs)
    assert.ok(patch, 'a cleared field still projects, so the row clears too')
    assert.equal('refs' in patch, false)
    assert.equal(patch.their?.exchange, '')
  }
})

test('an operation not running the event is left alone', async () => {
  const patch = await oh.runHook('activity', 'processQsoBeforeSave', {
    operation: { stationCall: 'N0DEV', refs: [{ type: 'pota', ref: 'US-1932' }] },
    qso: { their: { call: 'W1AW' }, refs: [{ type: TYPE, park: 'ADA' }] },
  })
  assert.equal(patch, null)
})

// Segmented: an activator works one park, moves, and carries on under the same
// event — a break whose override restates the event ref and swaps the park.
const EVENT = { type: TYPE }
const ADA = { type: 'potaActivation', ref: 'US-1932' }
const HOC = { type: 'potaActivation', ref: 'US-1958' }
const DAWN = -(2 ** 62)
const at = (i: number) => Date.UTC(2026, 8, 12, 14, i)
const tenQsos = (from: number, calls = from) =>
  Array.from({ length: 10 }, (_, n) => ({
    uuid: `q${from + n}`,
    startAtMillis: at(from + n),
    band: '20m',
    mode: 'CW',
    our: { call: 'N0DEV' },
    their: { call: `W${calls + n}AW` },
  }))

async function scoreSegmented(qsos: Record<string, JSONValue>[], segments: { fromMillis: number; refs: Record<string, JSONValue>[] }[]) {
  const base = { uuid: 'op', stationCall: 'N0DEV', refs: [EVENT, ADA] }
  return (await oh.runHook('scoring', 'scoreQsos', {
    operation: base,
    ref: EVENT,
    qsos,
    segments: segments.map(({ fromMillis, refs }) => ({ fromMillis, operation: { ...base, refs } })),
  })) as {
    qsoScores: Record<string, { value: number; dupe?: boolean }>
    operationSummary: Record<string, { qsos: number; total: number; longSummary?: string }>
  }
}

test('each contact is credited to the park its own segment was activating', async () => {
  // The same ten stations worked again after the move: from the next park they
  // count again, each park being its own entry. Scored against the base
  // operation, all ten would be duplicates at ADA.
  const result = await scoreSegmented([...tenQsos(0), ...tenQsos(10, 0)], [
    { fromMillis: DAWN, refs: [EVENT, ADA] },
    { fromMillis: at(10), refs: [EVENT, HOC] },
  ])
  assert.equal(result.operationSummary.ohspota.qsos, 20)
  assert.ok(Object.values(result.qsoScores).every((score) => score.value === 1))
  assert.match(String(result.operationSummary.ohspota.longSummary), /\*\*ADA:\*\* 10 /)
  assert.match(String(result.operationSummary.ohspota.longSummary), /\*\*HOC:\*\* 10 /)
})

test('a stretch the event was not running is not scored at all', async () => {
  // After the move the segment carries POTA only: those contacts get no
  // verdict, not a zero, and the park is not an event multiplier.
  const result = await scoreSegmented([...tenQsos(0), ...tenQsos(10)], [
    { fromMillis: DAWN, refs: [EVENT, ADA] },
    { fromMillis: at(10), refs: [HOC] },
  ])
  assert.equal(result.operationSummary.ohspota.qsos, 10)
  assert.equal(Object.keys(result.qsoScores).length, 10)
  assert.doesNotMatch(String(result.operationSummary.ohspota.longSummary), /\*\*HOC:\*\*/)
})
