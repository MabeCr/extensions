// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Texas State Parks On The Air through its HOOKS. The event is played THROUGH
// POTA, and what the sponsor takes is one ADIF per park, named for it (§8.4.1.1).
// The traps:
//   - the setup form asking what the sponsor does not score, or not asking the
//     power class it does (§6.3.4);
//   - a file per park that names one park and carries another's records: the
//     operation handed to the core writer has to hold ONLY the park the file
//     names, and POTA — whose MY_SIG_INFO and SIG_INFO the sponsor's uploader
//     requires — has to be asked for its fields by the key it is installed by;
//   - a park removed after the export sheet listed it, exported as a valid file
//     claiming no park at all.

import { test } from "node:test"
import assert from "node:assert/strict"

import type { JSONValue } from "@ham2k/extension-sdk"

import { loadExtension } from "./sdkGapTesting.ts"

const tx = await loadExtension(() => import("./index.ts"))

type Delegation = { method: string; args: Record<string, unknown>; key?: string }
let delegated: Delegation[] = []

// Where `adifForExport` hands the file to the core ADIF writer; recorded so
// what the event PASSES is what is tested, not the file the core writes.
;(globalThis as unknown as { __polo: Record<string, unknown> }).__polo.invokeLocal = async (
  _category: string,
  method: string,
  args: Record<string, unknown>,
  _online: unknown,
  key?: string,
) => {
  delegated.push({ method, args, key })
  return [{ ok: true, key, value: { content: '<CALL:4>W1AW <EOR>\n' } }]
}

const TYPE = 'txspota'
const park = (ref: string) => ({ type: 'potaActivation', ref })

const operationFor = (...parks: string[]): Record<string, JSONValue> => ({
  uuid: 'op-1',
  stationCall: 'KE5CW',
  refs: [{ type: TYPE, ourPower: 'HP' }, ...parks.map(park)],
})

const qso = {
  uuid: 'q0',
  our: { call: 'KE5CW' },
  their: { call: 'W0AW', name: 'Alice' },
  band: '20m',
  mode: 'CW',
  startAtMillis: Date.UTC(2026, 3, 18, 13, 30),
  refs: [{ type: 'pota', ref: 'US-9001' }],
}

test('the setup form asks only for the power class, which the score adds', async () => {
  const [control] = (await tx.runHook('activity', 'operationControls', { operation: operationFor() })) as {
    input: { form: { elements: { type: string; key?: string }[] } }
  }[]
  assert.deepEqual(control.input.form.elements.filter((e) => e.type === 'field').map((e) => e.key), ['ourPower'])
})

test('one file is offered per Texas park, and none without one', async () => {
  // A park outside the sponsor's list is not an entry here, so it gets no file.
  const options = async (operation: Record<string, JSONValue>) =>
    (await tx.runHook('export', 'suggestExportOptions', { operation, qsos: [qso] })) as { exportType: string; exportKey?: string }[]

  const both = await options(operationFor('US-3051', 'US-2195', 'US-3052'))
  assert.deepEqual(both.map((o) => o.exportKey ?? o.exportType), ['txspota-adif:US-3051', 'txspota-adif:US-3052'])
  assert.ok(both.every((o) => o.exportType === 'txspota-adif'))
  assert.deepEqual(await options(operationFor()), [])
})

test("each park's file is named as the rules print it, and carries only that park", async () => {
  for (const includePrivateData of [false, true]) {
    delegated = []
    const result = (await tx.runHook('export', 'generateExport', {
      exportType: 'txspota-adif',
      exportKey: 'txspota-adif:US-3051',
      operation: operationFor('US-3051', 'US-3052'),
      qsos: [qso],
      includePrivateData,
    })) as { filename: string }

    assert.match(result.filename, /^KE5CW@US-3051-/)
    assert.equal(delegated.length, 1)
    assert.equal(delegated[0].key, 'adif')
    assert.equal(delegated[0].args.mainHandler, 'ham2k-txspota')
    assert.ok((delegated[0].args.includeFieldsFrom as string[]).includes('ham2k-pota'), "POTA's park fields are asked for by the catalog key")
    const parks = ((delegated[0].args.operation as { refs: Record<string, JSONValue>[] }).refs)
      .filter((r) => r.type === 'potaActivation')
      .map((r) => r.ref)
    assert.deepEqual(parks, ['US-3051'], 'US-3052 has its own file')
    assert.equal(delegated[0].args.includePrivateData, includePrivateData)
  }
})

test('a park dropped since the export sheet listed it is refused, not exported parkless', async () => {
  await assert.rejects(tx.runHook('export', 'generateExport', {
    exportType: 'txspota-adif',
    exportKey: 'txspota-adif:US-3051',
    operation: operationFor(),
    qsos: [qso],
  }))
})
