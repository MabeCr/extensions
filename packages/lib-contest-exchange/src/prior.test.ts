// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT

import { test } from "node:test"
import assert from "node:assert/strict"

import type { HookContext, JSONValue } from "@ham2k/extension-sdk"

import { needsGuess, priorSent } from "./prior.ts"

type Logged = { uuid?: string; op: string; refs: Record<string, JSONValue>[] }

/// A host answering from [log], newest first, with the filters the helper
/// uses applied as the app applies them; [asked] records each query.
function hostWith(log: Logged[], asked: Record<string, unknown>[] = []): HookContext {
  return {
    getHistoryForCall: async (_call: string, options: Record<string, unknown>) => {
      asked.push(options)
      const types = ([] as unknown[]).concat(options.refType ?? [])
      return log
        .filter((q) => options.operation === undefined || q.op === options.operation)
        .filter((q) => options.excludeOperation === undefined || q.op !== options.excludeOperation)
        .filter((q) => q.refs.some((r) => types.includes(r.type)))
        .map((q) => ({ uuid: q.uuid ?? `${q.op}-qso`, their: { call: 'K1ABC' }, refs: q.refs }) as Record<string, JSONValue>)
    },
  } as unknown as HookContext
}

const upper = (field: string) => (ref: Record<string, JSONValue>) => (typeof ref[field] === 'string' ? (ref[field] as string).toUpperCase() : '')
const read = { name: upper('name'), location: upper('location') }
const operation = { uuid: 'tonight' }

test("this operation's contacts are kept apart from earlier ones", async () => {
  const sent = await priorSent(hostWith([
    { op: 'tonight', refs: [{ type: 'sprint', name: 'bob' }] },
    { op: 'last-year', refs: [{ type: 'sprint', name: 'robert', location: 'ct' }] },
  ]), { call: 'k1abc', operation, refTypes: ['sprint'], read })
  // Mixing the two would offer last year's name over the one copied tonight.
  assert.deepEqual(sent, { here: { name: 'BOB', location: '' }, before: { name: 'ROBERT', location: 'CT' } })
})

test("each part is the newest one with a value, from any of the contest's types", async () => {
  const sent = await priorSent(hostWith([
    { op: 'a', refs: [{ type: 'naqp', name: 'BOB' }] },
    { op: 'b', refs: [{ type: 'sprint', name: 'ROBERT', location: 'CT' }] },
    { op: 'c', refs: [{ type: 'other', name: 'RAY', location: 'MA' }] },
  ]), { call: 'K1ABC', operation, refTypes: ['sprint', 'naqp'], read })
  assert.deepEqual(sent.before, { name: 'BOB', location: 'CT' })
})

test("the contact being edited is not its own history", async () => {
  const sent = await priorSent(hostWith([{ uuid: 'me', op: 'tonight', refs: [{ type: 'sprint', name: 'TYPO' }] }]), {
    call: 'K1ABC', operation, qso: { uuid: 'me' }, refTypes: ['sprint'], read,
  })
  assert.equal(sent.here.name, '')
})

test("an operation with no uuid has no `here`, and asks for no operation", async () => {
  const asked: Record<string, unknown>[] = []
  const sent = await priorSent(hostWith([{ op: 'x', refs: [{ type: 'sprint', name: 'BOB' }] }], asked), {
    call: 'K1ABC', operation: {}, refTypes: ['sprint'], read,
  })
  assert.deepEqual(sent, { here: { name: '', location: '' }, before: { name: 'BOB', location: '' } })
  assert.ok(asked.every((options) => !('operation' in options) && !('excludeOperation' in options)))
})

test("when this operation's history cannot be read, earlier ones are not offered over it", async () => {
  const ctx = {
    getHistoryForCall: async (_call: string, options: Record<string, unknown>) => {
      if (options.operation) throw new Error('no log')
      return [{ refs: [{ type: 'sprint', name: 'ROBERT' }] }]
    },
  } as unknown as HookContext
  const sent = await priorSent(ctx, { call: 'K1ABC', operation, refTypes: ['sprint'], read })
  assert.deepEqual(sent.before, { name: '', location: '' })
})

test("no call, or a host without history, reads nothing", async () => {
  const empty = { here: { name: '', location: '' }, before: { name: '', location: '' } }
  assert.deepEqual(await priorSent({} as HookContext, { call: 'K1ABC', operation, refTypes: ['sprint'], read }), empty)
  assert.deepEqual(await priorSent(hostWith([{ op: 'tonight', refs: [{ type: 'sprint', name: 'BOB' }] }]), { call: ' ', operation, refTypes: ['sprint'], read }), empty)
})

test("a part the operator decided, even by emptying it, needs no guess", () => {
  assert.equal(needsGuess(undefined, ['name']), true)
  assert.equal(needsGuess({ type: 'sprint', name: '' }, ['name']), false)
  assert.equal(needsGuess({ type: 'sprint', name: 'BOB' }, ['name', 'location']), true)
})
