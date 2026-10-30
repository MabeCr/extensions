// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// One answer at setup — the category — decides both the precedence letter we
// send and the Cabrillo CATEGORY lines, so the two can never disagree. These
// check each category against the rules' precedence list and the ARRL's own
// Sweepstakes Cabrillo templates.

import { test } from "node:test"
import assert from "node:assert/strict"

import { cabrilloCategories, declaredOperators, normalizeCheck, normalizePrecedence, ourPrecedence } from "./entry.ts"

function lines(entry: string, mode = 'CW') {
  return Object.fromEntries(cabrilloCategories({ entry, mode }).filter(([, value]) => value))
}

test("each category sends its precedence letter", () => {
  const letters = ['SO-QRP', 'SO-LOW', 'SO-HIGH', 'SOU-QRP', 'SOU-LOW', 'SOU-HIGH', 'MULTI-LOW', 'MULTI-HIGH', 'SCHOOL']
    .map((entry) => ourPrecedence({ entry }))
  assert.deepEqual(letters, ['Q', 'A', 'B', 'U', 'U', 'U', 'M', 'M', 'S'])
  assert.equal(ourPrecedence({}), '')
  assert.equal(ourPrecedence({ entry: 'nonsense' }), '')
})

test("Single Operator is non-assisted; Unlimited, Multioperator and School Club are assisted", () => {
  assert.deepEqual(lines('SO-LOW'), {
    'CATEGORY-OPERATOR': 'SINGLE-OP',
    'CATEGORY-ASSISTED': 'NON-ASSISTED',
    'CATEGORY-BAND': 'ALL',
    'CATEGORY-POWER': 'LOW',
    'CATEGORY-MODE': 'CW',
    'CATEGORY-TRANSMITTER': 'ONE',
  })
  assert.equal(lines('SOU-QRP')['CATEGORY-ASSISTED'], 'ASSISTED')
  assert.equal(lines('SOU-QRP')['CATEGORY-POWER'], 'QRP')
  assert.equal(lines('MULTI-HIGH')['CATEGORY-OPERATOR'], 'MULTI-OP')
  assert.equal(lines('MULTI-HIGH')['CATEGORY-ASSISTED'], 'ASSISTED')
})

test("School Club is a multioperator school station, written as the ARRL's template writes it", () => {
  assert.deepEqual(lines('SCHOOL', 'SSB'), {
    'CATEGORY-OPERATOR': 'MULTI-OP',
    'CATEGORY-ASSISTED': 'ASSISTED',
    'CATEGORY-BAND': 'ALL',
    'CATEGORY-POWER': 'HIGH',
    'CATEGORY-MODE': 'SSB',
    'CATEGORY-TRANSMITTER': 'ONE',
    'CATEGORY-STATION': 'SCHOOL',
  })
})

test("an undeclared category claims nothing about operator, assistance or power", () => {
  assert.deepEqual(lines(''), { 'CATEGORY-BAND': 'ALL', 'CATEGORY-MODE': 'CW', 'CATEGORY-TRANSMITTER': 'ONE' })
})

test("received precedence and check are only ever a letter and two digits", () => {
  assert.equal(normalizePrecedence(' a '), 'A')
  assert.equal(normalizePrecedence('X'), '')
  assert.equal(normalizeCheck('79'), '79')
  assert.equal(normalizeCheck('1979'), '')
  assert.equal(normalizeCheck('7'), '')
})

test("operators are uppercased and space-separated", () => {
  assert.equal(declaredOperators({ operators: 'k1abc, w2def;n3ghi' }), 'K1ABC W2DEF N3GHI')
})
