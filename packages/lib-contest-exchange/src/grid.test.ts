// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT

import { test } from "node:test"
import assert from "node:assert/strict"

import { theirGridFields } from "./grid.ts"

test('a received grid the contact does not state yet is written, with its center', () => {
  assert.deepEqual(theirGridFields({ call: 'G4ABC' }, 'io91wo'), { grid: 'IO91WO', lat: 51.604167, lon: -0.125 })
  assert.deepEqual(theirGridFields(undefined, 'FN31'), { grid: 'FN31', lat: 41.5, lon: -73 })
})

test('a received grid replaces the lookup\'s home square, and its coordinate with it', () => {
  const their = { call: 'G4ABC/P', guess: { grid: 'IO91WO', lat: 51.6, lon: -1.1 } }
  assert.deepEqual(theirGridFields(their, 'IO83QK'), { grid: 'IO83QK', lat: 53.4375, lon: -2.625 })
})

test('a received grid replaces an earlier stated one, and the coordinate stored beside it', () => {
  const their = { call: 'G4ABC', grid: 'IO91WO', lat: 51.604167, lon: -0.125 }
  assert.deepEqual(theirGridFields(their, 'IO92AA'), { grid: 'IO92AA', lat: 52.020833, lon: -1.958333 })
})

test('nothing is written when the contact already says that square, or a finer one in it', () => {
  assert.deepEqual(theirGridFields({ grid: 'IO91WO' }, 'IO91WO'), {})
  assert.deepEqual(theirGridFields({ grid: 'io91wo12' }, 'IO91WO'), {})
  assert.deepEqual(theirGridFields({ guess: { grid: 'IO91WO' } }, 'IO91WO'), {})
  assert.deepEqual(theirGridFields({ guess: { grid: 'FN31PR' } }, 'FN31'), {})
})

test('the stated grid outranks the lookup\'s when deciding what the contact says', () => {
  assert.deepEqual(theirGridFields({ grid: 'IO83QK', guess: { grid: 'IO91WO' } }, 'IO91WO'), { grid: 'IO91WO', lat: 51.604167, lon: -0.125 })
})

test('anything short of a 4- or 6-character locator is not written', () => {
  for (const grid of ['', 'IO9', 'IO91W', 'IO91WO12', 'ZZ99', 'IO91YY', 'GRID']) {
    assert.deepEqual(theirGridFields({}, grid), {}, grid)
  }
})
