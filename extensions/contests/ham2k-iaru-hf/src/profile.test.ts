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
  const operation = { uuid: 'op-1', stationCall: 'N0DEV', refs: [{ type: 'iaru-hf', modeRestriction: 'Mixed', zone: '8', ...ref }] }
  const qsos = [{ uuid: 'q1', their: { call: 'DL1ABC' }, band: '20m', mode: 'CW', freq: 14025, startAtMillis: Date.UTC(2026, 6, 11, 12), refs: [] }]
  const result = (await contest.runHook('export', 'generateExport', { operation, qsos, exportType: 'iaru-hf-cabrillo' })) as { content: string }
  return result.content.split('\n').filter((line) => /^(NAME|EMAIL|CLUB):/.test(line))
}

test("the profile's name, email and club reach the header", async () => {
  settings = () => ({ operatorName: 'Sam  Doe', operatorEmail: 'sam@example.com', operatorClub: 'Potomac Valley Radio Club' })
  assert.deepEqual(await header(), ['CLUB: Potomac Valley Radio Club', 'NAME: Sam Doe', 'EMAIL: sam@example.com'])
})

test("a club typed at setup wins over the profile's", async () => {
  settings = () => ({ operatorName: 'Sam Doe', operatorClub: 'Potomac Valley Radio Club' })
  assert.deepEqual(await header({ club: 'Yankee Clipper Contest Club' }), ['CLUB: Yankee Clipper Contest Club', 'NAME: Sam Doe'])
})

test("an empty profile writes none of the three", async () => {
  settings = () => ({ operatorName: '', operatorEmail: '' })
  assert.deepEqual(await header(), [])
})

test("a host that cannot answer still exports the log", async () => {
  settings = () => { throw new Error('host disposed') }
  assert.deepEqual(await header({ club: 'Yankee Clipper Contest Club' }), ['CLUB: Yankee Clipper Contest Club'])
})

async function sectionValue(): Promise<unknown> {
  const controls = (await contest.runHook('activity', 'operationControls', { operation: { refs: [] } })) as {
    input: { form: { elements: { key?: string; value?: unknown }[] } }
  }[]
  return controls[0].input.form.elements.find((e) => e.key === 'section')?.value
}

test("our section defaults to the profile's, and a host that stops answering keeps the last one read", async () => {
  settings = () => ({ operatorSection: 'XX' })
  assert.equal(await sectionValue(), '')
  settings = () => ({ operatorSection: 'eny' })
  assert.equal(await sectionValue(), 'ENY')
  settings = () => { throw new Error('host disposed') }
  assert.equal(await sectionValue(), 'ENY')
})

test("the header's LOCATION is our section, or DX for a station outside the USA and Canada", async () => {
  settings = () => ({})
  const location = async (stationCall: string, ref: Record<string, unknown>) => {
    const operation = { uuid: 'op-1', stationCall, refs: [{ type: 'iaru-hf', ...ref }] }
    const result = (await contest.runHook('export', 'generateExport', { operation, qsos: [], exportType: 'iaru-hf-cabrillo' })) as { content: string }
    return result.content.split('\n').filter((line) => line.startsWith('LOCATION:'))
  }
  assert.deepEqual(await location('N0DEV', { section: 'MN' }), ['LOCATION: MN'])
  assert.deepEqual(await location('DL1ABC', { section: 'MN' }), ['LOCATION: DX'])
  assert.deepEqual(await location('N0DEV', {}), [])
})
