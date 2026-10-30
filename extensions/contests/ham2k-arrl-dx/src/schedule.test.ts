// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The weekends are computed from the rules' wording rather than read from a
// table, so these pin the result against the sponsor's published dates.

import { strict as assert } from "node:assert"
import { describe, it } from "node:test"

import { endOfContest, nearestMode, nextContestDate, relevanceFor, startOfContest } from "./schedule.ts"

const DAY = 24 * 60 * 60 * 1000

describe("startOfContest", () => {
  it("runs CW on the third full weekend of February and Phone on the first of March", () => {
    assert.equal(startOfContest(2026, "CW"), Date.UTC(2026, 1, 21))
    assert.equal(startOfContest(2026, "Phone"), Date.UTC(2026, 2, 7))
    assert.equal(startOfContest(2027, "CW"), Date.UTC(2027, 1, 20))
    assert.equal(startOfContest(2027, "Phone"), Date.UTC(2027, 2, 6))
  })

  it("runs for 48 hours", () => {
    assert.equal(endOfContest(2026, "CW") - startOfContest(2026, "CW"), 2 * DAY)
  })
})

describe("nextContestDate", () => {
  it("names this year's weekend until three days after it, then next year's", () => {
    assert.equal(nextContestDate(Date.UTC(2026, 0, 15), "CW"), "2026-02-21")
    assert.equal(nextContestDate(endOfContest(2026, "CW") + 2 * DAY, "CW"), "2026-02-21")
    assert.equal(nextContestDate(endOfContest(2026, "CW") + 4 * DAY, "CW"), "2027-02-20")
  })
})

describe("relevance", () => {
  it("defaults the setup to the running nearest on the calendar", () => {
    assert.equal(nearestMode(Date.UTC(2026, 0, 15)), "CW")
    // The day after CW, the default is the Phone weekend coming up.
    assert.equal(nearestMode(endOfContest(2026, "CW") + DAY), "Phone")
    assert.equal(relevanceFor(startOfContest(2026, "Phone") + DAY, "Phone"), 1)
  })
})
