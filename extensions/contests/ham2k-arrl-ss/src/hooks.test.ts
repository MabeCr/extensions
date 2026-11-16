// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The activity, ref and logging hooks, the way the app calls them.

import { test } from "node:test"
import assert from "node:assert/strict"

import { fixtureOperation, loadExtension } from "./sdkGapTesting.ts"

const contest = await loadExtension(() => import("./index.ts"), { hostCalls: { getSettings: () => ({ operatorSection: 'eny' }) } })

type Suggestion = { mode?: string; name: string; label: string; shortLabel: string; relevance: number }
type Control = { key: string; label?: string; input: Record<string, unknown> & { form?: { elements: { type?: string; key?: string; value?: unknown }[] } } }

const configured = fixtureOperation({
  stationCall: 'N0DEV',
  refs: [{ type: 'arrl-ss', mode: 'CW', entry: 'SO-LOW', check: '79', section: 'CT' }],
})

test("the activity search offers both weekends, the nearest first, dated and labelled as the operation will show them", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 20) })
  const suggestions = (await contest.runHook("activity", "suggest", { searchTerm: "sweep" })) as Suggestion[]
  const ranked = [...suggestions].sort((a, b) => b.relevance - a.relevance).map((s) => s.mode)
  assert.deepEqual(ranked, ["CW", "SSB"])

  const dates = Object.fromEntries(suggestions.map((s) => [s.mode, s.name.split(" • ")[1]]))
  assert.deepEqual(dates, { CW: "2026-11-07", SSB: "2026-11-21" })

  // A label that differs from decorateRef's would change the moment the
  // operation is edited.
  for (const s of suggestions) {
    const decorated = (await contest.runHook("ref:arrl-ss", "decorateRef", { ref: { type: "arrl-ss", mode: s.mode } })) as Suggestion
    assert.equal(s.label, decorated.label)
    assert.equal(s.shortLabel, decorated.shortLabel)
  }
  assert.deepEqual(suggestions.map((s) => s.label), ["ARRL SS CW", "ARRL SS Phone"])
})

test("an operation already running the contest is offered nothing, and unrelated searches find nothing", async () => {
  assert.deepEqual(await contest.runHook("activity", "suggest", { operation: configured, searchTerm: "ss" }), [])
  assert.deepEqual(await contest.runHook("activity", "suggest", { searchTerm: "pota" }), [])
})

test("the setup seeds our section from the profile", async () => {
  const controls = (await contest.runHook("activity", "operationControls", { operation: fixtureOperation() })) as Control[]
  const elements = controls[0].input.form!.elements
  // The rules line, one note per verdict, sits between the exchange and the rest of the entry.
  assert.deepEqual(elements.map((e) => e.key ?? e.type), ['mode', 'entry', 'check', 'section', 'markdown', 'markdown', 'club'])
  assert.equal(elements.find((e) => e.key === 'section')!.value, 'ENY')
})

test("the operation shows the exchange we send", async () => {
  const decorated = (await contest.runHook("ref:arrl-ss", "decorateRef", { ref: configured.refs![0 as never] })) as { name: string; label: string }
  assert.equal(decorated.label, 'ARRL SS CW')
  assert.equal(decorated.name, 'A 79 CT')
  const title = (await contest.runHook("ref:arrl-ss", "suggestOperationTitle", { ref: { type: 'arrl-ss', mode: 'SSB', entry: 'MULTI-HIGH', check: '31', section: 'ENY' }, operation: configured })) as { for: string; subtitle: string }
  assert.deepEqual(title, { for: 'ARRL SS Phone', subtitle: 'M 31 ENY' })
})

test("logging asks for our serial, then theirs, precedence, check and section, in the order they are sent", async () => {
  const controls = (await contest.runHook("activity", "loggingControls", {
    operation: configured,
    qso: { their: { call: 'W1AW', state: 'CT' } },
  })) as Control[]
  assert.deepEqual(controls.map((c) => c.key), [
    'arrl-ss/ourSerial', 'arrl-ss/theirSerial', 'arrl-ss/theirPrecedence', 'arrl-ss/theirCheck', 'arrl-ss/theirSection',
  ])
  assert.deepEqual(controls.slice(0, 2).map((c) => c.label), ['Our #', 'Their #'])
  assert.equal(controls[0].input.kind, 'serial')
  assert.deepEqual(controls[4].input.preferredCodes, ['CT'])
  // Off-contest, nothing.
  assert.deepEqual(await contest.runHook("activity", "loggingControls", { operation: fixtureOperation() }), [])
})

test("saving projects only their exchange, so the QSO row shows what was copied rather than the same sent exchange on every line", async () => {
  const patch = await contest.runHook("activity", "processQsoBeforeSave", {
    operation: configured,
    qso: { their: { call: 'W9JJ' }, refs: [{ type: 'arrl-ss', ourSerial: 123, theirSerial: '043', theirPrecedence: 'm', theirCheck: '31', theirSection: 'il' }] },
  })
  assert.deepEqual(patch, { their: { exchange: '43 M 31 IL', state: 'IL', arrlSection: 'IL' } })

  // Nothing of theirs entered yet: nothing projects.
  const ours = await contest.runHook("activity", "processQsoBeforeSave", {
    operation: configured,
    qso: { their: { call: 'W9JJ' }, refs: [{ type: 'arrl-ss', ourSerial: 7 }] },
  })
  assert.equal(ours, null)
})

test("their State is filled from the section they sent", async () => {
  const stateFor = async (call: string, section: string, state?: string) => {
    const patch = (await contest.runHook("activity", "processQsoBeforeSave", {
      operation: configured,
      qso: { their: { call, ...(state ? { state } : {}) }, refs: [{ type: 'arrl-ss', theirSerial: '1', theirPrecedence: 'A', theirCheck: '79', theirSection: section }] },
    })) as { their: Record<string, string> }
    return patch.their.state
  }
  // A section that is its state, one of a split state's, and a Canadian one.
  assert.equal(await stateFor('W1AW', 'CT'), 'CT')
  assert.equal(await stateFor('K6ABC', 'sdg'), 'CA')
  assert.equal(await stateFor('W2ABC', 'NLI'), 'NY')
  assert.equal(await stateFor('VE3ABC', 'GH'), 'ON')
  assert.equal(await stateFor('VE2ABC', 'QC'), 'QC')
  // The section is the station's own word, so it replaces a lookup's state...
  assert.equal(await stateFor('K6ABC', 'SDG', 'NY'), 'CA')
  // ...and one already right is left alone.
  assert.equal(await stateFor('K6ABC', 'SDG', 'CA'), undefined)
  // MDC is Maryland and DC both: a DC station stays DC.
  assert.equal(await stateFor('W3ABC', 'MDC'), 'MD')
  assert.equal(await stateFor('W3ABC', 'MDC', 'DC'), undefined)
  // PAC is Hawaii, but not for a Pacific possession.
  assert.equal(await stateFor('KH6ABC', 'PAC'), 'HI')
  assert.equal(await stateFor('AH6Y', 'PAC'), 'HI')
  assert.equal(await stateFor('KH2ABC', 'PAC'), undefined)
  // No single state: Puerto Rico, the Virgin Islands, the Territories.
  for (const [call, section] of [['KP4ABC', 'PR'], ['KP2ABC', 'VI'], ['VY1ABC', 'TER']]) {
    assert.equal(await stateFor(call, section), undefined, section)
  }
  // Nor does a section that isn't one.
  assert.equal(await stateFor('W9JJ', 'ILL'), undefined)
})

test("a part that isn't a valid value is kept as typed, so the exchange never looks complete when it isn't", async () => {
  const patch = await contest.runHook("activity", "processQsoBeforeSave", {
    operation: fixtureOperation({ refs: [{ type: 'arrl-ss', mode: 'CW', entry: 'SO-LOW', check: '1979', section: 'NYC' }] }),
    qso: { their: { call: 'W9JJ' }, refs: [{ type: 'arrl-ss', ourSerial: 1, theirSerial: '43', theirPrecedence: 'x', theirCheck: '7', theirSection: 'ill' }] },
  })
  assert.deepEqual(patch, { their: { exchange: '43 X 7 ILL' } })
})

test("an unknown section is flagged in the entry field rather than accepted", async () => {
  const controls = (await contest.runHook("activity", "loggingControls", { operation: configured, qso: { their: { call: 'W1AW' } } })) as Control[]
  assert.notEqual(controls[4].input.allowFreeform, true)
})

test("the ref states the rules for its entry, and only what they forbid", async () => {
  const decorate = async (extra: Record<string, unknown>) =>
    (await contest.runHook("ref:arrl-ss", "decorateRef", { ref: { type: "arrl-ss", mode: "CW", ...extra } })) as Record<string, unknown>

  // Every single-operator power class is unassisted, QRP included.
  for (const entry of ["SO-QRP", "SO-LOW", "SO-HIGH"]) assert.equal((await decorate({ entry })).assistance, false, entry)
  // An entry that may use spots drops the `false` an earlier one left behind.
  assert.equal("assistance" in (await decorate({ entry: "SOU-LOW", assistance: false })), false)
  assert.equal("assistance" in (await decorate({ entry: "SCHOOL" })), false)
  // Self-spotting is the operator's call in Sweepstakes.
  assert.equal("selfSpotting" in (await decorate({ entry: "SO-LOW" })), false)
})

test("the setup form's rules line follows the entry", async () => {
  const controls = (await contest.runHook("activity", "operationControls", { operation: fixtureOperation({ refs: [] }) })) as {
    input: { form: { elements: { type: string; text?: string; visibleWhen?: { field: string; equals: unknown[] } }[] } }
  }[]
  const notes = controls[0].input.form.elements.filter((el) => el.type === "markdown")
  const shownFor = (entry: string) => notes.filter((el) => el.visibleWhen?.equals.includes(entry)).map((el) => el.text)
  assert.deepEqual(shownFor("SO-HIGH"), ["🔴 Assistance: OFF, 🟢 Self-spotting: ON"])
  assert.deepEqual(shownFor("MULTI-LOW"), ["🟢 Assistance: ON, 🟢 Self-spotting: ON"])
})

/// How the app compiles an exchange pattern: anchored, case-insensitive.
const anchored = (source: unknown) => new RegExp(`^(?:${source as string})$`, 'i')

test("our serial carries the rest of what we send, and sits out the Space walk", async () => {
  const controls = (await contest.runHook("activity", "loggingControls", { operation: configured, qso: { their: { call: 'W1AW' } } })) as Control[]
  const ours = controls.find((c) => c.key === 'arrl-ss/ourSerial')! as Control & { skipFocus?: boolean }
  // Precedence, OUR CALL, check, section: what goes out after the number, in
  // the order it is sent. Without the call the operator reads a wrong exchange.
  assert.equal(ours.input.ourExchange, 'A N0DEV 79 CT')
  // Seen only while no number is held, so it says a number goes first; the
  // host adds our exchange after it while the operator includes it.
  assert.equal(ours.input.placeholder, '#')
  // The sequence fills it; Space and Tab go from the call to their exchange.
  assert.equal(ours.skipFocus, true)
})

test("our serial's field grows a digit once the series passes 999", async () => {
  const qsoWith = (serial: number) => ({ refs: [{ type: 'arrl-ss', ourSerial: serial }] })
  const widthAt = async (serials: number[]) => {
    const controls = (await contest.runHook(
      "activity",
      "loggingControls",
      { operation: { ...configured, uuid: 'op-1' }, qso: { their: { call: 'W1AW' } } },
      { ctx: { getQsos: async () => serials.map(qsoWith) } as never },
    )) as Control[]
    return (controls.find((c) => c.key === 'arrl-ss/ourSerial')!.input.chars as { min: number }).min
  }
  // 3 digits for the first 999 contacts gives the row's room to the fields
  // still to be copied; the 1000th must not be clipped.
  assert.equal(await widthAt([]), 3)
  assert.equal(await widthAt([998]), 3)
  assert.equal(await widthAt([999]), 4)
})

test("their exchange is one group typed straight through: 4A20ENY splits into its four parts", async () => {
  const controls = (await contest.runHook("activity", "loggingControls", { operation: configured, qso: { their: { call: 'W1AW' } } })) as (Control & { group?: string })[]
  const their = controls.filter((c) => c.key !== 'arrl-ss/ourSerial')
  assert.deepEqual(their.map((c) => c.group), ['their', 'their', 'their', 'their'])
  const [serial, precedence, check] = their.map((c) => c.input)
  // A letter ends the serial and goes on to the precedence…
  assert.ok(!anchored(serial.autoadvanceBefore).test('4'))
  assert.ok(anchored(serial.autoadvanceBefore).test('4A'))
  // …a valid precedence moves on by itself…
  assert.ok(anchored(precedence.autoadvanceWhen).test('a'))
  assert.ok(!anchored(precedence.autoadvanceWhen).test('X'))
  // …and so does the check, at two digits.
  assert.ok(!anchored(check.autoadvanceWhen).test('2'))
  assert.ok(anchored(check.autoadvanceWhen).test('20'))
})

test("editing a contact that holds a copy of ours clears it", async () => {
  const patch = await contest.runHook("activity", "processQsoBeforeSave", {
    operation: configured,
    qso: { their: { call: 'W9JJ' }, our: { exchange: '123 A 79 CT' }, refs: [{ type: 'arrl-ss', ourSerial: 124, theirSerial: '43', theirPrecedence: 'M', theirCheck: '31', theirSection: 'IL' }] },
  })
  // Left alone, the row would keep showing 123 after the serial became 124.
  assert.deepEqual(patch, { their: { exchange: '43 M 31 IL', state: 'IL', arrlSection: 'IL' }, our: { exchange: '' } })
})
