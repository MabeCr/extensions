// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Which source an R1 or RSGB VHF+ prefill takes the grid from. The guess is
// stamped onto the ref at save, and the scorer reads distance from it, so the
// wrong source winning is a wrong claim.

import { test } from "node:test"
import assert from "node:assert/strict"

import type { HookContext, JSONValue } from "@ham2k/extension-sdk"

import { suggestedGrid } from "./exchange.ts"

/// A host whose log holds [log] for every call, newest first, split by
/// operation the way the app's filters split it.
function hostWith(log: { op: string; grid: string }[]): HookContext {
  return {
    getHistoryForCall: async (_call: string, options: Record<string, unknown>) => log
      .filter((q) => options.operation === undefined || q.op === options.operation)
      .filter((q) => options.excludeOperation === undefined || q.op !== options.excludeOperation)
      .map((q) => ({ refs: [{ type: 'r1-vhf-tests', grid: q.grid }] }) as Record<string, JSONValue>),
  } as unknown as HookContext
}

const tonight = { uuid: 'tonight', refs: [{ type: 'r1-vhf-tests', ref: 'R1-VHF-2026' }] }
const suggested = (ctx: HookContext, their: Record<string, JSONValue>) => suggestedGrid(ctx, tonight, { their }, 'r1-vhf-tests')

test("the grid copied earlier tonight beats the lookup's, which beats an earlier event's", async () => {
  const both = hostWith([{ op: 'tonight', grid: 'jo01ab' }, { op: 'last-year', grid: 'IO91WO' }])
  assert.equal(await suggested(both, { call: 'G4ABC', guess: { grid: 'IO92AA' } }), 'JO01AB')
  const earlier = hostWith([{ op: 'last-year', grid: 'IO91WO' }])
  assert.equal(await suggested(earlier, { call: 'G4ABC', guess: { grid: 'IO92AA' } }), 'IO92AA')
  assert.equal(await suggested(earlier, { call: 'G4ABC' }), 'IO91WO')
})

test("a rover keeps tonight's newest grid, and is never offered an earlier event's", async () => {
  // The lookup's grid is a rover's home, almost never where it is roving.
  const tonightAndBefore = hostWith([{ op: 'tonight', grid: 'JO01AB' }, { op: 'tonight', grid: 'JO02CD' }, { op: 'last-year', grid: 'IO91WO' }])
  assert.equal(await suggested(tonightAndBefore, { call: 'G4ABC/R', guess: { grid: 'IO92AA' } }), 'JO01AB')
  // Last year's route is not this year's.
  const before = hostWith([{ op: 'last-year', grid: 'IO91WO' }])
  assert.equal(await suggested(before, { call: 'G4ABC/R', guess: { grid: 'IO92AA' } }), 'IO92AA')
  assert.equal(await suggested(before, { call: 'G4ABC/r' }), '')
})

test("an earlier grid of the wrong shape is passed over", async () => {
  assert.equal(await suggested(hostWith([{ op: 'last-year', grid: 'IO91' }]), { call: 'G4ABC' }), '')
})

test("a lookup's grid short of a locator yields to an earlier full one", async () => {
  // Stamped at save, a 4-character grid gives the scorer no distance.
  const earlier = hostWith([{ op: 'last-year', grid: 'IO91WO' }])
  assert.equal(await suggested(earlier, { call: 'G4ABC', guess: { grid: 'IO91' } }), 'IO91WO')
  // With nothing better it is still offered, for the operator to complete.
  assert.equal(await suggested(hostWith([]), { call: 'G4ABC', guess: { grid: 'IO91' } }), 'IO91')
})
