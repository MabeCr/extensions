// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// When the WWSACs run: "Starts: Tuesdays at 01z. Ends: Tuesdays at 01:59z.
// (Monday evening in North America)" (rules 1, wwsac.com/rules.html),
// computed by `@ham2k/lib-weekly-contest` as CWT's sessions are.
//
// Every session is its own contest entry, with its own log submitted within
// 24 hours of its end (rules 8), so the reference names the OCCURRENCE — the
// Tuesday it runs, `2026-10-27` — not the event.
//
// KNOWN LIMIT: a week the sponsor skips is still offered. A suggestion is an
// offer, not a claim, and the operator is the one who knows.

import { weeklySchedule } from "@ham2k/lib-weekly-contest"

/// 0100 to 0159 UTC, so an hour as an exclusive bound.
export const schedule = weeklySchedule({ slots: [{ weekday: 2, startMinutes: 60 }], durationMinutes: 60 })

export const { sessionsFrom, sessionAtHand, sessionFor, sessionDateLabel } = schedule
