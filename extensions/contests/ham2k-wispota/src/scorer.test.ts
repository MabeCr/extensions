// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The numbers here are the ones an operator TYPES INTO THE SPONSOR'S FORM —
// QSOs, WI parks worked, WI parks activated — so each test pins one sentence of
// the rules to one of those three, and an overcount is the failure that matters:
// it is a claim the sponsor's log check will not support.

import { test } from "node:test"
import assert from "node:assert/strict"

import type { JSONValue } from "@ham2k/extension-sdk"
import { QSOS_TO_ACTIVATE, WipotaScorer, slotMode, totalsFor, type WipotaScoresheet } from "./scorer.ts"

const ctx = { online: false } as never

// Wisconsin parks, from wi-parks.json. HAVENWOODS is the rules' own example.
const HAVENWOODS = 'US-5579'
const FOX_RIVER = 'US-0598'
const HORICON = 'US-0600'
// Out of state, and said so by POTA's own location.
const MINNESOTA = { ref: 'US-2466', location: 'US-MN' }

function operationFor(...ourParks: string[]): Record<string, JSONValue> {
  return { uuid: 'op', stationCall: 'N9EEE', refs: ourParks.map((ref) => ({ type: 'potaActivation', ref })) }
}

interface QsoSpec {
  call?: string
  band?: string
  mode?: string
  hunting?: (string | { ref: string; location: string })[]
}

function qso({ call = 'W1USA', band = '20m', mode = 'SSB', hunting = [] }: QsoSpec = {}): Record<string, JSONValue> {
  return {
    their: { call },
    band,
    mode,
    refs: hunting.map((park) => (typeof park === 'string' ? { type: 'pota', ref: park } : { type: 'pota', ...park })),
  }
}

/// Scores [qsos] in order, each against the operation it names — a rover's log
/// is the same fold with a different operation part way through.
function run(entries: (Record<string, JSONValue> | { qso: Record<string, JSONValue>; operation: Record<string, JSONValue> })[], operation = operationFor()) {
  const ref = { type: 'wispota' }
  let sheet: WipotaScoresheet = WipotaScorer.startScoresheet({ operation, ref }, ctx)
  const scores = entries.map((entry) => {
    const q = ('qso' in entry ? entry.qso : entry) as Record<string, JSONValue>
    const op = ('qso' in entry ? entry.operation : operation) as Record<string, JSONValue>
    const result = WipotaScorer.scoreQso({ scoresheet: sheet, qso: q, operation: op, ref, isNewDay: false }, ctx)
    sheet = result.scoresheet
    return result.score
  })
  const summary = () => WipotaScorer.summarizeScore({ scoresheet: sheet, operation, ref, scope: 'operation' }, ctx).wispota
  return { sheet, scores, summary, totals: () => totalsFor(sheet) }
}

/// [count] distinct stations, none in a park.
function filler(count: number, prefix = 'K9'): Record<string, JSONValue>[] {
  return Array.from({ length: count }, (_, i) => qso({ call: `${prefix}${String.fromCharCode(65 + i)}AA` }))
}

test("the rules' own example: one station on seven modes is seven QSOs", () => {
  // "you could work someone on SSB and AM. Even FM or C4FM… Then work them on
  // CW… FT8… FT4. In this example, that would count as seven (7) QSOs." Folding
  // modes into PHONE/CW/DATA, as every other contest here does, makes this 3.
  const modes = ['SSB', 'AM', 'FM', 'C4FM', 'CW', 'FT8', 'FT4']
  const { scores, totals } = run(modes.map((mode) => qso({ band: '10m', mode })))
  assert.deepEqual(scores.map((s) => s.value), [1, 1, 1, 1, 1, 1, 1])
  assert.equal(totals().qsos, 7)
})

test("once per band per mode: the second is a duplicate, another band is not", () => {
  const { scores, totals, sheet } = run([qso(), qso(), qso({ band: '40m' })])
  assert.deepEqual(scores.map((s) => s.value), [1, 0, 1])
  assert.equal(scores[1].dupe, true)
  assert.deepEqual(scores[1].alerts, ['duplicate'])
  assert.deepEqual(scores[2].notices, ['newBand'])
  assert.equal(totals().qsos, 2)
  assert.equal(sheet.dupes, 1)
})

test("the sidebands are one mode", () => {
  assert.equal(slotMode('usb'), 'SSB')
  assert.equal(slotMode('LSB'), 'SSB')
  const { scores } = run([qso({ mode: 'USB' }), qso({ mode: 'SSB' })])
  assert.equal(scores[1].dupe, true)
})

test("60, 30, 17 and 12 meters do not count, and neither does no band at all", () => {
  for (const band of ['60m', '30m', '17m', '12m', '']) {
    const { scores, totals } = run([qso({ band, hunting: [HAVENWOODS] })])
    assert.deepEqual(scores[0].alerts, ['invalidBand'], band)
    // Not even its park: a contact that is not a QSO confirms nothing.
    assert.deepEqual(totals(), { qsos: 0, worked: 0, activated: 0, mults: 0 }, band)
  }
  assert.equal(run([qso({ band: '6m' })]).scores[0].value, 1)
  assert.equal(run([qso({ band: '160m' })]).scores[0].value, 1)
})

test("score is QSOs times unique WI parks worked", () => {
  const { summary, totals } = run([
    qso({ call: 'WA9TT', hunting: [HAVENWOODS] }),
    qso({ call: 'W9AV', hunting: [HAVENWOODS] }),
    qso({ call: 'N9AAA', hunting: [FOX_RIVER] }),
    qso({ call: 'W5JCC' }),
  ])
  assert.deepEqual(totals(), { qsos: 4, worked: 2, activated: 0, mults: 2 })
  assert.equal(summary().total, 8)
  assert.equal(summary().label, 'WIPOTA: 8 points')
  assert.equal(String(summary().longSummary).split('\n')[0], '4 QSOs, 4 pts × 2 mults (2 parks worked)')
})

test("'you do not earn a multiplier for working out-of-state parks'", () => {
  const { totals, scores } = run([qso({ hunting: [MINNESOTA] })])
  assert.equal(scores[0].value, 1)
  assert.equal(scores[0].notices, undefined)
  assert.equal(totals().worked, 0)
})

test("a rover is a new QSO from each WI park, and only from a NEW one", () => {
  const { scores, totals } = run([
    qso({ hunting: [HAVENWOODS] }),
    qso({ hunting: [FOX_RIVER] }),
    qso({ hunting: [HAVENWOODS] }),
    // Back home, or the hunter chip not filled in: "no park" is not a park the
    // slot was still missing.
    qso(),
    // Nor is a park in another state.
    qso({ hunting: [MINNESOTA] }),
  ])
  assert.deepEqual(scores.map((s) => s.value), [1, 1, 0, 0, 0])
  assert.deepEqual(scores[1].notices, ['newPark'])
  assert.deepEqual(totals(), { qsos: 2, worked: 2, activated: 0, mults: 2 })
})

test("a rover credited again says so, even when nothing else about the contact is new", () => {
  // The third contact is new on no axis but the slot's: same band, same mode,
  // and a park already in the log. A verdict silent about the prior contact
  // leaves core's `duplicate` alert standing beside the credit.
  const { scores } = run([
    qso({ call: 'WA9TT', hunting: [HAVENWOODS] }),
    qso({ call: 'W9AV', hunting: [FOX_RIVER] }),
    qso({ call: 'WA9TT', hunting: [FOX_RIVER] }),
  ])
  assert.equal(scores[2].value, 1)
  assert.deepEqual(scores[2].notices, ['newPark'])
})

test("a park we operate from is a multiplier at ten QSOs, not at nine", () => {
  const short = run(filler(QSOS_TO_ACTIVATE - 1), operationFor(HORICON))
  assert.deepEqual(short.totals(), { qsos: 9, worked: 0, activated: 0, mults: 0 })
  // No multiplier yet still shows the QSOs, rather than a zero that reads as broken.
  assert.equal(short.summary().total, 9)

  const enough = run(filler(QSOS_TO_ACTIVATE), operationFor(HORICON))
  assert.deepEqual(enough.totals(), { qsos: 10, worked: 0, activated: 1, mults: 1 })
  assert.equal(enough.summary().total, 10)
})

test("duplicates and excluded bands do not count toward the ten", () => {
  const { totals } = run(
    [...filler(QSOS_TO_ACTIVATE - 1), qso({ call: 'K9AAA' }), qso({ call: 'K9ZZZ', band: '30m' })],
    operationFor(HORICON),
  )
  assert.equal(totals().activated, 0)
})

test("'any OTHER unique parks': a park both operated from and worked is one multiplier", () => {
  // Another station in our own park. The sponsor's form asks for the ADDITIONAL
  // parks activated, so summing the two lists would claim this park twice.
  const { totals } = run([...filler(QSOS_TO_ACTIVATE), qso({ call: 'WA9TT', hunting: [HORICON] })], operationFor(HORICON))
  assert.deepEqual(totals(), { qsos: 11, worked: 1, activated: 0, mults: 1 })
})

test("a rover's own parks each count once they have ten, read from each QSO's own operation", () => {
  const first = operationFor(HORICON)
  const second = operationFor(FOX_RIVER)
  const { totals, summary } = run([
    ...filler(10, 'K9').map((q) => ({ qso: q, operation: first })),
    ...filler(10, 'W9').map((q) => ({ qso: q, operation: second })),
  ])
  assert.deepEqual(totals(), { qsos: 20, worked: 0, activated: 2, mults: 2 })
  assert.equal(summary().total, 40)
})

test("operating outside Wisconsin's parks earns QSOs and no activation", () => {
  // Two of the sponsor's five classes are not in a park at all.
  const { totals } = run(filler(12))
  assert.deepEqual(totals(), { qsos: 12, worked: 0, activated: 0, mults: 0 })
})

test("the summary states the form's three counts under the form's own names", () => {
  const { summary } = run([qso({ hunting: [HAVENWOODS] }), ...filler(10)], operationFor(HORICON))
  const text = String(summary().longSummary)
  assert.match(text, /\*\*QSOs:\*\* 11/)
  assert.match(text, /\*\*WI Only Parks worked:\*\* 1/)
  assert.match(text, /\*\*WI Parks Activated:\*\* 1/)
})

test("the arithmetic names the form's two park counts, which add up to the multiplier", () => {
  // A park we operated from AND worked someone in is one multiplier, counted
  // as worked: naming it under both would list parts that sum past the product.
  const { summary } = run([qso({ hunting: [HORICON] }), qso({ call: 'W9AV', hunting: [HAVENWOODS] }), ...filler(10)], operationFor(HORICON))
  assert.equal(String(summary().longSummary).split('\n')[0], '12 QSOs, 12 pts × 2 mults (2 parks worked)')
  const { summary: other } = run([qso({ hunting: [HAVENWOODS] }), ...filler(10)], operationFor(HORICON))
  assert.equal(other().label, 'WIPOTA: 22 points')
  assert.equal(String(other().longSummary).split('\n')[0], '11 QSOs, 11 pts × 2 mults (1 park worked, 1 park activated)')
})

test("offers no per-day summary", () => {
  // Multipliers are won across the whole contest, so a day's share of the
  // score is not a number the sponsor defines.
  const operation = operationFor()
  const { sheet } = run([qso()], operation)
  assert.deepEqual(WipotaScorer.summarizeScore({ scoresheet: sheet, operation, ref: { type: 'wispota' }, scope: 'day' }, ctx), {})
})

test("a QSO with no callsign is nothing yet", () => {
  const { scores, totals } = run([{ their: {}, band: '20m', mode: 'SSB' }])
  assert.equal(scores[0].value, 0)
  assert.equal(totals().qsos, 0)
})
