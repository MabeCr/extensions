// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The activity search's suggestions. Each is persisted VERBATIM and never runs
// through `decorateRef`, so the two have to compose the operation row alike.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

const contest = await loadExtension(() => import("./index.ts"))

test("each suggestion names the day its running opens, as decorateRef does", async (t) => {
  // October 2026: both of this year's runnings are past, so it offers 2027's.
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 19) })
  const suggestions = (await contest.runHook("activity", "suggest", { searchTerm: "field day" })) as {
    type: string
    ref: string
    name: string
  }[]

  const dates = Object.fromEntries(suggestions.map((s) => [s.ref, s.name.split(" • ")[1]]))
  assert.deepEqual(dates, { "CW-2027": "2027-06-05", "SSB-2027": "2027-09-04" })

  for (const suggestion of suggestions) {
    const decorated = (await contest.runHook("ref:r1-fd", "decorateRef", { ref: { type: suggestion.type, ref: suggestion.ref } })) as { name: string }
    assert.equal(decorated.name, suggestion.name)
  }
})

test("a non-assisted entry rules out spotting assistance; an assisted one leaves it to the operator", async () => {
  const decorate = async (extra: Record<string, unknown>) =>
    (await contest.runHook("ref:r1-fd", "decorateRef", { ref: { type: "r1-fd", ref: "R1FD-2026-CW", ...extra } })) as Record<string, unknown>

  // The Cabrillo header claims NON-ASSISTED unless the box is ticked, so an
  // untouched box is the non-assisted claim and the ref has to match it.
  assert.equal((await decorate({})).assistance, false)
  assert.equal((await decorate({ ourAssisted: false })).assistance, false)
  assert.equal("assistance" in (await decorate({ ourAssisted: true, assistance: false })), false)
  assert.equal("selfSpotting" in (await decorate({})), false)

  const controls = (await contest.runHook("activity", "operationControls", { operation: { refs: [] } })) as {
    input: { form: { elements: { type: string; key?: string; text?: string; visibleWhen?: { field: string; equals: unknown[] } }[] } }
  }[]
  const elements = controls[0].input.form.elements
  const notes = elements.filter((el) => el.visibleWhen?.field === "ourAssisted")
  const shownFor = (assisted: unknown) => notes.filter((el) => el.visibleWhen?.equals.includes(assisted)).map((el) => el.text)
  assert.deepEqual(shownFor(false), ["🔴 Assistance: OFF, 🟢 Self-spotting: ON"])
  assert.deepEqual(shownFor(true), ["🟢 Assistance: ON, 🟢 Self-spotting: ON"])
  // After the running, before the entry category.
  const at = (key: string) => elements.findIndex((el) => el.key === key)
  assert.ok(at("ref") < elements.indexOf(notes[0]) && elements.indexOf(notes[0]) < at("ourStationType"))
})

test("a suggestion, stored without being decorated, makes the same non-assisted claim as an untouched setup", async () => {
  const suggestions = (await contest.runHook("activity", "suggest", { searchTerm: "field day" })) as Record<string, unknown>[]
  assert.ok(suggestions.length > 0 && suggestions.every((s) => s.assistance === false))
})
