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
