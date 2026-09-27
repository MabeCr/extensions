// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The Field Day summary: its title and the arithmetic an operator checks a
// claimed score against.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { JSONValue } from "@ham2k/extension-sdk"

import { FDScorer, TYPE } from "./scorer.ts"
import type { FDScoresheet } from "./scorer.ts"

/// QRP on batteries (×5), with one 100-point bonus claimed.
const SETUP = { type: TYPE, ref: '2026', ourPower: '5W', ourPowerSource: 'BATTERIES', bonusMediaPublicity: true }

/// Scores a run of QSOs against a fresh scoresheet, as the harness does.
function run(qsos: { call: string; band?: string; mode?: string }[]): FDScoresheet {
  const operation: Record<string, JSONValue> = { refs: [SETUP] }
  let sheet = FDScorer.startScoresheet({ operation, ref: SETUP }, {} as never) as FDScoresheet
  for (const q of qsos) {
    const qso = { band: q.band ?? '20m', mode: q.mode ?? 'SSB', their: { call: q.call }, refs: [{ type: TYPE, class: '1A', location: 'ENY' }] }
    sheet = FDScorer.scoreQso({ scoresheet: sheet, qso, operation, ref: SETUP, isNewDay: false }, {} as never).scoresheet
  }
  return sheet
}

describe('FDScorer summary', () => {
  // The power factor is not a count of multipliers worked, and the bonus is
  // added after it — an arithmetic line that said "mults", or multiplied the
  // bonus too, would not multiply out to the total in the title.
  it('titles the score as the operation is titled, over its arithmetic', () => {
    const sheet = run([{ call: 'K1AAA', mode: 'SSB' }, { call: 'K2BBB', mode: 'CW' }])
    const summary = FDScorer.summarizeScore({ scoresheet: sheet, operation: {}, scope: 'operation' }, {} as never)
    // (1 + 2) × 5 + 100
    assert.equal(summary.contest.total, 115)
    assert.equal(summary.contest.label, 'FD: 115 points')
    assert.equal((summary.contest.longSummary as string).split('\n')[0], '2 QSOs, 3 pts × 5 power + 100 bonus')
  })

  // The bonus and the power factor belong to the whole entry, so a day's share
  // of the score is not a number the contest defines.
  it('offers no per-day summary', () => {
    const sheet = run([{ call: 'K1AAA' }])
    assert.deepEqual(FDScorer.summarizeScore({ scoresheet: sheet, operation: {}, scope: 'day' }, {} as never), {})
  })
})
