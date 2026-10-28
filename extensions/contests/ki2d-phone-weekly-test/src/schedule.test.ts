// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The rule as configured — the schedule's own behaviour is
// `@ham2k/lib-weekly-contest`'s, and tested there.

import assert from "node:assert/strict"
import { test } from "node:test"

import { sessionDateLabel, sessionFor, sessionsFrom } from "./schedule.ts"

const MINUTE = 60 * 1000

// Wednesday 28 October 2026, 0230 UTC — Tuesday evening in North America.
const WED_0230 = Date.UTC(2026, 9, 28, 2, 30)

test("a Wednesday is its 0230–0300 UTC half hour", () => {
  const session = sessionFor('2026-10-28')
  assert.equal(session?.startMillis, WED_0230)
  assert.equal(session?.endMillis, WED_0230 + 30 * MINUTE)
  assert.equal(sessionDateLabel(session!), '2026-10-28 0230z')
})

test("Wednesdays and nothing else", () => {
  // The Tuesday evening it is in North America is not the date it runs on.
  assert.equal(sessionFor('2026-10-27'), undefined)
  assert.equal(sessionFor('2026-10-29'), undefined)
  // Date.UTC(2027, 1, 31) rolls over to 3 March 2027, a Wednesday.
  assert.equal(sessionFor('2027-02-31'), undefined)
  assert.ok(sessionFor('2027-03-03'))
  for (const key of ['', undefined, 'PWT', '2026-10-28-0230', '26-10-28']) assert.equal(sessionFor(key), undefined, String(key))
})

test("the coming Wednesdays, a week apart, this one from the same UTC day", () => {
  assert.deepEqual(sessionsFrom(Date.UTC(2026, 9, 28, 0, 5), 3).map((s) => s.key), ['2026-10-28', '2026-11-04', '2026-11-11'])
})
