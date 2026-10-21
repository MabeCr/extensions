// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// When the two Sweepstakes weekends run, and how close each is.
//
// COMPUTED, not published in a data file: the rules state each date as a
// RULE — CW on the "first full weekend in November", Phone on the "third full
// weekend in November", each from 2100 UTC Saturday "through 0259 UTC Monday"
// — so it is right for every year. Same approach as `cqww`.

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000

/// The two runnings, each its own contest: separate weekends, separate logs,
/// separate submissions. In calendar order. `SSB` is the Phone weekend, named
/// as its Cabrillo CONTEST line names it.
export type SSMode = "CW" | "SSB"
export const MODES: SSMode[] = ["CW", "SSB"]

/// Which full weekend of November each runs on.
const WEEKEND_FOR: Record<SSMode, number> = { CW: 1, SSB: 3 }

/// The Saturday starting the [nth] full weekend of November. A month's first
/// Saturday always has its Sunday in the same month, so the nth full weekend is
/// simply the nth Saturday.
function contestSaturday(year: number, mode: SSMode): number {
  const firstDay = new Date(Date.UTC(year, 10, 1)).getUTCDay()
  return Date.UTC(year, 10, 1 + ((6 - firstDay + 7) % 7) + (WEEKEND_FOR[mode] - 1) * 7)
}

/// The start of a running — 2100 UTC on its Saturday.
export function startOfContest(year: number, mode: SSMode): number {
  return contestSaturday(year, mode) + 21 * HOUR
}

/// The end — 30 hours later, as an EXCLUSIVE bound: "through 0259 UTC Monday"
/// runs to the instant 0300 begins.
export function endOfContest(year: number, mode: SSMode): number {
  return startOfContest(year, mode) + 30 * HOUR
}

/// How long a finished running is still offered — long enough to log it
/// after the weekend, short enough that the search reads as "what is coming".
const GRACE_DAYS = 3

/// The YEAR whose running of [mode] is the next one — the single source for
/// "which running is this?". Rolls once the running is [GRACE_DAYS] past.
export function nextRunningYear(nowMillis: number, mode: SSMode): number {
  const year = new Date(nowMillis).getUTCFullYear()
  return endOfContest(year, mode) < nowMillis - GRACE_DAYS * DAY ? year + 1 : year
}

/// `2026-11-07` — the Saturday the next running of [mode] starts. Written out
/// rather than localized, the same form the QSO parties use: these are the
/// sponsor's UTC dates, and an operator checks them against the rules.
export function nextContestDate(nowMillis: number, mode: SSMode): string {
  const at = new Date(contestSaturday(nextRunningYear(nowMillis, mode), mode))
  const pad = (value: number) => `${value}`.padStart(2, '0')
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`
}

/// Days until the next running of [mode], negative while it is on.
export function daysUntilContest(nowMillis: number, mode: SSMode): number {
  return Math.ceil((startOfContest(nextRunningYear(nowMillis, mode), mode) - nowMillis) / DAY)
}

/// Whether [mode]'s running is on the air right now.
export function isContestOn(nowMillis: number, mode: SSMode): boolean {
  const year = new Date(nowMillis).getUTCFullYear()
  return nowMillis >= startOfContest(year, mode) && nowMillis < endOfContest(year, mode)
}

/// Relevance for [mode]'s next running. This only ORDERS the suggestion list.
/// A running in its grace days ranks below every upcoming one, as in `cqww`.
export function relevanceFor(nowMillis: number, mode: SSMode): number {
  if (isContestOn(nowMillis, mode)) return 1
  const days = daysUntilContest(nowMillis, mode)
  if (days <= 0) return 0.05
  return 1 / (1 + days / 60)
}

/// The running nearest on the calendar, for the setup form's default — CW
/// until its weekend is past, then Phone.
export function nearestMode(nowMillis: number): SSMode {
  return MODES.reduce((best, mode) => (relevanceFor(nowMillis, mode) > relevanceFor(nowMillis, best) ? mode : best))
}
