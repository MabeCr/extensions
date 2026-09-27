// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The Winter Field Day summary: its title and the arithmetic an operator
// checks a claimed score against.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { JSONValue } from "@ham2k/extension-sdk"

import { TYPE, WFDScorer } from "./scorer.ts"
import type { WFDScoresheet } from "./scorer.ts"

/// Away from home (3) and alternative power (1), over the 1 for taking part.
const SETUP = { type: TYPE, ref: '2026', objectiveAwayFromHome: true, objectiveAltPower: true }

/// Scores a run of QSOs against a fresh scoresheet, as the harness does.
function run(qsos: { call: string; band?: string; mode?: string }[]): WFDScoresheet {
  const operation: Record<string, JSONValue> = { refs: [SETUP] }
  let sheet = WFDScorer.startScoresheet({ operation, ref: SETUP }, {} as never) as WFDScoresheet
  for (const q of qsos) {
    const qso = { band: q.band ?? '20m', mode: q.mode ?? 'SSB', their: { call: q.call }, refs: [{ type: TYPE, class: '1H', location: 'ENY' }] }
    sheet = WFDScorer.scoreQso({ scoresheet: sheet, qso, operation, ref: SETUP, isNewDay: false }, {} as never).scoresheet
  }
  return sheet
}

describe('WFDScorer summary', () => {
  // The multiplier is the WEIGHTED sum of the objectives; an arithmetic line
  // built from a flat count of them would not multiply out to the title.
  it('titles the score as the operation is titled, over its arithmetic', () => {
    const sheet = run([{ call: 'K1AAA', mode: 'SSB' }, { call: 'K2BBB', mode: 'CW' }])
    const summary = WFDScorer.summarizeScore({ scoresheet: sheet, operation: {}, scope: 'operation' }, {} as never)
    assert.equal(summary.contest.total, 15)
    assert.equal(summary.contest.label, 'WFD: 15 points')
    assert.equal((summary.contest.longSummary as string).split('\n')[0], '2 QSOs, 3 pts × 5 mults')
  })

  // The objectives multiply the whole entry, so a day's share of the score is
  // not a number the contest defines.
  it('offers no per-day summary', () => {
    const sheet = run([{ call: 'K1AAA' }])
    assert.deepEqual(WFDScorer.summarizeScore({ scoresheet: sheet, operation: {}, scope: 'day' }, {} as never), {})
  })
})
