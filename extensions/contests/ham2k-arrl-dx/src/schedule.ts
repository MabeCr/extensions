// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// When the two ARRL DX weekends run, and how close each is.
//
// COMPUTED, not published in a data file: the rules state each date as a
// RULE — CW on "the third full weekend in February", Phone on "the first full
// weekend in March", each from 0000 UTC Saturday through 2359 UTC Sunday — so
// it is right for every year, including ones nobody has updated a file for.
// Same approach as `cqww`.

const DAY = 24 * 60 * 60 * 1000

/// The two runnings, each its own contest: separate weekends, separate logs,
/// separate submissions. In calendar order.
export type ARRLDXMode = "CW" | "Phone"
export const MODES: ARRLDXMode[] = ["CW", "Phone"]

/// February for CW, March for Phone (0-based), and which full weekend of it.
const WEEKEND_FOR: Record<ARRLDXMode, { month: number; nth: number }> = {
  CW: { month: 1, nth: 3 },
  Phone: { month: 2, nth: 1 },
}

/// The Saturday starting the [nth] full weekend of [month]. A month's first
/// Saturday always has its Sunday in the same month, so the nth full weekend
/// is simply the nth Saturday.
function nthFullWeekendSaturday(year: number, month: number, nth: number): number {
  const firstDay = new Date(Date.UTC(year, month, 1)).getUTCDay()
  return Date.UTC(year, month, 1 + ((6 - firstDay + 7) % 7) + (nth - 1) * 7)
}

/// The start of a running — 0000 UTC on its Saturday.
export function startOfContest(year: number, mode: ARRLDXMode): number {
  const { month, nth } = WEEKEND_FOR[mode]
  return nthFullWeekendSaturday(year, month, nth)
}

/// The end — 48 hours later, as an EXCLUSIVE bound: "2359 UTC Sunday" runs
/// to the instant Monday begins.
export function endOfContest(year: number, mode: ARRLDXMode): number {
  return startOfContest(year, mode) + 2 * DAY
}

/// How long a finished running is still offered — long enough to log it
/// after the weekend, short enough that the search reads as "what is coming".
const GRACE_DAYS = 3

/// The YEAR whose running of [mode] is the next one — the single source for
/// "which running is this?". Rolls once the running is [GRACE_DAYS] past.
export function nextRunningYear(nowMillis: number, mode: ARRLDXMode): number {
  const year = new Date(nowMillis).getUTCFullYear()
  return endOfContest(year, mode) < nowMillis - GRACE_DAYS * DAY ? year + 1 : year
}

/// `2027-02-20` — the Saturday the next running of [mode] starts. Written out
/// rather than localized, the same form the QSO parties use: these are the
/// sponsor's UTC dates, and an operator checks them against the rules.
export function nextContestDate(nowMillis: number, mode: ARRLDXMode): string {
  const at = new Date(startOfContest(nextRunningYear(nowMillis, mode), mode))
  const pad = (value: number) => `${value}`.padStart(2, '0')
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`
}

/// Days until the next running of [mode], negative while it is on.
export function daysUntilContest(nowMillis: number, mode: ARRLDXMode): number {
  return Math.ceil((startOfContest(nextRunningYear(nowMillis, mode), mode) - nowMillis) / DAY)
}

/// Whether [mode]'s running is on the air right now.
export function isContestOn(nowMillis: number, mode: ARRLDXMode): boolean {
  const year = new Date(nowMillis).getUTCFullYear()
  return nowMillis >= startOfContest(year, mode) && nowMillis < endOfContest(year, mode)
}

/// Relevance for [mode]'s next running. This only ORDERS the suggestion list.
/// A running in its grace days ranks below every upcoming one, as in `cqww`.
export function relevanceFor(nowMillis: number, mode: ARRLDXMode): number {
  if (isContestOn(nowMillis, mode)) return 1
  const days = daysUntilContest(nowMillis, mode)
  if (days <= 0) return 0.05
  return 1 / (1 + days / 60)
}

/// The running nearest on the calendar, for the setup form's default.
export function nearestMode(nowMillis: number): ARRLDXMode {
  return MODES.reduce((best, mode) => (relevanceFor(nowMillis, mode) > relevanceFor(nowMillis, best) ? mode : best))
}
