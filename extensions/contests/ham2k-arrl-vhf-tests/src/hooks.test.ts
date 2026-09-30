// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The ARRL VHF+ family through its HOOKS, the way the app calls them. The
// traps: a rules link for a family whose events do not share one document, an
// ADIF export that delegates to the whole `export` category (re-entering itself,
// and letting another program's fields onto the contest's log) or drops the
// operator's privacy choice on the way, and a scorer that reads the BASE
// operation's grid when a rover's segment has moved it.

import { test } from "node:test"
import assert from "node:assert/strict"

import type { JSONValue } from "@ham2k/extension-sdk"

import { loadExtension } from "./sdkGapTesting.ts"

const vhf = await loadExtension(() => import("./index.ts"))

type Delegation = { category: string; method: string; args: Record<string, unknown>; key?: string }
let delegated: Delegation[] = []

// The kernel's `invokeLocal` is where `adifForExport` hands the file to the core
// ADIF writer. Recorded here, so what the contest PASSES is what is tested; the
// file the core writes from it is the host's.
;(globalThis as unknown as { __polo: Record<string, unknown> }).__polo.invokeLocal = async (
  category: string,
  method: string,
  args: Record<string, unknown>,
  _online: unknown,
  key?: string,
) => {
  delegated.push({ category, method, args, key })
  return [{ ok: true, key, value: { content: '<CALL:4>W1AW <EOR>\n' } }]
}

const TYPE = 'arrl-vhf-tests'

const operationFor = (extra: Record<string, JSONValue> = {}): Record<string, JSONValue> => ({
  uuid: 'op-1',
  stationCall: 'N0DEV',
  grid: 'FN32',
  refs: [{ type: TYPE, ref: 'ARRL-VHF-JUN' }, { type: 'potaActivation', ref: 'US-0001' }],
  ...extra,
})

const qsosFor = (count = 5): Record<string, JSONValue>[] =>
  Array.from({ length: count }, (_, i) => ({
    uuid: `q${i}`,
    our: { call: 'N0DEV' },
    their: { call: `W${i}AW`, name: 'Alice' },
    band: '2m',
    mode: 'CW',
    startAtMillis: Date.UTC(2026, 5, 13, 18, i),
    refs: [{ type: TYPE, grid: 'FN42' }],
  }))

async function generate(args: Record<string, unknown>) {
  delegated = []
  return (await vhf.runHook('export', 'generateExport', args)) as { filename: string; content: string }
}

test('each event links to its own rules, and no event links nowhere', async () => {
  // The family's events do not share one rules document, so with no event
  // picked there is no one document to send the operator to.
  const link = async (ref?: string) =>
    (await vhf.runHook(`ref:${TYPE}`, 'linkForRef', { ref: { type: TYPE, ...(ref ? { ref } : {}) } })) as { url: string } | null
  assert.equal((await link('ARRL-VHF-JAN'))?.url, 'https://contests.arrl.org/ContestRules/JanJunSep-VHF-Rules.pdf')
  assert.equal((await link('ARRL-10G-AUG'))?.url, 'https://contests.arrl.org/ContestRules/10-GHz-Rules.pdf')
  assert.equal(await link(), null)
})

test('the contest ADIF is handed to the core writer alone, naming this contest as its only handler', async () => {
  // Delegating through the whole category re-enters this very hook forever;
  // a missing `mainHandler` lets every other program (POTA, here on the same
  // operation) write its fields onto a contest log.
  const result = await generate({ exportType: `${TYPE}-adif`, operation: operationFor(), qsos: qsosFor() })

  assert.equal(delegated.length, 1)
  assert.equal(delegated[0].category, 'export')
  assert.equal(delegated[0].method, 'generateExport')
  assert.equal(delegated[0].key, 'adif')
  assert.equal(delegated[0].args.exportType, 'adif')
  assert.equal(delegated[0].args.mainHandler, 'ham2k-arrl-vhf-tests')
  assert.equal(delegated[0].args.includeFieldsFrom, undefined, 'no other program is asked for fields')
  assert.match(result.content, /<CALL:/)
  assert.match(result.filename, /\.adi$/)
})

test("the operator's private-data choice reaches the core writer either way", async () => {
  // Only a forwarded flag reaches the generator; dropped, the export silently
  // withholds (or leaks) the operator's notes whatever they chose.
  for (const includePrivateData of [false, true]) {
    await generate({ exportType: `${TYPE}-adif`, operation: operationFor(), qsos: qsosFor(1), includePrivateData })
    assert.equal(delegated[0].args.includePrivateData, includePrivateData)
  }
})

test('an exportType it never offered is declined, not delegated', async () => {
  const result = await generate({ exportType: 'adif', operation: operationFor(), qsos: qsosFor(1) })
  assert.deepEqual(result, { filename: '', mimeType: '', content: '' })
  assert.equal(delegated.length, 0)
})

test('the Cabrillo comes out of the shared writer', async () => {
  const result = await generate({ exportType: `${TYPE}-cabrillo`, operation: operationFor(), qsos: qsosFor(3) })
  const lines = result.content.split('\n')
  assert.equal(lines[0], 'START-OF-LOG: 3.0')
  assert.equal(lines.filter((line) => line.startsWith('QSO:')).length, 3)
})

test("each contact is scored from the grid its own segment was operating from", async () => {
  // A rover changes `operation.grid` each stint through a segment override, so
  // the distance of a contact after a move is measured from where the rover
  // then was. Scored from the base operation, both runs below would agree.
  const ref = { type: TYPE, ref: 'ARRL-222' }
  const base = { uuid: 'op', stationCall: 'N0DEV', grid: 'FN32aa', refs: [ref] }
  const segment = (fromMillis: number, grid: string) => ({ fromMillis, operation: { ...base, grid } })
  const at = (i: number) => Date.UTC(2026, 2, 28, 12, i)
  const qso = (i: number, band: string) => ({
    uuid: `q${i}`,
    startAtMillis: at(i),
    band,
    mode: 'CW',
    our: { call: 'N0DEV' },
    their: { call: 'W1AW' },
    refs: [{ type: TYPE, grid: 'FN42aa' }],
  })
  const qsos = [qso(0, '1.25m'), qso(10, '70cm')]
  const DAWN = -(2 ** 62)

  const score = async (segments: unknown[]) =>
    ((await vhf.runHook('scoring', 'scoreQsos', { operation: base, qsos, ref, segments })) as {
      qsoScores: Record<string, { value: number }>
    }).qsoScores

  const moved = await score([segment(DAWN, 'FN32aa'), segment(at(10), 'EM12aa')])
  const stayed = await score([segment(DAWN, 'FN32aa')])

  assert.ok(moved.q0.value > 0)
  assert.equal(moved.q0.value, stayed.q0.value, 'before the move both runs are at FN32aa')
  assert.notEqual(moved.q10.value, stayed.q10.value, 'after it, EM12aa to FN42aa is not FN32aa to FN42aa')
})
