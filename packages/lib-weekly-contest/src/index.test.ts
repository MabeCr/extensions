// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT

import { test } from "node:test"
import assert from "node:assert/strict"

import { OFFER_GRACE_MILLIS, OFFER_LEAD_MILLIS, isAround, isDuring, relevanceFor, searchMatches, weeklySchedule } from "./index.ts"

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

// Wednesdays at 0230z, half an hour.
const weekly = weeklySchedule({ slots: [{ weekday: 3, startMinutes: 2 * 60 + 30 }], durationMinutes: 30 })
// Twice on Wednesdays and twice on Thursdays, an hour each.
const twiceADay = weeklySchedule({
  slots: [{ weekday: 4, startMinutes: 7 * 60 }, { weekday: 3, startMinutes: 13 * 60 }, { weekday: 3, startMinutes: 19 * 60 }, { weekday: 4, startMinutes: 3 * 60 }],
  durationMinutes: 60,
  keyWithTime: true,
})

const WED_0230 = Date.UTC(2026, 9, 28, 2, 30)

test('a session is named by its UTC date, or its date and start', () => {
  assert.deepEqual(weekly.sessionFor('2026-10-28'), { key: '2026-10-28', startMillis: WED_0230, endMillis: WED_0230 + 30 * MINUTE })
  assert.equal(weekly.sessionDateLabel(weekly.sessionFor('2026-10-28')!), '2026-10-28 0230z')
  assert.equal(twiceADay.sessionFor('2026-10-28-1900')?.startMillis, Date.UTC(2026, 9, 28, 19))
  assert.equal(twiceADay.sessionDateLabel(twiceADay.sessionFor('2026-10-29-0300')!), '2026-10-29 0300z')
  // The wrong day, a slot that doesn't run, a rolled-over date, a bad shape.
  for (const key of ['2026-10-27', '2026-02-31', '2026-10-28-0230', ' ', undefined]) assert.equal(weekly.sessionFor(key), undefined, key)
  for (const key of ['2026-10-28-1400', '2026-10-28', '2026-10-27-1300']) assert.equal(twiceADay.sessionFor(key), undefined, key)
})

test('the next sessions, in order, with the one just worked still first', () => {
  assert.deepEqual(weekly.sessionsFrom(WED_0230 - 3 * 24 * HOUR, 3).map((s) => s.key), ['2026-10-28', '2026-11-04', '2026-11-11'])
  const end = WED_0230 + weekly.sessionMillis
  assert.equal(weekly.sessionsFrom(end + OFFER_GRACE_MILLIS - 1, 1)[0].key, '2026-10-28')
  assert.equal(weekly.sessionsFrom(end + OFFER_GRACE_MILLIS, 1)[0].key, '2026-11-04')
  // Slots listed out of order still come out in order, across midnight.
  assert.deepEqual(twiceADay.sessionsFrom(Date.UTC(2026, 9, 28, 12), 5).map((s) => s.key),
    ['2026-10-28-1300', '2026-10-28-1900', '2026-10-29-0300', '2026-10-29-0700', '2026-11-04-1300'])
})

test('a session is at hand from three hours before until an hour after', () => {
  assert.equal(weekly.sessionAtHand(WED_0230 - OFFER_LEAD_MILLIS - 1), undefined)
  assert.equal(weekly.sessionAtHand(WED_0230 - OFFER_LEAD_MILLIS)?.key, '2026-10-28')
  assert.equal(weekly.sessionAtHand(WED_0230 + 30 * MINUTE + OFFER_GRACE_MILLIS - 1)?.key, '2026-10-28')
  assert.equal(weekly.sessionAtHand(WED_0230 + 30 * MINUTE + OFFER_GRACE_MILLIS), undefined)
  // Relevance falls away with time to start, and is 1 once started.
  const [a, b] = weekly.sessionsFrom(WED_0230, 2)
  assert.equal(relevanceFor(a, WED_0230 + MINUTE), 1)
  assert.ok(relevanceFor(b, WED_0230) < relevanceFor(a, WED_0230 - HOUR))
})

test('during the session, and around it', () => {
  const session = weekly.sessionFor('2026-10-28')!
  assert.deepEqual([WED_0230 - 1, WED_0230, WED_0230 + 30 * MINUTE - 1, WED_0230 + 30 * MINUTE].map((t) => isDuring(session, t)), [false, true, true, false])
  assert.equal(isAround(session, WED_0230 - OFFER_LEAD_MILLIS), true)
  assert.equal(isAround(session, WED_0230 - OFFER_LEAD_MILLIS - 1), false)
  assert.equal(isAround(session, session.endMillis + OFFER_GRACE_MILLIS - 1), true)
  assert.equal(isAround(session, session.endMillis + OFFER_GRACE_MILLIS), false)
})

test('a search names the contest by its words, and holds steady while typed', () => {
  const words = ['PHONE', 'WEEKLY', 'FRAY', 'PWT', 'SSB']
  for (const term of ['pwt', 'Phone Weekly Test', 'pho wee', 'phone fray 2026', 'phone w', 'phone weekly t', 'phone weekly tes', 'phone weekly c', 'pwt 2']) {
    assert.equal(searchMatches(term, words), true, term)
  }
  for (const term of ['', 'test', 'te', 'contest', '2026', 'ph', 'p', 'phone x', 'phone sprint', 'test phone x', 'naqp']) {
    assert.equal(searchMatches(term, words), false, term)
  }
})
