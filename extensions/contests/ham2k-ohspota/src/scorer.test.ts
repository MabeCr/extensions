// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The sponsor's own example first, then each rule of theirs that changes a
// number — several of which the combined scorer got wrong: our own park was a
// multiplier only after ten contacts, a station in no park worked from no park
// scored, and three parks' worth of MPO operating was one entry.

import { test } from "node:test"
import assert from "node:assert/strict"

import type { JSONValue } from "@ham2k/extension-sdk"
import { OhspotaScorer, type OhspotaScoresheet } from "./scorer.ts"

const ctx = { online: false } as never

const PUN = { abbreviation: 'PUN', ref: 'US-1985' }
const ADA = { abbreviation: 'ADA', ref: 'US-1932' }

const OWN_REF = { type: 'ohspota' }

function operationFor(ourPark?: string, ...activating: string[]): Record<string, JSONValue> {
  return {
    uuid: 'op',
    stationCall: 'K8BF',
    refs: [
      { ...OWN_REF, ...(ourPark ? { ourPark } : {}) },
      ...activating.map((ref) => ({ type: 'potaActivation', ref })),
    ],
  }
}

interface QsoSpec { call?: string; band?: string; mode?: string; park?: string; legacyPark?: string; hunting?: string[] }

function qso({ call = 'W8AAA', band = '40m', mode = 'SSB', park, legacyPark, hunting = [] }: QsoSpec = {}): Record<string, JSONValue> {
  return {
    their: { call },
    band,
    mode,
    refs: [
      ...hunting.map((ref) => ({ type: 'pota', ref })),
      ...(park !== undefined ? [{ type: 'ohspota', park }] : []),
      ...(legacyPark !== undefined ? [{ type: 'stateparks', park: legacyPark }] : []),
    ],
  }
}

type Entry = Record<string, JSONValue> | { qso: Record<string, JSONValue>; operation: Record<string, JSONValue> }

function run(entries: Entry[], operation = operationFor('PUN')) {
  const refOf = (op: Record<string, JSONValue>) => ((op.refs as Record<string, JSONValue>[]).find((r) => r.type === 'ohspota' || r.type === 'stateparks')) as Record<string, JSONValue>
  let sheet: OhspotaScoresheet = OhspotaScorer.startScoresheet({ operation, ref: refOf(operation) }, ctx)
  const scores = entries.map((entry) => {
    const q = ('qso' in entry ? entry.qso : entry) as Record<string, JSONValue>
    const op = ('qso' in entry ? entry.operation : operation) as Record<string, JSONValue>
    const result = OhspotaScorer.scoreQso({ scoresheet: sheet, qso: q, operation: op, ref: refOf(op), isNewDay: false }, ctx)
    sheet = result.scoresheet
    return result.score
  })
  const summary = () => OhspotaScorer.summarizeScore({ scoresheet: sheet, operation, ref: refOf(operation), scope: 'operation' }, ctx).ohspota
  return { sheet, scores, summary }
}

const OTHER_PARKS = ['ADA', 'BLU', 'CAT', 'HOC', 'SBI', 'OPT', 'MBI', 'NBI', 'KEL']

/// [count] distinct stations, the first [parks] of them each in a different
/// park that is not ours.
function contacts(count: number, parks = 0, spec: QsoSpec = {}, prefix = 'W8'): Record<string, JSONValue>[] {
  return Array.from({ length: count }, (_, i) => qso({
    ...spec,
    call: `${prefix}${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}A`,
    ...(i < parks ? { park: OTHER_PARKS[i] } : {}),
  }))
}

test("the sponsor's example: 37 contacts from PUN, 9 other parks — '9 plus PUN, Total score = 10 x 37 = 370'", () => {
  const { summary } = run([
    ...contacts(10, 9, { band: '80m' }),
    ...contacts(15, 0, { band: '40m' }, 'K8'),
    ...contacts(12, 0, { band: '15m', mode: 'CW' }, 'N8'),
  ])
  assert.equal(summary().total, 370)
  assert.equal(summary().label, 'OSPOTA: 370 points')
  // Our own park is one of the ten: the arithmetic must multiply by the same
  // count the score did, or it disagrees with the title.
  assert.equal(String(summary().longSummary).split('\n')[0], '37 QSOs, 37 pts × 10 mults')
})

test("our own park is a multiplier from the first contact — no ten-contact threshold", () => {
  // The combined scorer counted it only at ten, so this read 3 × 1.
  assert.equal(run(contacts(3)).summary().total, 3 * 1)
  assert.equal(run(contacts(3, 1)).summary().total, 3 * 2)
})

test("our park is ONE multiplier, however many stations we work there", () => {
  const { summary } = run([qso({ call: 'W8AAA', park: 'PUN' }), qso({ call: 'W8BBB', park: 'PUN' })])
  assert.equal(summary().total, 2 * 1)
})

test("'Stations may be worked once on each band/mode'", () => {
  const { scores } = run([
    qso({ park: 'ADA' }), qso({ park: 'ADA' }), qso({ park: 'ADA', mode: 'CW' }), qso({ park: 'ADA', band: '20m' }),
  ])
  assert.deepEqual(scores.map((s) => s.value), [1, 0, 1, 1])
  assert.equal(scores[1].dupe, true)
})

test("SSB and CW only: a digital contact is not a contact here", () => {
  const { scores } = run([qso({ mode: 'FT8', park: 'ADA' }), qso({ mode: 'RTTY' }), qso({ mode: 'USB', park: 'ADA' })])
  assert.deepEqual(scores[0], { value: 0, alerts: ['invalidMode'] })
  assert.equal(scores[1].value, 0)
  assert.equal(scores[2].value, 1)
})

test("80, 40, 20, 15 and 10 m only", () => {
  for (const band of ['160m', '60m', '30m', '17m', '12m', '6m', '']) {
    assert.deepEqual(run([qso({ band })]).scores[0].alerts, ['invalidBand'], band)
  }
})

test("in no park, only a station in one may be worked", () => {
  // "Ohio stations not located in an Ohio State Park may only contact stations
  // operating from inside an Ohio State Park."
  const { scores, summary } = run([qso({ call: 'W8AAA', park: 'ADA' }), qso({ call: 'W8BBB', park: 'NOT' }), qso({ call: 'W8CCC' })], operationFor())
  assert.deepEqual(scores.map((s) => s.value), [1, 0, 0])
  assert.deepEqual(scores[1].alerts, ['invalidExchange'])
  assert.deepEqual(scores[2].alerts, ['missingExchange'])
  assert.equal(summary().total, 1)
})

test("in a park everyone counts, and a missing or unknown park says so", () => {
  const { scores } = run([qso({ call: 'W8AAA' }), qso({ call: 'KD4BF', park: 'GA' })])
  assert.deepEqual(scores.map((s) => s.value), [1, 1])
  assert.deepEqual(scores[0].alerts, ['missingExchange'])
  assert.deepEqual(scores[1].alerts, ['invalidExchange'])
})

test("what was typed is the park of record, over a POTA reference that disagrees", () => {
  const { sheet } = run([qso({ park: 'ADA', hunting: ['US-1958'] })])
  assert.deepEqual(Object.keys(sheet.entries.PUN.hunted), ['ADA'])
  // Nothing typed: the reference supplies it.
  assert.deepEqual(Object.keys(run([qso({ hunting: [ADA.ref] })]).sheet.entries.PUN.hunted), ['ADA'])
  // A DELIBERATE blank is a decision, and no reference overrides it.
  assert.deepEqual(Object.keys(run([qso({ park: '', hunting: [ADA.ref] })]).sheet.entries.PUN.hunted), [])
})

test("each park we operate from is its own entry, and a station counts again at the next", () => {
  // "If you activate three Ohio State Parks in the MPO category, send in three
  // Summary Sheets and three Log files."
  const first = operationFor('PUN')
  const second = operationFor('ADA')
  const { scores, summary } = run([
    ...contacts(3, 1).map((q) => ({ qso: q, operation: first })),
    ...contacts(2).map((q) => ({ qso: q, operation: second })),
  ])
  assert.deepEqual(scores.map((s) => s.value), [1, 1, 1, 1, 1])
  // Worked before on this band and mode, and counted: the verdict says so, or
  // the app's own `duplicate` alert stands beside the credit.
  assert.deepEqual(scores[3].notices, ['newRef'])
  // PUN: 3 × (PUN + ADA) = 6. ADA: 2 × ADA = 2. Not 5 × 2 as one entry.
  assert.equal(summary().total, 8)
  assert.equal(summary().label, 'OSPOTA: 8 points')
  // Each entry's product, never one product over the pooled contacts (5 × 2).
  assert.equal(String(summary().longSummary).split('\n')[0], '5 QSOs, 6 + 2')
  assert.match(String(summary().longSummary), /\*\*PUN:\*\* 3 × 2 = 6/)
})

test("a rover worked again from a new park, on a band and mode already worked, says newPark", () => {
  const { scores } = run([
    qso({ call: 'W8ROV', park: 'ADA' }),
    qso({ call: 'W8TWO', park: 'BLU' }),
    qso({ call: 'W8ROV', park: 'BLU' }),
  ])
  assert.deepEqual(scores.map((s) => s.value), [1, 1, 1])
  assert.deepEqual(scores[2].notices, ['newPark'])
})

test("our park comes from setup first, then from a POTA activation", () => {
  assert.ok(run([qso()], operationFor(undefined, PUN.ref)).sheet.entries.PUN)
  assert.ok(run([qso()], operationFor('ADA', PUN.ref)).sheet.entries.ADA)
})

test("an entry short of ten contacts or four other parks is told so", () => {
  assert.match(String(run(contacts(3, 1)).summary().longSummary), /Needs 10 contacts, 4 with other parks: 3 and 1 so far/)
  assert.doesNotMatch(String(run(contacts(10, 4)).summary().longSummary), /Needs/)
})

test("an operation logged under the combined extension is scored, its QSOs' exchange included", () => {
  const operation: Record<string, JSONValue> = { uuid: 'op', refs: [{ type: 'stateparks', ref: 'OHSP', ourPark: 'PUN' }] }
  const { summary } = run([qso({ legacyPark: 'ADA' }), qso({ call: 'W8BBB' })], operation)
  assert.equal(summary().total, 2 * 2)
})

test("another state-park event's legacy operation is declined without a word", () => {
  const operation: Record<string, JSONValue> = { uuid: 'op', refs: [{ type: 'stateparks', ref: 'TXSP' }] }
  const { scores, summary } = run([qso({ park: 'ADA' })], operation)
  assert.deepEqual(scores[0], { value: 0 })
  assert.equal(summary(), undefined)
})

test("offers no per-day summary", () => {
  // Multipliers accumulate across each park's whole entry, so a day's share of
  // the score is not a number the sponsor defines.
  const operation = operationFor('PUN')
  const { sheet } = run(contacts(3, 1), operation)
  assert.deepEqual(OhspotaScorer.summarizeScore({ scoresheet: sheet, operation, ref: OWN_REF, scope: 'day' }, ctx), {})
})
