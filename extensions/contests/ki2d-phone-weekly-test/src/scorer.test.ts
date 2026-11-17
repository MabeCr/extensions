// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// NAQP's scoring without 10m: contacts times the multipliers worked on each
// band.

import { test } from "node:test"
import assert from "node:assert/strict"

import type { JSONValue } from "@ham2k/extension-sdk"

import { PwtScorer } from "./scorer.ts"

const ctx = { online: false } as never
const operation = { uuid: 'op', stationCall: 'KI2D' }
const ref = { type: 'pwt', ref: '2026-10-28', ourName: 'SEB', ourLocation: 'NY' }

function qso(call: string, location: string | undefined, band = '20m', extra: Record<string, JSONValue> = {}): Record<string, JSONValue> {
  return {
    their: { call },
    band,
    mode: 'USB',
    refs: [location === undefined ? { type: 'pwt', name: 'BOB' } : { type: 'pwt', name: 'BOB', location }],
    ...extra,
  }
}

function run(qsos: Record<string, JSONValue>[]) {
  let sheet = PwtScorer.startScoresheet({ operation, ref }, ctx)
  const scores = qsos.map((q) => {
    const r = PwtScorer.scoreQso({ scoresheet: sheet, qso: q, operation, ref, isNewDay: false }, ctx)
    sheet = r.scoresheet
    return r.score
  })
  const summary = PwtScorer.summarizeScore({ scoresheet: sheet, operation, ref, scope: 'operation' } as never, ctx) as Record<string, { total?: number; longSummary?: string }>
  return { sheet, scores, summary: Object.values(summary)[0] }
}

test('multipliers count once per band, and the score is contacts times their sum', () => {
  const { scores, sheet, summary } = run([
    qso('W1AW', 'CT', '20m'),
    qso('K1ABC', 'CT', '20m'), // CT again on 20m: a contact, not a multiplier
    qso('W1AW', 'CT', '40m'), // the same station on another band: both again
    qso('VE3XYZ', 'ON', '40m'),
    qso('XE1ABC', 'XE', '80m'),
  ])
  assert.deepEqual(scores.map((s) => s.notices ?? []), [['newMult'], [], ['newMult', 'newBand'], ['newMult'], ['newMult']])
  assert.equal(sheet.qsos, 5)
  assert.equal(Object.keys(sheet.mults).length, 4)
  assert.equal(summary.total, 20)
})

test('DX is a contact but not a multiplier', () => {
  const { scores, summary } = run([qso('DL1ABC', 'DX'), qso('W1AW', 'CT')])
  assert.deepEqual(scores.map((s) => s.value), [1, 1])
  assert.equal(scores[0].alerts, undefined)
  assert.equal(summary.total, 2)
})

test('a station is worked once per band', () => {
  const { scores, sheet } = run([qso('W1AW', 'CT'), qso('W1AW', 'CT')])
  assert.equal(scores[1].dupe, true)
  assert.equal(sheet.qsos, 1)
})

test('SSB on 160 through 15m only — no 10m', () => {
  const { scores } = run([
    qso('W1AA', 'CT', '160m'),
    qso('W2AA', 'NY', '15m'),
    qso('W3AA', 'PA', '10m'),
    qso('W4AA', 'VA', '20m', { mode: 'CW' }),
    qso('W5AA', 'TX', '40m', { mode: 'LSB' }),
  ])
  assert.deepEqual(scores.map((s) => s.value), [1, 1, 0, 0, 1])
  assert.deepEqual(scores[2].alerts, ['invalidBand'])
  assert.deepEqual(scores[3].alerts, ['invalidMode'])
})

test('a missing or unknown location, or a missing name, still counts, and says so', () => {
  const noName = { refs: [{ type: 'pwt', location: 'CT' }] }
  const { scores, summary } = run([qso('W1AW', undefined), qso('W2AW', 'XX'), qso('W3AW', 'CT', '20m', noName)])
  assert.deepEqual(scores.map((s) => s.value), [1, 1, 1])
  assert.deepEqual(scores[0].incomplete, ['pwt/location'])
  assert.deepEqual(scores[1].alerts, ['invalidExchange'])
  assert.deepEqual(scores[2].incomplete, ['pwt/name'], 'only what is missing is asked for')
  assert.equal(summary.total, 3)
})

test('only the half hour counts: 0230 to 0300 UTC', () => {
  const at = (h: number, m: number) => ({ startAtMillis: Date.UTC(2026, 9, 28, h, m) })
  const { scores, summary } = run([
    qso('W1AA', 'CT', '20m', at(2, 25)),
    qso('W2AA', 'NY', '20m', at(2, 30)),
    qso('W3AA', 'PA', '20m', at(2, 59)),
    qso('W4AA', 'VA', '20m', at(3, 0)),
    qso('W5AA', 'TX', '20m'), // no time: given the benefit of the doubt
  ])
  assert.deepEqual(scores.map((s) => s.value), [0, 1, 1, 0, 1])
  assert.deepEqual(scores[0].alerts, ['outsideSession'])
  assert.deepEqual(scores[3].alerts, ['outsideSession'])
  assert.equal(summary.total, 9)
})

test('the summary lists every band, with its contacts, points and multipliers', () => {
  // The score is posted by hand from these lines, so each band has to carry
  // its points and multipliers, not only its QSOs; a DX contact is a point but
  // no multiplier, so the two differ on 20m. 40m sits above 20m whatever order
  // they were worked in, and 10m — not a band in this contest — never shows.
  const { summary } = run([qso('W1AW', 'CT', '20m'), qso('DL1ABC', 'DX', '20m'), qso('VE3XYZ', 'ON', '20m'), qso('XE1ABC', 'XE', '40m')])
  const lines = (summary.longSummary ?? '').split('\n').filter((line) => line.startsWith('**'))
  assert.deepEqual(lines, [
    '**160m**: —',
    '**80m**: —',
    '**40m**: 1 QSO, 1 pt, 1 mult',
    '**20m**: 3 QSOs, 3 pts, 2 mults',
    '**15m**: —',
  ])
})
