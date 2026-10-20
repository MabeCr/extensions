// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The activity search's suggestion. It is persisted VERBATIM and never runs
// through `decorateRef`, so what it says is what the operation row shows.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

const contest = await loadExtension(() => import("./index.ts"))

test("the suggestion names the day the next running opens", async (t) => {
  // October 2026: this September's running is past, so it offers next year's.
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 19) })
  const [suggestion] = (await contest.runHook("activity", "suggest", { searchTerm: "field day" })) as {
    ref: string
    name: string
  }[]

  assert.equal(suggestion.ref, "2027")
  assert.equal(suggestion.name.split(" • ")[1], "2027-09-04")
})
