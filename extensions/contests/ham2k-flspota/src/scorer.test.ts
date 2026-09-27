// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Each test pins one sentence of the 2026 FSPOTA rules, or one way the score
// could come to disagree with the per-park ADIF files the sponsor counts.

import { test } from "node:test"
import assert from "node:assert/strict"

import type { JSONValue } from "@ham2k/extension-sdk"
import { QSOS_TO_ACTIVATE } from "./event.ts"
import { FlspotaScorer, parksActivated, type FlspotaScoresheet } from "./scorer.ts"

const ctx = { online: false } as never

// Listed Florida parks, from parks.json.
const PARK_A = 'US-0634'
const PARK_B = 'US-0635'
const PARK_C = 'US-1832'
// A POTA park that is not on Florida's list.
const ELSEWHERE = 'US-5579'

const OWN_REF = { type: 'flspota' }
const LEGACY_REF = { type: 'stateparks', ref: 'FLSP' }

function operationFor(...ourParks: string[]): Record<string, JSONValue> {
  return { uuid: 'op', stationCall: 'K4AAA', refs: ourParks.map((ref) => ({ type: 'potaActivation', ref })) }
}

interface QsoSpec { call?: string; band?: string; mode?: string; hunting?: string[] }

function qso({ call = 'W1USA', band = '20m', mode = 'SSB', hunting = [] }: QsoSpec = {}): Record<string, JSONValue> {
  return { their: { call }, band, mode, refs: hunting.map((ref) => ({ type: 'pota', ref })) }
}

type Entry = Record<string, JSONValue> | { qso: Record<string, JSONValue>; operation: Record<string, JSONValue> }

function run(entries: Entry[], operation = operationFor(PARK_A), ref: Record<string, JSONValue> = OWN_REF) {
  let sheet: FlspotaScoresheet = FlspotaScorer.startScoresheet({ operation, ref }, ctx)
  const scores = entries.map((entry) => {
    const q = ('qso' in entry ? entry.qso : entry) as Record<string, JSONValue>
    const op = ('qso' in entry ? entry.operation : operation) as Record<string, JSONValue>
    const result = FlspotaScorer.scoreQso({ scoresheet: sheet, qso: q, operation: op, ref, isNewDay: false }, ctx)
    sheet = result.scoresheet
    return result.score
  })
  const summary = () => FlspotaScorer.summarizeScore({ scoresheet: sheet, operation, ref, scope: 'operation' }, ctx)
  return { sheet, scores, summary }
}

function filler(count: number, spec: QsoSpec = {}, prefix = 'K9'): Record<string, JSONValue>[] {
  return Array.from({ length: count }, (_, i) => qso({ ...spec, call: `${prefix}${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}A` }))
}

test("§6.1.4.1: 40 SSB and 10 CW from one park is 60, plus 100 for the park", () => {
  const { summary } = run([...filler(40), ...filler(10, { mode: 'CW' }, 'W9')])
  const tally = summary().flspota
  assert.equal(tally.points, 60)
  // The sponsor's 260 includes the first-time activator bonus, which is claimed
  // on their form and is not in a log.
  assert.equal(tally.total, 160)
  assert.equal(tally.label, 'FSPOTA: 160 points')
  // No multiplier clause at all: the event has none, and "× 1 mult" would
  // suggest one the operator is missing.
  assert.equal(String(tally.longSummary).split('\n')[0], '50 QSOs, 60 pts + 100 bonus')
})

test("§6.1.4.2: three parks, 60 SSB and 20 CW in all, is 100 + 300", () => {
  const ops = [operationFor(PARK_A), operationFor(PARK_B), operationFor(PARK_C)]
  const entries = ops.flatMap((operation, index) => [
    ...filler(20, {}, `K${index}`).map((q) => ({ qso: q, operation })),
    // The rules' 20 CW spread so that every park still reaches ten contacts.
    ...filler(index === 0 ? 8 : 6, { mode: 'CW' }, `W${index}`).map((q) => ({ qso: q, operation })),
  ])
  const { summary } = run(entries)
  assert.equal(summary().flspota.points, 100)
  assert.equal(summary().flspota.total, 400)
})

test("§6.1.2: a park is activated at ten QSOs, not nine, and the bonus is once per park", () => {
  assert.equal(parksActivated(run(filler(QSOS_TO_ACTIVATE - 1)).sheet), 0)
  assert.equal(parksActivated(run(filler(QSOS_TO_ACTIVATE)).sheet), 1)
  assert.equal(run(filler(25)).summary().flspota.total, 25 + 100)
})

test("§4.5: each mode is a separate contact — FT8, FT4 and RTTY are three", () => {
  // Folding modes into PHONE/CW/DATA, as the combined scorer did, makes this 1.
  const { scores } = run(['FT8', 'FT4', 'RTTY', 'FT8'].map((mode) => qso({ mode })))
  assert.deepEqual(scores.map((s) => s.value), [1, 1, 1, 0])
  assert.equal(scores[3].dupe, true)
})

test("§4.3: K4AAA on CW and then on SSB is two contacts, and CW is worth two", () => {
  const { scores } = run([qso({ mode: 'CW' }), qso({ mode: 'USB' }), qso({ mode: 'LSB' })])
  assert.deepEqual(scores.map((s) => s.value), [2, 1, 0])
})

test("§4.2: only 160, 80, 40, 20, 15, 10 and 6 m", () => {
  for (const band of ['60m', '30m', '17m', '12m', '2m', '']) {
    assert.deepEqual(run([qso({ band })]).scores[0].alerts, ['invalidBand'], band)
  }
  for (const band of ['160m', '6m']) assert.equal(run([qso({ band })]).scores[0].value, 1, band)
})

test("§7.2: each park is its own log, so a station worked from one park counts again from the next", () => {
  // The combined scorer called the second a duplicate — and the second park's
  // ADIF, which has that contact in it, then claimed more than the score did.
  const first = operationFor(PARK_A)
  const second = operationFor(PARK_B)
  const { scores, sheet } = run([
    { qso: qso(), operation: first },
    { qso: qso(), operation: second },
    { qso: qso(), operation: second },
  ])
  assert.deepEqual(scores.map((s) => s.value), [1, 1, 0])
  // Worked before and credited anyway has to SAY so, or the app's own
  // `duplicate` alert stands beside the credit.
  assert.deepEqual(scores[1].notices, ['newRef'])
  assert.deepEqual(sheet.activated, { [PARK_A]: 1, [PARK_B]: 1 })
})

test("an activation at two listed parks at once is a contact in both logs", () => {
  const { scores, sheet } = run([qso({ mode: 'CW' })], operationFor(PARK_A, PARK_B))
  assert.equal(scores[0].value, 4)
  assert.deepEqual(sheet.activated, { [PARK_A]: 1, [PARK_B]: 1 })
})

test("§7.4: a station at two parks is two records in a POTA-format log, and two contacts", () => {
  // Listed or not: POTA's hook writes a record per hunted park either way.
  const { scores, sheet } = run([qso({ hunting: [PARK_B, ELSEWHERE] })])
  assert.equal(scores[0].value, 2)
  assert.equal(sheet.qsos, 2)
  // Only the listed one is a Florida park worked.
  assert.deepEqual(Object.keys(sheet.hunted), [PARK_B])
})

test("a rover is a new contact from a park they had not given us, and says so", () => {
  const { scores } = run([
    qso({ call: 'K4BBB', hunting: [PARK_B] }),
    qso({ call: 'K4CCC', hunting: [PARK_C] }),
    qso({ call: 'K4BBB', hunting: [PARK_C] }),
    qso({ call: 'K4BBB', hunting: [PARK_C] }),
    // Back home: "no park" is not a park the slot was still missing.
    qso({ call: 'K4BBB' }),
  ])
  assert.deepEqual(scores.map((s) => s.value), [1, 1, 1, 0, 0])
  // New on no axis but the slot's — same band, same mode, a park already in
  // the log — which is the case a log-wide `newPark` test misses.
  assert.deepEqual(scores[2].notices, ['newPark'])
})

test("§6.2.1: in no listed park we are a hunter, and only a Florida park is a contact", () => {
  const { scores, sheet, summary } = run(
    [qso({ call: 'K4BBB', hunting: [PARK_B] }), qso({ call: 'W5XYZ' }), qso({ call: 'N9ZZ', hunting: [ELSEWHERE] })],
    operationFor(ELSEWHERE),
  )
  assert.deepEqual(scores.map((s) => s.value), [1, 0, 0])
  assert.equal(scores[1].alerts, undefined)
  assert.equal(sheet.qsos, 1)
  assert.equal(summary().flspota.total, 1)
})

test("an operation logged under the combined extension is scored as it stands", () => {
  const { scores, summary } = run([qso({ mode: 'CW' })], operationFor(PARK_A), LEGACY_REF)
  assert.equal(scores[0].value, 2)
  assert.equal(summary().flspota.points, 2)
})

test("another state-park event's legacy operation is declined without a word", () => {
  // The scope names `stateparks`, so Texas's operations reach this scorer too.
  // Scoring one, or alerting on one, would put Florida on a Texas log.
  const { scores, summary } = run([qso()], operationFor(PARK_A), { type: 'stateparks', ref: 'TXSP' })
  assert.deepEqual(scores[0], { value: 0 })
  assert.deepEqual(summary(), {})
})

test("offers no per-day summary", () => {
  // The park bonus is won across the whole event, so a day's share of the
  // score is not a number the sponsor defines.
  const operation = operationFor(PARK_A)
  const { sheet } = run(filler(12), operation)
  assert.deepEqual(FlspotaScorer.summarizeScore({ scoresheet: sheet, operation, ref: OWN_REF, scope: 'day' }, ctx), {})
})
