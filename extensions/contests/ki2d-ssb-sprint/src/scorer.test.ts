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
  const summary = SprintScorer.summarizeScore({ scoresheet: sheet, operation, ref, scope: 'operation' } as never, ctx) as Record<string, { total?: number; summary?: string; longSummary?: string }>
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
  assert.deepEqual(scores.map((s) => s.alerts?.[0]), ['missingExchange', 'invalidExchange', undefined])
  assert.deepEqual(scores.map((s) => s.value), [1, 1, 1])
  // "AK/KL7": the alias is the state.
  assert.ok(sheet.mults.AK)
})

test('the summary multiplies contacts by multipliers and says what is left to chase', () => {
  const { summary } = run([qso('W1AW', 'CT'), qso('VE3ABC', 'ON', '40m'), qso('XE1ABC', 'XE', '80m'), qso('W2ABC', 'NY')])
  assert.equal(summary.total, 4 * 4)
  assert.match(summary.longSummary ?? '', /\*\*Provinces:\*\* 1 of 13 — missing AB BC MB NB NL NS NT NU PE QC SK YT/)
  assert.match(summary.longSummary ?? '', /\*\*States:\*\* 2 of 51\n/)
  assert.match(summary.longSummary ?? '', /\*\*20m\*\*: 2 QSOs/)
})
