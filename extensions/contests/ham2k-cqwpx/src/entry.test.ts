// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The entry declared at setup, as the Cabrillo `CATEGORY-` lines the CQ WPX
// log robot reads. An unanswered question must write no line — a guessed one
// is a claim the operator never made — while what the rules make follow from
// an answer is written for it.

import { test } from "node:test"
import assert from "node:assert/strict"
import type { JSONValue } from "@ham2k/extension-sdk"

import { cabrilloCategories, transmitterColumns } from "./entry.ts"

function lines(ref: Record<string, string>) {
  return Object.fromEntries(cabrilloCategories({ type: 'cqwpx', ...ref }).filter(([, value]) => value))
}

test("nothing declared writes nothing but the mode", () => {
  assert.deepEqual(lines({ mode: 'CW' }), { 'CATEGORY-MODE': 'CW' })
})

test("a single operator declares whether they were assisted", () => {
  assert.deepEqual(lines({ mode: 'SSB', operator: 'SINGLE-OP', band: 'ALL', power: 'LOW' }), {
    'CATEGORY-OPERATOR': 'SINGLE-OP',
    'CATEGORY-ASSISTED': 'NON-ASSISTED',
    'CATEGORY-BAND': 'ALL',
    'CATEGORY-POWER': 'LOW',
    'CATEGORY-MODE': 'SSB',
  })
  assert.equal(lines({ mode: 'SSB', operator: 'SINGLE-OP-ASSISTED' })['CATEGORY-ASSISTED'], 'ASSISTED')
})

test("multi-operator classes split into operator and transmitter, all-band and assisted", () => {
  assert.deepEqual(lines({ mode: 'CW', operator: 'MULTI-TWO', band: '20M', power: 'HIGH' }), {
    'CATEGORY-OPERATOR': 'MULTI-OP',
    'CATEGORY-ASSISTED': 'ASSISTED',
    // "All-band operation only", whatever band was picked.
    'CATEGORY-BAND': 'ALL',
    'CATEGORY-POWER': 'HIGH',
    'CATEGORY-MODE': 'CW',
    'CATEGORY-TRANSMITTER': 'TWO',
  })
  assert.equal(lines({ mode: 'CW', operator: 'MULTI-ONE' })['CATEGORY-TRANSMITTER'], 'ONE')
  assert.equal(lines({ mode: 'CW', operator: 'MULTI-UNLIMITED' })['CATEGORY-TRANSMITTER'], 'UNLIMITED')

  // Multi-Distributed is MULTI-OP with a DISTRIBUTED station (VI.C.4).
  const distributed = lines({ mode: 'CW', operator: 'MULTI-DISTRIBUTED' })
  assert.equal(distributed['CATEGORY-OPERATOR'], 'MULTI-OP')
  assert.equal(distributed['CATEGORY-STATION'], 'DISTRIBUTED')
})

test("a checklog is just that", () => {
  assert.equal(lines({ mode: 'CW', operator: 'CHECKLOG' })['CATEGORY-OPERATOR'], 'CHECKLOG')
})

test("overlays go with single operators only, and Classic not with assistance", () => {
  assert.equal(lines({ mode: 'CW', operator: 'SINGLE-OP', overlay: 'CLASSIC' })['CATEGORY-OVERLAY'], 'CLASSIC')
  // WPX's own overlay.
  assert.equal(lines({ mode: 'CW', operator: 'SINGLE-OP-ASSISTED', overlay: 'TB-WIRES' })['CATEGORY-OVERLAY'], 'TB-WIRES')
  assert.equal(lines({ mode: 'CW', operator: 'SINGLE-OP-ASSISTED', overlay: 'ROOKIE' })['CATEGORY-OVERLAY'], 'ROOKIE')
  assert.equal(lines({ mode: 'CW', operator: 'SINGLE-OP-ASSISTED', overlay: 'CLASSIC' })['CATEGORY-OVERLAY'], undefined)
  assert.equal(lines({ mode: 'CW', operator: 'MULTI-ONE', overlay: 'YOUTH' })['CATEGORY-OVERLAY'], undefined)
})

test("RTTY has no 160m entry", () => {
  assert.equal(lines({ mode: 'RTTY', operator: 'SINGLE-OP', band: '160M' })['CATEGORY-BAND'], undefined)
  assert.equal(lines({ mode: 'CW', operator: 'SINGLE-OP', band: '160M' })['CATEGORY-BAND'], '160M')
})

test("a value that is not one of the rules' is no claim", () => {
  assert.deepEqual(lines({ mode: 'CW', operator: 'SINGLE-OP-QRP', power: '1500' }), { 'CATEGORY-MODE': 'CW' })
})

test("LOCATION is what was typed, a Canadian call area, or DX outside the US and Canada", async () => {
  const { cabrilloLocation } = await import("./entry.ts")
  assert.equal(cabrilloLocation('N0DEV', 'wma'), 'WMA')
  assert.equal(cabrilloLocation('VE3XYZ', undefined), 'ON')
  assert.equal(cabrilloLocation('DL1ABC', undefined), 'DX')
  // A US station must give one, Hawaii and Puerto Rico included: blank, never DX.
  assert.equal(cabrilloLocation('N0DEV', undefined), '')
  assert.equal(cabrilloLocation('KH6ABC', ''), '')
  assert.equal(cabrilloLocation('NP3U', 'PR'), 'PR')
})

type Our = Record<string, string | number>

/// The transmitter column [operator]'s log writes for each of [ours].
function columns(operator: string, ours: Our[], extra: Record<string, JSONValue>[] = []) {
  const qsos = ours.map((our) => ({ our: { call: 'N0DEV', ...our } }))
  const column = transmitterColumns({ type: 'cqwpx', operator }, [...qsos, ...extra])
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
  for (const operator of ['SINGLE-OP', 'MULTI-ONE', 'MULTI-UNLIMITED', '']) assert.deepEqual(columns(operator, [{ multiIdentifier: '1' }, { multiIdentifier: '2' }]), ['', ''])
})
