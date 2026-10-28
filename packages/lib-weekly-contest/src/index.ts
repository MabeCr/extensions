// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The weekly contests — CWT, the WWSAC, the Phone Weekly Test: when they run,
// which one is the one at hand, and how an operator finds one by name.
//
// COMPUTED from the rule each sponsor publishes ("every Wednesday at 0230z"),
// not read from a data file: a rule is right for every week, including ones
// nobody has updated a file for. A week the sponsor skips is still offered —
// a suggestion is an offer, not a claim, and the operator is the one who knows.
//
// Every session is its own contest entry, scored and submitted on its own, so
// the reference names the OCCURRENCE, not the event: the UTC date it runs on,
// `2026-10-28`, or with the start time too, `2026-08-26-1300`, for a contest
// that runs more than once a day.
//
// Such a contest stays out of the picker's unprompted list except around a
// session (`sessionAtHand`) — one that always offered itself would sit at the
// top of the picker six days out of seven. Searching for it, or scoping the
// picker to its extension, offers the next sessions on any day.

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/// How long before a session starts it appears in the picker unprompted.
export const OFFER_LEAD_MILLIS = 3 * HOUR

/// How long after a session ends it still counts as "the one at hand" — an
/// operator who worked it and only afterwards opens the operation sheet is
/// still setting up THAT session, not the next one.
export const OFFER_GRACE_MILLIS = HOUR

/// When a session starts: a UTC weekday, in `Date.getUTCDay()`'s numbering (3
/// is Wednesday), and the minutes past UTC midnight.
export interface WeeklySlot {
  weekday: number
  startMinutes: number
}

export interface WeeklySession {
  /// The reference: `YYYY-MM-DD`, or `YYYY-MM-DD-HHMM` — see [WeeklySchedule].
  key: string
  startMillis: number
  endMillis: number
}

export interface WeeklySchedule {
  /// How long every session runs, as an exclusive bound.
  sessionMillis: number
  /// The next [count] sessions as of [nowMillis]. A session still counts as
  /// "next" until [OFFER_GRACE_MILLIS] past its end, so the one just worked
  /// heads the list rather than vanishing from it the moment it finishes.
  sessionsFrom(nowMillis: number, count: number): WeeklySession[]
  /// The session to offer UNPROMPTED: the next one, from [OFFER_LEAD_MILLIS]
  /// before it starts; otherwise undefined.
  sessionAtHand(nowMillis: number): WeeklySession | undefined
  /// The session a reference names, or undefined when the key isn't one. The
  /// SLOT is checked, not just the shape: `2026-10-27` is a well-formed date,
  /// and a Tuesday.
  sessionFor(key: string | undefined): WeeklySession | undefined
  /// "2026-10-28 0230z" — the start in UTC, in ISO order: it is a log
  /// reference the operator will see again in a filename and a Cabrillo
  /// header, and it should read the same in all three, on every locale.
  sessionDateLabel(session: WeeklySession): string
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/// "0230" — a session's UTC start, as operators name it.
export function startTimeOf(session: WeeklySession): string {
  const at = new Date(session.startMillis)
  return `${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}`
}

/// The schedule of a contest run in [slots] every week, each [durationMinutes]
/// long. [keyWithTime] puts the start time in the reference, which a contest
/// with two slots on one UTC day needs to tell them apart.
export function weeklySchedule({ slots, durationMinutes, keyWithTime = false }: {
  slots: WeeklySlot[]
  durationMinutes: number
  keyWithTime?: boolean
}): WeeklySchedule {
  const sessionMillis = durationMinutes * MINUTE

  function sessionAt(startMillis: number): WeeklySession {
    const at = new Date(startMillis)
    const date = `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`
    const session = { key: date, startMillis, endMillis: startMillis + sessionMillis }
    if (keyWithTime) session.key = `${date}-${startTimeOf(session)}`
    return session
  }

  /// The sessions starting on the UTC day [dayMillis] falls in, in order.
  function sessionsOnDay(dayMillis: number): WeeklySession[] {
    const at = new Date(dayMillis)
    const midnight = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())
    return slots
      .filter((slot) => slot.weekday === at.getUTCDay())
      .map((slot) => sessionAt(midnight + slot.startMinutes * MINUTE))
      .sort((a, b) => a.startMillis - b.startMillis)
  }

  function sessionsFrom(nowMillis: number, count: number): WeeklySession[] {
    const found: WeeklySession[] = []
    // A day back: a session that started yesterday UTC can still be within
    // the grace window. A week further than [count] weeks out always holds
    // [count] sessions.
    for (let offset = -1; offset <= 7 * (count + 1) && found.length < count; offset += 1) {
      for (const session of sessionsOnDay(nowMillis + offset * DAY)) {
        if (session.endMillis + OFFER_GRACE_MILLIS <= nowMillis) continue
        if (found.length < count) found.push(session)
      }
    }
    return found
  }

  return {
    sessionMillis,
    sessionsFrom,

    sessionAtHand(nowMillis) {
      const next = sessionsFrom(nowMillis, 1)[0]
      if (!next) return undefined
      return nowMillis >= next.startMillis - OFFER_LEAD_MILLIS ? next : undefined
    },

    sessionFor(key) {
      const match = (keyWithTime ? /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})$/ : /^(\d{4})-(\d{2})-(\d{2})$/).exec((key ?? '').trim())
      if (!match) return undefined
      const [year, month, day, hour = 0, minute = 0] = match.slice(1).map(Number)
      const midnight = Date.UTC(year, month - 1, day)
      const at = new Date(midnight)
      // Round-trip guard: Date.UTC rolls a 31st of February over into March
      // silently, and the rolled-over date could be a session's.
      if (at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) return undefined
      const slot = slots.find((s) => s.weekday === at.getUTCDay() && (!keyWithTime || s.startMinutes === hour * 60 + minute))
      return slot ? sessionAt(midnight + slot.startMinutes * MINUTE) : undefined
    },

    sessionDateLabel(session) {
      return `${session.key.slice(0, 10)} ${startTimeOf(session)}z`
    },
  }
}

/// Whether a contact at [millis] falls in [session] itself — the only
/// contacts that count.
export function isDuring(session: WeeklySession, millis: number): boolean {
  return millis >= session.startMillis && millis < session.endMillis
}

/// Whether a contact at [millis] was made around [session], in the hours it
/// is offered for: before and after it, but the same evening.
export function isAround(session: WeeklySession, millis: number): boolean {
  return millis >= session.startMillis - OFFER_LEAD_MILLIS && millis < session.endMillis + OFFER_GRACE_MILLIS
}

/// Relevance for ordering the picker — 1 for the session at hand, falling away
/// for each one further out.
///
/// Strictly decreasing in time-to-start, so a list of sessions ranked by it
/// stays in CHRONOLOGICAL order. A separate, lower rank for a session that has
/// already run would sink it below the one after it, and the operator setting
/// up the log for the one they just worked would find it second.
///
/// Only ORDERS suggestions, and only against others with no location: the
/// picker sorts everything with a distance ahead of everything without one.
export function relevanceFor(session: WeeklySession, nowMillis: number): number {
  const hours = (session.startMillis - nowMillis) / HOUR
  if (hours <= 0) return 1
  return 1 / (1 + hours / 24)
}

/// Words that say nothing about WHICH contest, ignored in a search.
const FILLER_WORDS = ['CONTEST', 'TEST']

/// Whether a picker search [term] names the contest whose name is made of
/// [words]. Every word typed has to be one of them, or from three letters on
/// the start of one; a year and filler words are ignored.
///
/// The results hold steady while the operator types: the start of a filler
/// word is filler too, and a last word still being typed after one that
/// matched may be shorter than three letters.
export function searchMatches(term: string, words: string[]): boolean {
  const typed = term.trim().toUpperCase().split(/\s+/).filter((word) => word)
  const meaningful = typed.filter((word, i) =>
    !/^\d+$/.test(word) && !FILLER_WORDS.some((filler) => filler === word || (i === typed.length - 1 && filler.startsWith(word))))
  return meaningful.length > 0 && meaningful.every((word, i) =>
    words.some((known) => known === word || ((word.length >= 3 || (i > 0 && i === meaningful.length - 1)) && known.startsWith(word))))
}
