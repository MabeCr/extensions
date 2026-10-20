// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The monthly sessions are COMPUTED from a weekday rule, so these pin the rule
// against every 2026 date in app-polo's table, which was copied from the RSGB
// calendar. The one-off events come from a table that needs a year added each
// autumn: what matters there is that every event is in it, and that one past
// its last listed date shows no date rather than a stale one.

import { strict as assert } from "node:assert"
import { describe, it } from "node:test"

import { nextStartDate } from "./calendar.ts"
import { EVENTS } from "./events.ts"

const NEW_YEAR_2026 = Date.UTC(2026, 0, 1)

/// app-polo's 2026 start dates for the monthly sessions.
const MONTHLY_2026: Record<string, string> = {
  "RSGB-144-FMAC-JAN": "2026-01-06",
  "RSGB-144-FMAC-FEB": "2026-02-03",
  "RSGB-144-FMAC-MAR": "2026-03-03",
  "RSGB-144-FMAC-APR": "2026-04-07",
  "RSGB-144-FMAC-MAY": "2026-05-05",
  "RSGB-144-FMAC-JUN": "2026-06-02",
  "RSGB-144-FMAC-JUL": "2026-07-07",
  "RSGB-144-FMAC-AUG": "2026-08-04",
  "RSGB-144-FMAC-SEP": "2026-09-01",
  "RSGB-144-FMAC-OCT": "2026-10-06",
  "RSGB-144-FMAC-NOV": "2026-11-03",
  "RSGB-144-FMAC-DEC": "2026-12-01",
  "RSGB-432-FMAC-JAN": "2026-01-13",
  "RSGB-432-FMAC-FEB": "2026-02-10",
  "RSGB-432-FMAC-MAR": "2026-03-10",
  "RSGB-432-FMAC-APR": "2026-04-14",
  "RSGB-432-FMAC-MAY": "2026-05-12",
  "RSGB-432-FMAC-JUN": "2026-06-09",
  "RSGB-432-FMAC-JUL": "2026-07-14",
  "RSGB-432-FMAC-AUG": "2026-08-11",
  "RSGB-432-FMAC-SEP": "2026-09-08",
  "RSGB-432-FMAC-OCT": "2026-10-13",
  "RSGB-432-FMAC-NOV": "2026-11-10",
  "RSGB-432-FMAC-DEC": "2026-12-08",
  "RSGB-144-UKAC-JAN": "2026-01-06",
  "RSGB-144-UKAC-FEB": "2026-02-03",
  "RSGB-144-UKAC-MAR": "2026-03-03",
  "RSGB-144-UKAC-APR": "2026-04-07",
  "RSGB-144-UKAC-MAY": "2026-05-05",
  "RSGB-144-UKAC-JUN": "2026-06-02",
  "RSGB-144-UKAC-JUL": "2026-07-07",
  "RSGB-144-UKAC-AUG": "2026-08-04",
  "RSGB-144-UKAC-SEP": "2026-09-01",
  "RSGB-144-UKAC-OCT": "2026-10-06",
  "RSGB-144-UKAC-NOV": "2026-11-03",
  "RSGB-144-UKAC-DEC": "2026-12-01",
  "RSGB-432-UKAC-JAN": "2026-01-13",
  "RSGB-432-UKAC-FEB": "2026-02-10",
  "RSGB-432-UKAC-MAR": "2026-03-10",
  "RSGB-432-UKAC-APR": "2026-04-14",
  "RSGB-432-UKAC-MAY": "2026-05-12",
  "RSGB-432-UKAC-JUN": "2026-06-09",
  "RSGB-432-UKAC-JUL": "2026-07-14",
  "RSGB-432-UKAC-AUG": "2026-08-11",
  "RSGB-432-UKAC-SEP": "2026-09-08",
  "RSGB-432-UKAC-OCT": "2026-10-13",
  "RSGB-432-UKAC-NOV": "2026-11-10",
  "RSGB-432-UKAC-DEC": "2026-12-08",
  "RSGB-70-UKAC-JAN": "2026-01-15",
  "RSGB-70-UKAC-FEB": "2026-02-19",
  "RSGB-70-UKAC-MAR": "2026-03-19",
  "RSGB-70-UKAC-APR": "2026-04-16",
  "RSGB-70-UKAC-MAY": "2026-05-21",
  "RSGB-70-UKAC-JUN": "2026-06-18",
  "RSGB-70-UKAC-JUL": "2026-07-16",
  "RSGB-70-UKAC-AUG": "2026-08-20",
  "RSGB-70-UKAC-SEP": "2026-09-17",
  "RSGB-70-UKAC-OCT": "2026-10-15",
  "RSGB-70-UKAC-NOV": "2026-11-19",
  "RSGB-70-UKAC-DEC": "2026-12-17",
  "RSGB-50-UKAC-JAN": "2026-01-08",
  "RSGB-50-UKAC-FEB": "2026-02-12",
  "RSGB-50-UKAC-MAR": "2026-03-12",
  "RSGB-50-UKAC-APR": "2026-04-09",
  "RSGB-50-UKAC-MAY": "2026-05-14",
  "RSGB-50-UKAC-JUN": "2026-06-11",
  "RSGB-50-UKAC-JUL": "2026-07-09",
  "RSGB-50-UKAC-AUG": "2026-08-13",
  "RSGB-50-UKAC-SEP": "2026-09-10",
  "RSGB-50-UKAC-OCT": "2026-10-08",
  "RSGB-50-UKAC-NOV": "2026-11-12",
  "RSGB-50-UKAC-DEC": "2026-12-10",
  "RSGB-SHF-UKAC-JAN": "2026-01-27",
  "RSGB-SHF-UKAC-FEB": "2026-02-24",
  "RSGB-SHF-UKAC-MAR": "2026-03-24",
  "RSGB-SHF-UKAC-APR": "2026-04-28",
  "RSGB-SHF-UKAC-MAY": "2026-05-26",
  "RSGB-SHF-UKAC-JUN": "2026-06-23",
  "RSGB-SHF-UKAC-JUL": "2026-07-28",
  "RSGB-SHF-UKAC-AUG": "2026-08-25",
  "RSGB-SHF-UKAC-SEP": "2026-09-22",
  "RSGB-SHF-UKAC-OCT": "2026-10-27",
  "RSGB-SHF-UKAC-NOV": "2026-11-24",
  "RSGB-1300-UKAC-JAN": "2026-01-20",
  "RSGB-1300-UKAC-FEB": "2026-02-17",
  "RSGB-1300-UKAC-MAR": "2026-03-17",
  "RSGB-1300-UKAC-APR": "2026-04-21",
  "RSGB-1300-UKAC-MAY": "2026-05-19",
  "RSGB-1300-UKAC-JUN": "2026-06-16",
  "RSGB-1300-UKAC-JUL": "2026-07-21",
  "RSGB-1300-UKAC-AUG": "2026-08-18",
  "RSGB-1300-UKAC-SEP": "2026-09-15",
  "RSGB-1300-UKAC-OCT": "2026-10-20",
  "RSGB-1300-UKAC-NOV": "2026-11-17",
  "RSGB-1300-UKAC-DEC": "2026-12-15",
}

describe("nextStartDate", () => {
  it("computes every monthly session's 2026 date from its rule", () => {
    for (const [key, date] of Object.entries(MONTHLY_2026)) assert.equal(nextStartDate(key, NEW_YEAR_2026), date, key)
  })

  it("dates every event in the list", () => {
    for (const event of EVENTS) assert.ok(nextStartDate(event.key, NEW_YEAR_2026), event.key)
  })

  it("keeps an event for three days after it, then moves to the next year's", () => {
    assert.equal(nextStartDate("RSGB-144-UKAC-NOV", Date.UTC(2026, 10, 3, 20)), "2026-11-03")
    assert.equal(nextStartDate("RSGB-144-UKAC-NOV", Date.UTC(2026, 10, 9)), "2027-11-02")
    assert.equal(nextStartDate("RSGB-144-MARCONI", Date.UTC(2026, 10, 10)), "2026-11-07")
    assert.equal(nextStartDate("RSGB-144-MARCONI", Date.UTC(2026, 10, 13)), "2027-11-06")
  })

  it("gives a one-off event past the calendar's last year no date at all", () => {
    assert.equal(nextStartDate("RSGB-144-MARCONI", Date.UTC(2028, 0, 1)), undefined)
    // The monthly sessions need no calendar, so they keep going.
    assert.equal(nextStartDate("RSGB-144-UKAC-JAN", Date.UTC(2028, 0, 1)), "2028-01-04")
  })
})
