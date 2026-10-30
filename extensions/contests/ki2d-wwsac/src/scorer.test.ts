// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The WWSAC's score is points × prefixes, where a contact's points are the
// OTHER station's age group and each prefix counts once for the session — not
// per band, the way a contest copied from CQ WW would have it.

import { test } from "node:test"
import assert from "node:assert/strict"

import type { JSONValue } from "@ham2k/extension-sdk"

import { WwsacScorer } from "./scorer.ts"
import { wpxPrefix } from "./prefix.ts"

const ctx = { online: false } as never
const operation = { uuid: 'op', stationCall: 'KI2D' }
const ref = { type: 'wwsac', ref: '2026-10-27', ourAgeGroup: 'OM' }

function qso(call: string, ageGroup: string | undefined, band = '20m', extra: Record<string, JSONValue> = {}): Record<string, JSONValue> {
  return {
    their: { call },
    band,
    mode: 'USB',
    refs: [ageGroup === undefined ? { type: 'wwsac' } : { type: 'wwsac', ageGroup }],
    ...extra,
  }
}

function run(qsos: Record<string, JSONValue>[]) {
  let sheet = WwsacScorer.startScoresheet({ operation, ref }, ctx)
  const scores = qsos.map((q) => {
    const r = WwsacScorer.scoreQso({ scoresheet: sheet, qso: q, operation, ref, isNewDay: false }, ctx)
    sheet = r.scoresheet
    return r.score
  })
  const summary = WwsacScorer.summarizeScore({ scoresheet: sheet, operation, ref, scope: 'operation' } as never, ctx) as Record<string, { total?: number; longSummary?: string }>
  return { sheet, scores, summary: Object.values(summary)[0] }
}

test('a contact is worth the age group of the station worked', () => {
  const { scores, sheet } = run([qso('K1AA', 'OM'), qso('K2BB', 'YL'), qso('K3CC', 'Y'), qso('K4DD', 'YYL')])
  assert.deepEqual(scores.map((s) => s.value), [1, 5, 10, 15])
  assert.equal(sheet.points, 31)
})

test('the score is points times prefixes, each prefix counted once for the session', () => {
  const { scores, sheet, summary } = run([
    qso('K1AA', 'OM', '20m'),
    qso('K1BB', 'YL', '40m'), // K1 again, on another band: not a new multiplier
    qso('K1AA', 'OM', '40m'), // the same station on another band is a contact
    qso('W2XYZ', 'OM', '80m'),
  ])
  assert.deepEqual(scores.map((s) => s.notices ?? []), [['newMult'], [], ['newBand'], ['newMult']])
  assert.deepEqual(Object.keys(sheet.mults).sort(), ['K1', 'W2'])
  assert.equal(sheet.points, 8)
  assert.equal(summary.total, 16)
})

test('a station is worked once per band', () => {
  const { scores, sheet } = run([qso('K1AA', 'OM'), qso('K1AA', 'OM')])
  assert.equal(scores[1].dupe, true)
  assert.equal(scores[1].value, 0)
  assert.equal(sheet.qsos, 1)
})

test('SSB on 160 through 6m only', () => {
  const { scores } = run([
    qso('K1AA', 'OM', '6m'),
    qso('K2AA', 'OM', '160m'),
    qso('K3AA', 'OM', '30m'),
    qso('K4AA', 'OM', '20m', { mode: 'CW' }),
    qso('K5AA', 'OM', '20m', { mode: 'LSB' }),
  ])
  assert.deepEqual(scores.map((s) => s.value), [1, 1, 0, 0, 1])
  assert.deepEqual(scores[2].alerts, ['invalidBand'])
  assert.deepEqual(scores[3].alerts, ['invalidMode'])
})

test('a missing or unknown age group still counts, as an OM, and says so', () => {
  const { scores, sheet } = run([qso('K1AA', undefined), qso('K2AA', 'XX'), qso('K3AA', 'youth')])
  assert.deepEqual(scores.map((s) => s.value), [1, 1, 10])
  assert.deepEqual(scores[0].alerts, ['missingExchange'])
  assert.deepEqual(scores[1].alerts, ['invalidExchange'])
  assert.equal(scores[2].alerts, undefined)
  assert.equal(sheet.qsos, 3)
  // The summary's age groups still add up to the contacts.
  assert.match(run([qso('K1AA', undefined), qso('K2AA', 'XX'), qso('K3AA', 'YL')]).summary.longSummary ?? '', /YL 1 · \? 2/)
})

test('the summary breaks the score down by band, age group and prefix', () => {
  const { summary } = run([qso('K1AA', 'OM', '20m'), qso('VE3XX', 'YL', '40m')])
  assert.match(summary.longSummary ?? '', /\*\*40m\*\*: 1 QSOs, 5 pts/)
  assert.match(summary.longSummary ?? '', /OM 1 · YL 1/)
  assert.match(summary.longSummary ?? '', /K1 VE3/)
})

test('prefixes are CQ WPX\'s', () => {
  assert.equal(wpxPrefix('KI2D'), 'KI2')
  assert.equal(wpxPrefix('N8BJQ/KH9'), 'KH9')
  assert.equal(wpxPrefix('LZ2ITU/P'), 'LZ2')
  assert.equal(wpxPrefix('PA/N8BJQ'), 'PA0')
  assert.equal(wpxPrefix('LY1000'), 'LY1000')
})
