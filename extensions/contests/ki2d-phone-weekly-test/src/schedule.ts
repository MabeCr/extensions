// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// When the Phone Weekly Tests run: "Wednesday, 0230-0300 UTC (Tuesday
// evening, in NA)", computed by `@ham2k/lib-weekly-contest` as CWT's and the
// WWSAC's are.
//
// Every session is its own entry, with its own score posted within 48 hours,
// so the reference names the OCCURRENCE — the UTC date it runs on,
// `2026-10-28` — not the event.
//
// KNOWN LIMIT: a week the organizers skip, or replace with a special event
// under other rules, is still offered. A suggestion is an offer, not a claim,
// and the operator is the one who knows.

import { weeklySchedule } from "@ham2k/lib-weekly-contest"

export const schedule = weeklySchedule({ slots: [{ weekday: 3, startMinutes: 2 * 60 + 30 }], durationMinutes: 30 })

export const { sessionsFrom, sessionAtHand, sessionFor, sessionDateLabel } = schedule
