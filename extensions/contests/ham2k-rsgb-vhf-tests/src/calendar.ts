// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// When each RSGB VHF+ event next runs, for the date on its suggestion.
//
// Two kinds of event, dated two ways:
//
// - The monthly UKAC and FMAC sessions follow a fixed rule — "every 1st
//   Tuesday" and so on, per the RSGB calendar — so they are COMPUTED from the
//   key, and stay right for every year.
// - Everything else (Trophies, AFS, Backpackers, Christmas…) is set by the
//   RSGB year by year, with no rule to compute it from, so it comes from
//   [ONE_OFF_DATES], copied from the published calendar
//   (https://www.rsgbcc.org/cgi-bin/readcal.pl?year=YYYY). That table needs a
//   new year added each autumn, once the RSGB publishes it; until then an
//   event past its last listed date simply shows no date, rather than a
//   stale one.

const DAY = 24 * 60 * 60 * 1000

/// How long a finished event is still offered as itself — long enough to log
/// it after the event, short enough that the date reads as "what is coming".
const GRACE_DAYS = 3

/// The UTC start date of each one-off event, per year. 2026 is app-polo's
/// table; 2027 is the RSGB's provisional calendar, as published October 2026.
const ONE_OFF_DATES: Record<string, string[]> = {
  'RSGB-BACKPACKERS-1': ['2026-05-17', '2027-05-16'],
  'RSGB-BACKPACKERS-2': ['2026-06-14', '2027-06-13'],
  'RSGB-BACKPACKERS-3': ['2026-07-05', '2027-07-04'],
  'RSGB-BACKPACKERS-4': ['2026-08-01', '2027-08-07'],
  'RSGB-BACKPACKERS-5': ['2026-09-06', '2027-09-05'],
  'RSGB-70-AFS': ['2026-09-20', '2027-09-19'],
  'RSGB-50-AFS': ['2026-10-18', '2027-10-17'],
  'RSGB-144-AFS': ['2026-12-06', '2027-12-05'],
  'RSGB-432-AFS': ['2026-02-08', '2027-02-07'],
  'RSGB-144-432-MARCH': ['2026-03-07', '2027-03-06'],
  'RSGB-432-245-MAY': ['2026-05-02', '2027-05-01'],
  'RSGB-432-245-OCT': ['2026-10-03', '2027-10-02'],
  'RSGB-144-MAY': ['2026-05-16', '2027-05-15'],
  'RSGB-70-TROPHY': ['2026-07-18', '2027-07-17'],
  'RSGB-50-TROPHY': ['2026-06-20', '2027-06-19'],
  'RSGB-144-TROPHY': ['2026-09-05', '2027-09-04'],
  'RSGB-432-TROPHY': ['2026-05-02', '2027-05-01'],
  'RSGB-2300-TROPHY': ['2026-10-03', '2027-10-02'],
  'RSGB-1300-TROPHY': ['2026-10-03', '2027-10-02'],
  'RSGB-10G-TROPHY': ['2026-05-24', '2027-05-23'],
  'RSGB-70-CW': ['2026-05-10', '2027-05-09'],
  'RSGB-50-CW': ['2026-06-28', '2027-06-27'],
  'RSGB-144-LP': ['2026-08-01', '2027-08-07'],
  'RSGB-432-LP': ['2026-08-02', '2027-08-08'],
  'RSGB-144-MARCONI': ['2026-11-07', '2027-11-06'],
  'RSGB-50-XMAS': ['2026-12-27', '2027-12-27'],
  'RSGB-70-XMAS': ['2026-12-28', '2027-12-28'],
  'RSGB-144-XMAS': ['2026-12-29', '2027-12-29'],
  'RSGB-432-XMAS': ['2026-12-30', '2027-12-30'],
}

/// The monthly sessions' rule: which weekday (0 = Sunday) and which of it in
/// the month, per band. FMAC runs just before the same band's UKAC.
const MONTHLY_RULES: Record<string, { weekday: number; nth: number }> = {
  '144': { weekday: 2, nth: 1 },
  '432': { weekday: 2, nth: 2 },
  '1300': { weekday: 2, nth: 3 },
  SHF: { weekday: 2, nth: 4 },
  '50': { weekday: 4, nth: 2 },
  '70': { weekday: 4, nth: 3 },
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

const MONTHLY_KEY = /^RSGB-(144|432|1300|SHF|50|70)-(?:UKAC|FMAC)-([A-Z]{3})$/

/// The [nth] [weekday] of [month] in [year].
function nthWeekday(year: number, month: number, weekday: number, nth: number): number {
  const firstDay = new Date(Date.UTC(year, month, 1)).getUTCDay()
  return Date.UTC(year, month, 1 + ((weekday - firstDay + 7) % 7) + (nth - 1) * 7)
}

/// Whether [start] is still the event to offer at [nowMillis]: until
/// [GRACE_DAYS] after its day — a day longer for the 24-hour events that end
/// on the next.
function stillCurrent(start: number, nowMillis: number): boolean {
  return start + (2 + GRACE_DAYS) * DAY >= nowMillis
}

function fmtUtcDate(millis: number): string {
  const at = new Date(millis)
  const pad = (value: number) => `${value}`.padStart(2, '0')
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`
}

/// `2026-11-03` — the UTC day [key]'s next running starts, or undefined for
/// an event the calendar does not date yet. Written out rather than
/// localized, the same form the QSO parties use.
export function nextStartDate(key: string, nowMillis: number): string | undefined {
  const monthly = MONTHLY_KEY.exec(key)
  if (monthly) {
    const { weekday, nth } = MONTHLY_RULES[monthly[1]]
    const month = MONTHS.indexOf(monthly[2])
    const year = new Date(nowMillis).getUTCFullYear()
    const thisYear = nthWeekday(year, month, weekday, nth)
    return fmtUtcDate(stillCurrent(thisYear, nowMillis) ? thisYear : nthWeekday(year + 1, month, weekday, nth))
  }
  return (ONE_OFF_DATES[key] ?? []).find((date) => stillCurrent(Date.parse(date), nowMillis))
}
