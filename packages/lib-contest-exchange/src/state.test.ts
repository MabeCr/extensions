// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT

import { test } from "node:test"
import assert from "node:assert/strict"

import { theirStateFields, withTheirFields } from "./state.ts"

const US = 291
const CANADA = 1

test('a received state or province is written, over the lookup\'s', () => {
  assert.deepEqual(theirStateFields({ call: 'W1AW', guess: { dxccCode: US } }, 'ct'), { state: 'CT' })
  assert.deepEqual(theirStateFields({ call: 'W1AW/7', guess: { dxccCode: US, state: 'CT' } }, 'AZ'), { state: 'AZ' })
  assert.deepEqual(theirStateFields({ call: 'VE3ABC', guess: { dxccCode: CANADA } }, 'ON'), { state: 'ON' })
  assert.deepEqual(theirStateFields({ call: 'W3ABC', dxccCode: US }, 'DC'), { state: 'DC' })
  assert.deepEqual(theirStateFields({ call: 'KL7ABC', guess: { dxccCode: 6 } }, 'AK'), { state: 'AK' })
})

test('a lookup\'s matching state is confirmed; a stated one is left alone', () => {
  assert.deepEqual(theirStateFields({ guess: { dxccCode: US, state: 'CT' } }, 'CT'), { state: 'CT' })
  assert.deepEqual(theirStateFields({ dxccCode: US, state: 'CT' }, 'CT'), {})
})

test('anything that is not a state or province says nothing', () => {
  for (const location of ['', 'DX', 'XE', 'KP4', '1234', 'KW', '100']) {
    assert.deepEqual(theirStateFields({ guess: { dxccCode: US } }, location), {}, location)
  }
})

test('a prefix that is also a state is a state only from the US, a province only from Canada', () => {
  // The Czech Republic, Finland, Portugal, Belgium and the Dominican Republic.
  assert.deepEqual(theirStateFields({ call: 'OK1RR', guess: { dxccCode: 503 } }, 'OK'), {})
  assert.deepEqual(theirStateFields({ call: 'OH8X', guess: { dxccCode: 224 } }, 'OH'), {})
  assert.deepEqual(theirStateFields({ call: 'CT1ABC', guess: { dxccCode: 272 } }, 'CT'), {})
  assert.deepEqual(theirStateFields({ call: 'ON4ABC', guess: { dxccCode: 209 } }, 'ON'), {})
  assert.deepEqual(theirStateFields({ call: 'HI8ABC', guess: { dxccCode: 72 } }, 'HI'), {})
  assert.deepEqual(theirStateFields({ call: 'KH6ABC', guess: { dxccCode: 110 } }, 'HI'), { state: 'HI' })
  // A province from the US, or a state from Canada, is not where they are.
  assert.deepEqual(theirStateFields({ call: 'W1AW', guess: { dxccCode: US } }, 'ON'), {})
  assert.deepEqual(theirStateFields({ call: 'VE3ABC', guess: { dxccCode: CANADA } }, 'OH'), {})
})

test('fields are merged into a patch\'s their, and an empty set changes nothing', () => {
  assert.deepEqual(withTheirFields({ their: { exchange: 'BOB CT' } }, { state: 'CT' }), { their: { exchange: 'BOB CT', state: 'CT' } })
  assert.deepEqual(withTheirFields(null, { state: 'CT' }), { their: { state: 'CT' } })
  assert.equal(withTheirFields(null, {}), null)
  const patch = { their: { exchange: 'X' } }
  assert.equal(withTheirFields(patch, {}), patch)
})
