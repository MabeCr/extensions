// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The activity, ref, logging and export hooks, the way the app calls them.

import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"

import { fixtureOperation, loadExtension } from "./sdkGapTesting.ts"
import manifest from "../manifest.json" with { type: "json" }

const contest = await loadExtension(() => import("./index.ts"))

type Suggestion = { ref: string; name: string; label: string; shortLabel: string; selfSpotting?: boolean; assistance?: boolean }
type Control = { key: string; input: Record<string, unknown> & { form?: { elements: { key?: string; type?: string; value?: unknown; text?: string; options?: { value: string }[] }[] } } }

// Tuesday 27 October 2026, 2330 UTC — three hours before the 0230 session.
const TUESDAY_EVENING = Date.UTC(2026, 9, 27, 23, 30)
// Friday 30 October 2026, noon.
const FRIDAY = Date.UTC(2026, 9, 30, 12)

const configured = fixtureOperation({
  stationCall: 'KI2D',
  refs: [{ type: 'pwt', ref: '2026-10-28', ourName: 'SEB', ourLocation: 'NY' }],
})

test("unprompted, a session is offered only around its half hour", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: TUESDAY_EVENING })
  const near = (await contest.runHook("activity", "suggest", {})) as Suggestion[]
  assert.deepEqual(near.map((s) => s.ref), ['2026-10-28'])
  // Labelled as the operation will show it, and saying what the rules forbid.
  const decorated = (await contest.runHook("ref:pwt", "decorateRef", { ref: { type: "pwt", ref: near[0].ref } })) as Suggestion
  assert.equal(near[0].label, decorated.label)
  assert.equal(near[0].shortLabel, decorated.shortLabel)
  // Tapped and never set up, it says so, as the decorated row does.
  assert.equal(near[0].name, '2026-10-28 0230z · Not configured!')
  assert.equal(near[0].name, decorated.name)
  assert.equal(near[0].assistance, false)
  assert.equal(near[0].selfSpotting, false)

  t.mock.timers.setTime(FRIDAY)
  assert.deepEqual(await contest.runHook("activity", "suggest", {}), [])
})

test("a search or a scoped picker finds the next sessions on any day", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: FRIDAY })
  const found = async (searchTerm: string) => ((await contest.runHook("activity", "suggest", { searchTerm })) as Suggestion[]).map((s) => s.ref)
  assert.deepEqual(await found('phone weekly test'), ['2026-11-04', '2026-11-11', '2026-11-18', '2026-11-25'])
  for (const term of ['PWT', 'phone fray', 'fray', 'phone', 'weekly test', 'pho wee', 'phone weekly test 2026']) {
    assert.equal((await found(term)).length, 4, term)
  }
  // Nothing flickers away while a word is still being typed.
  for (const term of ['phone w', 'phone we', 'phone weekly t', 'phone weekly te', 'phone weekly tes', 'phone weekly c', 'pwt 2']) {
    assert.equal((await found(term)).length, 4, term)
  }
  for (const term of ['test', 'te', 'contest', 'naqp', 'cwt', 'phone sprint', 'phone x', 'ph', 'p', 'wwsac', 'test phone x']) assert.deepEqual(await found(term), [], term)

  const scoped = (await contest.runHook("activity", "suggest", { searchTerm: '11-11', scoped: true })) as Suggestion[]
  assert.deepEqual(scoped.map((s) => s.ref), ['2026-11-11'])
  assert.deepEqual(await contest.runHook("activity", "suggest", { operation: configured, searchTerm: "pwt" }), [])
})

test("the setup asks for the session and our exchange, and shows the rules", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: FRIDAY })
  const controls = (await contest.runHook("activity", "operationControls", { operation: fixtureOperation() })) as Control[]
  const elements = controls[0].input.form!.elements
  assert.deepEqual(elements.map((e) => e.key ?? e.type), ['ref', 'ourName', 'ourLocation', 'markdown', 'markdown'])
  assert.equal(elements[0].value, '2026-11-04')
  assert.match(String(elements[3].text), /Assistance: OFF.*Self-spotting: OFF/)
  assert.match(String(elements[4].text), /3830scores\.com.*48 hours/)

  // A session long past stays selectable on its own operation.
  const old = (await contest.runHook("activity", "operationControls", { operation: configured })) as Control[]
  assert.equal(old[0].input.form!.elements[0].options![0].value, '2026-10-28')
})

test("the operation shows the session and what we send, or that it is missing", async () => {
  const decorate = async (ref: Record<string, unknown>) =>
    (await contest.runHook("ref:pwt", "decorateRef", { ref: { type: 'pwt', ...ref } })) as Record<string, unknown>
  const decorated = await decorate({ ref: '2026-10-28', ourName: 'seb', ourLocation: 'ny' })
  assert.deepEqual([decorated.label, decorated.shortLabel, decorated.name], ['Phone Weekly Test', 'PWT', '2026-10-28 0230z · SEB NY'])
  assert.equal((await decorate({ ref: '2026-10-28', ourName: 'hans' })).name, '2026-10-28 0230z · HANS')
  assert.equal((await decorate({ ref: '2026-10-28', ourLocation: 'NY' })).name, '2026-10-28 0230z · Not configured!')
  assert.equal((await decorate({ ref: '2026-10-28', ourName: 'seb', ourLocation: 'n.y.' })).name, "2026-10-28 0230z · N.Y. isn't a location!")

  const title = await contest.runHook("ref:pwt", "suggestOperationTitle", { ref: configured.refs![0 as never], operation: configured })
  assert.deepEqual(title, { for: 'Phone Weekly Test', subtitle: 'Sending SEB NY' })

  assert.deepEqual(await contest.runHook("ref:pwt", "validateRef", { ref: { type: 'pwt', ref: '2026-10-28' } }), { valid: true, normalized: '2026-10-28' })
  assert.equal(((await contest.runHook("ref:pwt", "validateRef", { ref: { type: 'pwt', ref: '2026-10-27' } })) as { valid: boolean }).valid, false)
})

// Last week, K1ABC sent BOB NH.
const history = {
  getHistoryForCall: async (call: string) =>
    call === 'K1ABC' ? [{ their: { call }, startAtMillis: Date.UTC(2026, 9, 21, 2, 40), refs: [{ type: 'pwt', name: 'BOB', location: 'NH' }] }] : [],
}

test("logging asks for their name and location, suggesting what they sent before", async () => {
  const controls = (await contest.runHook("activity", "loggingControls", { operation: configured, qso: { their: { call: 'K1ABC', name: 'Robert Smith', state: 'CT' } } }, { ctx: history })) as Control[]
  assert.deepEqual(controls.map((c) => c.key), ['pwt/name', 'pwt/location'])
  assert.deepEqual(controls.map((c) => c.input.suggestedValue), ['BOB', 'CT'])

  const dx = (await contest.runHook("activity", "loggingControls", { operation: configured, qso: { their: { call: 'DL1ABC' } } }, { ctx: history })) as Control[]
  assert.deepEqual(dx.map((c) => c.input.suggestedValue), [undefined, 'DX'])

  assert.deepEqual(await contest.runHook("activity", "loggingControls", { operation: fixtureOperation() }), [])
})

test("saving stamps the guesses and projects both exchanges", async () => {
  const save = (ref: Record<string, unknown>, their: Record<string, unknown> = { call: 'K1ABC' }) =>
    contest.runHook("activity", "processQsoBeforeSave", { operation: configured, qso: { their, refs: [{ type: 'pwt', ...ref }] } }, { ctx: history })

  // Logged from a call list: last week's exchange is stamped.
  assert.deepEqual(await save({}), { our: { exchange: 'SEB NY' }, refs: [{ type: 'pwt', name: 'BOB', location: 'NH' }], their: { exchange: 'BOB NH' } })
  // What was typed wins, normalized; an emptied location stays empty.
  assert.deepEqual(await save({ name: 'rob', location: '' }), { our: { exchange: 'SEB NY' }, refs: [{ type: 'pwt', name: 'ROB' }], their: { exchange: 'ROB' } })
  // Nothing known and nothing typed: their side is left alone.
  assert.deepEqual(await save({}, { call: 'W9ZZZ' }), { our: { exchange: 'SEB NY' } })
  assert.equal(await contest.runHook("activity", "processQsoBeforeSave", { operation: fixtureOperation(), qso: {} }), null)
})

let delegated: { args: Record<string, unknown>; key: string | null | undefined }[] = []
const polo = (globalThis as unknown as { __polo: Record<string, unknown> }).__polo
polo.invokeLocal = async (_category: string, _method: string, args: Record<string, unknown>, _online: unknown, key?: string | null) => {
  delegated.push({ args, key })
  return [{ ok: true, value: { content: '<CALL:4>W1AW <EOR>' } }]
}
beforeEach(() => {
  delegated = []
})

test("the only export is the contest's ADIF — there are no logs to send", async () => {
  const options = (await contest.runHook('export', 'suggestExportOptions', { operation: configured, qsos: [] })) as { exportType: string; filename: string }[]
  assert.deepEqual(options.map((o) => o.exportType), ['pwt-adif'])
  assert.match(options[0].filename, /PWT-2026-10-28.*\.adi$/)

  await contest.runHook('export', 'generateExport', { operation: configured, qsos: [], exportType: 'pwt-adif' })
  assert.equal(delegated.length, 1)
  assert.equal(delegated[0].key, 'adif')
  assert.equal(delegated[0].args.mainHandler, manifest.key)

  assert.equal(((await contest.runHook('export', 'generateExport', { operation: configured, qsos: [], exportType: 'adif' })) as { content: string }).content, '')
})

test("each contact's ADIF carries the contest and both exchanges", async () => {
  const qso = { their: { call: 'K1ABC' }, refs: [{ type: 'pwt', name: 'bob', location: 'nh' }] }
  assert.deepEqual(await contest.runHook('adifFields', 'fieldsForOneQSO', { qso, operation: configured }), [
    { name: 'CONTEST_ID', value: 'PWT' },
    { name: 'STX_STRING', value: 'SEB NY' },
    { name: 'SRX_STRING', value: 'BOB NH' },
  ])
  assert.deepEqual(await contest.runHook('adifFields', 'fieldsForOneQSO', { qso, operation: { refs: [] } }), [])
})
