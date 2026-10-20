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
