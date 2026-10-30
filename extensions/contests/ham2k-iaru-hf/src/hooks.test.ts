// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The activity search, through the `activity` HOOK the way the app calls it.
// A suggestion is persisted verbatim, so what it carries is what the operation
// row shows until the ref is next decorated.

import { test } from "node:test"
import assert from "node:assert/strict"

import { fixtureOperation, loadExtension } from "./sdkGapTesting.ts"

const contest = await loadExtension(() => import("./index.ts"))

type Suggestion = { mode?: string; name: string; label: string; shortLabel: string; relevance: number }

test("the activity search offers the one contest, dated and labelled as the operation will show them", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 19) })
  const suggestions = (await contest.runHook("activity", "suggest", { searchTerm: "iaru" })) as Suggestion[]
  assert.equal(suggestions.length, 1)
  assert.equal(suggestions[0].name.split(" • ")[1], "2027-07-10")

  // A label that differs from decorateRef's would change the moment the
  // operation is edited — and a new setup is a Mixed entry.
  const decorated = (await contest.runHook("ref:iaru-hf", "decorateRef", { ref: { type: "iaru-hf", modeRestriction: "Mixed" } })) as Suggestion
  assert.equal(suggestions[0].label, decorated.label)
  assert.equal(suggestions[0].shortLabel, decorated.shortLabel)
})

test("an operation already running the contest is offered nothing", async () => {
  // A suggestion has no `ref` for the picker's duplicate guard to match, so
  // tapping one would replace the configured ref and lose its setup.
  const configured = fixtureOperation({ stationCall: "N0DEV", refs: [{ type: "iaru-hf", modeRestriction: "Mixed", zone: "8" }] })
  assert.deepEqual(await contest.runHook("activity", "suggest", { operation: configured, searchTerm: "iaru" }), [])
})

test("the activity search stays out of unrelated searches", async () => {
  assert.deepEqual(await contest.runHook("activity", "suggest", { searchTerm: "pota" }), [])
})

test("the ref states the rules for its operator class, and only what they forbid", async () => {
  const decorate = async (extra: Record<string, unknown>) =>
    (await contest.runHook("ref:iaru-hf", "decorateRef", { ref: { type: "iaru-hf", modeRestriction: "Mixed", ...extra } })) as Record<string, unknown>

  // Multi-Two is the easy one to miss: it is a multi-operator class without
  // spotting assistance (HCAT.4.2.2).
  assert.equal((await decorate({ operator: "SINGLE-OP" })).assistance, false)
  assert.equal((await decorate({ operator: "MULTI-TWO" })).assistance, false)
  // A class that may use it drops the `false` an earlier class left behind.
  assert.equal("assistance" in (await decorate({ operator: "MULTI-ONE", assistance: false })), false)
  assert.equal("assistance" in (await decorate({ operator: "MULTI-HQ" })), false)
  // Nobody self-spots, whatever the class.
  assert.equal((await decorate({})).selfSpotting, false)

  const suggestions = (await contest.runHook("activity", "suggest", { searchTerm: "iaru" })) as Record<string, unknown>[]
  assert.ok(suggestions.length > 0 && suggestions.every((s) => s.selfSpotting === false && !("assistance" in s)))
})

test("the setup form's rules line follows the operator class", async () => {
  const controls = (await contest.runHook("activity", "operationControls", { operation: fixtureOperation({ refs: [] }) })) as {
    input: { form: { elements: { type: string; text?: string; visibleWhen?: { field: string; equals: unknown[] } }[] } }
  }[]
  const notes = controls[0].input.form.elements.filter((el) => el.type === "markdown")
  const shownFor = (op: string) => notes.filter((el) => el.visibleWhen?.equals.includes(op)).map((el) => el.text)
  assert.deepEqual(shownFor("MULTI-TWO"), ["🔴 Assistance: OFF, 🔴 Self-spotting: OFF"])
  assert.deepEqual(shownFor("SINGLE-OP-UNLIMITED"), ["🟢 Assistance: ON, 🔴 Self-spotting: OFF"])
})
