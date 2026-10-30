// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Sweepstakes scoring is simple arithmetic — two points a contact, times the
// sections — wrapped in three rules that are easy to get quietly wrong: once
// per contest rather than per band, W/VE only, and only the first 24 hours of
// operating time. These encode each.

import { test } from "node:test"
import assert from "node:assert/strict"

import type { JSONValue } from "@ham2k/extension-sdk"

import { SSScorer, fmtDuration } from "./scorer.ts"

const ctx = { online: false, locale: 'en' } as never
const operation = { uuid: 'op', stationCall: 'N0DEV' }
const cwRef = { type: 'arrl-ss', mode: 'CW' }

const START = Date.UTC(2026, 10, 7, 21, 0)
const MINUTE = 60 * 1000

function qso(call: string, minutes: number, section = 'CT', band = '20m', mode = 'CW'): Record<string, JSONValue> {
  return {
    their: { call },
    band,
    mode,
    startAtMillis: START + minutes * MINUTE,
    refs: [{ type: 'arrl-ss', theirSerial: '1', theirPrecedence: 'A', theirCheck: '79', theirSection: section }],
  }
}

function run(qsos: Record<string, JSONValue>[], ref: Record<string, JSONValue> = cwRef) {
  let sheet = SSScorer.startScoresheet({ operation, ref }, ctx)
  const scores = qsos.map((q) => {
    const r = SSScorer.scoreQso({ scoresheet: sheet, qso: q, operation, ref, isNewDay: false }, ctx)
    sheet = r.scoresheet
    return r.score
  })
  const summary = SSScorer.summarizeScore({ scoresheet: sheet, operation, ref, scope: 'operation' }, ctx)['arrl-ss']
  return { sheet, scores, summary }
}

test("two points a contact, times the sections worked", () => {
  const { scores, summary } = run([qso('W1AW', 0, 'CT'), qso('K1ABC', 1, 'CT'), qso('W9JJ', 2, 'IL')])
  assert.deepEqual(scores.map((s) => s.value), [2, 2, 2])
  // 6 points × 2 sections.
  assert.equal(summary.total, 12)
  assert.deepEqual(scores.map((s) => s.notices ?? []), [['newMult'], [], ['newMult']])
})

test("a station counts once per contest, whatever the band, and W1AW/7 is W1AW", () => {
  const { scores, sheet } = run([qso('W1AW', 0), qso('W1AW', 5, 'CT', '40m'), qso('W1AW/7', 10)])
  assert.deepEqual(scores.map((s) => s.value), [2, 0, 0])
  assert.equal(scores[1].dupe, true)
  assert.equal(scores[2].dupe, true)
  // A counted contact says so, so core's per-band dupe rule stands down.
  assert.equal(scores[0].dupe, false)
  assert.equal(sheet.qsos, 1)
})

test("only W/VE stations count, the possessions included", () => {
  const { scores } = run([qso('DL1ABC', 0), qso('KH6ABC', 1, 'PAC'), qso('KP4ABC', 2, 'PR'), qso('VE3ABC', 3, 'ONS'), qso('KL7ABC', 4, 'AK')])
  assert.deepEqual(scores.map((s) => s.value), [0, 2, 2, 2, 2])
  assert.deepEqual(scores[0].alerts, ['invalidCategory'])
})

test("WARC bands and the other weekend's mode don't count", () => {
  const { scores } = run([qso('W1AW', 0, 'CT', '30m'), qso('K1ABC', 1, 'CT', '20m', 'SSB')])
  assert.deepEqual(scores.map((s) => s.alerts), [['invalidBand'], ['invalidMode']])
  // Phone is any voice mode.
  const phone = run([qso('W1AW', 0, 'CT', '20m', 'USB'), qso('K1ABC', 1, 'CT', '2m', 'FM'), qso('K2ABC', 2, 'CT', '10m', 'FM')], { type: 'arrl-ss', mode: 'SSB' })
  assert.deepEqual(phone.scores.map((s) => s.value), [2, 0, 2])
})

test("a section the list doesn't know scores the contact but no multiplier, and says so", () => {
  const { scores, summary } = run([qso('W1AW', 0, 'XX'), qso('K1ABC', 1, 'ct')])
  assert.deepEqual(scores.map((s) => s.value), [2, 2])
  // Lowercase is still CT; XX is nothing.
  assert.equal(summary.mults, 1)
  assert.deepEqual(scores.map((s) => s.alerts), [['invalidExchange'], undefined])
})

test("an exchange with a part missing or not one Sweepstakes sends is flagged while it can be fixed", () => {
  const withExchange = (call: string, minutes: number, exchange: Record<string, JSONValue>) => {
    const q = qso(call, minutes)
    const refs = q.refs as Record<string, JSONValue>[]
    q.refs = [{ ...refs[0], ...exchange }]
    return q
  }
  const { scores } = run([
    withExchange('W1AW', 0, { theirCheck: '' }),
    withExchange('K1ABC', 1, { theirSection: undefined as never }),
    withExchange('K2ABC', 2, { theirPrecedence: 'X' }),
    withExchange('K3ABC', 3, { theirCheck: '7' }),
    withExchange('K4ABC', 4, { theirSerial: '1A' }),
  ])
  assert.deepEqual(scores.map((s) => s.alerts), [['missingExchange'], ['missingExchange'], ['invalidExchange'], ['invalidExchange'], ['invalidExchange']])
  // Still scored: the log checker, not the logger, decides what a bad copy costs.
  assert.deepEqual(scores.map((s) => s.value), [2, 2, 2, 2, 2])
})

test("a gap of 30 minutes or more is an off-time; anything shorter is operating time", () => {
  const { sheet, summary } = run([qso('W1AW', 0), qso('K1ABC', 29), qso('K2ABC', 59), qso('K3ABC', 89)])
  // 0 → 29 operating, 29 → 59 is exactly 30 minutes off, 59 → 89 off again.
  assert.equal(sheet.operatedMillis, 29 * MINUTE)
  assert.equal(sheet.offTimes.length, 2)
  assert.match(String(summary.longSummary), /Operating time:\*\* 0h 29m of 24h — 23h 31m left/)
  assert.match(String(summary.longSummary), /Off times:\*\* 2129Z–2159Z \(0h 30m\), 2159Z–2229Z \(0h 30m\)/)
})

test("contacts past 24 hours of operating time score nothing, but the clock leaves out the off-times", () => {
  // A contact every 20 minutes — all operating time — with one two-hour
  // break in the middle that does not count against the 24.
  const qsos: Record<string, JSONValue>[] = []
  let minute = 0
  for (let i = 0; i < 80; i++) {
    qsos.push(qso(`K${i}AA`, minute))
    minute += i === 30 ? 120 : 20
  }
  const { scores, sheet, summary } = run(qsos)
  // 72 gaps of 20 minutes make 24 hours exactly. The break is one of the 73
  // gaps before index 73, so that contact is at hour 24 — still in — and
  // every one after it is past.
  assert.equal(scores[73].value, 2)
  assert.equal(scores[74].value, 0)
  assert.deepEqual(scores[74].alerts, ['overTime'])
  // Editing a contact from before the limit, scored against the whole log,
  // is not over time; one after it still is.
  const edit = (index: number) => SSScorer.scoreQso({ scoresheet: structuredClone(sheet), qso: { ...qsos[index], their: { call: 'W9JJ' } }, operation, ref: cwRef, isNewDay: false }, ctx).score
  assert.equal(edit(5).value, 2)
  assert.equal(edit(73).value, 2)
  assert.deepEqual(edit(75).alerts, ['overTime'])
  assert.equal(sheet.overtime, 80 - 74)
  assert.equal(sheet.qsos, 74)
  assert.match(String(summary.longSummary), /all 24h 00m used/)
  assert.match(String(summary.longSummary), /6 contacts past the 24 hours/)

  const one = run(qsos.slice(0, 75))
  assert.match(String(one.summary.longSummary), /\*\*1 contact past the 24 hours\*\* doesn't count/)
})

test("the operating time leads the summary, ahead of sections and bands", () => {
  const { summary } = run([qso('W1AW', 0)])
  const detail = String(summary.longSummary).split('\n\n')
  // The arithmetic line, then the clock.
  assert.match(detail[0], /1 QSO/)
  assert.match(detail[1], /^\*\*Operating time/)
  assert.match(detail[2], /^\*\*Sections:\*\* 1 of 85/)
})

test("the missing sections are listed once few enough are left, and a Clean Sweep says so", async () => {
  const { ALL_SECTIONS } = await import("./sections.ts")
  const all = Object.keys(ALL_SECTIONS)
  const most = run(all.slice(0, 70).map((section, i) => qso(`K${i}AA`, i, section)))
  assert.match(String(most.summary.longSummary), new RegExp(`Missing:\\*\\* ${all.slice(70).sort().join(' ')}`))
  const sweep = run(all.map((section, i) => qso(`K${i}AA`, i, section)))
  assert.match(String(sweep.summary.longSummary), /Clean Sweep!\*\* All 85 sections/)
  assert.equal(sweep.summary.total, 85 * 2 * 85)
})

test("durations read as hours and minutes", () => {
  assert.equal(fmtDuration(0), '0h 00m')
  assert.equal(fmtDuration(18 * 3600000 + 5 * 60000 + 59000), '18h 05m')
})
