// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The entry declared at setup, as the Cabrillo `CATEGORY-` lines the NCJ's
// log checker reads. An unanswered question must write no line — a guessed
// one is a claim the operator never made — while what the rules make follow
// from an answer is written for it.

import { test } from "node:test"
import assert from "node:assert/strict"

import { cabrilloCategories, declaredOperators } from "./entry.ts"

function lines(ref: Record<string, string>) {
  return Object.fromEntries(cabrilloCategories({ type: 'naqp', ...ref }).filter(([, value]) => value))
}

test("nothing declared writes nothing but the band and mode every entry has", () => {
  assert.deepEqual(lines({ mode: 'CW' }), { 'CATEGORY-BAND': 'ALL', 'CATEGORY-MODE': 'CW' })
})

test("a single operator is one transmitter, and declares whether they were assisted", () => {
  // The sponsor's own template header, line for line.
  assert.deepEqual(lines({ mode: 'CW', operator: 'SINGLE-OP', power: 'LOW' }), {
    'CATEGORY-OPERATOR': 'SINGLE-OP',
    'CATEGORY-TRANSMITTER': 'ONE',
    'CATEGORY-ASSISTED': 'NON-ASSISTED',
    'CATEGORY-BAND': 'ALL',
    'CATEGORY-POWER': 'LOW',
    'CATEGORY-MODE': 'CW',
  })
  assert.equal(lines({ mode: 'SSB', operator: 'SINGLE-OP-ASSISTED' })['CATEGORY-ASSISTED'], 'ASSISTED')
  assert.equal(lines({ mode: 'SSB', operator: 'SINGLE-OP-ASSISTED' })['CATEGORY-OPERATOR'], 'SINGLE-OP')
})

test("Multioperator Two-Transmitter is a multi-op, two transmitters, assisted", () => {
  assert.deepEqual(lines({ mode: 'RTTY', operator: 'MULTI-TWO', power: 'QRP' }), {
    'CATEGORY-OPERATOR': 'MULTI-OP',
    'CATEGORY-TRANSMITTER': 'TWO',
    'CATEGORY-ASSISTED': 'ASSISTED',
    'CATEGORY-BAND': 'ALL',
    'CATEGORY-POWER': 'QRP',
    'CATEGORY-MODE': 'RTTY',
  })
})

test("a checklog is just that", () => {
  assert.deepEqual(lines({ mode: 'CW', operator: 'CHECKLOG' }), {
    'CATEGORY-OPERATOR': 'CHECKLOG',
    'CATEGORY-BAND': 'ALL',
    'CATEGORY-MODE': 'CW',
  })
})

test("a value that is not one of the rules' is no claim", () => {
  // No high power, no multi-single: NAQP has neither.
  assert.deepEqual(lines({ mode: 'CW', operator: 'MULTI-ONE', power: 'HIGH' }), { 'CATEGORY-BAND': 'ALL', 'CATEGORY-MODE': 'CW' })
  assert.equal(lines({ mode: 'CW', operator: 'single-op', power: 'qrp' })['CATEGORY-POWER'], 'QRP')
})

test("operators are listed uppercased and space-separated", () => {
  assert.equal(declaredOperators({ operators: 'k1abc, w2def;  w3ghi @w3bgn' }), 'K1ABC W2DEF W3GHI @W3BGN')
  assert.equal(declaredOperators({}), '')
})
