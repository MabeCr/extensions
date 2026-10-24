// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The entry declared at setup, as the Cabrillo `CATEGORY-` lines the ARRL's
// log robot reads, checked against the rules' categories (Special Rules 3,
// HCAT). An unanswered question must write no line — a guessed one is a claim
// the operator never made — while what the rules make follow from an answer
// is written for it.

import { test } from "node:test"
import assert from "node:assert/strict"

import { cabrilloCategories, declaredClub, declaredOperators } from "./entry.ts"

function lines(ref: Record<string, string>) {
  return Object.fromEntries(cabrilloCategories({ type: 'arrl-dx', ...ref }).filter(([, value]) => value))
}

test("nothing declared writes nothing but the mode, and Phone is Cabrillo's SSB", () => {
  assert.deepEqual(lines({ mode: 'CW' }), { 'CATEGORY-MODE': 'CW' })
  assert.deepEqual(lines({ mode: 'Phone' }), { 'CATEGORY-MODE': 'SSB' })
})

test("Single Operator is non-assisted, Single Operator Unlimited assisted, either all-band or single-band", () => {
  assert.deepEqual(lines({ mode: 'CW', operator: 'SINGLE-OP', band: 'ALL', power: 'QRP' }), {
    'CATEGORY-OPERATOR': 'SINGLE-OP',
    'CATEGORY-ASSISTED': 'NON-ASSISTED',
    'CATEGORY-BAND': 'ALL',
    'CATEGORY-POWER': 'QRP',
    'CATEGORY-MODE': 'CW',
  })
  assert.deepEqual(lines({ mode: 'Phone', operator: 'SINGLE-OP-UNLIMITED', band: '15M', power: 'LOW' }), {
    'CATEGORY-OPERATOR': 'SINGLE-OP',
    'CATEGORY-ASSISTED': 'ASSISTED',
    'CATEGORY-BAND': '15M',
    'CATEGORY-POWER': 'LOW',
    'CATEGORY-MODE': 'SSB',
  })
})

test("multioperator classes split into operator and transmitter, all-band and assisted", () => {
  assert.deepEqual(lines({ mode: 'CW', operator: 'MULTI-ONE', band: '20M', power: 'LOW' }), {
    'CATEGORY-OPERATOR': 'MULTI-OP',
    'CATEGORY-ASSISTED': 'ASSISTED',
    // "Multioperator stations may only enter as All Band", whatever was picked.
    'CATEGORY-BAND': 'ALL',
    'CATEGORY-POWER': 'LOW',
    'CATEGORY-MODE': 'CW',
    'CATEGORY-TRANSMITTER': 'ONE',
  })
  assert.equal(lines({ mode: 'CW', operator: 'MULTI-TWO' })['CATEGORY-TRANSMITTER'], 'TWO')
  assert.equal(lines({ mode: 'CW', operator: 'MULTI-MULTI' })['CATEGORY-TRANSMITTER'], 'UNLIMITED')
})

test("power follows the class's own sub-categories", () => {
  // Multi-Single has no QRP, and a QRP station is within its Low Power.
  assert.equal(lines({ mode: 'CW', operator: 'MULTI-ONE', power: 'QRP' })['CATEGORY-POWER'], 'LOW')
  assert.equal(lines({ mode: 'CW', operator: 'MULTI-ONE' })['CATEGORY-POWER'], undefined)
  // M2 and MM are high power only, so the class answers it.
  assert.equal(lines({ mode: 'CW', operator: 'MULTI-TWO' })['CATEGORY-POWER'], 'HIGH')
  assert.equal(lines({ mode: 'CW', operator: 'MULTI-MULTI', power: 'LOW' })['CATEGORY-POWER'], 'HIGH')
})

test("a checklog is just that", () => {
  assert.deepEqual(lines({ mode: 'CW', operator: 'CHECKLOG' }), { 'CATEGORY-OPERATOR': 'CHECKLOG', 'CATEGORY-MODE': 'CW' })
})

test("a value that is not one of the rules' is no claim", () => {
  assert.deepEqual(lines({ mode: 'CW', operator: 'SINGLE-OP-ASSISTED', band: '6M', power: '1500' }), { 'CATEGORY-MODE': 'CW' })
})

test("operators are listed as the sponsor asks, and the club on one line", () => {
  assert.equal(declaredOperators({ operators: 'k1abc, w2def;  w3ghi' }), 'K1ABC W2DEF W3GHI')
  assert.equal(declaredOperators({}), '')
  assert.equal(declaredClub({ club: '  Yankee  Clipper\nContest Club ' }), 'Yankee Clipper Contest Club')
})
