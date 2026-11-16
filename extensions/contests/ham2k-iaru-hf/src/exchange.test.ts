// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Which source the IARU HF prefill takes the exchange from. The guess is
// stamped onto the ref at save as data of record, so the wrong source winning
// is a wrong multiplier claim — and a zone guessed for an HQ station is one.

import { test } from "node:test"
import assert from "node:assert/strict"

import type { HookContext, JSONValue } from "@ham2k/extension-sdk"

import { suggestedExchange } from "./exchange.ts"

/// A host whose log holds [log] for every call, newest first, split by
/// operation and cut to `limit` the way the app's filters do.
function hostWith(log: { op: string; sent: string }[]): HookContext {
  return {
    getHistoryForCall: async (_call: string, options: Record<string, unknown>) => log
      .filter((q) => options.operation === undefined || q.op === options.operation)
      .filter((q) => options.excludeOperation === undefined || q.op !== options.excludeOperation)
      .slice(0, (options.limit as number | undefined) ?? 5)
      .map((q) => ({ refs: [{ type: 'iaru-hf', theirExchange: q.sent }] }) as Record<string, JSONValue>),
  } as unknown as HookContext
}

const thisWeekend = { uuid: 'this-weekend', refs: [{ type: 'iaru-hf' }] }
const suggested = (ctx: HookContext, their: Record<string, JSONValue>) => suggestedExchange(ctx, thisWeekend, { their })

test("what the station sent earlier this weekend beats the lookup's zone", async () => {
  assert.equal(await suggested(hostWith([{ op: 'this-weekend', sent: 'darc' }]), { call: 'DA0HQ', guess: { ituZone: 28 } }), 'DARC')
  assert.equal(await suggested(hostWith([{ op: 'this-weekend', sent: '7' }]), { call: 'W1AW', guess: { ituZone: 8 } }), '7')
})

test("an earlier IARU's society beats the lookup's zone, but its zone does not", async () => {
  // A society is who the station is, which no lookup knows.
  assert.equal(await suggested(hostWith([{ op: 'last-year', sent: 'DARC' }]), { call: 'DA0HQ', guess: { ituZone: 28 } }), 'DARC')
  // A zone is where it is, and the lookup is the fresher word on that.
  assert.equal(await suggested(hostWith([{ op: 'last-year', sent: '7' }]), { call: 'W1AW', guess: { ituZone: 8 } }), '8')
})

test("a society from any earlier IARU is offered, even behind a zone sent since", async () => {
  // HQ duty comes and goes by year: a stale society is the operator's to
  // overwrite, a zone offered over a society is a multiplier missed unseen.
  const ctx = hostWith([{ op: 'last-year', sent: '8' }, { op: 'two-years-ago', sent: 'ARRL' }])
  assert.equal(await suggested(ctx, { call: 'W1AW', guess: { ituZone: 8 } }), 'ARRL')
  // A running's worth of zones, on every band and mode, does not hide it.
  const busy = hostWith([...Array.from({ length: 12 }, () => ({ op: 'last-year', sent: '8' })), { op: 'two-years-ago', sent: 'ARRL' }])
  assert.equal(await suggested(busy, { call: 'W1AW', guess: { ituZone: 8 } }), 'ARRL')
  // This weekend's zone still stands over it.
  const tonight = hostWith([{ op: 'this-weekend', sent: '8' }, { op: 'two-years-ago', sent: 'ARRL' }])
  assert.equal(await suggested(tonight, { call: 'W1AW' }), '8')
})
