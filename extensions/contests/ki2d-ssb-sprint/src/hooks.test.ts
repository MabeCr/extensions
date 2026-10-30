// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The activity, ref and logging hooks, the way the app calls them.

import { test } from "node:test"
import assert from "node:assert/strict"

import { fixtureOperation, loadExtension } from "./sdkGapTesting.ts"

const contest = await loadExtension(() => import("./index.ts"), { hostCalls: { getSettings: () => ({ operatorName: 'Sebastian Delmont' }) } })

type Suggestion = { name: string; label: string; shortLabel: string; relevance: number }
type Control = { key: string; skipFocus?: boolean; input: Record<string, unknown> & { form?: { elements: { key?: string; value?: unknown }[] } } }

const configured = fixtureOperation({
  stationCall: 'KI2D',
  refs: [{ type: 'ssb-sprint', ourName: 'SEB', ourLocation: 'NY', operator: 'SINGLE-OP', power: 'LOW' }],
})

test("the activity search offers the next Sprint, dated and labelled as the operation will show it", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 26) })
  const suggestions = (await contest.runHook("activity", "suggest", { searchTerm: "sprint" })) as Suggestion[]
  assert.equal(suggestions.length, 1)
  assert.equal(suggestions[0].name.split(" • ")[1], "2026-11-01 0000Z")

  const decorated = (await contest.runHook("ref:ssb-sprint", "decorateRef", { ref: { type: "ssb-sprint" } })) as Suggestion
  assert.equal(suggestions[0].label, decorated.label)
  assert.equal(suggestions[0].shortLabel, decorated.shortLabel)
})

test("the search finds the Sprint by any of its words, in any order", async () => {
  const found = async (searchTerm: string) => ((await contest.runHook("activity", "suggest", { searchTerm })) as Suggestion[]).length === 1
  for (const term of ['sprint', 'SSB Sprint', 'sprint ssb', 'na ssb sprint', 'ssb sprint 2026', 'NA-SPRINT-SSB', 'spr']) {
    assert.ok(await found(term), term)
  }
  // Too short to be the start of anything but an exact word: SS is Sweepstakes.
  for (const term of ['cw sprint', 'naqp', '2026', 'ss', 's', 'n', 'p']) assert.ok(!(await found(term)), term)
})

test("an operation already running the Sprint is offered nothing, and unrelated searches find nothing", async () => {
  assert.deepEqual(await contest.runHook("activity", "suggest", { operation: configured, searchTerm: "sprint" }), [])
  assert.deepEqual(await contest.runHook("activity", "suggest", { searchTerm: "pota" }), [])
})

test("the setup seeds our name from the profile", async () => {
  const controls = (await contest.runHook("activity", "operationControls", { operation: fixtureOperation() })) as Control[]
  const elements = controls[0].input.form!.elements
  assert.deepEqual(elements.filter((e) => e.key).map((e) => e.key), ['ourName', 'ourLocation', 'operator', 'power'])
  // The rules line, one note per verdict, sits between the exchange and the entry.
  assert.deepEqual(elements.slice(2, 5).map((e) => e.key ?? (e as { type?: string }).type), ['markdown', 'markdown', 'operator'])
  assert.equal(elements.find((e) => e.key === 'ourName')!.value, 'SEBASTIAN')
  // Our location is checked against the Sprint's own list as it is typed.
  const codes = ((elements.find((e) => e.key === 'ourLocation') as { suggestions?: { code: string }[] }).suggestions ?? []).map((s) => s.code)
  for (const code of ['NY', 'ON', 'XE', 'HI3', 'DX']) assert.ok(codes.includes(code), code)
})

test("the operation shows the exchange we send", async () => {
  const decorated = (await contest.runHook("ref:ssb-sprint", "decorateRef", { ref: configured.refs![0 as never] })) as { name: string; label: string }
  assert.deepEqual([decorated.label, decorated.name], ['SSB Sprint', 'SEB NY'])
  const title = (await contest.runHook("ref:ssb-sprint", "suggestOperationTitle", { ref: configured.refs![0 as never], operation: configured })) as { for: string; subtitle: string }
  assert.deepEqual(title, { for: 'SSB Sprint', subtitle: 'SEB in NY' })
})

test("logging asks for our serial, then their serial, name and location, guessing the last two", async () => {
  const controls = (await contest.runHook("activity", "loggingControls", {
    operation: configured,
    qso: { their: { call: 'W1AW', state: 'CT', name: 'Hiram Maxim' } },
  })) as Control[]
  assert.deepEqual(controls.map((c) => c.key), ['ssb-sprint/ourSerial', 'ssb-sprint/theirSerial', 'ssb-sprint/name', 'ssb-sprint/location'])
  assert.equal(controls[0].input.kind, 'serial')
  assert.equal(controls[0].skipFocus, true)
  assert.equal(controls[2].input.suggestedValue, 'HIRAM')
  assert.equal(controls[3].input.suggestedValue, 'CT')
  assert.deepEqual(await contest.runHook("activity", "loggingControls", { operation: fixtureOperation() }), [])
})

test("saving stamps the guesses and projects both exchanges", async () => {
  const patch = await contest.runHook("activity", "processQsoBeforeSave", {
    operation: configured,
    qso: { their: { call: 'W1AW', state: 'CT', name: 'Hiram' }, refs: [{ type: 'ssb-sprint', ourSerial: 154, theirSerial: '0122' }] },
  })
  assert.deepEqual(patch, {
    our: { exchange: '154' },
    refs: [{ type: 'ssb-sprint', name: 'HIRAM', location: 'CT' }],
    their: { exchange: '122 HIRAM CT' },
  })

  // A location the operator emptied stays empty — the patch never writes over
  // it — and what they typed wins.
  const typed = await contest.runHook("activity", "processQsoBeforeSave", {
    operation: configured,
    qso: { their: { call: 'W1AW', state: 'CT' }, refs: [{ type: 'ssb-sprint', ourSerial: 2, theirSerial: '5', name: 'bill', location: '' }] },
  })
  assert.deepEqual(typed, {
    our: { exchange: '2' },
    refs: [{ type: 'ssb-sprint', name: 'BILL' }],
    their: { exchange: '5 BILL' },
  })

  // A serial the core has yet to allocate is left alone, not blanked.
  const later = await contest.runHook("activity", "processQsoBeforeSave", {
    operation: configured,
    qso: { their: { call: 'W1AW' }, refs: [{ type: 'ssb-sprint', theirSerial: '7', name: 'HAL', location: 'CT' }] },
  })
  assert.deepEqual(later, {
    refs: [{ type: 'ssb-sprint', name: 'HAL', location: 'CT' }],
    their: { exchange: '7 HAL CT' },
  })
})

test("the ref states the rules for its entry: no spotting assistance but for a check log", async () => {
  const decorate = async (extra: Record<string, unknown>) =>
    (await contest.runHook("ref:ssb-sprint", "decorateRef", { ref: { type: "ssb-sprint", ...extra } })) as Record<string, unknown>

  assert.equal((await decorate({ operator: "SINGLE-OP" })).assistance, false)
  assert.equal((await decorate({})).assistance, false)
  // A check log may, and drops the `false` an earlier entry left behind.
  assert.equal("assistance" in (await decorate({ operator: "CHECKLOG", assistance: false })), false)
  // Self-spotting is the operator's call in the Sprint.
  assert.equal("selfSpotting" in (await decorate({ operator: "SINGLE-OP" })), false)
})
