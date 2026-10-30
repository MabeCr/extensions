// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// What comes from the operator profile: our section at setup, and the
// Cabrillo header's NAME, EMAIL and CLUB at export. Its own file because the
// profile is a host call, stubbed once per loaded extension, and the section
// default is module state these tests walk through in order.
//
// The trap is the host that cannot answer. It must cost the default, never
// the setup form — and once a section has been read, it must not blank the
// field in front of the operator (see `ourSectionDefault`). At export it must
// cost those three lines, never the log.

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

const hostGone = () => {
  throw new Error('the host went away')
}

async function sectionValue(): Promise<unknown> {
  const controls = (await contest.runHook('activity', 'operationControls', { operation: { refs: [] } })) as {
    input: { form: { elements: { key?: string; value?: unknown }[] } }
  }[]
  assert.equal(controls.length, 1, 'the setup form must survive whatever getSettings does')
  return controls[0].input.form.elements.find((e) => e.key === 'section')?.value
}

async function header(ref: Record<string, unknown> = {}): Promise<string[]> {
  const operation = { uuid: 'op-1', stationCall: 'N0DEV', refs: [{ type: 'arrl-ss', mode: 'CW', ...ref }] }
  const qsos = [{ uuid: 'q1', their: { call: 'W1AW' }, band: '20m', mode: 'CW', freq: 14035, startAtMillis: Date.UTC(2026, 10, 7, 21), refs: [] }]
  const result = (await contest.runHook('export', 'generateExport', { operation, qsos, exportType: 'arrl-ss-cabrillo' })) as { content: string }
  return result.content.split('\n').filter((line) => /^(NAME|EMAIL|CLUB):/.test(line))
}

test("a host that rejects before any read costs only the section default", async () => {
  settings = hostGone
  assert.equal(await sectionValue(), '')
})

test("our section defaults to the profile's, and a section that isn't one is not offered", async () => {
  settings = () => ({ operatorSection: 'XX' })
  assert.equal(await sectionValue(), '')
  settings = () => ({ operatorSection: 'ons' })
  assert.equal(await sectionValue(), 'ONS')
})

test("a host that stops answering keeps the last section read", async () => {
  settings = hostGone
  assert.equal(await sectionValue(), 'ONS')
})

test("the profile's name, email and club reach the header, and a club typed at setup wins", async () => {
  settings = () => ({ operatorName: 'Sam  Doe', operatorEmail: 'sam@example.com', operatorClub: 'Hudson Valley Contesters' })
  assert.deepEqual(await header(), ['CLUB: Hudson Valley Contesters', 'NAME: Sam Doe', 'EMAIL: sam@example.com'])
  assert.deepEqual(await header({ club: 'Yankee Clipper Contest Club' }), ['CLUB: Yankee Clipper Contest Club', 'NAME: Sam Doe', 'EMAIL: sam@example.com'])
})

test("a host that cannot answer still exports the log", async () => {
  settings = hostGone
  assert.deepEqual(await header({ club: 'Yankee Clipper Contest Club' }), ['CLUB: Yankee Clipper Contest Club'])
})
