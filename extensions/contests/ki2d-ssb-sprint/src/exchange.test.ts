// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Guessing the Sprint's name and location. A guess is STAMPED onto the ref at
// save and exported as though the station had sent it, so a wrong guess is a
// wrong claim in a submitted log. These check the country file rather than
// restating what it was assumed to say.

import { afterEach, test } from "node:test"
import assert from "node:assert/strict"

import { annotateCallAgainstCountryFile } from "@ham2k/extension-sdk"
import type { HookContext, JSONValue } from "@ham2k/extension-sdk"

import { guessedLocation, suggestedExchange } from "./exchange.ts"
import { historyFor, loadHistory, parseHistory, removeHistory } from "./history.ts"
import { normalizeLocation } from "./locations.ts"

afterEach(() => removeHistory())

/// The head of today's file, as N1MM serves it.
const HISTORY = [
  '!!Order!!,Call,Name,State,UserText,',
  '# 0-This is helping file, LOG what is sent.',
  '# 1-LastEdit,2026-10-05',
  '4U1WB,MASA,DC,',
  '6Y5PW,PATRICK,',
  '8P5A,TOM,8P,',
  'AA0AC,DAVE,MN,',
  'K2LE,STEVE,NY,',
  'W5RZ,,AR,',
  'N0BAD,BOB,ZZ,',
].join('\r\n')

test('the call history reads its own column order, and keeps only valid locations', () => {
  const index = parseHistory(HISTORY)
  assert.deepEqual(index['AA0AC'], ['DAVE', 'MN'])
  assert.deepEqual(index['6Y5PW'], ['PATRICK', ''])
  assert.deepEqual(index['8P5A'], ['TOM', '8P'])
  assert.deepEqual(index['W5RZ'], ['', 'AR'])
  assert.deepEqual(index['N0BAD'], ['BOB', ''])
  assert.equal(Object.keys(index).length, 7)
})

test('a portable call finds its name under the plain call, never its location', () => {
  loadHistory(parseHistory(HISTORY))
  assert.deepEqual(historyFor('k2le'), { name: 'STEVE', location: 'NY' })
  assert.deepEqual(historyFor('K2LE/4'), { name: 'STEVE', location: '' })
  assert.equal(historyFor('W1AW'), undefined)
})

/// A host whose log holds [log] for every call, newest first, split by
/// operation the way the app's filters split it.
function hostWith(log: { op: string; refs: Record<string, JSONValue>[] }[]): HookContext {
  return {
    getHistoryForCall: async (_call: string, options: Record<string, unknown>) => log
      .filter((q) => options.operation === undefined || q.op === options.operation)
      .filter((q) => options.excludeOperation === undefined || q.op !== options.excludeOperation)
      .map((q) => ({ refs: q.refs }) as Record<string, JSONValue>),
  } as unknown as HookContext
}

const tonight = { uuid: 'tonight', refs: [{ type: 'ssb-sprint' }] }
const suggested = (ctx: HookContext, their: Record<string, JSONValue>) => suggestedExchange(ctx, tonight, { their })

test("what a station sent earlier in this operation beats the call history file", async () => {
  loadHistory(parseHistory(HISTORY))
  const ctx = hostWith([{ op: 'tonight', refs: [{ type: 'ssb-sprint', name: 'DAVID', location: 'IA' }] }])
  // The file says DAVE in MN; the operator copied DAVID in IA an hour ago, and
  // that is what the station is sending tonight.
  assert.deepEqual(await suggested(ctx, { call: 'AA0AC', name: 'David Smith', state: 'WI' }), { name: 'DAVID', location: 'IA' })
})

test("the call history file beats earlier Sprints, which beat the lookup's name", async () => {
  const ctx = hostWith([{ op: 'last-spring', refs: [{ type: 'naqp', name: 'DAVY', location: 'WI' }] }])
  loadHistory(parseHistory(HISTORY))
  assert.deepEqual(await suggested(ctx, { call: 'AA0AC', name: 'David Smith', state: 'IA' }), { name: 'DAVE', location: 'MN' })
  removeHistory()
  // Without the file, the name an earlier contest logged beats the lookup's…
  assert.equal((await suggested(ctx, { call: 'AA0AC', name: 'David Smith', state: 'IA' })).name, 'DAVY')
  assert.equal((await suggested({} as HookContext, { call: 'W1AW', guess: { name: 'Hiram Percy Maxim' } })).name, 'HIRAM')
  assert.equal((await suggested({} as HookContext, { call: 'AA0AC' })).name, '')
})

test("the lookup's location beats an earlier one, which fills in where the lookup has none", async () => {
  const ctx = hostWith([{ op: 'last-spring', refs: [{ type: 'pwt', name: 'STEVE', location: 'NY' }] }])
  // They have moved since: the lookup is the fresher word on where they are.
  assert.equal((await suggested(ctx, { call: 'K2LE', state: 'FL' })).location, 'FL')
  assert.equal((await suggested(ctx, { call: 'K2LE' })).location, 'NY')
})

test("an earlier location the Sprint does not list is passed over", async () => {
  const ctx = hostWith([
    { op: 'a', refs: [{ type: 'naqp', location: 'ZZ' }] },
    { op: 'b', refs: [{ type: 'ssb-sprint', location: 'ny' }] },
  ])
  assert.equal((await suggested(ctx, { call: 'K2LE' })).location, 'NY')
})

test('a US or Canadian station is guessed at its state or province, never its prefix', () => {
  assert.equal(guessedLocation({ call: 'W1AW', state: 'CT' }), 'CT')
  assert.equal(guessedLocation({ call: 'VE3XYZ', guess: { state: 'ON' } }), 'ON')
  assert.equal(guessedLocation({ call: 'KL7RA', state: 'AK' }), 'AK')
  // No state resolved: blank, because every one of them is a multiplier.
  assert.equal(guessedLocation({ call: 'W1AW' }), '')
  assert.equal(guessedLocation({ call: 'VE3XYZ' }), '')
  // …except where the entity is the state: Alaska and Hawaii, offline too,
  // and whatever mailing address the lookup holds.
  assert.equal(guessedLocation({ call: 'KL7RA' }), 'AK')
  assert.equal(guessedLocation({ call: 'KH6ZZ' }), 'HI')
  assert.equal(guessedLocation({ call: 'KL7RA', state: 'WA' }), 'AK')
})

test("a portable call is never guessed at its home call's state", () => {
  // The lookup answers for the home call: K2LE/4 isn't in New York, and
  // K2LE/VE3 isn't in the US at all.
  assert.equal(guessedLocation({ call: 'K2LE/4', state: 'NY' }), '')
  assert.equal(guessedLocation({ call: 'K2LE/VE3', state: 'NY' }), '')
  assert.equal(guessedLocation({ call: 'VE3ABC/W4', guess: { state: 'ON' } }), '')
  // Nor is a plain call guessed at a place in the other country.
  assert.equal(guessedLocation({ call: 'W1AW', state: 'ON' }), '')
})

test('Hawaii sends its state, though the country file puts it in Oceania', () => {
  assert.equal(annotateCallAgainstCountryFile('KH6ABC').continent, 'OC')
  assert.equal(guessedLocation({ call: 'KH6ABC', state: 'HI' }), 'HI')
})

test("North American countries are guessed in the sponsor's spelling", () => {
  assert.equal(guessedLocation({ call: 'XE1ABC' }), 'XE')
  assert.equal(guessedLocation({ call: 'KP4ABC' }), 'KP4')
  // The country file's `HI` is the Dominican Republic; the sponsor writes HI3,
  // since HI is Hawaii.
  assert.equal(annotateCallAgainstCountryFile('HI8ABC').entityPrefix, 'HI')
  assert.equal(guessedLocation({ call: 'HI8ABC' }), 'HI3')
  // Clipperton is `FO/c` there and `FO/C` here; San Andres is `HK0/a` there
  // and plain `HK0` here.
  assert.equal(guessedLocation({ call: 'TX5C' }), 'FO/C')
  assert.equal(annotateCallAgainstCountryFile('HK0AA').entityPrefix, 'HK0/a')
  assert.equal(guessedLocation({ call: 'HK0AA' }), 'HK0')
  // North American, but not on the rules' list: their prefix, a contact and
  // no multiplier.
  assert.equal(guessedLocation({ call: 'VP9ABC' }), 'VP9')
})

test('the lookup\'s reading of a station beats the country file\'s', () => {
  assert.equal(guessedLocation({ call: 'XE1ABC', guess: { entityPrefix: 'DL', continent: 'EU' } }), 'DX')
  assert.equal(guessedLocation({ call: 'DL1ABC', guess: { entityPrefix: 'XE', continent: 'NA' } }), 'XE')
})

test('everyone else is DX', () => {
  assert.equal(guessedLocation({ call: 'DL1ABC' }), 'DX')
  assert.equal(guessedLocation({ call: 'FO/K1ABC' }), 'DX')
  assert.equal(guessedLocation({ call: 'KH7K' }), 'DX')
})

test('the aliases the rules and old habits use read as the multiplier', () => {
  assert.deepEqual(['kl7', 'KH6', 'pq', 'NF', ' ny '].map(normalizeLocation), ['AK', 'HI', 'QC', 'NL', 'NY'])
})
