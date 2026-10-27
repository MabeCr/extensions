// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The activity, ref and logging hooks, the way the app calls them.

import { test } from "node:test"
import assert from "node:assert/strict"

import { fixtureOperation, loadExtension } from "./sdkGapTesting.ts"

const contest = await loadExtension(() => import("./index.ts"))

type Suggestion = { ref: string; name: string; label: string; shortLabel: string; selfSpotting?: boolean; assistance?: boolean }
type Control = { key: string; input: Record<string, unknown> & { form?: { elements: { key?: string; type?: string; value?: unknown; options?: { value: string }[] }[] } } }

// Monday 26 October 2026, 2300 UTC — two hours before the 0100 session.
const MONDAY_EVENING = Date.UTC(2026, 9, 26, 23)
// Thursday 29 October 2026, noon.
const THURSDAY = Date.UTC(2026, 9, 29, 12)

const configured = fixtureOperation({
  stationCall: 'KI2D',
  refs: [{ type: 'wwsac', ref: '2026-10-27', ourAgeGroup: 'OM', power: 'LOW' }],
})

test("unprompted, a session is offered only around its hour", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: MONDAY_EVENING })
  const near = (await contest.runHook("activity", "suggest", {})) as Suggestion[]
  assert.deepEqual(near.map((s) => s.ref), ['2026-10-27'])
  // Labelled as the operation will show it, and saying what the rules forbid.
  const decorated = (await contest.runHook("ref:wwsac", "decorateRef", { ref: { type: "wwsac", ref: near[0].ref } })) as Suggestion
  assert.equal(near[0].label, decorated.label)
  assert.equal(near[0].shortLabel, decorated.shortLabel)
  assert.equal(near[0].selfSpotting, false)
  assert.equal("assistance" in near[0], false)

  t.mock.timers.setTime(THURSDAY)
  assert.deepEqual(await contest.runHook("activity", "suggest", {}), [])
})

test("a search or a scoped picker finds the next sessions on any day", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: THURSDAY })
  const found = async (searchTerm: string) => ((await contest.runHook("activity", "suggest", { searchTerm })) as Suggestion[]).map((s) => s.ref)
  assert.deepEqual(await found('wwsac'), ['2026-11-03', '2026-11-10', '2026-11-17', '2026-11-24'])
  for (const term of ['WWSAC', 'wws', 'sideband activity', 'worldwide sideband activity contest', 'world wide sideband', 'wwsac 2026']) {
    assert.equal((await found(term)).length, 4, term)
  }
  for (const term of ['contest', 'cwt', 'ssb sprint', 'pota', 's', 'ww']) assert.deepEqual(await found(term), [], term)

  const scoped = (await contest.runHook("activity", "suggest", { searchTerm: '11-10', scoped: true })) as Suggestion[]
  assert.deepEqual(scoped.map((s) => s.ref), ['2026-11-10'])
})

test("an operation already running the WWSAC is offered nothing", async () => {
  assert.deepEqual(await contest.runHook("activity", "suggest", { operation: configured, searchTerm: "wwsac" }), [])
})

test("the setup asks for the session, our age group and power, and shows the rules", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: THURSDAY })
  const controls = (await contest.runHook("activity", "operationControls", { operation: fixtureOperation() })) as Control[]
  const elements = controls[0].input.form!.elements
  assert.deepEqual(elements.map((e) => e.key ?? e.type), ['ref', 'ourAgeGroup', 'markdown', 'power', 'markdown'])
  assert.equal(elements[0].value, '2026-11-03')
  assert.deepEqual(elements[1].options!.map((o) => o.value), ['', 'OM', 'YL', 'Y', 'YYL'])
  assert.match(String((elements[2] as { text?: string }).text), /Assistance: ON.*Self-spotting: OFF/)

  // A session long past stays selectable on its own operation.
  const old = (await contest.runHook("activity", "operationControls", { operation: configured })) as Control[]
  assert.equal(old[0].input.form!.elements[0].options![0].value, '2026-10-27')
})

test("the operation shows the session and the age group we send, or that it is missing", async () => {
  const decorate = async (ref: Record<string, unknown>) =>
    (await contest.runHook("ref:wwsac", "decorateRef", { ref: { type: 'wwsac', ...ref } })) as Record<string, unknown>
  const decorated = await decorate({ ref: '2026-10-27', ourAgeGroup: 'YYL' })
  assert.deepEqual([decorated.label, decorated.name], ['WWSAC', '2026-10-27 0100z · Youth YL (YYL)'])
  assert.equal(decorated.selfSpotting, false)
  assert.equal((await decorate({ ref: '2026-10-27' })).name, '2026-10-27 0100z · Not configured!')

  const title = await contest.runHook("ref:wwsac", "suggestOperationTitle", { ref: configured.refs![0 as never], operation: configured })
  assert.deepEqual(title, { for: 'WWSAC', subtitle: 'Sending OM' })

  assert.deepEqual(await contest.runHook("ref:wwsac", "validateRef", { ref: { type: 'wwsac', ref: '2026-10-27' } }), { valid: true, normalized: '2026-10-27' })
  assert.equal(((await contest.runHook("ref:wwsac", "validateRef", { ref: { type: 'wwsac', ref: '2026-10-26' } })) as { valid: boolean }).valid, false)
})

test("logging asks for their age group, suggesting the one they sent before", async () => {
  const asked: Record<string, unknown>[] = []
  const history = [
    { their: { call: 'K1YL' }, refs: [{ type: 'wwsac' }] },
    { their: { call: 'K1YL' }, refs: [{ type: 'wwsac', ageGroup: 'YL' }] },
  ]
  const ctx = {
    getHistoryForCall: async (_call: string, options: Record<string, unknown>) => {
      asked.push(options)
      return history
    },
  }
  const controls = (await contest.runHook("activity", "loggingControls", { operation: configured, qso: { their: { call: 'k1yl' } } }, { ctx })) as Control[]
  assert.deepEqual(controls.map((c) => c.key), ['wwsac/ageGroup'])
  assert.equal(controls[0].input.suggestedValue, 'YL')
  assert.equal(asked[0].refType, 'wwsac')

  // Nothing known: hinted as OM, never filled in as one.
  const fresh = (await contest.runHook("activity", "loggingControls", { operation: configured, qso: { their: { call: 'W1AW' } } }, { ctx: { getHistoryForCall: async () => [] } })) as Control[]
  assert.equal(fresh[0].input.suggestedValue, undefined)
  assert.equal(fresh[0].input.placeholder, 'OM')

  // A host that cannot answer costs the suggestion, not the field.
  const failing = (await contest.runHook("activity", "loggingControls", { operation: configured, qso: { their: { call: 'W1AW' } } }, { ctx: { getHistoryForCall: async () => { throw new Error('no') } } })) as Control[]
  assert.equal(failing[0].input.placeholder, 'OM')

  assert.deepEqual(await contest.runHook("activity", "loggingControls", { operation: fixtureOperation() }), [])
})

test("saving projects both age groups, spelling a typed one the rules' way", async () => {
  const asked: string[] = []
  const ctx = {
    getHistoryForCall: async (call: string) => {
      asked.push(call)
      return call === 'K1YL' ? [{ their: { call }, refs: [{ type: 'wwsac', ageGroup: 'YL' }] }] : []
    },
  }
  const save = (ref: Record<string, unknown>, call = 'K1AA') =>
    contest.runHook("activity", "processQsoBeforeSave", { operation: configured, qso: { their: { call }, refs: [{ type: 'wwsac', ...ref }] } }, { ctx })
  assert.deepEqual(await save({ ageGroup: 'YL' }), { our: { exchange: 'OM' }, refs: [{ type: 'wwsac', ageGroup: 'YL' }], their: { exchange: 'YL' } })
  assert.deepEqual(await save({ ageGroup: 'youth' }), { our: { exchange: 'OM' }, refs: [{ type: 'wwsac', ageGroup: 'Y' }], their: { exchange: 'Y' } })
  assert.deepEqual(await save({ ageGroup: 'ol' }), { our: { exchange: 'OM' }, refs: [{ type: 'wwsac', ageGroup: 'OL' }], their: { exchange: 'OL' } })
  // Emptied on purpose: the column is cleared too, and nothing is guessed over it.
  assert.deepEqual(await save({ ageGroup: '' }, 'K1YL'), { our: { exchange: 'OM' }, their: { exchange: '' } })
  assert.deepEqual(asked, [])

  // Never filled in — a call list, a call stack: the entry field's suggestion
  // is stamped, and with none their side is left alone.
  assert.deepEqual(await save({}, 'k1yl'), { our: { exchange: 'OM' }, refs: [{ type: 'wwsac', ageGroup: 'YL' }], their: { exchange: 'YL' } })
  assert.deepEqual(await save({}), { our: { exchange: 'OM' } })
  assert.deepEqual(asked, ['K1YL', 'K1AA'])

  assert.equal(await contest.runHook("activity", "processQsoBeforeSave", { operation: fixtureOperation(), qso: {} }), null)
})
