// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Which source CQWW's prefill takes the zone and RTTY's QTH from. The guess
// is stamped onto the ref at save as data of record, so the wrong source
// winning is a wrong multiplier claim.

import { test } from "node:test"
import assert from "node:assert/strict"

import type { HookContext, JSONValue } from "@ham2k/extension-sdk"

import { suggestedExchange } from "./exchange.ts"

/// A host whose log holds [log] for every call, newest first, split by
/// operation the way the app's filters split it.
function hostWith(log: { op: string; ref: Record<string, JSONValue> }[]): HookContext {
  return {
    getHistoryForCall: async (_call: string, options: Record<string, unknown>) => log
      .filter((q) => options.operation === undefined || q.op === options.operation)
      .filter((q) => options.excludeOperation === undefined || q.op !== options.excludeOperation)
      .map((q) => ({ refs: [{ type: 'cqww', ...q.ref }] }) as Record<string, JSONValue>),
  } as unknown as HookContext
}

const thisWeekend = { uuid: 'this-weekend', refs: [{ type: 'cqww', mode: 'RTTY' }] }

test("the zone copied earlier this weekend beats the lookup's and the country file's", async () => {
  const ctx = hostWith([{ op: 'this-weekend', ref: { theirZone: '4', theirQth: 'TX' } }])
  const qso = { their: { call: 'W1AW', state: 'CT', guess: { cqZone: 5 } } }
  assert.deepEqual(await suggestedExchange(ctx, thisWeekend, qso, true), { zone: '4', qth: 'TX' })
})

test("the lookup beats an earlier CQWW, which only answers where the lookup has nothing", async () => {
  const ctx = hostWith([{ op: 'last-year', ref: { theirZone: '4', theirQth: 'TX' } }])
  // Moved to Connecticut since last year: the lookup is the fresher word.
  assert.deepEqual(await suggestedExchange(ctx, thisWeekend, { their: { call: 'W1AW', state: 'CT', guess: { cqZone: 5 } } }, true), { zone: '5', qth: 'CT' })
  assert.equal((await suggestedExchange(ctx, thisWeekend, { their: { call: 'W1AW' } }, true)).qth, 'TX')
})

test("a QTH is offered only on RTTY, and only to a station that sends one", async () => {
  const ctx = hostWith([{ op: 'this-weekend', ref: { theirZone: '14', theirQth: 'NY' } }])
  assert.equal((await suggestedExchange(ctx, thisWeekend, { their: { call: 'W1AW' } }, false)).qth, '')
  assert.equal((await suggestedExchange(ctx, thisWeekend, { their: { call: 'DL1ABC' } }, true)).qth, '')
})
