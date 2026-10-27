// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { OFFER_GRACE_MILLIS, OFFER_LEAD_MILLIS, relevanceFor, sessionAtHand, sessionDateLabel, sessionFor, sessionsFrom } from "./schedule.ts"

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

// Tuesday 27 October 2026, 0100 UTC — Monday evening in North America.
const TUE_0100 = Date.UTC(2026, 9, 27, 1)

describe("sessionFor", () => {
  it("resolves a Tuesday to its 0100–0159 UTC hour", () => {
    const session = sessionFor('2026-10-27')
    assert.equal(session?.startMillis, TUE_0100)
    assert.equal(session?.endMillis, TUE_0100 + HOUR)
    assert.equal(sessionDateLabel(session!), '2026-10-27 0100z')
  })

  it("accepts Tuesdays and nothing else", () => {
    // The Monday evening it is in North America is not the date it runs on.
    assert.equal(sessionFor('2026-10-26'), undefined)
    assert.equal(sessionFor('2026-10-28'), undefined)
    // Date.UTC(2026, 1, 31) rolls over to 3 March, a Tuesday.
    assert.equal(sessionFor('2026-02-31'), undefined)
    assert.ok(sessionFor('2026-03-03'))
  })

  it("rejects malformed keys", () => {
    for (const key of ['', undefined, 'WWSAC', '2026-10-27-0100', '26-10-27']) assert.equal(sessionFor(key), undefined, String(key))
  })
})

describe("sessionsFrom", () => {
  it("lists the coming Tuesdays, a week apart", () => {
    const keys = sessionsFrom(TUE_0100 - 2 * DAY, 3).map((s) => s.key)
    assert.deepEqual(keys, ['2026-10-27', '2026-11-03', '2026-11-10'])
  })

  it("keeps the session just worked first until its grace runs out", () => {
    const end = TUE_0100 + HOUR
    assert.equal(sessionsFrom(end + OFFER_GRACE_MILLIS - 1, 1)[0].key, '2026-10-27')
    assert.equal(sessionsFrom(end + OFFER_GRACE_MILLIS, 1)[0].key, '2026-11-03')
    // From any day of the week.
    for (let day = 0; day < 7; day += 1) {
      assert.equal(sessionsFrom(TUE_0100 + 2 * HOUR + day * DAY, 1)[0].key, '2026-11-03', `day ${day}`)
    }
  })
})

describe("sessionAtHand", () => {
  it("offers a session only from a few hours before it until an hour after", () => {
    assert.equal(sessionAtHand(TUE_0100 - OFFER_LEAD_MILLIS - 1), undefined)
    assert.equal(sessionAtHand(TUE_0100 - OFFER_LEAD_MILLIS)?.key, '2026-10-27')
    assert.equal(sessionAtHand(TUE_0100 + 30 * 60 * 1000)?.key, '2026-10-27')
    assert.equal(sessionAtHand(TUE_0100 + HOUR + OFFER_GRACE_MILLIS), undefined)
  })
})

describe("relevanceFor", () => {
  it("ranks sooner sessions higher, and the one under way highest", () => {
    const [first, second] = sessionsFrom(TUE_0100 - DAY, 2)
    assert.ok(relevanceFor(first, TUE_0100 - DAY) > relevanceFor(second, TUE_0100 - DAY))
    assert.equal(relevanceFor(first, TUE_0100 + 1), 1)
  })
})
