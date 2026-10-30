// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The two weekends, checked against the ARRL's own calendar for 2026 (SS CW
// Nov 7-9, SS Phone Nov 21-23) and against the rule for years with a
// November starting on other weekdays.

import { test } from "node:test"
import assert from "node:assert/strict"

import { endOfContest, isContestOn, nearestMode, nextContestDate, relevanceFor, startOfContest } from "./schedule.ts"

test("each running starts 2100 UTC on its Saturday and runs 30 hours", () => {
  assert.equal(new Date(startOfContest(2026, 'CW')).toISOString(), '2026-11-07T21:00:00.000Z')
  assert.equal(new Date(endOfContest(2026, 'CW')).toISOString(), '2026-11-09T03:00:00.000Z')
  assert.equal(new Date(startOfContest(2026, 'SSB')).toISOString(), '2026-11-21T21:00:00.000Z')
})

test("a November starting on a Saturday makes the 1st the first full weekend", () => {
  // November 2025 began on a Saturday: SS CW was Nov 1, Phone Nov 15.
  assert.equal(new Date(startOfContest(2025, 'CW')).toISOString().slice(0, 10), '2025-11-01')
  assert.equal(new Date(startOfContest(2025, 'SSB')).toISOString().slice(0, 10), '2025-11-15')
  // 2027 begins on a Monday.
  assert.equal(new Date(startOfContest(2027, 'CW')).toISOString().slice(0, 10), '2027-11-06')
  assert.equal(new Date(startOfContest(2027, 'SSB')).toISOString().slice(0, 10), '2027-11-20')
})

test("the date offered moves to next year three days after a running ends", () => {
  assert.equal(nextContestDate(Date.UTC(2026, 9, 20), 'CW'), '2026-11-07')
  assert.equal(nextContestDate(Date.UTC(2026, 10, 11), 'CW'), '2026-11-07')
  assert.equal(nextContestDate(Date.UTC(2026, 10, 13), 'CW'), '2027-11-06')
})

test("the contest is on only inside its 30 hours", () => {
  assert.equal(isContestOn(Date.UTC(2026, 10, 7, 20, 59), 'CW'), false)
  assert.equal(isContestOn(Date.UTC(2026, 10, 7, 21, 0), 'CW'), true)
  assert.equal(isContestOn(Date.UTC(2026, 10, 9, 2, 59), 'CW'), true)
  assert.equal(isContestOn(Date.UTC(2026, 10, 9, 3, 0), 'CW'), false)
  assert.equal(relevanceFor(Date.UTC(2026, 10, 8), 'CW'), 1)
})

test("the setup defaults to CW until its weekend is past, then Phone", () => {
  assert.equal(nearestMode(Date.UTC(2026, 9, 20)), 'CW')
  assert.equal(nearestMode(Date.UTC(2026, 10, 10)), 'SSB')
})

test("the catalog's dates are the ones the schedule runs on", async () => {
  const { default: manifest } = await import("../manifest.json", { with: { type: "json" } })
  const years = [...new Set(manifest.relevance.dates.map((date: string) => Number(date.slice(0, 4))))]
  const expected = years.flatMap((year) => (['CW', 'SSB'] as const).map((mode) => new Date(startOfContest(year, mode)).toISOString().slice(0, 10)))
  assert.deepEqual(manifest.relevance.dates, expected)
})
