// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// When the IARU HF Championship runs, and how close it is.
//
// COMPUTED, not published in a data file: the rules state the date as a RULE
// — "the second full weekend of July", from 1200 UTC Saturday through 1159
// UTC Sunday — so it is right for every year, including ones nobody has
// updated a file for. Same approach as `cqww`.

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000

/// The Saturday starting the second full weekend of July. A month's first
/// Saturday always has its Sunday in the same month, so the second full
/// weekend is simply the second Saturday.
function contestSaturday(year: number): number {
  const firstDay = new Date(Date.UTC(year, 6, 1)).getUTCDay()
  return Date.UTC(year, 6, 1 + ((6 - firstDay + 7) % 7) + 7)
}

/// The start of a running — 1200 UTC on its Saturday.
export function startOfContest(year: number): number {
  return contestSaturday(year) + 12 * HOUR
}

/// The end — 24 hours later, as an EXCLUSIVE bound: "1159 UTC Sunday" runs to
/// the instant 1200 UTC begins.
export function endOfContest(year: number): number {
  return startOfContest(year) + DAY
}

/// How long a finished running is still offered — long enough to log it
/// after the weekend, short enough that the search reads as "what is coming".
const GRACE_DAYS = 3

/// The YEAR whose running is the next one — the single source for "which
/// running is this?". Rolls once the running is [GRACE_DAYS] past.
export function nextRunningYear(nowMillis: number): number {
  const year = new Date(nowMillis).getUTCFullYear()
  return endOfContest(year) < nowMillis - GRACE_DAYS * DAY ? year + 1 : year
}

/// `2027-07-10` — the Saturday the next running starts. Written out rather
/// than localized, the same form the QSO parties use: these are the
/// sponsor's UTC dates, and an operator checks them against the rules.
export function nextContestDate(nowMillis: number): string {
  const at = new Date(contestSaturday(nextRunningYear(nowMillis)))
  const pad = (value: number) => `${value}`.padStart(2, '0')
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`
}

/// Days until the next running, negative while it is on.
export function daysUntilContest(nowMillis: number): number {
  return Math.ceil((startOfContest(nextRunningYear(nowMillis)) - nowMillis) / DAY)
}

/// Whether the contest is on the air right now.
export function isContestOn(nowMillis: number): boolean {
  const year = new Date(nowMillis).getUTCFullYear()
  return nowMillis >= startOfContest(year) && nowMillis < endOfContest(year)
}

/// Relevance for the next running. This only ORDERS the suggestion list.
/// A running in its grace days ranks low, as in `cqww`.
export function relevanceFor(nowMillis: number): number {
  if (isContestOn(nowMillis)) return 1
  const days = daysUntilContest(nowMillis)
  if (days <= 0) return 0.05
  return 1 / (1 + days / 60)
}
