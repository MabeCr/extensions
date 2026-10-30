// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Which park each side is in is read by the scorer, the exchange field, the
// ADIF and the Cabrillo alike, so a wrong answer here is a multiplier the
// submitted log does not support.

import { test } from "node:test"
import assert from "node:assert/strict"

import type { JSONValue } from "@ham2k/extension-sdk"

import { eventRefIn, isOurRef, ourPark, theirExchange, theirPark } from "./parks.ts"

test("ours is our own type, or the combined extension's ref naming Ohio", () => {
  assert.equal(isOurRef({ type: 'ohspota' }), true)
  assert.equal(isOurRef({ type: 'stateparks', ref: 'OHSP' }), true)
  assert.equal(isOurRef({ type: 'stateparks', ref: 'TXSP' }), false)
  assert.equal(isOurRef({ type: 'stateparks' }), false)
  assert.equal(eventRefIn({ refs: [{ type: 'stateparks', ref: 'GASP' }] }), undefined)
})

test("a park left on the ref that is not one of Ohio's is not ours", () => {
  // The combined extension shared one ref between four events.
  assert.equal(ourPark({ refs: [{ type: 'stateparks', ref: 'OHSP', ourPark: 'US-2983' }] }), '')
  assert.equal(ourPark({ refs: [{ type: 'ohspota', ourPark: 'pun' }] }), 'PUN')
})

test("our park is ONE even on an activation of two", () => {
  const operation: Record<string, JSONValue> = { refs: [{ type: 'ohspota' }, { type: 'potaActivation', ref: 'US-1992' }, { type: 'potaActivation', ref: 'US-1981' }] }
  assert.equal(ourPark(operation), 'SBI')
})

test("the exchange reads our type first, then the combined extension's", () => {
  assert.equal(theirExchange({ refs: [{ type: 'stateparks', park: 'ada' }] }), 'ADA')
  assert.equal(theirExchange({ refs: [{ type: 'stateparks', park: 'ADA' }, { type: 'ohspota', park: 'HOC' }] }), 'HOC')
})

test("a typed exchange that is not a park claims nothing, and is still what was sent", () => {
  const qso: Record<string, JSONValue> = { refs: [{ type: 'ohspota', park: 'NOT' }, { type: 'pota', ref: 'US-1932' }] }
  assert.equal(theirExchange(qso), 'NOT')
  assert.equal(theirPark(qso), '')
})

test("a deliberate blank is a decision; a missing field is not", () => {
  assert.equal(theirExchange({ refs: [{ type: 'ohspota', park: '' }, { type: 'pota', ref: 'US-1932' }] }), '')
  assert.equal(theirExchange({ refs: [{ type: 'ohspota' }, { type: 'pota', ref: 'US-1932' }] }), 'ADA')
  assert.equal(theirPark({ refs: [{ type: 'pota', ref: 'US-1932' }] }), 'ADA')
})
