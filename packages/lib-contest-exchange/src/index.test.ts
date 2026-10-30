// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT

import { test } from "node:test"
import assert from "node:assert/strict"

import type { JSONValue } from "@ham2k/extension-sdk"

import { stampedExchange } from "./index.ts"

const upper = (value: JSONValue | undefined) => String(value ?? '').trim().toUpperCase()
const join = (values: Record<string, string>) => Object.values(values).filter((v) => v).join(' ')

/// A name and a location, guessed as BOB and CT when the operator decides
/// neither; [calls] records which guesses ran.
function patch(ref: Record<string, JSONValue> | undefined, guesses = { name: 'BOB', location: 'CT' }, calls: string[] = []) {
  return stampedExchange('contest', ref, {
    name: { read: upper, guess: () => (calls.push('name'), guesses.name) },
    location: { read: upper, guess: () => (calls.push('location'), guesses.location) },
  }, join)
}

test('what the operator left alone is guessed, stamped and projected', () => {
  assert.deepEqual(patch(undefined), { refs: [{ type: 'contest', name: 'BOB', location: 'CT' }], their: { exchange: 'BOB CT' } })
})

test('what the operator typed stands, normalized, and is never guessed over', () => {
  const calls: string[] = []
  assert.deepEqual(patch({ type: 'contest', name: ' bill ' }, undefined, calls), {
    refs: [{ type: 'contest', name: 'BILL', location: 'CT' }],
    their: { exchange: 'BILL CT' },
  })
  assert.deepEqual(calls, ['location'], 'a decided part is not guessed at all')
})

test('a part the operator emptied stays empty, and is not stamped again', () => {
  assert.deepEqual(patch({ type: 'contest', location: '' }), { refs: [{ type: 'contest', name: 'BOB' }], their: { exchange: 'BOB' } })
})

test('a guess that comes up empty is not stamped as a blank', () => {
  // A stamped '' reads back as "the operator emptied this", and the part
  // would never be guessed again.
  assert.deepEqual(patch(undefined, { name: 'BOB', location: '' }), { refs: [{ type: 'contest', name: 'BOB' }], their: { exchange: 'BOB' } })
})

test('a deliberate blank projects as an empty exchange; nothing at all says nothing', () => {
  assert.deepEqual(patch({ type: 'contest', name: '', location: '' }), { their: { exchange: '' } })
  assert.equal(patch(undefined, { name: '', location: '' }), null)
  assert.equal(patch({ type: 'contest' }, { name: '', location: '' }), null)
})

test('a part read but never stamped still counts as decided and projects', () => {
  const result = stampedExchange('contest', { type: 'contest', serial: '0122' }, {
    serial: { read: (v) => String(Number(v)), stamp: false },
    name: { read: upper, guess: () => '' },
  }, join)
  assert.deepEqual(result, { their: { exchange: '122' } })
})

test('a part with no guess is never guessed', () => {
  assert.equal(stampedExchange('contest', undefined, { number: { read: upper } }, join), null)
})
