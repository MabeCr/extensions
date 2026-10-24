// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The Cabrillo header's NAME, EMAIL and CLUB, read from the operator profile
// at export. Its own file because the profile is a host call, stubbed once
// per loaded extension.
//
// The trap is the host that cannot answer: that must cost these three lines,
// never the log the operator is trying to submit.

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
  const operation = { uuid: 'op-1', stationCall: 'LA8OKA/P', refs: [{ type: 'nrrl-nfd', ref: '2026', ...ref }] }
  const qsos = [{ uuid: 'q1', their: { call: 'SV7QNV/P' }, band: '20m', mode: 'SSB', freq: 14125, startAtMillis: Date.UTC(2026, 8, 5, 15), refs: [] }]
  const result = (await contest.runHook('export', 'generateExport', { operation, qsos, exportType: 'nrrl-nfd-cabrillo' })) as { content: string }
  return result.content.split('\n').filter((line) => /^(NAME|EMAIL|CLUB):/.test(line))
}

test("the profile's name, email and club reach the header", async () => {
  settings = () => ({ operatorName: 'Martin  Storli', operatorEmail: 'ms@example.com', operatorClub: 'Oslogruppen av NRRL' })
  assert.deepEqual(await header(), ['CLUB: Oslogruppen av NRRL', 'NAME: Martin Storli', 'EMAIL: ms@example.com'])
})

test("a club typed at setup wins over the profile's", async () => {
  settings = () => ({ operatorName: 'Martin Storli', operatorClub: 'Oslogruppen av NRRL' })
  assert.deepEqual(await header({ club: 'LA4O Fieldday-gruppa' }), ['CLUB: LA4O Fieldday-gruppa', 'NAME: Martin Storli'])
})

test("an empty profile writes none of the three", async () => {
  settings = () => ({ operatorName: '', operatorEmail: '' })
  assert.deepEqual(await header(), [])
})

test("a host that cannot answer still exports the log", async () => {
  settings = () => { throw new Error('host disposed') }
  assert.deepEqual(await header({ club: 'LA4O Fieldday-gruppa' }), ['CLUB: LA4O Fieldday-gruppa'])
})
