// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { mock, test } from "node:test"

// The recovery path logs on purpose; silenced so a passing run prints no stack
// traces that read as failures.
mock.method(console, 'warn', () => {})

let settings: () => unknown = () => ({})
;(globalThis as Record<string, unknown>).__polo = {
  hostCall: async (method: string) => (method === 'getSettings' ? settings() : null),
}

const { cabrilloClub, cabrilloOperators, clubField, logOperators, ownerCall } = await import("./index.ts")

const ctx = { locale: 'en' }
const operation = { stationCall: 'W1AW', local: { operatorCall: 'K1ABC' } }
const qso = (our: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ our: { call: 'W1AW', ...our }, ...extra })

test("the operators are whoever logged, in the order they first did", () => {
  const qsos = [qso({ operatorCall: 'k1abc' }), qso({ operatorCall: 'W2DEF' }), qso({ operatorCall: 'K1ABC' })]
  assert.deepEqual(logOperators(operation, qsos), ['K1ABC', 'W2DEF'])
})

test("a contact with no operator call was logged by the station's own holder", () => {
  // Without this, a club station where the trustee also operates would list
  // only the guests.
  assert.deepEqual(logOperators(operation, [qso({ operatorCall: 'K1ABC' }), qso({})]), ['K1ABC', 'W1AW'])
})

test("deleted contacts and event markers name nobody", () => {
  const qsos = [qso({ operatorCall: 'N0BAD' }, { deleted: true }), qso({ operatorCall: 'N0EVT' }, { band: 'event' }), qso({ operatorCall: 'W2DEF' })]
  assert.deepEqual(logOperators({ stationCall: 'W1AW' }, qsos), ['W2DEF'])
})

test("the operation's operator is named even before they log", () => {
  // A multi-op entry whose second operator has not made a contact yet still
  // lists them; one already in the log is not listed twice.
  assert.deepEqual(logOperators(operation, [qso({ operatorCall: 'W2DEF' })]), ['W2DEF', 'K1ABC'])
  assert.deepEqual(logOperators({ stationCall: 'W1AW', operatorCall: 'k1abc' }, [qso({ operatorCall: 'K1ABC' })]), ['K1ABC'])
})

test("an empty log names the operation's operator, else its station", () => {
  assert.deepEqual(logOperators(operation, []), ['K1ABC'])
  assert.deepEqual(logOperators({ stationCall: 'W1AW' }, []), ['W1AW'])
  assert.deepEqual(logOperators({}, []), [])
})

test("the operation's station owner closes the Cabrillo OPERATORS line, once", () => {
  const qsos = [qso({ operatorCall: 'K1ABC' }), qso({ operatorCall: 'W2DEF' })]
  assert.equal(cabrilloOperators({ ...operation, ownerCall: ' @n1own ' }, qsos), 'K1ABC W2DEF @N1OWN')
  // An owner who also operated is already named.
  assert.equal(cabrilloOperators({ ...operation, ownerCall: 'K1ABC' }, qsos), 'K1ABC W2DEF')
  assert.equal(cabrilloOperators(operation, qsos), 'K1ABC W2DEF')
  assert.equal(ownerCall({ ownerCall: 'N1OWN W2XYZ' }), 'N1OWN')
})

test("the club field shows the profile's club rather than promising it", async () => {
  settings = () => ({ operatorClub: 'Yankee  Clipper Contest Club' })
  const field = await clubField(ctx, 'test')
  assert.equal(field.key, 'club')
  assert.equal(field.value, 'Yankee Clipper Contest Club')
  // Field Day asks for a club or group, in its own words.
  const fd = await clubField(ctx, 'test', { label: 'Club or group' })
  assert.deepEqual([fd.label, fd.placeholder, fd.value], ['Club or group', undefined, 'Yankee Clipper Contest Club'])
})

test("a host that stops answering keeps the club last read", async () => {
  // Without the sticky read, a re-fetched form definition would blank the
  // seeded field in front of the operator.
  settings = () => ({ operatorClub: 'Potomac Valley Radio Club' })
  await clubField(ctx, 'test')
  settings = () => { throw new Error('host disposed') }
  assert.equal((await clubField(ctx, 'test')).value, 'Potomac Valley Radio Club')
})

test("the export's club is the setup's, a cleared one is none, and an unset one the profile's", async () => {
  settings = () => ({ operatorClub: 'Potomac Valley Radio Club' })
  assert.equal(await cabrilloClub({ club: 'Frankford Radio Club' }, 'test'), 'Frankford Radio Club')
  // Cleared on purpose — a guest at another club's station — sends no club.
  assert.equal(await cabrilloClub({ club: '' }, 'test'), '')
  // Never set, as a setup saved before the field was seeded: the profile's.
  assert.equal(await cabrilloClub({}, 'test'), 'Potomac Valley Radio Club')
  assert.equal(await cabrilloClub(undefined, 'test'), 'Potomac Valley Radio Club')
})
