// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Which source the ARRL VHF prefill takes the grid from. The guess is stamped
// onto the ref at save and scored as a multiplier, so the wrong source
// winning is a wrong claim.

import { test } from "node:test"
import assert from "node:assert/strict"

import type { HookContext, JSONValue } from "@ham2k/extension-sdk"

import { eventFor } from "./events.ts"
import { suggestedGrid } from "./exchange.ts"

/// A host whose log holds [log] for every call, newest first, split by
/// operation the way the app's filters split it.
function hostWith(log: { op: string; grid: string }[]): HookContext {
  return {
    getHistoryForCall: async (_call: string, options: Record<string, unknown>) => log
      .filter((q) => options.operation === undefined || q.op === options.operation)
      .filter((q) => options.excludeOperation === undefined || q.op !== options.excludeOperation)
      .map((q) => ({ refs: [{ type: 'arrl-vhf-tests', grid: q.grid }] }) as Record<string, JSONValue>),
  } as unknown as HookContext
}

const JUNE = eventFor('ARRL-VHF-JUN')!
const MICROWAVE = eventFor('ARRL-10G-AUG')!
const tonight = { uuid: 'tonight', refs: [{ type: 'arrl-vhf-tests', ref: 'ARRL-VHF-JUN' }] }
const suggested = (ctx: HookContext, their: Record<string, JSONValue>, event = JUNE) =>
  suggestedGrid(ctx, tonight, { their }, 'arrl-vhf-tests', event)

test("the grid copied earlier tonight beats the lookup's, which beats an earlier event's", async () => {
  const both = hostWith([{ op: 'tonight', grid: 'fn42' }, { op: 'last-year', grid: 'FN31' }])
  assert.equal(await suggested(both, { call: 'W1AW', guess: { grid: 'FN31pr' } }), 'FN42')
  const earlier = hostWith([{ op: 'last-year', grid: 'FN42' }])
  assert.equal(await suggested(earlier, { call: 'W1AW', guess: { grid: 'FN31pr' } }), 'FN31')
  assert.equal(await suggested(earlier, { call: 'W1AW' }), 'FN42')
})

test("a rover keeps tonight's newest grid, and is never offered an earlier event's", async () => {
  // The lookup's grid is a rover's home, almost never where it is roving.
  const tonightAndBefore = hostWith([{ op: 'tonight', grid: 'FN42' }, { op: 'tonight', grid: 'FN43' }, { op: 'last-year', grid: 'FN20' }])
  assert.equal(await suggested(tonightAndBefore, { call: 'W1AW/R', guess: { grid: 'FN31pr' } }), 'FN42')
  // Last year's route is not this year's.
  const before = hostWith([{ op: 'last-year', grid: 'FN20' }])
  assert.equal(await suggested(before, { call: 'W1AW/R', guess: { grid: 'FN31pr' } }), 'FN31')
  assert.equal(await suggested(before, { call: 'W1AW/R' }), '')
})

test("an earlier grid is trimmed to the event's precision, and passed over when short of it", async () => {
  assert.equal(await suggested(hostWith([{ op: 'last-year', grid: 'FN42ab' }]), { call: 'W1AW' }), 'FN42')
  assert.equal(await suggested(hostWith([{ op: 'last-year', grid: 'FN42' }]), { call: 'W1AW' }, MICROWAVE), '')
  // A lookup's grid that short yields to an earlier full one, and is offered
  // only when nothing better is known.
  assert.equal(await suggested(hostWith([{ op: 'last-year', grid: 'FN42ab' }]), { call: 'W1AW', guess: { grid: 'FN31' } }, MICROWAVE), 'FN42AB')
  assert.equal(await suggested(hostWith([]), { call: 'W1AW', guess: { grid: 'FN31' } }, MICROWAVE), 'FN31')
})
