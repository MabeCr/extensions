// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// When the Sprints run.
//
// PUBLISHED, not computed: the rules give each season's date outright (4,
// "Contest Period") and state no rule they follow, so the runnings are the
// sponsor's own list. Each new season's goes here, and into the manifest's
// `relevance.dates` with it.

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000

/// Each running's start, 0000 UTC — Saturday evening in North America.
export const RUNNINGS = [
  Date.UTC(2026, 10, 1), // Fall 2026
  Date.UTC(2027, 2, 21), // Spring 2027
]

/// 0000 to 0359 UTC, so four hours as an exclusive bound.
export const LENGTH = 4 * HOUR

/// How long a finished running is still offered — long enough to log it
/// after the evening, short enough that the search reads as "what is coming".
const GRACE_DAYS = 3

/// The start of the next running, or the last one known once they are all
/// past.
export function nextStart(nowMillis: number): number {
  return RUNNINGS.find((start) => start + LENGTH >= nowMillis - GRACE_DAYS * DAY) ?? RUNNINGS[RUNNINGS.length - 1]
}

/// `2026-11-01 0000Z` — the rules' own UTC start, which is what an operator
/// checks against them.
export function nextContestDate(nowMillis: number): string {
  const at = new Date(nextStart(nowMillis))
  const pad = (value: number) => `${value}`.padStart(2, '0')
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())} 0000Z`
}

export function isContestOn(nowMillis: number): boolean {
  const start = nextStart(nowMillis)
  return nowMillis >= start && nowMillis < start + LENGTH
}

/// Relevance for the next running. This only ORDERS the suggestion list. A
/// running in its grace days, or past the end of the list, ranks low.
export function relevanceFor(nowMillis: number): number {
  if (isContestOn(nowMillis)) return 1
  const days = Math.ceil((nextStart(nowMillis) - nowMillis) / DAY)
  if (days <= 0) return 0.05
  return 1 / (1 + days / 60)
}
