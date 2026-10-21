// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// ARRL November Sweepstakes scoring, per the rules (v2.1):
//   * Each contact counts for two points (5.1).
//   * Multipliers are the ARRL/RAC sections worked, once for the whole contest
//     — not per band (5.2). Final score = QSO points × sections (5.3).
//   * "Each station may be contacted only once, regardless of band" (2.2), and
//     W1AW and W1AW/7 are the same station (COND.2.1).
//   * Only W/VE stations count (2.1), only on 160/80/40/20/15/10m (2.3), and
//     only in the weekend's own mode (2.4).
//   * Only the first 24 hours of operation count (1.1, 1.2). Operating time
//     begins with the first contact; a gap of 30 minutes or more with no
//     contact is an off-time, and anything shorter is operating time. Contacts
//     past hour 24 stay in the log and score nothing.

import { fmtInteger } from "@ham2k/lib-format-tools"
import { parseCallsign } from "@ham2k/lib-callsigns"
import type { ContestScorer, JSONValue, QsoScoreVerdict } from "@ham2k/extension-sdk"
import { contestArithmetic, contestSummary } from "@ham2k/extension-sdk"

import { tFor } from "./i18n.ts"
import { normalizeCheck, normalizePrecedence } from "./entry.ts"
import { isWVE, normalizeSection } from "./exchange.ts"
import { ALL_SECTIONS } from "./sections.ts"

export const TYPE = 'arrl-ss'

/// "Use only the 1.8, 3.5, 7, 14, 21, and 28 MHz bands."
export const VALID_BANDS = ['160m', '80m', '40m', '20m', '15m', '10m']

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

/// The most operating time that scores.
export const OPERATING_LIMIT = 24 * HOUR

/// The shortest gap that is an off-time rather than operating time.
export const MIN_OFF_TIME = 30 * MINUTE

export type SSScoresheet = {
  /// Base calls already worked — once per contest, whatever the band.
  worked: Record<string, true>
  /// Contacts per section, every one of them a multiplier.
  sections: Record<string, number>
  bands: Record<string, number>
  qsos: number
  points: number
  /// When the last contact was, to measure the gap to the next one.
  lastAt?: number
  /// Operating time so far, the gaps between contacts that were not off-times.
  operatedMillis: number
  /// The moment the 24 hours ran out, once they have. A contact after it
  /// scores nothing; one before it — an earlier contact being edited, scored
  /// against the whole log — still does.
  limitAt?: number
  /// Each off-time, as [last contact before it, first contact after it].
  offTimes: [number, number][]
  /// Contacts logged past the 24 hours, which score nothing.
  overtime: number
}

function str(value: JSONValue | undefined): string {
  return typeof value === 'string' ? value : ''
}

/// Sweepstakes runs separate CW and Phone weekends; a QSO in the other mode is
/// not a contest QSO. Phone is any voice mode a radio may report.
function modeMatches(contestMode: string, qsoMode: string): boolean {
  if (!contestMode) return true
  if (contestMode === 'SSB') return ['SSB', 'USB', 'LSB', 'AM', 'FM'].includes(qsoMode)
  return qsoMode === contestMode
}

export const SSScorer: ContestScorer<SSScoresheet> = {
  startScoresheet(): SSScoresheet {
    return { worked: {}, sections: {}, bands: {}, qsos: 0, points: 0, operatedMillis: 0, offTimes: [], overtime: 0 }
  },

  // Mutates and returns the given scoresheet — see ContestScorer.scoreQso.
  scoreQso({ scoresheet, qso, ref }) {
    const sheet = scoresheet
    const their = (qso.their as Record<string, JSONValue>) ?? {}
    const call = str(their.call).toUpperCase()
    if (!call) return { scoresheet: sheet, score: { value: 0 } }

    if (!modeMatches(str(ref?.mode), str(qso.mode))) {
      return { scoresheet: sheet, score: { value: 0, alerts: ['invalidMode'] } }
    }
    const band = str(qso.band)
    if (!VALID_BANDS.includes(band)) {
      return { scoresheet: sheet, score: { value: 0, alerts: ['invalidBand'] } }
    }

    // The clock runs on every contact in the contest's mode and bands, scoring
    // or not: a dupe made at hour 23 is still operating.
    const at = typeof qso.startAtMillis === 'number' ? qso.startAtMillis : undefined
    if (at !== undefined) {
      if (sheet.lastAt !== undefined) {
        const gap = at - sheet.lastAt
        if (gap >= MIN_OFF_TIME) {
          sheet.offTimes.push([sheet.lastAt, at])
        } else if (gap > 0) {
          sheet.operatedMillis += gap
          if (sheet.limitAt === undefined && sheet.operatedMillis > OPERATING_LIMIT) {
            sheet.limitAt = at - (sheet.operatedMillis - OPERATING_LIMIT)
          }
        }
      }
      sheet.lastAt = at
    }

    const station = String(parseCallsign(call).baseCall ?? call)
    if (sheet.worked[station]) {
      return { scoresheet: sheet, score: { value: 0, dupe: true, alerts: ['duplicate'] } }
    }
    // From here on the dupe test has run and passed, which the verdict says
    // with `dupe: false` — that is what keeps core's call+band+mode rule from
    // contradicting "once per contest" (see the SDK's scoring docs).
    if (!isWVE(call)) {
      return { scoresheet: sheet, score: { value: 0, dupe: false, alerts: ['invalidCategory'] } }
    }
    if (sheet.limitAt !== undefined && (at === undefined || at > sheet.limitAt)) {
      sheet.overtime += 1
      return { scoresheet: sheet, score: { value: 0, dupe: false, alerts: ['overTime'] } }
    }

    const contestRef = ((qso.refs as Record<string, JSONValue>[] | undefined) ?? []).find((r) => r?.type === TYPE)
    const section = normalizeSection(contestRef?.theirSection)

    sheet.worked[station] = true
    sheet.qsos += 1
    sheet.points += 2
    sheet.bands[band] = (sheet.bands[band] ?? 0) + 1

    const score: QsoScoreVerdict = { value: 2, band, dupe: false }
    if (section) {
      if (sheet.sections[section] === undefined) score.notices = ['newMult']
      sheet.sections[section] = (sheet.sections[section] ?? 0) + 1
      score.section = section
    }
    // The contact still scores, but an exchange that is incomplete or not one
    // Sweepstakes sends is a section going unclaimed, or a contact the log
    // checker will remove — and a typo the operator can still fix, if told.
    const parts = [contestRef?.theirSerial, contestRef?.theirPrecedence, contestRef?.theirCheck, contestRef?.theirSection]
    if (parts.some((part) => String(part ?? '').trim() === '')) {
      score.alerts = ['missingExchange']
    } else if (!/^\d+$/.test(String(contestRef?.theirSerial).trim()) || !normalizePrecedence(contestRef?.theirPrecedence) || !normalizeCheck(contestRef?.theirCheck) || !section) {
      score.alerts = ['invalidExchange']
    }
    return { scoresheet: sheet, score }
  },

  summarizeScore({ scoresheet, ref, scope }, ctx) {
    const t = tFor(ctx)
    const sections = Object.keys(scoresheet.sections).length
    return contestSummary(
      {
        key: TYPE,
        scope,
        icon: 'broom',
        title: contestTitle(ref),
        total: scoresheet.points * sections,
        arithmetic: contestArithmetic(
          { qsos: scoresheet.qsos, points: scoresheet.points, mults: sections, multsNoun: t(sections === 1 ? 'sectionOne' : 'sectionMany') },
          ctx,
        ),
        // The clock first: past 24 hours nothing scores, and an operator
        // planning off-times reads this more than anything below it.
        detail: [operatingTime(scoresheet, t), sectionsLine(scoresheet, t), bandBreakdown(scoresheet)].join('\n\n'),
        extra: { points: scoresheet.points, mults: sections, qsos: scoresheet.qsos },
      },
      ctx,
    )
  },
}

/// "ARRL SS CW" — the name the operation's title gives the contest, which its
/// summary repeats.
export function contestTitle(ref: Record<string, JSONValue> | undefined): string {
  const mode = str(ref?.mode)
  return ['ARRL SS', mode === 'SSB' ? 'Phone' : mode].filter((x) => x).join(' ')
}

/// `18h 05m`.
export function fmtDuration(millis: number): string {
  const minutes = Math.floor(millis / MINUTE)
  return `${Math.floor(minutes / 60)}h ${`${minutes % 60}`.padStart(2, '0')}m`
}

/// `2215Z`.
function fmtUtcTime(millis: number): string {
  const at = new Date(millis)
  return `${`${at.getUTCHours()}`.padStart(2, '0')}${`${at.getUTCMinutes()}`.padStart(2, '0')}Z`
}

/// Operating time used and left, and every off-time taken so far.
function operatingTime(sheet: SSScoresheet, t: (key: string, args?: Record<string, string>) => string): string {
  const used = Math.min(sheet.operatedMillis, OPERATING_LIMIT)
  const lines = [
    sheet.limitAt !== undefined
      ? t('operatingDone', { limit: fmtDuration(OPERATING_LIMIT) })
      : t('operatingUsed', { used: fmtDuration(used), left: fmtDuration(OPERATING_LIMIT - used) }),
  ]
  if (sheet.overtime > 0) lines.push(t(sheet.overtime === 1 ? 'overtimeOne' : 'overtimeMany', { count: fmtInteger(sheet.overtime) }))
  lines.push(
    sheet.offTimes.length === 0
      ? t('offTimesNone')
      : t('offTimes', {
          list: sheet.offTimes.map(([from, to]) => `${fmtUtcTime(from)}–${fmtUtcTime(to)} (${fmtDuration(to - from)})`).join(', '),
        }),
  )
  return lines.join('\n')
}

/// Sections worked, and — once few enough are left to chase — which ones.
const MISSING_SHOWN_FROM = 20

function sectionsLine(sheet: SSScoresheet, t: (key: string, args?: Record<string, string>) => string): string {
  const all = Object.keys(ALL_SECTIONS)
  const missing = all.filter((section) => !sheet.sections[section]).sort()
  if (missing.length === 0) return t('cleanSweep', { total: fmtInteger(all.length) })
  const line = t('sectionsWorked', { worked: fmtInteger(all.length - missing.length), total: fmtInteger(all.length) })
  return missing.length <= MISSING_SHOWN_FROM ? `${line}\n${t('sectionsMissing', { list: missing.join(' ') })}` : line
}

/// QSOs per band, in band order.
function bandBreakdown(sheet: SSScoresheet): string {
  return VALID_BANDS.map((band) => {
    const qsos = sheet.bands[band] ?? 0
    return qsos === 0 ? `**${band}**: —` : `**${band}**: ${fmtInteger(qsos)} QSOs`
  }).join('\n')
}
