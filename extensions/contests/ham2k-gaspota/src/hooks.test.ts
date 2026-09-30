// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Georgia State Parks on the Air through its HOOKS. The event is played THROUGH
// POTA, and what the sponsor takes is an ADIF whose FILENAME names the park
// (§7.2.1). The traps:
//   - that name following the operator's compact-filename preference, when the
//     rules print it one way only;
//   - losing it to POTA's own per-park export, whose compact name is the very
//     same string — the core renames the SECOND of a colliding pair, so this
//     file has to be generated first;
//   - a setup form asking what the sponsor takes on its web form and scores
//     nothing (the power classes).

import { test } from "node:test"
import assert from "node:assert/strict"

import type { JSONValue } from "@ham2k/extension-sdk"

import { loadExtension } from "./sdkGapTesting.ts"

const ga = await loadExtension(() => import("./index.ts"))

const TYPE = 'gaspota'

const operationFor = (...parks: string[]): Record<string, JSONValue> => ({
  uuid: 'op-1',
  stationCall: 'W1RCP',
  refs: [{ type: TYPE }, ...parks.map((ref) => ({ type: 'potaActivation', ref }))],
})

const qsos = [{ uuid: 'q0', their: { call: 'W0AW' }, band: '20m', mode: 'CW', startAtMillis: Date.UTC(2026, 3, 18, 13, 30) }]

type Option = { exportType: string; exportKey?: string; filename?: string; priority?: number }

test('the setup form asks nothing: the power classes are taken on the web form and score nothing', async () => {
  const [control] = (await ga.runHook('activity', 'operationControls', { operation: operationFor() })) as {
    input: { form: { elements: { type: string }[] } }
  }[]
  assert.deepEqual(control.input.form.elements.filter((e) => e.type === 'field'), [])
})

test('one file is offered per park, and none without one', async () => {
  const options = async (operation: Record<string, JSONValue>) =>
    (await ga.runHook('export', 'suggestExportOptions', { operation, qsos })) as Option[]
  const both = await options(operationFor('US-2195', 'US-2165'))
  assert.deepEqual(both.map((o) => o.exportKey ?? o.exportType), ['gaspota-adif:US-2195', 'gaspota-adif:US-2165'])
  assert.ok(both.every((o) => o.exportType === 'gaspota-adif'))
  assert.deepEqual(await options(operationFor()), [])
})

test('the file is named exactly as the rules print it, compact names or not, and generated ahead of POTA', async () => {
  // §7.2.1 prints `W1RCP@US-2195-20260418`.
  for (const compactFilenames of [false, true]) {
    const [option] = (await ga.runHook('export', 'suggestExportOptions', {
      operation: operationFor('US-2195'),
      qsos,
      compactFilenames,
    })) as Option[]
    assert.equal(option.filename, 'W1RCP@US-2195-20260418.adi', `compactFilenames: ${compactFilenames}`)
    assert.ok((option.priority ?? 0) > 0)
  }
})
