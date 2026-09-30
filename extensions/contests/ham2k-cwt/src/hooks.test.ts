// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The date gate through the `suggest` HOOK, with the clock parked on a chosen
// day. schedule.test.ts proves the arithmetic; this proves the hook applies it
// to the right asks. Two traps: a hook that skips the gate heads the nearby
// list six days a week, and a hook that ignores `scoped` answers the
// extension's own "Activity Types" row with nothing on those same six days —
// both asks arrive with no search term, so `scoped` is the only thing telling
// them apart.

import { test } from "node:test"
import assert from "node:assert/strict"

import { fixtureOperation, loadExtension } from "./sdkGapTesting.ts"

const cwt = await loadExtension(() => import("./index.ts"))

// Monday 24 August 2026, and the Wednesday of that week — a CWT day.
const MONDAY_NOON = Date.UTC(2026, 7, 24, 12)
const WEDNESDAY = (hour: number, minute = 0) => Date.UTC(2026, 7, 26, hour, minute)

interface Suggestion {
  type: string
  ref: string
  shortLabel: string
  relevance: number
}

const suggest = async (args: Record<string, unknown> = {}) =>
  (await cwt.runHook("activity", "suggest", { operation: fixtureOperation(), ...args })) as Suggestion[]

test("offers nothing unprompted on a day with no session", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: MONDAY_NOON })
  assert.deepEqual(await suggest(), [])
})

test("offers nothing unprompted more than three hours before a session", async (t) => {
  // A CWT day, but the 1300 is still four hours out.
  t.mock.timers.enable({ apis: ["Date"], now: WEDNESDAY(9) })
  assert.deepEqual(await suggest(), [])
})

test("offers exactly the session at hand once its lead window opens", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: WEDNESDAY(10, 30) })
  const suggestions = await suggest()
  assert.equal(suggestions.length, 1)
  assert.equal(suggestions[0].type, "cwt")
  assert.equal(suggestions[0].ref, "2026-08-26-1300")
  assert.equal(suggestions[0].shortLabel, "CWT 1300z")
})

test("a scoped ask is answered on a day the nearby list stays silent", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: MONDAY_NOON })
  assert.deepEqual(await suggest(), [])

  const scoped = await suggest({ scoped: true })
  assert.equal(scoped.length, 4, "a scope offers the next four sessions on any day")

  // The picker ranks these on `relevance` alone, so the order emitted has to
  // already be the order they run in — and a Monday's next session is
  // Wednesday's 1300.
  const refs = scoped.map((s) => s.ref)
  assert.equal(new Set(refs).size, 4)
  assert.deepEqual(refs, [...refs].sort())
  assert.deepEqual(refs, ["2026-08-26-1300", "2026-08-26-1900", "2026-08-27-0300", "2026-08-27-0700"])
})
