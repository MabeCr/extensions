// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The Cabrillo header's NAME and EMAIL, read from the operator profile at
// export. Its own file because the profile is a host call, stubbed once per
// loaded extension.
//
// The trap is the host that cannot answer: that must cost these lines, never
// the log the operator is trying to submit.

import assert from "node:assert/strict"
import { mock, test } from "node:test"

import { loadExtension } from "./sdkGapTesting.ts"

// The extension logs its own recovery; silenced so a passing run does not
// print stack traces that read as failures.
mock.method(console, 'warn', () => {})

let settings: () => unknown = () => ({})

const contest = await loadExtension(() => import("./index.ts"), {
  hostCalls: { getSettings: () => settings() },
})

async function header(ref: Record<string, unknown> = {}): Promise<string[]> {
  const operation = { uuid: 'op-1', stationCall: 'N0DEV', refs: [{ type: 'naqp', mode: 'CW', ...ref }] }
  const qsos = [{ uuid: 'q1', their: { call: 'W1AW' }, band: '20m', mode: 'CW', freq: 14035, startAtMillis: Date.UTC(2026, 7, 1, 18), refs: [] }]
  const result = (await contest.runHook('export', 'generateExport', { operation, qsos, exportType: 'naqp-cabrillo' })) as { content: string }
  return result.content.split('\n').filter((line) => /^(NAME|EMAIL|CLUB):/.test(line))
}

test("the profile's full name and email reach the header, and no club", async () => {
  settings = () => ({ operatorName: 'Sam  Doe', operatorEmail: 'sam@example.com', operatorClub: 'Potomac Valley Radio Club' })
  // Teams are registered with the NCJ, not read from the log.
  assert.deepEqual(await header({ ourName: 'SAM' }), ['NAME: Sam Doe', 'EMAIL: sam@example.com'])
})

test("without a profile name, the name we send stands in", async () => {
  settings = () => ({ operatorName: '', operatorEmail: '' })
  assert.deepEqual(await header({ ourName: 'sam' }), ['NAME: SAM'])
  assert.deepEqual(await header(), [])
})

test("a host that cannot answer still exports the log", async () => {
  settings = () => { throw new Error('host disposed') }
  assert.deepEqual(await header({ ourName: 'SAM' }), ['NAME: SAM'])
})
