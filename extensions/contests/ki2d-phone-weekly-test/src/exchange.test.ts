// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Guessing the exchange. A guess is STAMPED onto the ref at save and posted in
// the score as though the station had sent it, so a wrong one is a wrong
// multiplier, not a cosmetic annoyance.

import { test } from "node:test"
import assert from "node:assert/strict"

import type { HookContext, JSONValue } from "@ham2k/extension-sdk"

import { exchangeText, suggestedExchange } from "./exchange.ts"

/// A host whose log holds [log], newest first, answering the `refType` filter
/// the guess uses — or, as a host older than the filters does, ignoring it.
function hostWith(log: { at: number; refs: Record<string, JSONValue>[] }[], asked: Record<string, unknown>[] = [], { filters = true } = {}) {
  return {
    getHistoryForCall: async (_call: string, options: Record<string, unknown>) => {
      asked.push(options)
      const types = filters ? ([] as unknown[]).concat(options.refType ?? []) : []
      return log
        .filter((q) => types.length === 0 || q.refs.some((r) => types.includes(r.type)))
        .map((q) => ({ their: { call: 'K1ABC' }, startAtMillis: q.at, refs: q.refs }) as Record<string, JSONValue>)
    },
  } as unknown as HookContext
}

const operation = { uuid: 'this-week', refs: [{ type: 'pwt', ref: '2026-10-28' }] }
// Ten minutes into this week's session, and into last week's.
const THIS_SESSION = Date.UTC(2026, 9, 28, 2, 40)
const LAST_WEEK = Date.UTC(2026, 9, 21, 2, 40)

test('the name sent last week beats the lookup; the lookup has the fresher location', async () => {
  const asked: Record<string, unknown>[] = []
  const ctx = hostWith([{ at: LAST_WEEK, refs: [{ type: 'pwt', name: 'BOB', location: 'NH' }] }], asked)
  assert.deepEqual(
    await suggestedExchange(ctx, operation, { call: 'K1ABC', name: 'Robert Smith', state: 'CT' }),
    { name: 'BOB', location: 'CT' },
  )
  // The lookup knows no state: last week's location fills in.
  assert.deepEqual(await suggestedExchange(ctx, operation, { call: 'K1ABC' }), { name: 'BOB', location: 'NH' })
  // One read of the log per guess.
  assert.deepEqual(asked, [{ limit: 10, refType: ['pwt', 'naqp'] }, { limit: 10, refType: ['pwt', 'naqp'] }])
})

test('what they sent earlier this session, on another band, stands', async () => {
  const ctx = hostWith([
    { at: THIS_SESSION, refs: [{ type: 'pwt', name: 'ROB', location: 'RI' }] },
    { at: LAST_WEEK, refs: [{ type: 'pwt', name: 'BOB', location: 'NH' }] },
  ])
  assert.deepEqual(await suggestedExchange(ctx, operation, { call: 'K1ABC', state: 'CT' }), { name: 'ROB', location: 'RI' })
})

test('this session is told by the time of each contact, whatever the host filters', async () => {
  // A host older than the filters answers the latest contacts as they are:
  // last week's PWT is not passed off as copied minutes ago, and a POTA
  // contact tonight is not an exchange at all.
  const ctx = hostWith([
    { at: THIS_SESSION, refs: [{ type: 'pota', name: 'NOPE', location: 'US-1234' }] },
    { at: LAST_WEEK, refs: [{ type: 'pwt', name: 'BOB', location: 'NH' }] },
  ], [], { filters: false })
  assert.deepEqual(await suggestedExchange(ctx, operation, { call: 'K1ABC', state: 'CT' }), { name: 'BOB', location: 'CT' })
  // An NAQP contact never counts as this session's.
  const naqp = hostWith([{ at: THIS_SESSION, refs: [{ type: 'naqp', name: 'AL', location: 'ME' }] }])
  assert.deepEqual(await suggestedExchange(naqp, operation, { call: 'K1ABC', state: 'CT' }), { name: 'AL', location: 'CT' })
})

test('an NAQP contact counts, an unrelated one does not, and a bad location is skipped', async () => {
  const ctx = hostWith([
    { at: LAST_WEEK, refs: [{ type: 'pota', name: 'NOPE', location: 'US-1234' }] },
    { at: LAST_WEEK, refs: [{ type: 'naqp', name: 'Al', location: 'XX' }] },
    { at: LAST_WEEK, refs: [{ type: 'naqp', location: 'ME' }] },
  ])
  assert.deepEqual(await suggestedExchange(ctx, operation, { call: 'K1ABC' }), { name: 'AL', location: 'ME' })
})

test('a host without history, or one that fails, leaves the lookup guess', async () => {
  const their = { call: 'K1ABC', name: 'Robert', state: 'CT' }
  assert.deepEqual(await suggestedExchange({} as HookContext, operation, their), { name: 'ROBERT', location: 'CT' })
  const failing = { getHistoryForCall: async () => { throw new Error('no log') } } as unknown as HookContext
  assert.deepEqual(await suggestedExchange(failing, operation, their), { name: 'ROBERT', location: 'CT' })
})

test('an exchange as sent and logged: a DX station sends its name alone', () => {
  assert.equal(exchangeText({ name: 'SEB', location: 'NY' }), 'SEB NY')
  assert.equal(exchangeText({ name: 'HANS', location: 'DX' }), 'HANS DX')
  assert.equal(exchangeText({ name: 'HANS', location: '' }), 'HANS')
})
