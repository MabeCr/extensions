// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The Winter Field Day summary: its title and the arithmetic an operator
// checks a claimed score against.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { SECTION_ROWS } from "@ham2k/lib-contest-summary"

import type { JSONValue } from "@ham2k/extension-sdk"

import { TYPE, WFDScorer } from "./scorer.ts"
import type { WFDScoresheet } from "./scorer.ts"
import { ALL_SECTIONS } from "./sections.ts"

/// Away from home (3) and alternative power (1), over the 1 for taking part.
const SETUP = { type: TYPE, ref: '2026', objectiveAwayFromHome: true, objectiveAltPower: true }

/// Scores a run of QSOs against a fresh scoresheet, as the harness does.
function run(qsos: { call: string; band?: string; mode?: string; section?: string; class?: string }[]): WFDScoresheet {
  const operation: Record<string, JSONValue> = { refs: [SETUP] }
  let sheet = WFDScorer.startScoresheet({ operation, ref: SETUP }, {} as never) as WFDScoresheet
  for (const q of qsos) {
    const qso = { band: q.band ?? '20m', mode: q.mode ?? 'SSB', their: { call: q.call }, refs: [{ type: TYPE, class: q.class ?? '1H', location: q.section ?? 'ENY' }] }
    sheet = WFDScorer.scoreQso({ scoresheet: sheet, qso, operation, ref: SETUP, isNewDay: false }, {} as never).scoresheet
  }
  return sheet
}

function summary(sheet: WFDScoresheet) {
  return WFDScorer.summarizeScore({ scoresheet: sheet, operation: {}, scope: 'operation' }, {} as never).contest
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

  it('shows every section as a checklist, the worked ones struck through', () => {
    // A bare count of sections tells an operator nothing about which ones
    // are still out there to be worked.
    const sheet = run([{ call: 'K1AAA', section: 'CT' }, { call: 'VE3BBB', section: 'ONS' }, { call: 'K1AAA', band: '40m', section: 'CT' }])
    const detail = summary(sheet).longSummary as string
    assert.equal(summary(sheet).grid, true)
    assert.match(detail, /^### Sections: 2 of 85$/m)
    assert.match(detail, /^W1 \*\*~~CT~~\*\* EMA ME NH RI VT WMA$/m)
    assert.match(detail, /^VE AB BC GH MB NB NL NS ONE ONN \*\*~~ONS~~\*\* PE QC SK TER$/m)
  })

  it('carries the points of each band, and the contacts of each mode', () => {
    // Points differ by mode, so a band's QSO count alone misreads it: 20m's
    // two contacts here are worth three points, 40m's one CW contact two.
    const sheet = run([{ call: 'K1AAA', mode: 'SSB' }, { call: 'K2BBB', mode: 'CW' }, { call: 'K3CCC', band: '40m', mode: 'CW' }])
    const detail = summary(sheet).longSummary as string
    assert.match(detail, /^\*\*40m\*\*: 1 QSO, 2 pts$/m)
    assert.match(detail, /^\*\*20m\*\*: 2 QSOs, 3 pts$/m)
    assert.match(detail, /^CW 2 · Phone 1$/m)
    // The multiplier is the whole entry's, worked on no band.
    assert.doesNotMatch(detail, /^\*\*.*mult/m)
  })

  it('reads a checkpoint cached before the band tallies existed', () => {
    // An older version's sheet resumes the fold without `bands`; reading it
    // unguarded throws, and the score panel goes blank instead of catching up.
    const sheet = run([{ call: 'K1AAA' }])
    delete sheet.bands
    const resumed = WFDScorer.scoreQso(
      { scoresheet: sheet, qso: { band: '40m', mode: 'CW', their: { call: 'K2BBB' }, refs: [] }, operation: {}, isNewDay: false },
      {} as never,
    ).scoresheet
    assert.match(summary(resumed).longSummary as string, /^\*\*40m\*\*: 1 QSO, 2 pts$/m)
  })

  it('lists the same 85 sections the exchange accepts', () => {
    // The checklist's rows live in lib-contest-summary; a section this contest
    // accepts but the rows lack could be worked and never struck.
    assert.deepEqual(SECTION_ROWS.flatMap(([, codes]) => codes).sort(), Object.keys(ALL_SECTIONS).sort())
  })
})
