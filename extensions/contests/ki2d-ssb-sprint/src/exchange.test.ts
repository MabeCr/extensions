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

import { guessedLocation, guessedName } from "./exchange.ts"
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

test('what a station sent before beats the lookup, which beats nothing', () => {
  loadHistory(parseHistory(HISTORY))
  assert.equal(guessedName({ call: 'AA0AC', name: 'David Smith' }), 'DAVE')
  assert.equal(guessedLocation({ call: 'AA0AC', state: 'IA' }), 'MN')
  assert.equal(guessedName({ call: 'W1AW', guess: { name: 'Hiram Percy Maxim' } }), 'HIRAM')
  removeHistory()
  assert.equal(guessedName({ call: 'AA0AC' }), '')
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
