// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// When the WWSACs run, and which one is the one at hand.
//
// COMPUTED from the rule the sponsor publishes — "Starts: Tuesdays at 01z.
// Ends: Tuesdays at 01:59z. (Monday evening in North America)" (rules 1,
// wwsac.com/rules.html) — as `ham2k-cwt` computes its sessions: a rule is right
// for every week, including ones nobody has updated a data file for.
//
// Every session is its own contest entry, with its own log submitted within
// 24 hours of its end (rules 8), so the reference names the OCCURRENCE — the
// Tuesday it runs, `2026-10-27` — not the event.
//
// KNOWN LIMIT: a week the sponsor skips is still offered. A suggestion is an
// offer, not a claim, and the operator is the one who knows.

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/// Tuesday, in `Date.getUTCDay()`'s numbering.
const WEEKDAY = 2

/// 0100 UTC.
const START_HOUR = 1

/// 0100 to 0159 UTC, so an hour as an exclusive bound.
export const SESSION_MILLIS = HOUR

/// How long before a session starts it appears in the picker unprompted.
export const OFFER_LEAD_MILLIS = 3 * HOUR

/// How long after a session ends it still counts as "the one at hand" — an
/// operator who worked the hour and only afterwards opens the operation sheet
/// is still setting up THAT session, not next week's.
export const OFFER_GRACE_MILLIS = HOUR

export interface WwsacSession {
  /// The reference: the UTC date it runs on, `YYYY-MM-DD`.
  key: string
  startMillis: number
  endMillis: number
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function sessionAt(startMillis: number): WwsacSession {
  const at = new Date(startMillis)
  return {
    key: `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`,
    startMillis,
    endMillis: startMillis + SESSION_MILLIS,
  }
}

/// The next [count] sessions as of [nowMillis]. A session still counts as
/// "next" until [OFFER_GRACE_MILLIS] past its end, so the hour just worked
/// heads the list rather than vanishing from it the moment it finishes.
export function sessionsFrom(nowMillis: number, count: number): WwsacSession[] {
  const at = new Date(nowMillis)
  const midnight = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())
  // This week's Tuesday, which may be up to six days back.
  let start = midnight - ((at.getUTCDay() - WEEKDAY + 7) % 7) * DAY + START_HOUR * HOUR
  if (start + SESSION_MILLIS + OFFER_GRACE_MILLIS <= nowMillis) start += 7 * DAY
  return Array.from({ length: count }, (_, week) => sessionAt(start + week * 7 * DAY))
}

/// The session to offer UNPROMPTED, or undefined when none is close enough —
/// a weekly contest that always offered itself would sit at the top of the
/// picker six days out of seven. Searching for it, or scoping the picker to
/// this extension, still finds the next sessions on any day.
export function sessionAtHand(nowMillis: number): WwsacSession | undefined {
  const next = sessionsFrom(nowMillis, 1)[0]
  return nowMillis >= next.startMillis - OFFER_LEAD_MILLIS ? next : undefined
}

/// The session a reference names, or undefined when the key isn't one.
///
/// Validates the DAY, not just the shape: `2026-10-26` is a well-formed date,
/// and a Monday.
export function sessionFor(key: string | undefined): WwsacSession | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((key ?? '').trim())
  if (!match) return undefined
  const [year, month, day] = match.slice(1).map(Number)
  const startMillis = Date.UTC(year, month - 1, day, START_HOUR)
  const at = new Date(startMillis)
  // Round-trip guard: Date.UTC rolls a 31st of February over into March
  // silently, and the rolled-over date could be a Tuesday.
  if (at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) return undefined
  if (at.getUTCDay() !== WEEKDAY) return undefined
  return sessionAt(startMillis)
}

/// "2026-10-27 0100z" — the rules' own UTC start, in ISO order: it is a log
/// reference the operator will see again in a filename and a Cabrillo file.
export function sessionDateLabel(session: WwsacSession): string {
  return `${session.key} ${pad(START_HOUR)}00z`
}

/// Relevance for ordering the picker — 1 for the session at hand, falling away
/// for each one further out. Strictly decreasing in time-to-start, so the list
/// stays in chronological order.
export function relevanceFor(session: WwsacSession, nowMillis: number): number {
  const hours = (session.startMillis - nowMillis) / HOUR
  if (hours <= 0) return 1
  return 1 / (1 + hours / 24)
}
