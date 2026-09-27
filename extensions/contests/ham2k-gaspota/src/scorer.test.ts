// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The sponsor's own worked examples first, then each reading the rules leave
// open — every one of which the sponsor's published 2026 results settle.

import { test } from "node:test"
import assert from "node:assert/strict"

import type { JSONValue } from "@ham2k/extension-sdk"
import { GaspotaScorer, totalsFor, type GaspotaScoresheet } from "./scorer.ts"

const ctx = { online: false } as never

// Listed Georgia parks, from parks.json: US-2165 … US-2207 are consecutive.
const park = (n: number) => `US-${2165 + n}`
const OUR_PARK = park(40)
const OUR_SECOND_PARK = park(41)
// A POTA park that is not on Georgia's list.
const ELSEWHERE = 'US-5579'

const OWN_REF = { type: 'gaspota' }
const DAY_ONE = Date.UTC(2026, 3, 18, 14, 0)
const DAY_TWO = Date.UTC(2026, 3, 19, 14, 0)

function operationFor(...ourParks: string[]): Record<string, JSONValue> {
  return { uuid: 'op', stationCall: 'K4AAA', refs: ourParks.map((ref) => ({ type: 'potaActivation', ref })) }
}

interface QsoSpec { call?: string; band?: string; mode?: string; hunting?: string[]; at?: number }

function qso({ call = 'W1USA', band = '20m', mode = 'SSB', hunting = [], at = DAY_ONE }: QsoSpec = {}): Record<string, JSONValue> {
  return { their: { call }, band, mode, startAtMillis: at, refs: hunting.map((ref) => ({ type: 'pota', ref })) }
}

type Entry = Record<string, JSONValue> | { qso: Record<string, JSONValue>; operation: Record<string, JSONValue> }

function run(entries: Entry[], operation = operationFor(OUR_PARK), ref: Record<string, JSONValue> = OWN_REF) {
  let sheet: GaspotaScoresheet = GaspotaScorer.startScoresheet({ operation, ref }, ctx)
  const scores = entries.map((entry) => {
    const q = ('qso' in entry ? entry.qso : entry) as Record<string, JSONValue>
    const op = ('qso' in entry ? entry.operation : operation) as Record<string, JSONValue>
    const result = GaspotaScorer.scoreQso({ scoresheet: sheet, qso: q, operation: op, ref, isNewDay: false }, ctx)
    sheet = result.scoresheet
    return result.score
  })
  const summary = () => GaspotaScorer.summarizeScore({ scoresheet: sheet, operation, ref, scope: 'operation' }, ctx)
  return { sheet, scores, summary, totals: () => totalsFor(sheet) }
}

/// [count] contacts with distinct stations, the first [parks] of them each in a
/// distinct listed park.
function contacts(count: number, parks = 0, prefix = 'K9', firstPark = 0): Record<string, JSONValue>[] {
  return Array.from({ length: count }, (_, i) => qso({
    call: `${prefix}${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}A`,
    mode: i % 5 === 0 ? 'CW' : 'SSB',
    hunting: i < parks ? [park(firstPark + i)] : [],
  }))
}

test("§6.1.2.1: 40 SSB and 10 CW, 6 of them with distinct Georgia parks, is 50 + 6×5 = 80", () => {
  // CW is worth the same point as SSB here — the combined scorer's per-mode
  // table said so too, and Florida's and Texas's two-point CW must not leak in.
  const { summary } = run(contacts(50, 6))
  assert.equal(summary().gaspota.total, 80)
  assert.equal(summary().gaspota.label, 'GASPOTA: 80 points')
  // The five points per distinct park are added INSIDE the parentheses: written
  // after the product, the line would not multiply out to a two-park score.
  assert.equal(String(summary().gaspota.longSummary).split('\n')[0], '50 QSOs, (50 pts + 30 bonus) × 1 mult')
})

test("§6.1.2.2: a second park the next day, 75 contacts and 12 parks, is 2 × (80 + 135) = 430", () => {
  const first = operationFor(OUR_PARK)
  const second = operationFor(OUR_SECOND_PARK)
  const { totals } = run([
    ...contacts(50, 6).map((q) => ({ qso: q, operation: first })),
    ...contacts(75, 12, 'W8', 6).map((q) => ({ qso: q, operation: second })),
  ])
  assert.deepEqual(totals().activator, { contacts: 125, distinctParks: 18, parksActivated: 2, total: 430 })
})

test("§6.2.2: a hunter with 45 contacts across 28 Georgia parks is 28 × 45 = 1260", () => {
  // The combined scorer put this entry through the ACTIVATOR formula and
  // reported 185.
  const calls = Array.from({ length: 45 }, (_, i) => qso({ call: `K4${String.fromCharCode(65 + (i % 26))}${i}`, hunting: [park(i % 28)] }))
  const { summary, totals } = run(calls, operationFor())
  assert.deepEqual(totals().hunter, { contacts: 45, parks: 28, bonus: 0, total: 1260 })
  assert.equal(summary().gaspota.total, 1260)
  assert.equal(summary().gaspota.label, 'GASPOTA: 1,260 points')
  // The hunter's formula, not the activator's: no five-point term.
  assert.equal(String(summary().gaspota.longSummary).split('\n')[0], '45 QSOs, 45 pts × 28 mults')
})

test("§6.2.1: a hunter's contact is one with a Georgia park, and nobody else", () => {
  const { scores, totals } = run(
    [qso({ call: 'K4ABC', hunting: [park(1)] }), qso({ call: 'W5XYZ' }), qso({ call: 'N9ZZ', hunting: [ELSEWHERE] })],
    operationFor(),
  )
  assert.deepEqual(scores.map((s) => s.value), [1, 0, 0])
  assert.equal(scores[1].alerts, undefined)
  assert.equal(totals().hunter.total, 1)
})

test("§6.2.1: 'K4ABC on CW, K4ABC on SSB, and K4DEF on SSB, all at the same park, counts as three contacts'", () => {
  const { totals } = run([
    qso({ call: 'K4ABC', mode: 'CW', hunting: [park(1)] }),
    qso({ call: 'K4ABC', mode: 'SSB', hunting: [park(1)] }),
    qso({ call: 'K4DEF', mode: 'SSB', hunting: [park(1)] }),
  ], operationFor())
  assert.deepEqual(totals().hunter, { contacts: 3, parks: 1, bonus: 0, total: 3 })
})

test("§6.2.3: hunting Georgia parks on both UTC days is worth 100", () => {
  const oneDay = run([qso({ call: 'K4ABC', hunting: [park(1)] }), qso({ call: 'K4DEF', hunting: [park(2)] })], operationFor())
  assert.equal(oneDay.totals().hunter.total, 4)
  const bothDays = run([qso({ call: 'K4ABC', hunting: [park(1)] }), qso({ call: 'K4DEF', hunting: [park(2)], at: DAY_TWO })], operationFor())
  assert.equal(bothDays.totals().hunter.total, 2 * 2 + 100)
  // Outside the product: the bonus is paid once, not once per park.
  assert.equal(String(bothDays.summary().gaspota.longSummary).split('\n')[0], '2 QSOs, 2 pts × 2 mults + 100 bonus')
  // A second day spent working nobody in a Georgia park is not a day of hunting.
  const idle = run([qso({ call: 'K4ABC', hunting: [park(1)] }), qso({ call: 'W5XYZ', at: DAY_TWO })], operationFor())
  assert.equal(idle.totals().hunter.bonus, 0)
})

test("a park counts as activated with fewer than ten QSOs — the sponsor's results score one at nine", () => {
  // 2026 results: 9 QSOs, 1 park activated. A ten-contact threshold here would
  // multiply that entry by zero.
  const { totals } = run(contacts(9, 1))
  assert.deepEqual(totals().activator, { contacts: 9, distinctParks: 1, parksActivated: 1, total: 14 })
})

test("§4.4: each mode is a separate contact — FT8, FT4 and RTTY are three", () => {
  const { scores } = run(['FT8', 'FT4', 'RTTY', 'FT8'].map((mode) => qso({ mode })))
  assert.deepEqual(scores.map((s) => s.value), [1, 1, 1, 0])
  assert.equal(scores[3].dupe, true)
})

test("§4.1: the WARC bands do not count, and nothing else is excluded", () => {
  for (const band of ['60m', '30m', '17m', '12m', '']) {
    assert.deepEqual(run([qso({ band })]).scores[0].alerts, ['invalidBand'], band)
  }
  for (const band of ['160m', '6m', '2m']) assert.equal(run([qso({ band })]).scores[0].value, 1, band)
})

test("each park is its own log: a station worked from one park counts again from the next, and says so", () => {
  const first = operationFor(OUR_PARK)
  const second = operationFor(OUR_SECOND_PARK)
  const { scores, totals } = run([{ qso: qso(), operation: first }, { qso: qso(), operation: second }, { qso: qso(), operation: second }])
  assert.deepEqual(scores.map((s) => s.value), [1, 1, 0])
  assert.deepEqual(scores[1].notices, ['newRef'])
  assert.equal(totals().activator.contacts, 2)
})

test("'n-fer contacts must be listed separately … to count as a new contact': two parks, two contacts", () => {
  const { scores, totals } = run([qso({ hunting: [park(1), ELSEWHERE] })])
  assert.equal(scores[0].value, 2)
  // Out-of-state parks "count just as regular contacts", and not toward C.
  assert.deepEqual(totals().activator, { contacts: 2, distinctParks: 1, parksActivated: 1, total: 7 })
})

test("a hunter's table ignores OUR park: the same station, band, mode and park is one row in THEIR log", () => {
  // From a second park of ours it is a new contact in our log, and still the
  // same single row in the activator's — which is where a hunter's score is
  // read from.
  const { totals } = run([
    { qso: qso({ call: 'K4ABC', hunting: [park(1)] }), operation: operationFor(OUR_PARK) },
    { qso: qso({ call: 'K4ABC', hunting: [park(1)] }), operation: operationFor(OUR_SECOND_PARK) },
  ])
  assert.equal(totals().activator.contacts, 2)
  assert.equal(totals().hunter.contacts, 1)
})

test("a rover credited again on a worked band and mode says newPark, even for a park already in the log", () => {
  const { scores } = run([
    qso({ call: 'K4BBB', hunting: [park(1)] }),
    qso({ call: 'K4CCC', hunting: [park(2)] }),
    qso({ call: 'K4BBB', hunting: [park(2)] }),
    qso({ call: 'K4BBB' }),
  ])
  assert.deepEqual(scores.map((s) => s.value), [1, 1, 1, 0])
  assert.deepEqual(scores[2].notices, ['newPark'])
})

test("an operation logged under the combined extension is scored; another event's is declined without a word", () => {
  const legacy = run(contacts(3, 1), operationFor(OUR_PARK), { type: 'stateparks', ref: 'GASP' })
  assert.equal(legacy.summary().gaspota.total, 8)
  const texas = run([qso()], operationFor(OUR_PARK), { type: 'stateparks', ref: 'TXSP' })
  assert.deepEqual(texas.scores[0], { value: 0 })
  assert.deepEqual(texas.summary(), {})
})

test("offers no per-day summary", () => {
  // Parks and the two-day bonus are won across the whole event, so a day's
  // share of the score is not a number the sponsor defines.
  const operation = operationFor(OUR_PARK)
  const { sheet } = run(contacts(3, 1), operation)
  assert.deepEqual(GaspotaScorer.summarizeScore({ scoresheet: sheet, operation, ref: OWN_REF, scope: 'day' }, ctx), {})
})
