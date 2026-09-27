// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The sponsor's rules carry no worked example with numbers, so each test pins
// one sentence of §6 — and the places the combined scorer departed from it: a
// 100-point per-park bonus the rules do not contain, a hunter credited for
// contacts §5.2 says do not count, and digital modes folded into one.

import { test } from "node:test"
import assert from "node:assert/strict"

import type { JSONValue } from "@ham2k/extension-sdk"
import { QSOS_TO_ACTIVATE } from "./event.ts"
import { TxspotaScorer, totalsFor, type TxspotaScoresheet } from "./scorer.ts"

const ctx = { online: false } as never

// Listed Texas parks, from parks.json.
const PARKS = ['US-2983', 'US-2984', 'US-2985', 'US-2986', 'US-2987', 'US-2988']
const [PARK_A, PARK_B, PARK_C, PARK_D] = PARKS
// A POTA park that is not in the sponsor's directory.
const ELSEWHERE = 'US-5579'

function operationFor(...ourParks: string[]): Record<string, JSONValue> {
  return { uuid: 'op', stationCall: 'KE5CW', refs: ourParks.map((ref) => ({ type: 'potaActivation', ref })) }
}

interface QsoSpec { call?: string; band?: string; mode?: string; hunting?: string[] }

function qso({ call = 'W1USA', band = '20m', mode = 'SSB', hunting = [] }: QsoSpec = {}): Record<string, JSONValue> {
  return { their: { call }, band, mode, refs: hunting.map((ref) => ({ type: 'pota', ref })) }
}

type Entry = Record<string, JSONValue> | { qso: Record<string, JSONValue>; operation: Record<string, JSONValue> }

function run(entries: Entry[], operation = operationFor(PARK_A), ref: Record<string, JSONValue> = { type: 'txspota' }) {
  let sheet: TxspotaScoresheet = TxspotaScorer.startScoresheet({ operation, ref }, ctx)
  const scores = entries.map((entry) => {
    const q = ('qso' in entry ? entry.qso : entry) as Record<string, JSONValue>
    const op = ('qso' in entry ? entry.operation : operation) as Record<string, JSONValue>
    const result = TxspotaScorer.scoreQso({ scoresheet: sheet, qso: q, operation: op, ref, isNewDay: false }, ctx)
    sheet = result.scoresheet
    return result.score
  })
  const summary = () => TxspotaScorer.summarizeScore({ scoresheet: sheet, operation, ref, scope: 'operation' }, ctx)
  return { sheet, scores, summary, totals: () => totalsFor(sheet) }
}

function filler(count: number, spec: QsoSpec = {}, prefix = 'K9'): Record<string, JSONValue>[] {
  return Array.from({ length: count }, (_, i) => qso({ ...spec, call: `${prefix}${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}A` }))
}

test("§6.5.1: QSO points × (power + parks worked + parks activated) — the three ADD", () => {
  // 10 SSB + 2 CW from one park, two of them with other Texas parks, QRP:
  // 14 points × (3 + 2 + 1). Multiplying the terms instead would give 84.
  const { summary, totals } = run(
    [...filler(8), qso({ call: 'K5AAA', hunting: [PARK_B] }), qso({ call: 'K5BBB', hunting: [PARK_C] }), ...filler(2, { mode: 'CW' }, 'W9')],
    operationFor(PARK_A),
    { type: 'txspota', ourPower: 'QRP' },
  )
  assert.deepEqual(totals(), { worked: 2, activated: 1, power: 3, mult: 6, bonus: 0 })
  assert.equal(summary().txspota.total, 14 * 6)
  // Each term of the sum is a KIND of multiplier the arithmetic names, so the
  // operator can see which one a missing multiplier belongs to.
  assert.equal(String(summary().txspota.longSummary).split('\n')[0], '12 QSOs, 14 pts × 6 mults (1 park activated, 2 parks worked, 3 power)')
})

test("§6.3.4: QRP adds 3, LOW 2, HIGH 1 — and an undeclared class claims nothing", () => {
  const term = (ourPower?: string) => run([qso()], operationFor(PARK_A), { type: 'txspota', ...(ourPower ? { ourPower } : {}) }).totals().power
  assert.deepEqual([term('QRP'), term('LP'), term('HP'), term(), term('KW')], [3, 2, 1, 0, 0])
  // No parks and no class is still worth its points, not zero.
  assert.equal(run([qso()]).summary().txspota.total, 1)
})

test("there is no bonus per park activated: a park is a term in the sum and nothing more", () => {
  // The combined scorer added 100 points here, from a data file the 2026 rules
  // do not support.
  const { totals, summary } = run(filler(QSOS_TO_ACTIVATE))
  assert.deepEqual(totals(), { worked: 0, activated: 1, power: 0, mult: 1, bonus: 0 })
  assert.equal(summary().txspota.total, 10)
})

test("§9.1: a park is activated at POTA's ten contacts, not nine", () => {
  assert.equal(run(filler(QSOS_TO_ACTIVATE - 1)).totals().activated, 0)
  assert.equal(run(filler(QSOS_TO_ACTIVATE)).totals().activated, 1)
})

test("§6.4.1: K5LRK is worth five, once per contest — in a park or not, to a hunter or not", () => {
  const activator = run([qso({ call: 'K5LRK' }), qso({ call: 'K5LRK', band: '40m' })])
  assert.equal(activator.totals().bonus, 5)
  assert.deepEqual(activator.scores[0].notices, ['bonusStation'])
  assert.equal(activator.summary().txspota.total, 2 * 1 + 5)
  // A hunter's contact with a station in no park scores nothing, and the host
  // station's bonus is still theirs.
  const hunter = run([qso({ call: 'K5LRK' })], operationFor())
  assert.equal(hunter.scores[0].value, 0)
  assert.equal(hunter.totals().bonus, 5)
})

test("§6.4.2: fifty for activating MORE than three parks — four, not three", () => {
  const log = (parks: string[]) => parks.flatMap((park, index) => filler(QSOS_TO_ACTIVATE, {}, `K${index}`).map((q) => ({ qso: q, operation: operationFor(park) })))
  assert.equal(run(log([PARK_A, PARK_B, PARK_C])).totals().bonus, 0)
  assert.equal(run(log([PARK_A, PARK_B, PARK_C, PARK_D])).totals().bonus, 50)
})

test("§6.4.3: fifty for the same activator call in three different parks, once", () => {
  const rover = (call: string, parks: string[]) => parks.map((park) => qso({ call, hunting: [park] }))
  assert.equal(run(rover('K5ROV', [PARK_B, PARK_C])).totals().bonus, 0)
  assert.equal(run(rover('K5ROV', [PARK_B, PARK_C, PARK_D])).totals().bonus, 50)
  // The same park three times over is one park.
  assert.equal(run([qso({ call: 'K5ROV', hunting: [PARK_B] }), qso({ call: 'K5ROV', band: '40m', hunting: [PARK_B] }), qso({ call: 'K5ROV', mode: 'CW', hunting: [PARK_B] })]).totals().bonus, 0)
  // A park outside the directory is not one of the three.
  assert.equal(run(rover('K5ROV', [PARK_B, PARK_C, ELSEWHERE])).totals().bonus, 0)
  // The rule does not say it repeats, so a second rover is not a second fifty.
  assert.equal(run([...rover('K5ROV', [PARK_B, PARK_C, PARK_D]), ...rover('K5TWO', [PARK_B, PARK_C, PARK_D])]).totals().bonus, 50)
})

test("§5.2: a hunter's QSO with anyone but a Texas park activator does not count", () => {
  const { scores, totals, sheet } = run(
    [qso({ call: 'K5AAA', mode: 'CW', hunting: [PARK_B] }), qso({ call: 'W5XYZ' }), qso({ call: 'N9ZZ', hunting: [ELSEWHERE] })],
    operationFor(),
    { type: 'txspota', ourPower: 'HP' },
  )
  assert.deepEqual(scores.map((s) => s.value), [2, 0, 0])
  assert.equal(scores[1].alerts, undefined)
  assert.equal(sheet.qsos, 1)
  // §6.5.2: points × (power + parks worked), with no activated term to have.
  assert.deepEqual(totals(), { worked: 1, activated: 0, power: 1, mult: 2, bonus: 0 })
})

test("§4.2: each mode is a separate contact — FT8, FT4 and RTTY are three, each worth one", () => {
  const { scores } = run(['FT8', 'FT4', 'RTTY', 'FT8', 'CW'].map((mode) => qso({ mode })))
  assert.deepEqual(scores.map((s) => s.value), [1, 1, 1, 0, 2])
  assert.equal(scores[3].dupe, true)
})

test("§4.3: 60, 30, 17 and 12 m do not count, and neither does no band at all", () => {
  for (const band of ['60m', '30m', '17m', '12m', '']) {
    assert.deepEqual(run([qso({ band })]).scores[0].alerts, ['invalidBand'], band)
  }
  assert.equal(run([qso({ band: '2m' })]).scores[0].value, 1)
})

test("§6.1 'per park', ours: a station worked from one park counts again from the next, and says so", () => {
  const first = operationFor(PARK_A)
  const second = operationFor(PARK_B)
  const { scores } = run([{ qso: qso(), operation: first }, { qso: qso(), operation: second }, { qso: qso(), operation: second }])
  assert.deepEqual(scores.map((s) => s.value), [1, 1, 0])
  assert.deepEqual(scores[1].notices, ['newRef'])
})

test("§6.1 'per park', theirs: a rover is a new contact at each park, and only at a NEW one", () => {
  const { scores } = run([
    qso({ call: 'K5ROV', hunting: [PARK_B] }),
    qso({ call: 'K5TWO', hunting: [PARK_C] }),
    qso({ call: 'K5ROV', hunting: [PARK_C] }),
    qso({ call: 'K5ROV', hunting: [PARK_C] }),
    qso({ call: 'K5ROV' }),
  ])
  assert.deepEqual(scores.map((s) => s.value), [1, 1, 1, 0, 0])
  // New on no axis but the slot's — the case a log-wide `newPark` test misses,
  // leaving the app's own `duplicate` alert beside the credit.
  assert.deepEqual(scores[2].notices, ['newPark'])
})

test("a power class declared only in a later segment still reaches the score", () => {
  // `summarizeScore` is handed the BASE operation's ref, so the class has to be
  // recorded as the fold goes — and the 0 of "not declared yet" must not latch.
  const operation = operationFor(PARK_A)
  let sheet: TxspotaScoresheet = TxspotaScorer.startScoresheet({ operation, ref: { type: 'txspota' } }, ctx)
  sheet = TxspotaScorer.scoreQso({ scoresheet: sheet, qso: qso({ call: 'K1AAA' }), operation, ref: { type: 'txspota' }, isNewDay: false }, ctx).scoresheet
  sheet = TxspotaScorer.scoreQso({ scoresheet: sheet, qso: qso({ call: 'K1BBB' }), operation, ref: { type: 'txspota', ourPower: 'QRP' }, isNewDay: false }, ctx).scoresheet
  assert.equal(totalsFor(sheet).power, 3)
})

test("an operation logged under the combined extension keeps its power class; another event's is declined", () => {
  const legacy = run([qso()], operationFor(PARK_A), { type: 'stateparks', ref: 'TXSP', ourPower: 'LP' })
  assert.equal(legacy.totals().power, 2)
  const florida = run([qso()], operationFor(PARK_A), { type: 'stateparks', ref: 'FLSP' })
  assert.deepEqual(florida.scores[0], { value: 0 })
  assert.deepEqual(florida.summary(), {})
})

test("the title names the event and its score, over the arithmetic with the bonus outside the product", () => {
  // The bonus is added AFTER the multiplier sum (§6.5.1); written inside the
  // product, the line would multiply out to a different score than the title's.
  const { summary } = run([qso({ call: 'K5LRK' }), ...filler(2, { mode: 'CW' })])
  const tally = summary().txspota
  assert.equal(tally.label, 'TSPOTA: 10 points')
  assert.equal(String(tally.longSummary).split('\n')[0], '3 QSOs, 5 pts × 1 mult + 5 bonus')
})

test("offers no per-day summary", () => {
  // Parks, the power term and the bonuses are won across the whole event, so a
  // day's share of the score is not a number the sponsor defines.
  const operation = operationFor(PARK_A)
  const { sheet } = run([qso()], operation)
  assert.deepEqual(TxspotaScorer.summarizeScore({ scoresheet: sheet, operation, ref: { type: 'txspota' }, scope: 'day' }, ctx), {})
})
