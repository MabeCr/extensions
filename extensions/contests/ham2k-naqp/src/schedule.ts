// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// When the NAQP runnings are, and how close each mode's next one is.
//
// COMPUTED, not published in a data file: the rules' contest calendar states
// each weekend as a RULE — CW on the 2nd full weekend of January and the 1st
// of August, SSB on the 3rd full weekend of January and of August, RTTY
// starting the last Saturday of February and on the 3rd full weekend of July —
// each from 1800 UTC Saturday to 0559 UTC Sunday. Same approach as `cqww`,
// except that every mode runs TWICE a year, so "which running" is a date, not
// a year.

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000

/// The three modes, each run as its own contest. In calendar order of their
/// first running.
export type NAQPMode = "CW" | "SSB" | "RTTY"
export const MODES: NAQPMode[] = ["CW", "SSB", "RTTY"]

/// When in the year each running falls (months 0-based): the [nth] full
/// weekend of [month], or for February's RTTY the month's last Saturday —
/// "full" does not apply there, and 2026's runs Feb 28 into March 1.
type Weekend = { month: number; nth: number } | { month: number; lastSaturday: true }

const RUNNINGS_FOR: Record<NAQPMode, Weekend[]> = {
  CW: [{ month: 0, nth: 2 }, { month: 7, nth: 1 }],
  SSB: [{ month: 0, nth: 3 }, { month: 7, nth: 3 }],
  RTTY: [{ month: 1, lastSaturday: true }, { month: 6, nth: 3 }],
}

/// The Saturday a [weekend] of [year] starts on. A month's first Saturday
/// always has its Sunday in the same month, so the nth full weekend is simply
/// the nth Saturday.
function saturdayOf(year: number, weekend: Weekend): number {
  if ('lastSaturday' in weekend) {
    const lastDay = new Date(Date.UTC(year, weekend.month + 1, 0))
    return lastDay.getTime() - ((lastDay.getUTCDay() + 1) % 7) * DAY
  }
  const firstDay = new Date(Date.UTC(year, weekend.month, 1)).getUTCDay()
  return Date.UTC(year, weekend.month, 1 + ((6 - firstDay + 7) % 7) + (weekend.nth - 1) * 7)
}

/// How long a running lasts: 1800 UTC Saturday to 0559 UTC Sunday.
const LENGTH = 12 * HOUR

/// The starts — 1800 UTC on each Saturday — of [mode]'s runnings in [year].
export function startsOfContest(year: number, mode: NAQPMode): number[] {
  return RUNNINGS_FOR[mode].map((weekend) => saturdayOf(year, weekend) + 18 * HOUR)
}

/// How long a finished running is still offered — long enough to log it
/// after the weekend, short enough that the search reads as "what is coming".
const GRACE_DAYS = 3

/// The start of [mode]'s next running — the single source for "which running
/// is this?". Moves on once a running is [GRACE_DAYS] past.
export function nextStart(nowMillis: number, mode: NAQPMode): number {
  const year = new Date(nowMillis).getUTCFullYear()
  const starts = [...startsOfContest(year, mode), ...startsOfContest(year + 1, mode)]
  return starts.find((start) => start + LENGTH >= nowMillis - GRACE_DAYS * DAY) ?? starts[starts.length - 1]
}

/// `2027-01-09` — the Saturday [mode]'s next running starts. Written out
/// rather than localized, the same form the QSO parties use: these are the
/// sponsor's UTC dates, and an operator checks them against the rules.
export function nextContestDate(nowMillis: number, mode: NAQPMode): string {
  const at = new Date(nextStart(nowMillis, mode))
  const pad = (value: number) => `${value}`.padStart(2, '0')
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`
}

/// Whether one of [mode]'s runnings is on the air right now.
export function isContestOn(nowMillis: number, mode: NAQPMode): boolean {
  const start = nextStart(nowMillis, mode)
  return nowMillis >= start && nowMillis < start + LENGTH
}

/// Relevance for [mode]'s next running. This only ORDERS the suggestion list.
/// A running in its grace days ranks below every upcoming one, as in `cqww`.
export function relevanceFor(nowMillis: number, mode: NAQPMode): number {
  if (isContestOn(nowMillis, mode)) return 1
  const days = Math.ceil((nextStart(nowMillis, mode) - nowMillis) / DAY)
  if (days <= 0) return 0.05
  return 1 / (1 + days / 60)
}

/// The mode running soonest, for the setup form's default.
export function nearestMode(nowMillis: number): NAQPMode {
  return MODES.reduce((best, mode) => (relevanceFor(nowMillis, mode) > relevanceFor(nowMillis, best) ? mode : best))
}
