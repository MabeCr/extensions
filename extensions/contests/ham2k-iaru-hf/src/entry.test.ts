// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The entry declared at setup, as the Cabrillo `CATEGORY-` lines the ARRL's
// log robot reads, checked against the rules' Entry Categories and the values
// of the Cabrillo form the rules page links to. An unanswered question must
// write no line — a guessed one is a claim the operator never made — while
// what the rules make follow from an answer is written for it.

import { test } from "node:test"
import assert from "node:assert/strict"

import { cabrilloCategories, declaredClub, declaredOperators } from "./entry.ts"

function lines(ref: Record<string, string>) {
  return Object.fromEntries(cabrilloCategories({ type: 'iaru-hf', ...ref }).filter(([, value]) => value))
}

test("nothing declared writes nothing but the band, and the mode restriction set up", () => {
  assert.deepEqual(lines({}), { 'CATEGORY-BAND': 'ALL' })
  assert.deepEqual(lines({ modeRestriction: 'Mixed' }), { 'CATEGORY-BAND': 'ALL', 'CATEGORY-MODE': 'MIXED' })
  assert.equal(lines({ modeRestriction: 'CW' })['CATEGORY-MODE'], 'CW')
  assert.equal(lines({ modeRestriction: 'Phone' })['CATEGORY-MODE'], 'SSB')
})

test("a single operator declares whether they were assisted, at the power they declared", () => {
  assert.deepEqual(lines({ modeRestriction: 'CW', operator: 'SINGLE-OP', power: 'QRP' }), {
    'CATEGORY-OPERATOR': 'SINGLE-OP',
    'CATEGORY-ASSISTED': 'NON-ASSISTED',
    'CATEGORY-BAND': 'ALL',
    'CATEGORY-MODE': 'CW',
    'CATEGORY-POWER': 'QRP',
  })
  const unlimited = lines({ modeRestriction: 'Phone', operator: 'SINGLE-OP-UNLIMITED', power: 'HIGH' })
  assert.equal(unlimited['CATEGORY-OPERATOR'], 'SINGLE-OP')
  assert.equal(unlimited['CATEGORY-ASSISTED'], 'ASSISTED')
  assert.equal(unlimited['CATEGORY-POWER'], 'HIGH')
  assert.equal(lines({ operator: 'SINGLE-OP' })['CATEGORY-POWER'], undefined)
})

test("Multi-Single is mixed-mode, assisted and high power; Multi-Two mixed-mode, unassisted and low power", () => {
  assert.deepEqual(lines({ modeRestriction: 'CW', operator: 'MULTI-ONE', power: 'QRP' }), {
    'CATEGORY-OPERATOR': 'MULTI-OP',
    'CATEGORY-ASSISTED': 'ASSISTED',
    'CATEGORY-BAND': 'ALL',
    // "Multioperator stations may only enter as Mixed-Mode."
    'CATEGORY-MODE': 'MIXED',
    'CATEGORY-POWER': 'HIGH',
    'CATEGORY-TRANSMITTER': 'ONE',
  })
  assert.deepEqual(lines({ operator: 'MULTI-TWO' }), {
    'CATEGORY-OPERATOR': 'MULTI-OP',
    'CATEGORY-ASSISTED': 'NON-ASSISTED',
    'CATEGORY-BAND': 'ALL',
    'CATEGORY-MODE': 'MIXED',
    'CATEGORY-POWER': 'LOW',
    'CATEGORY-TRANSMITTER': 'TWO',
  })
  assert.equal(lines({ operator: 'MULTI-TWO', power: 'QRP' })['CATEGORY-POWER'], 'LOW')
  // Declared high power is never written as the 100 W the class requires.
  assert.equal(lines({ operator: 'MULTI-TWO', power: 'HIGH' })['CATEGORY-POWER'], 'HIGH')
})

test("an HQ station says so, and only an HQ station may enter as a multi-op HQ", () => {
  assert.deepEqual(lines({ stationType: 'hq', modeRestriction: 'Mixed', operator: 'MULTI-HQ', power: 'HIGH' }), {
    'CATEGORY-OPERATOR': 'MULTI-OP',
    'CATEGORY-BAND': 'ALL',
    'CATEGORY-MODE': 'MIXED',
    'CATEGORY-POWER': 'HIGH',
    'CATEGORY-TRANSMITTER': 'UNLIMITED',
    'CATEGORY-STATION': 'HQ',
  })
  assert.equal(lines({ stationType: 'hq', operator: 'SINGLE-OP' })['CATEGORY-STATION'], 'HQ')
  // From a station that isn't one, only the multi-op part is still true.
  assert.deepEqual(lines({ stationType: 'normal', operator: 'MULTI-HQ', power: 'LOW' }), {
    'CATEGORY-OPERATOR': 'MULTI-OP',
    'CATEGORY-BAND': 'ALL',
    'CATEGORY-MODE': 'MIXED',
    'CATEGORY-POWER': 'LOW',
  })
  // An IARU official has no Cabrillo station value of its own.
  assert.equal(lines({ stationType: 'official', operator: 'SINGLE-OP' })['CATEGORY-STATION'], undefined)
})

test("the Youth overlay goes with single operators only", () => {
  assert.equal(lines({ operator: 'SINGLE-OP', overlay: 'YOUTH' })['CATEGORY-OVERLAY'], 'YOUTH')
  assert.equal(lines({ operator: 'SINGLE-OP-UNLIMITED', overlay: 'YOUTH' })['CATEGORY-OVERLAY'], 'YOUTH')
  assert.equal(lines({ operator: 'MULTI-ONE', overlay: 'YOUTH' })['CATEGORY-OVERLAY'], undefined)
  assert.equal(lines({ overlay: 'YOUTH' })['CATEGORY-OVERLAY'], undefined)
})

test("a checklog is just that", () => {
  assert.equal(lines({ operator: 'CHECKLOG' })['CATEGORY-OPERATOR'], 'CHECKLOG')
  assert.equal(lines({ operator: 'CHECKLOG' })['CATEGORY-ASSISTED'], undefined)
})

test("a value that is not one of the rules' is no claim", () => {
  assert.deepEqual(lines({ modeRestriction: 'RTTY', operator: 'MULTI-MULTI', power: '1500', overlay: 'CLASSIC' }), { 'CATEGORY-BAND': 'ALL' })
})

test("operators are uppercased and space-separated, and the club on one line", () => {
  assert.equal(declaredOperators({ operators: 'k1abc, w2def;  w3ghi' }), 'K1ABC W2DEF W3GHI')
  assert.equal(declaredOperators({}), '')
  assert.equal(declaredClub({ club: '  Yankee  Clipper\nContest Club ' }), 'Yankee Clipper Contest Club')
})
