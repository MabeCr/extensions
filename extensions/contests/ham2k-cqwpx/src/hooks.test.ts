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

test("the activity search offers all three runnings, the nearest first, dated and labelled as the operation will show them", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 2, 1) })
  const suggestions = (await contest.runHook("activity", "suggest", { searchTerm: "wpx" })) as Suggestion[]
  // Ranked by the calendar, not by a fixed order.
  const ranked = [...suggestions].sort((a, b) => b.relevance - a.relevance).map((s) => s.mode)
  assert.deepEqual(ranked, ["SSB", "CW", "RTTY"])

  // Each names the weekend it runs: `description • date`.
  const dates = Object.fromEntries(suggestions.map((s) => [s.mode, s.name.split(" • ")[1]]))
  assert.deepEqual(dates, { SSB: "2026-03-28", CW: "2026-05-30", RTTY: "2027-02-13" })

  // A label that differs from decorateRef's would change the moment the
  // operation is edited.
  for (const s of suggestions) {
    const decorated = (await contest.runHook("ref:cqwpx", "decorateRef", { ref: { type: "cqwpx", mode: s.mode } })) as Suggestion
    assert.equal(s.label, decorated.label)
    assert.equal(s.shortLabel, decorated.shortLabel)
  }
})

test("an operation already running the contest is offered nothing", async () => {
  // A suggestion has no `ref` for the picker's duplicate guard to match, so
  // tapping one would replace the configured ref and lose its setup.
  const configured = fixtureOperation({ stationCall: "N0DEV", refs: [{ type: "cqwpx", mode: "CW" }] })
  assert.deepEqual(await contest.runHook("activity", "suggest", { operation: configured, searchTerm: "wpx" }), [])
})

test("the activity search stays out of unrelated searches", async () => {
  assert.deepEqual(await contest.runHook("activity", "suggest", { searchTerm: "pota" }), [])
})
