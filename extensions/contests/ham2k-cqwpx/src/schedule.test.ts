// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The weekends are computed from a rule rather than read from a table, so
// these pin the result against the sponsor's published dates. The trap is
// "last FULL weekend": when a month ends on a Saturday, that Saturday's Sunday
// is in the next month, so the contest runs the weekend before.

import { strict as assert } from "node:assert"
import { describe, it } from "node:test"

import { endOfContest, nearestMode, nextContestDate, startOfContest } from "./schedule.ts"

const DAY = 24 * 60 * 60 * 1000

describe("startOfContest", () => {
  it("matches the published 2026 weekends", () => {
    assert.equal(startOfContest(2026, "RTTY"), Date.UTC(2026, 1, 14))
    assert.equal(startOfContest(2026, "SSB"), Date.UTC(2026, 2, 28))
    assert.equal(startOfContest(2026, "CW"), Date.UTC(2026, 4, 30))
  })

  it("skips a Saturday on the month's last day", () => {
    // 2025: May 31 is a Saturday, so CW was the 24th.
    assert.equal(startOfContest(2025, "CW"), Date.UTC(2025, 4, 24))
  })

  it("runs for 48 hours", () => {
    assert.equal(endOfContest(2026, "SSB") - startOfContest(2026, "SSB"), 2 * DAY)
  })
})

describe("nextContestDate", () => {
  it("names this year's weekend until three days after it, then next year's", () => {
    assert.equal(nextContestDate(endOfContest(2026, "CW") + 2 * DAY, "CW"), "2026-05-30")
    assert.equal(nextContestDate(endOfContest(2026, "CW") + 4 * DAY, "CW"), "2027-05-29")
  })
})

describe("nearestMode", () => {
  it("defaults the setup to the running nearest on the calendar", () => {
    assert.equal(nearestMode(Date.UTC(2026, 0, 15)), "RTTY")
    assert.equal(nearestMode(endOfContest(2026, "RTTY") + DAY), "SSB")
    assert.equal(nearestMode(Date.UTC(2026, 3, 15)), "CW")
    // After CW, the list reads "what is coming": next February's RTTY.
    assert.equal(nearestMode(Date.UTC(2026, 9, 19)), "RTTY")
  })
})
