// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Which source NAQP's prefill takes the name and location from. A guess is
// stamped onto the ref at save and exported as though the station had sent
// it, so the wrong source winning is a wrong claim in a submitted log.

import { test } from "node:test"
import assert from "node:assert/strict"

import type { HookContext, JSONValue } from "@ham2k/extension-sdk"

import { suggestedExchange } from "./exchange.ts"

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

const tonight = { uuid: 'tonight', refs: [{ type: 'naqp', mode: 'SSB' }] }
const suggested = (ctx: HookContext, their: Record<string, JSONValue>) => suggestedExchange(ctx, tonight, { their })

test("what the station sent earlier tonight beats everything else", async () => {
  const ctx = hostWith([
    { op: 'tonight', refs: [{ type: 'naqp', name: 'BOB', location: 'RI' }] },
    { op: 'last-week', refs: [{ type: 'pwt', name: 'ROBERT', location: 'MA' }] },
  ])
  assert.deepEqual(await suggested(ctx, { call: 'K1ABC', name: 'Robert Smith', state: 'CT' }), { name: 'BOB', location: 'RI' })
})

test("an earlier contest's name beats the lookup's, but the lookup's location beats an earlier one", async () => {
  const ctx = hostWith([{ op: 'last-week', refs: [{ type: 'pwt', name: 'BOB', location: 'MA' }] }])
  // The nickname they send is not the lookup's "Robert"; the state they moved
  // to is the lookup's, not the one they sent last week.
  assert.deepEqual(await suggested(ctx, { call: 'K1ABC', name: 'Robert Smith', state: 'CT' }), { name: 'BOB', location: 'CT' })
  assert.equal((await suggested(ctx, { call: 'K1ABC', name: 'Robert Smith' })).location, 'MA')
})

test("a host without history leaves the lookup's guess", async () => {
  assert.deepEqual(await suggested({} as HookContext, { call: 'K1ABC', name: 'Robert Smith', state: 'CT' }), { name: 'ROBERT', location: 'CT' })
})
