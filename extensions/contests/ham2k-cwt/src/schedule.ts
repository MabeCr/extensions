// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// When the CWTs run, and which one is the one at hand.
//
// COMPUTED from the rule CWops publishes — "every Wednesday at 1300-1400z and
// 1900-2000z, and every Thursday at 0300-0400z and 0700-0800z"
// (https://cwops.org/cwops-tests/) — by `@ham2k/lib-weekly-contest`: a rule is
// right for every week, including ones nobody has updated a data file for.
//
// A CWT is an HOUR, four times a week, so the reference has to name the
// *occurrence*, not the event, and with its start: `2026-08-26-1300` is a
// different contest entry from `2026-08-26-1900`, submitted separately.
//
// KNOWN LIMIT: CWops occasionally suspends a week (their published calendar is
// the authority). Nothing here knows about that, so an off week is still
// offered. A suggestion is an offer, not a claim, and the operator is the one
// who knows.

import { type WeeklySession, startTimeOf, weeklySchedule } from "@ham2k/lib-weekly-contest"

export { OFFER_GRACE_MILLIS, OFFER_LEAD_MILLIS, relevanceFor } from "@ham2k/lib-weekly-contest"

export type CwtSession = WeeklySession

/// Wednesday (3) at 1300z and 1900z, Thursday (4) at 0300z and 0700z, an
/// hour each.
export const schedule = weeklySchedule({
  slots: [
    { weekday: 3, startMinutes: 13 * 60 },
    { weekday: 3, startMinutes: 19 * 60 },
    { weekday: 4, startMinutes: 3 * 60 },
    { weekday: 4, startMinutes: 7 * 60 },
  ],
  durationMinutes: 60,
  keyWithTime: true,
})

export const { sessionsFrom, sessionAtHand, sessionFor, sessionDateLabel } = schedule

/// The session's own name — "CWT 1300z". The hour is how operators refer to
/// them, and it is the same string on every locale, so it isn't translated.
export function sessionShortLabel(session: CwtSession): string {
  return `CWT ${startTimeOf(session)}z`
}
