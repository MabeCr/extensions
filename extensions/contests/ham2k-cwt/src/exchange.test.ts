// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The guesses, which are the part that can be wrong without looking wrong.
//
// Callsigns resolve against the bundled country file (no network): W1AW → K/NA,
// DL1ABC → DL/EU.

import { test } from "node:test"
import assert from "node:assert/strict"

import type { HookContext, JSONValue } from "@ham2k/extension-sdk"

import { firstName, guessedName, guessedQth, normalizeNumber, ourExchange, suggestedName } from "./exchange.ts"

test('a name is the first one, upper-cased', () => {
  // The lookup hands back whole names; the exchange is one name sent in CW.
  assert.equal(firstName('Hiram Percy Maxim'), 'HIRAM')
  assert.equal(firstName('seb'), 'SEB')
  assert.equal(firstName(undefined), '')
})

test('a name typed on the QSO beats the lookup guess', () => {
  assert.equal(guessedName({ name: 'Bob', guess: { name: 'Robert' } }), 'BOB')
  assert.equal(guessedName({ guess: { name: 'Robert' } }), 'ROBERT')
  assert.equal(guessedName({}), '')
})

test('the QTH hint prefers a state over an entity prefix', () => {
  // A non-member sends a state, province or DX prefix — the state is the more
  // specific of the two, and the one a US station would actually send.
  assert.equal(guessedQth({ call: 'W1AW', state: 'ct' }), 'CT')
  assert.equal(guessedQth({ call: 'W1AW', guess: { state: 'ct' } }), 'CT')
})

test('the QTH hint falls back to the country file when nothing was looked up', () => {
  // The last resort, and the only branch that reaches an external data file:
  // a shape change there would silently blank the hint rather than fail.
  assert.equal(guessedQth({ call: 'DL1ABC' }), 'DL')
  assert.equal(guessedQth({ call: 'W1AW' }), 'K')
  assert.equal(guessedQth({}), '')
})

test('numbers normalize to what goes in the log', () => {
  assert.equal(normalizeNumber(' 1234 '), '1234')
  assert.equal(normalizeNumber('cwa'), 'CWA')
  assert.equal(normalizeNumber(undefined), '')
})

test('our exchange reads ourName/ourNumber, never the decoration slots', () => {
  // `name` on a ref is where `decorateRef` writes the activity row's subtitle.
  // Reading it here would export a display string as the sent exchange.
  const ref = { type: 'cwt', ourName: 'Seb', ourNumber: '1234', name: '2026-08-26 1300z · SEB 1234' }
  assert.deepEqual(ourExchange(ref), { name: 'SEB', number: '1234' })
  assert.deepEqual(ourExchange(undefined), { name: '', number: '' })
})

/// A host whose log holds [log] for every call, newest first, split by
/// operation the way the app's filters split it.
function hostWith(log: { op: string; name: string }[]): HookContext {
  return {
    getHistoryForCall: async (_call: string, options: Record<string, unknown>) => log
      .filter((q) => options.operation === undefined || q.op === options.operation)
      .filter((q) => options.excludeOperation === undefined || q.op !== options.excludeOperation)
      .map((q) => ({ refs: [{ type: 'cwt', name: q.name }] }) as Record<string, JSONValue>),
  } as unknown as HookContext
}

test("the name sent earlier this session beats an earlier CWT's, which beats the lookup's", async () => {
  const session = { uuid: 'this-session', refs: [{ type: 'cwt', ref: '2026-10-29-1300' }] }
  const qso = { their: { call: 'K1ABC', name: 'Robert Smith' } }
  const both = hostWith([{ op: 'this-session', name: 'ROB' }, { op: 'last-week', name: 'BOB' }])
  assert.equal(await suggestedName(both, session, qso), 'ROB')
  assert.equal(await suggestedName(hostWith([{ op: 'last-week', name: 'BOB' }]), session, qso), 'BOB')
  assert.equal(await suggestedName({} as HookContext, session, qso), 'ROBERT')
})
