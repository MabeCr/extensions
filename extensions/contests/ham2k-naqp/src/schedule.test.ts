// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The weekends are computed from the rules' contest calendar rather than read
// from a table, so these pin the result against the published 2026 dates —
// including February's RTTY, which starts on the month's last Saturday even
// when its Sunday is in March.

import { strict as assert } from "node:assert"
import { describe, it } from "node:test"

import { isContestOn, nearestMode, nextContestDate, relevanceFor, startsOfContest } from "./schedule.ts"

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000

describe("startsOfContest", () => {
  it("matches the 2026 contest calendar, from 1800 UTC Saturday", () => {
    assert.deepEqual(startsOfContest(2026, "CW"), [Date.UTC(2026, 0, 10, 18), Date.UTC(2026, 7, 1, 18)])
    assert.deepEqual(startsOfContest(2026, "SSB"), [Date.UTC(2026, 0, 17, 18), Date.UTC(2026, 7, 15, 18)])
    assert.deepEqual(startsOfContest(2026, "RTTY"), [Date.UTC(2026, 1, 28, 18), Date.UTC(2026, 6, 18, 18)])
  })

  it("runs for twelve hours, to 0559 UTC Sunday", () => {
    const [january] = startsOfContest(2026, "CW")
    assert.equal(isContestOn(january + 12 * HOUR - 1, "CW"), true)
    assert.equal(isContestOn(january + 12 * HOUR, "CW"), false)
  })
})

describe("nextContestDate", () => {
  it("names each mode's next running, of the two it has each year", () => {
    const now = Date.UTC(2026, 9, 19)
    assert.equal(nextContestDate(now, "CW"), "2027-01-09")
    assert.equal(nextContestDate(now, "SSB"), "2027-01-16")
    assert.equal(nextContestDate(now, "RTTY"), "2027-02-27")
    assert.equal(nextContestDate(Date.UTC(2026, 3, 1), "CW"), "2026-08-01")
  })

  it("keeps a finished running for three days, then moves on", () => {
    const [january] = startsOfContest(2026, "SSB")
    assert.equal(nextContestDate(january + 2 * DAY, "SSB"), "2026-01-17")
    assert.equal(nextContestDate(january + 4 * DAY, "SSB"), "2026-08-15")
  })
})

describe("relevance", () => {
  it("ranks a running on the air first, and defaults the setup to the soonest", () => {
    const [, august] = startsOfContest(2026, "SSB")
    assert.equal(relevanceFor(august + HOUR, "SSB"), 1)
    assert.equal(nearestMode(Date.UTC(2026, 0, 1)), "CW")
    // The day after January's CW, SSB is next.
    assert.equal(nearestMode(Date.UTC(2026, 0, 12)), "SSB")
    assert.equal(nearestMode(Date.UTC(2026, 1, 1)), "RTTY")
  })
})
