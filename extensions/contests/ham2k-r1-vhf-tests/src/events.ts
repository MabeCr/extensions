// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The named IARU Region 1 VHF+ contest instances, ported from app-polo's
// `r1-vhf-tests/all-events.js`. Every event here sends the same exchange
// (serial number + 6-character grid) and scores the same way (great-circle
// distance × a per-band multiplier) — `rsgb-vhf-tests` shares this shape but
// adds a district/postcode exchange field and a district-bonus scoring rule
// neither this file nor scorer.ts needs to know about.

import { EHF_BANDS, SHF_BANDS, UHF_BANDS, VHF_BANDS } from "@ham2k/lib-operation-data"

export interface R1VhfEvent {
  key: string
  name: string
  short: string
  bands: string[]
  /// When it runs, as the IARU R1 VHF Handbook states it: the [nth] full
  /// weekend of [month] (0-based) — see `nextStartDate`.
  weekend: { month: number; nth: number }
}

const ALL_BANDS = [...VHF_BANDS, ...UHF_BANDS, ...SHF_BANDS, ...EHF_BANDS]

const EVENTS: R1VhfEvent[] = [
  { key: 'R1-VHF-SUB1-MARCH', name: 'Subregional 1 - March', short: 'March VHF Test', bands: ALL_BANDS, weekend: { month: 2, nth: 1 } },
  { key: 'R1-VHF-SUB2-MAY', name: 'Subregional 2 - May', short: 'May VHF Test', bands: ALL_BANDS, weekend: { month: 4, nth: 1 } },
  { key: 'R1-VHF-SUB3-JULY', name: 'Subregional 3 - July', short: 'July VHF Test', bands: ALL_BANDS, weekend: { month: 6, nth: 1 } },
  { key: 'R1-VHF-50-JUNE', name: '50 MHz CW/SSB - June', short: '50 MHz Test', bands: ['6m'], weekend: { month: 5, nth: 3 } },
  { key: 'R1-VHF-70-JULY', name: '70 MHz CW/SSB - July', short: '70 MHz Test', bands: ['4m'], weekend: { month: 6, nth: 3 } },
  { key: 'R1-VHF-145-SEPTEMBER', name: '145 MHz CW/SSB - September', short: '145 MHz Test', bands: ['2m'], weekend: { month: 8, nth: 1 } },
  { key: 'R1-VHF-UHF-OCTOBER', name: 'UHF - October', short: 'UHF Test', bands: [...UHF_BANDS, ...SHF_BANDS, ...EHF_BANDS], weekend: { month: 9, nth: 1 } },
  { key: 'R1-VHF-MARCONI-NOVEMBER', name: 'Marconi Memorial CW 145 MHz - November', short: 'Marconi Memorial', bands: ['2m'], weekend: { month: 10, nth: 1 } },
]

const EVENTS_BY_KEY: Record<string, R1VhfEvent> = Object.fromEntries(EVENTS.map((e) => [e.key, e]))

export function eventFor(key: string | undefined | null): R1VhfEvent | undefined {
  return key ? EVENTS_BY_KEY[key] : undefined
}

const DAY = 24 * 60 * 60 * 1000

/// How long a finished running is still offered as itself — long enough to
/// log it after the weekend — before the date moves on to next year's.
const GRACE_DAYS = 3

/// The Saturday of the [nth] full weekend of [month]. The first Saturday of a
/// month always has its Sunday in the same month, so the nth full weekend is
/// simply the nth Saturday.
function weekendSaturday(year: number, { month, nth }: R1VhfEvent['weekend']): number {
  const firstDay = new Date(Date.UTC(year, month, 1)).getUTCDay()
  return Date.UTC(year, month, 1 + ((6 - firstDay + 7) % 7) + (nth - 1) * 7)
}

/// `2026-08-01` — the Saturday [event]'s next running starts, UTC. Rolls to
/// next year's [GRACE_DAYS] after the weekend ends. Written out rather than
/// localized, the same form the QSO parties use: these are the sponsor's
/// dates, and an operator checks them against the rules.
export function nextStartDate(event: R1VhfEvent, nowMillis: number): string {
  const year = new Date(nowMillis).getUTCFullYear()
  const thisYear = weekendSaturday(year, event.weekend)
  const start = thisYear + (2 + GRACE_DAYS) * DAY < nowMillis ? weekendSaturday(year + 1, event.weekend) : thisYear
  const at = new Date(start)
  const pad = (value: number) => `${value}`.padStart(2, '0')
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`
}

export { EVENTS }
