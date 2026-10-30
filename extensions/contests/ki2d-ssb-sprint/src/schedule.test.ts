// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The runnings are the sponsor's published list, so the one thing that can go
// stale is the manifest's copy of them.

import { test } from "node:test"
import assert from "node:assert/strict"

import { RUNNINGS, isContestOn, nextContestDate, relevanceFor } from "./schedule.ts"
import manifest from "../manifest.json" with { type: "json" }

const HOUR = 60 * 60 * 1000

test("the manifest's dates are each running's Saturday evening and UTC Sunday", () => {
  const day = (millis: number) => new Date(millis).toISOString().slice(0, 10)
  assert.deepEqual(manifest.relevance.dates, RUNNINGS.flatMap((start) => [day(start - 24 * HOUR), day(start)]))
})

test("a running is on for 0000–0359 UTC and offered for a few days after", () => {
  const fall = RUNNINGS[0]
  assert.equal(isContestOn(fall + 3 * HOUR + 59 * 60 * 1000), true)
  assert.equal(isContestOn(fall + 4 * HOUR), false)
  assert.equal(nextContestDate(fall + 48 * HOUR), '2026-11-01 0000Z')
  assert.equal(nextContestDate(fall + 5 * 24 * HOUR), '2027-03-21 0000Z')
  assert.ok(relevanceFor(fall - 24 * HOUR) > relevanceFor(fall - 30 * 24 * HOUR))
})
