// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// HOTA activates on five DIFFERENT callsigns in a UTC day (rules §1, §3),
// which `activityScorer` has no rule for. Its activation credit is per
// contact, and two cases put more than one callsign's worth on one station:
//
// - one contact naming an activator on two sites credits once per site
//   (`huntedRefs.length || 1`);
// - a station worked at a site and later the same day with no site is, to
//   its duplicate check, a different contact, so it credits twice.
//
// So the scorer runs as it is, and this caps what it credited: the first
// contact with a callsign on a UTC day is worth at most one toward the
// activation, and every later one nothing. Hunting credit, an H&H contact
// with a new site, is left exactly as the scorer gave it.

import type { ActivityScoresheet, ContestScorer, HookContext, JSONValue } from "@ham2k/extension-sdk"

const DAY_IN_MILLIS = 1000 * 60 * 60 * 24

/// The scorer's own sheet, plus the callsigns already credited toward the
/// activation on `activationCallsDay`. Plain JSON, because the harness copies a
/// scoresheet through JSON at every checkpoint.
export type HotaScoresheet = ActivityScoresheet & {
  activationCallsDay?: number
  activationCalls?: Record<string, true>
}

export function oneCallsignPerDay(
  scorer: ContestScorer<ActivityScoresheet>,
  activationType: string,
): ContestScorer<HotaScoresheet> {
  return {
    startScoresheet: (args, ctx: HookContext) => scorer.startScoresheet(args, ctx),
    summarizeScore: (args, ctx: HookContext) => scorer.summarizeScore(args, ctx),

    scoreQso(args, ctx: HookContext) {
      const before = args.scoresheet.activatedQsos
      const { scoresheet, score } = scorer.scoreQso(args, ctx)
      const sheet = scoresheet as HotaScoresheet
      const credited = sheet.activatedQsos - before
      if (credited <= 0) return { scoresheet: sheet, score }

      const call = String(((args.qso.their ?? {}) as Record<string, JSONValue>).call ?? '').trim().toUpperCase()
      const day = Math.floor(Number(args.qso.startAtMillis ?? 0) / DAY_IN_MILLIS)
      if (sheet.activationCallsDay !== day) {
        sheet.activationCallsDay = day
        sheet.activationCalls = {}
      }
      const calls = sheet.activationCalls ?? (sheet.activationCalls = {})
      const excess = calls[call] ? credited : credited - 1
      calls[call] = true
      if (excess <= 0) return { scoresheet: sheet, score }

      // Taken back from everywhere the scorer added it: the totals, each
      // activated site (all of them were credited the same amount), and the
      // operator's share when it kept one.
      sheet.activatedQsos -= excess
      sheet.dayActivatedQsos -= excess
      const operator = String(((args.qso.our ?? {}) as Record<string, JSONValue>).operatorCall ?? '').trim().toUpperCase()
      for (const ref of Object.keys(sheet.activatedRefs)) {
        if (!activates(args.operation, activationType, ref)) continue
        sheet.activatedRefs[ref] -= excess
        sheet.dayActivatedRefs[ref] = (sheet.dayActivatedRefs[ref] ?? 0) - excess
        if (operator && sheet.operatorRefs[ref]?.[operator] != null) sheet.operatorRefs[ref][operator] -= excess
        if (operator && sheet.dayOperatorRefs[ref]?.[operator] != null) sheet.dayOperatorRefs[ref][operator] -= excess
      }

      const value = Math.max(0, (score.value ?? 0) - excess)
      if (value > 0) return { scoresheet: sheet, score: { ...score, value } }
      // Nothing left: a station already counted today, at no new site, is a
      // duplicate as far as HOTA is concerned.
      sheet.duplicates += 1
      sheet.dayDuplicates += 1
      return { scoresheet: sheet, score: { ...score, value: 0, dupe: true, alerts: ['duplicate'], notices: undefined } }
    },
  }
}

function activates(operation: Record<string, JSONValue>, activationType: string, ref: string): boolean {
  const refs = (operation.refs ?? []) as { type?: string; ref?: string }[]
  return refs.some((r) => r?.ref === ref && r?.type === activationType)
}
