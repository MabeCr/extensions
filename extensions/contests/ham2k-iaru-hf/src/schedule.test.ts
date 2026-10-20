// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The weekend is computed from the rules' wording rather than read from a
// table, so these pin the result against the sponsor's published dates.

import { strict as assert } from "node:assert"
import { describe, it } from "node:test"

import { endOfContest, isContestOn, nextContestDate, relevanceFor, startOfContest } from "./schedule.ts"

const DAY = 24 * 60 * 60 * 1000

describe("startOfContest", () => {
  it("runs from 1200 UTC on the second full weekend of July, for 24 hours", () => {
    assert.equal(startOfContest(2026), Date.UTC(2026, 6, 11, 12))
    assert.equal(endOfContest(2026), Date.UTC(2026, 6, 12, 12))
    assert.equal(startOfContest(2027), Date.UTC(2027, 6, 10, 12))
  })

  it("is on the air only between those hours", () => {
    assert.equal(isContestOn(Date.UTC(2026, 6, 11, 11, 59)), false)
    assert.equal(isContestOn(Date.UTC(2026, 6, 12, 11, 59)), true)
    assert.equal(relevanceFor(Date.UTC(2026, 6, 12, 11, 59)), 1)
  })
})

describe("nextContestDate", () => {
  it("names the Saturday, this year's until three days after it, then next year's", () => {
    assert.equal(nextContestDate(Date.UTC(2026, 0, 1)), "2026-07-11")
    assert.equal(nextContestDate(endOfContest(2026) + 2 * DAY), "2026-07-11")
    assert.equal(nextContestDate(endOfContest(2026) + 4 * DAY), "2027-07-10")
  })
})
