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

test("the activity search offers both runnings, the nearest first, dated and labelled as the operation will show them", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 19) })
  const suggestions = (await contest.runHook("activity", "suggest", { searchTerm: "arrl" })) as Suggestion[]
  // Ranked by the calendar, not by a fixed order.
  const ranked = [...suggestions].sort((a, b) => b.relevance - a.relevance).map((s) => s.mode)
  assert.deepEqual(ranked, ["CW", "Phone"])

  // Each names the weekend it runs: `description • date`.
  const dates = Object.fromEntries(suggestions.map((s) => [s.mode, s.name.split(" • ")[1]]))
  assert.deepEqual(dates, { CW: "2027-02-20", Phone: "2027-03-06" })

  // A label that differs from decorateRef's would change the moment the
  // operation is edited.
  for (const s of suggestions) {
    const decorated = (await contest.runHook("ref:arrl-dx", "decorateRef", { ref: { type: "arrl-dx", mode: s.mode } })) as Suggestion
    assert.equal(s.label, decorated.label)
    assert.equal(s.shortLabel, decorated.shortLabel)
  }
})

test("an operation already running the contest is offered nothing", async () => {
  // A suggestion has no `ref` for the picker's duplicate guard to match, so
  // tapping one would replace the configured ref and lose its setup.
  const configured = fixtureOperation({ stationCall: "N0DEV", refs: [{ type: "arrl-dx", mode: "CW" }] })
  assert.deepEqual(await contest.runHook("activity", "suggest", { operation: configured, searchTerm: "arrl" }), [])
})

test("the activity search stays out of unrelated searches", async () => {
  assert.deepEqual(await contest.runHook("activity", "suggest", { searchTerm: "pota" }), [])
})
