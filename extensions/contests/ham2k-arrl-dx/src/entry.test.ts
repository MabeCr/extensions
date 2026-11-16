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
import type { JSONValue } from "@ham2k/extension-sdk"

import { cabrilloCategories, transmitterColumns } from "./entry.ts"

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

type Our = Record<string, string | number>

/// The transmitter column [operator]'s log writes for each of [ours].
function columns(operator: string, ours: Our[], extra: Record<string, JSONValue>[] = []) {
  const qsos = ours.map((our) => ({ our: { call: 'N0DEV', ...our } }))
  const column = transmitterColumns({ type: 'arrl-dx', operator }, [...qsos, ...extra])
  return qsos.map((qso) => column(qso).join(' '))
}

test("each distinct operating position in the log is a transmitter, numbered from 0 in sorted order", () => {
  for (const operator of ['MULTI-TWO']) {
    assert.deepEqual(columns(operator, [{ multiIdentifier: '2' }, { multiIdentifier: '1' }, { multiIdentifier: '2' }]), ['1', '0', '1'])
    // Any numbers, in numeric order rather than as text.
    assert.deepEqual(columns(operator, [{ multiIdentifier: '10' }, { multiIdentifier: '9' }]), ['1', '0'])
    // Any labels, numbers first.
    assert.deepEqual(columns(operator, [{ multiIdentifier: 'RUN' }, { multiIdentifier: 'MULT' }, { multiIdentifier: '3' }]), ['2', '1', '0'])
    // A number is one position however it is stored or written.
    assert.deepEqual(columns(operator, [{ multiIdentifier: 4 }, { multiIdentifier: '4' }, { multiIdentifier: '04' }, { multiIdentifier: '7' }]), ['0', '0', '0', '1'])
    // `operatingPosition` when there is no `multiIdentifier`.
    assert.deepEqual(columns(operator, [{ operatingPosition: 'B' }, { operatingPosition: 'A', multiIdentifier: 'C' }, { operatingPosition: 'A' }]), ['1', '2', '0'])
    // No position is the first position's transmitter, or the one transmitter there was.
    assert.deepEqual(columns(operator, [{}, {}]), ['0', '0'])
    assert.deepEqual(columns(operator, [{ multiIdentifier: '3' }, {}, { multiIdentifier: '2' }, { multiIdentifier: ' ' }]), ['1', '0', '0', '0'])
    // More positions than transmitters are written as counted, for the checker to flag.
    assert.deepEqual(columns(operator, [{ multiIdentifier: '1' }, { multiIdentifier: '2' }, { multiIdentifier: '3' }]), ['0', '1', '2'])
  }
})

test("an event row or a deleted contact takes up no transmitter", () => {
  const extra: Record<string, JSONValue>[] = [
    { band: 'event', our: { multiIdentifier: '1' } },
    { deleted: true, our: { multiIdentifier: '2' } },
  ]
  assert.deepEqual(columns('MULTI-TWO', [{ multiIdentifier: '5' }, { multiIdentifier: '3' }], extra), ['1', '0'])
})

test("a log with no transmitter column writes none", () => {
  for (const operator of ['SINGLE-OP', 'MULTI-ONE', 'MULTI-MULTI', '']) assert.deepEqual(columns(operator, [{ multiIdentifier: '1' }, { multiIdentifier: '2' }]), ['', ''])
})
