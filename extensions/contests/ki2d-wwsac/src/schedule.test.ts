// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The rule as configured — the schedule's own behaviour is
// `@ham2k/lib-weekly-contest`'s, and tested there.

import assert from "node:assert/strict"
import { test } from "node:test"

import { sessionDateLabel, sessionFor, sessionsFrom } from "./schedule.ts"

const HOUR = 60 * 60 * 1000

// Tuesday 27 October 2026, 0100 UTC — Monday evening in North America.
const TUE_0100 = Date.UTC(2026, 9, 27, 1)

test("a Tuesday is its 0100–0159 UTC hour", () => {
  const session = sessionFor('2026-10-27')
  assert.equal(session?.startMillis, TUE_0100)
  assert.equal(session?.endMillis, TUE_0100 + HOUR)
  assert.equal(sessionDateLabel(session!), '2026-10-27 0100z')
})

test("Tuesdays and nothing else", () => {
  // The Monday evening it is in North America is not the date it runs on.
  assert.equal(sessionFor('2026-10-26'), undefined)
  assert.equal(sessionFor('2026-10-28'), undefined)
  // Date.UTC(2026, 1, 31) rolls over to 3 March, a Tuesday.
  assert.equal(sessionFor('2026-02-31'), undefined)
  assert.ok(sessionFor('2026-03-03'))
  for (const key of ['', undefined, 'WWSAC', '2026-10-27-0100', '26-10-27']) assert.equal(sessionFor(key), undefined, String(key))
})

test("the coming Tuesdays, a week apart, this one from the same UTC day", () => {
  assert.deepEqual(sessionsFrom(Date.UTC(2026, 9, 27, 0, 5), 3).map((s) => s.key), ['2026-10-27', '2026-11-03', '2026-11-10'])
})
