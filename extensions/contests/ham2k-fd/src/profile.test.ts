// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// What comes from the operator profile: our section at setup, seeded so it is
// typed once in Settings rather than at every running, and the Cabrillo
// header's NAME, EMAIL and CLUB at export.
//
// Its own file because the profile is a host call, stubbed once per loaded
// extension, and the section default is module state (`lastKnownSection`)
// these tests walk through in order: nothing read yet, then a read, then a
// host that stops answering. Each test sets the stub's answer.
//
// The trap is the rejecting host. FormRenderer re-applies a field's `value`
// when a re-fetched definition disagrees with the previous one on a field the
// operator hasn't edited, and operationControls is re-fetched on every ref
// change — so a getSettings that works once and then rejects must not blank
// the section in front of the operator, and one that rejects from the start
// must cost the default, never the whole setup form. At export it must cost
// the three header lines, never the log.

import assert from "node:assert/strict"
import { mock, test } from "node:test"

import { loadExtension } from "./sdkGapTesting.ts"

// The extension logs its own recovery; silenced so a passing run does not
// print stack traces that read as failures.
mock.method(console, 'warn', () => {})

let settings: () => unknown = () => ({})

const fd = await loadExtension(() => import("./index.ts"), {
  hostCalls: { getSettings: () => settings() },
})

async function sectionValue(): Promise<unknown> {
  const controls = (await fd.runHook('activity', 'operationControls', { operation: { refs: [] } })) as {
    input: { form: { elements: { key?: string; value?: unknown }[] } }
  }[]
  assert.equal(controls.length, 1, 'the setup form must survive whatever getSettings does')
  const field = controls[0].input.form.elements.find((e) => e.key === 'ourSection')
  assert.ok(field, 'no ourSection field')
  return field.value
}

const hostGone = () => {
  throw new Error('the host went away')
}

test('a host that rejects getSettings before any read costs only the default', async () => {
  settings = hostGone
  assert.equal(await sectionValue(), '')
})

test('a profile with no section leaves our section blank', async () => {
  settings = () => ({})
  assert.equal(await sectionValue(), '')
})

test("our section defaults to the profile's", async () => {
  settings = () => ({ operatorSection: 'ENY' })
  assert.equal(await sectionValue(), 'ENY')
})

test('a failed re-read keeps the section already read', async () => {
  settings = () => ({ operatorSection: 'ENY' })
  assert.equal(await sectionValue(), 'ENY')
  settings = hostGone
  assert.equal(await sectionValue(), 'ENY', 'a failed re-read must not blank the field')
})

async function header(ref: Record<string, unknown> = {}): Promise<string[]> {
  const operation = { uuid: 'op-1', stationCall: 'W1AW', refs: [{ type: 'fd', ref: '2026', ourClass: '2A', ourSection: 'CT', ...ref }] }
  const qsos = [{ uuid: 'q1', their: { call: 'K1AAA' }, band: '20m', mode: 'SSB', freq: 14250, startAtMillis: Date.UTC(2026, 5, 27, 19), refs: [] }]
  const result = (await fd.runHook('export', 'generateExport', { operation, qsos, exportType: 'fd-cabrillo' })) as { content: string }
  return result.content.split('\n').filter((line) => /^(NAME|EMAIL|CLUB):/.test(line))
}

test("the profile's name, email and club reach the Cabrillo header, and a club typed at setup wins", async () => {
  settings = () => ({ operatorName: 'Sam  Doe', operatorEmail: 'sam@example.com', operatorClub: 'Newington Amateur Radio League' })
  assert.deepEqual(await header(), ['CLUB: Newington Amateur Radio League', 'NAME: Sam Doe', 'EMAIL: sam@example.com'])
  assert.deepEqual(await header({ club: 'Hartford County ARES' }), ['CLUB: Hartford County ARES', 'NAME: Sam Doe', 'EMAIL: sam@example.com'])
})

test("an empty profile writes none of the three", async () => {
  settings = () => ({ operatorName: '', operatorEmail: '' })
  assert.deepEqual(await header(), [])
})

test("a host that cannot answer still exports the log", async () => {
  settings = hostGone
  assert.deepEqual(await header({ club: 'Hartford County ARES' }), ['CLUB: Hartford County ARES'])
})
