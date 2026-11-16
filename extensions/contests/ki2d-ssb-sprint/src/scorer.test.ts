// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The Sprint's score is contacts × multipliers. The rules that are easy to get
// wrong by copying NAQP: multipliers count ONCE for the contest rather than
// per band, KH6 is North American here, and two stations outside North
// America score nothing together.

import { test } from "node:test"
import assert from "node:assert/strict"

import type { JSONValue } from "@ham2k/extension-sdk"

import { SprintScorer } from "./scorer.ts"
import { NA_COUNTRIES, US_STATES, CANADIAN_PROVINCES, isMultiplier } from "./locations.ts"

const ctx = { online: false } as never

const usOperation = { uuid: 'op', stationCall: 'KI2D' }
const usRef = { type: 'ssb-sprint', ourName: 'SEB', ourLocation: 'NY' }

function qso(call: string, location: string, band = '20m', extra: Record<string, JSONValue> = {}): Record<string, JSONValue> {
  return {
    their: { call },
    band,
    mode: 'USB',
    refs: [{ type: 'ssb-sprint', ourSerial: 1, theirSerial: '12', name: 'BOB', location }],
    ...extra,
  }
}

function run(qsos: Record<string, JSONValue>[], operation: Record<string, JSONValue> = usOperation, ref: Record<string, JSONValue> = usRef) {
  let sheet = SprintScorer.startScoresheet({ operation, ref }, ctx)
  const scores = qsos.map((q) => {
    const r = SprintScorer.scoreQso({ scoresheet: sheet, qso: q, operation, ref, isNewDay: false }, ctx)
    sheet = r.scoresheet
    return r.score
  })
  const summary = SprintScorer.summarizeScore({ scoresheet: sheet, operation, ref, scope: 'operation' } as never, ctx) as Record<string, { total?: number; summary?: string; longSummary?: string; grid?: boolean }>
  return { sheet, scores, summary: Object.values(summary)[0] }
}

test('the multiplier list is 51 + 13 + the 42 countries the rules name', () => {
  assert.equal(US_STATES.length, 51)
  assert.equal(CANADIAN_PROVINCES.length, 13)
  assert.equal(NA_COUNTRIES.length, 42)
  for (const code of ['DC', 'AK', 'HI', 'NU', 'HI3', 'FO/C', 'KP4', 'VP2E']) assert.ok(isMultiplier(code), code)
  for (const code of ['DX', 'VP9', 'FP', 'DL', '']) assert.ok(!isMultiplier(code), code)
})

test('multipliers count once for the contest, not per band', () => {
  const { sheet, scores } = run([qso('W1AW', 'CT', '20m'), qso('W1AW', 'CT', '40m'), qso('K1ABC', 'CT', '80m')])
  assert.deepEqual(Object.keys(sheet.mults), ['CT'])
  assert.equal(sheet.qsos, 3)
  assert.deepEqual(scores.map((s) => s.notices), [['newMult'], ['newBand'], undefined])
})

test('a station counts once per band', () => {
  const { scores, sheet } = run([qso('W1AW', 'CT', '20m'), qso('W1AW', 'CT', '20m')])
  assert.equal(scores[1].dupe, true)
  assert.equal(scores[1].value, 0)
  assert.equal(sheet.qsos, 1)
})

test('only 20, 40 and 80m and only SSB count', () => {
  const { scores } = run([qso('W1AW', 'CT', '15m'), qso('W1AW', 'CT', '20m', { mode: 'CW' }), qso('W1AW', 'CT', '40m', { mode: 'LSB' })])
  assert.deepEqual(scores.map((s) => s.alerts?.[0]), ['invalidBand', 'invalidMode', undefined])
  assert.equal(scores[2].value, 1)
})

test('DX is a contact for a North American station, never a multiplier', () => {
  const { scores, sheet, summary } = run([qso('DL1ABC', 'DX'), qso('W1AW', 'CT')])
  assert.equal(scores[0].value, 1)
  assert.equal(scores[0].alerts, undefined)
  assert.deepEqual(Object.keys(sheet.mults), ['CT'])
  assert.equal(summary.total, 2 * 1)
})

test('outside North America, only North American stations count — and KH6 is one', () => {
  const dxOperation = { uuid: 'op', stationCall: 'DL1ABC' }
  const dxRef = { type: 'ssb-sprint', ourName: 'HANS', ourLocation: 'DX' }
  const { scores } = run([qso('G4ABC', 'DX'), qso('KH6ABC', 'HI'), qso('W1AW', 'CT')], dxOperation, dxRef)
  assert.equal(scores[0].alerts?.[0], 'invalidCategory')
  assert.equal(scores[0].value, 0)
  assert.equal(scores[0].dupe, false)
  assert.deepEqual(scores.slice(1).map((s) => s.value), [1, 1])
})

test('with no location set up, our call decides whether we are North American', () => {
  const { scores } = run([qso('G4ABC', 'DX')], { uuid: 'op', stationCall: 'F5ABC' }, { type: 'ssb-sprint' })
  assert.equal(scores[0].alerts?.[0], 'invalidCategory')
  assert.equal(run([qso('G4ABC', 'DX')], { uuid: 'op', stationCall: 'KH6ABC' }, { type: 'ssb-sprint' }).scores[0].value, 1)
})

test('an incomplete or unknown exchange still counts, and says so', () => {
  const missing = qso('W1AW', 'CT')
  ;(missing.refs as Record<string, JSONValue>[])[0].theirSerial = ''
  const { scores, sheet } = run([missing, qso('K1ABC', 'ZZ'), qso('K2ABC', 'kl7')])
  assert.deepEqual(scores.map((s) => s.incomplete), [['ssb-sprint/theirSerial'], undefined, undefined])
  assert.deepEqual(scores.map((s) => s.alerts?.[0]), [undefined, 'invalidExchange', undefined])
  assert.deepEqual(scores.map((s) => s.value), [1, 1, 1])
  // "AK/KL7": the alias is the state.
  assert.ok(sheet.mults.AK)
})

test('the summary multiplies contacts by multipliers and checks off the states and provinces', () => {
  const { summary } = run([qso('W1AW', 'CT'), qso('VE3ABC', 'ON', '40m'), qso('XE1ABC', 'XE', '80m'), qso('W2ABC', 'NY')])
  assert.equal(summary.total, 4 * 4)
  assert.equal(summary.grid, true)
  const detail = summary.longSummary ?? ''
  // Every state and province, the worked ones struck.
  assert.match(detail, /### 2 of 51 US States\n\nAK AL AR AZ CA CO \*\*~~CT~~\*\* DC .* NV \*\*~~NY~~\*\* OH .* WY\n\n/)
  assert.match(detail, /### 1 of 13 Canadian Provinces\n\nAB BC MB NB NL NS NT NU \*\*~~ON~~\*\* PE QC SK YT\n\n/)
  // The countries worked, alone.
  assert.match(detail, /### 1 NA Country\n\n\*\*~~XE~~\*\*\n\n/)
  assert.match(detail, /### 4 QSOs\n\n\*\*80m\*\*: 1 QSO, 1 pt, 1 mult\n\*\*40m\*\*: 1 QSO, 1 pt, 1 mult\n\*\*20m\*\*: 2 QSOs, 2 pts, 2 mults$/)
  assert.doesNotMatch(detail, /missing/)
})

test('each multiplier counts on the band it was first worked on, so the band lines add up', () => {
  // A multiplier counts once for the whole contest. Crediting CT again on 40m
  // would show three multipliers across the bands when the score multiplies by
  // two; and 80m reads first however late it was worked.
  const { summary } = run([qso('W1AW', 'CT'), qso('W1AW', 'CT', '40m'), qso('VE3ABC', 'ON', '40m'), qso('W2ABC', 'NY', '80m')])
  const lines = (summary.longSummary ?? '').split('\n').filter((line) => /^\*\*\d+m\*\*/.test(line))
  assert.deepEqual(lines, ['**80m**: 1 QSO, 1 pt, 1 mult', '**40m**: 2 QSOs, 2 pts, 1 mult', '**20m**: 1 QSO, 1 pt, 1 mult'])
  assert.equal(summary.total, 4 * 3)
})

test('the day carries the score too, as a badge for the date header', () => {
  const { sheet } = run([qso('W1AW', 'CT'), qso('VE3ABC', 'ON', '40m')])
  const day = SprintScorer.summarizeScore({ scoresheet: sheet, operation: usOperation, ref: usRef, scope: 'day' } as never, ctx) as Record<string, Record<string, unknown>>
  assert.deepEqual(Object.keys(day), ['ssb-sprint'])
  assert.equal(day['ssb-sprint'].for, 'day')
  assert.equal(day['ssb-sprint'].icon, 'run-fast')
  assert.equal(day['ssb-sprint'].summary, '4')
  assert.equal(day['ssb-sprint'].label, 'SSB Sprint: 4 points')
  assert.equal(day['ssb-sprint'].longSummary, undefined)
  assert.equal(day['ssb-sprint'].grid, undefined)
})
