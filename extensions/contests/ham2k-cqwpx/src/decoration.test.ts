// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The exchange this contest keeps on its own ref, projected onto the QSO by
// `processQsoBeforeSave`. The received exchange lives on the contest's ref,
// which nothing generic reads: the QSO row's exchange column and a plain ADIF
// export read `their.exchange`, so without the projection a contest log shows
// an empty exchange everywhere. The patch is narrow — a `their` holding a
// `call` would overwrite the station — and a pure projection rewrites nothing:
// a serial cannot be guessed.
//
// Our own serial is projected on EVERY save. A serial is dropped from the ref
// when cleared, never kept as '', and an edited QSO's `our.exchange` rides onto
// calls added to it while the serial is stripped for re-issue — so a hook that
// projects only when the field is present leaves a number this QSO never sent.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

const contest = await loadExtension(() => import("./index.ts"))

type Patch = { their?: Record<string, unknown>; our?: Record<string, unknown>; refs?: Record<string, unknown>[] } | null

async function decorate(
  qso: Record<string, unknown>,
  refs: Record<string, unknown>[] = [{ type: 'cqwpx', mode: 'CW', exchange: '59 001' }],
): Promise<Patch> {
  return (await contest.runHook('activity', 'processQsoBeforeSave', {
    operation: { stationCall: 'N0DEV', refs },
    qso: { band: '20m', mode: 'CW', ...qso },
  })) as Patch
}

test("the received serial reaches their.exchange as a number, and nothing else is rewritten", async () => {
  const patch = await decorate({ their: { call: 'W1AW' }, refs: [{ type: 'cqwpx', theirSerial: '0012' }] })
  assert.equal(patch?.their?.exchange, '12')
  assert.equal('call' in (patch?.their ?? {}), false)
  assert.equal(patch && 'refs' in patch, false)
})

test("the serial we sent reaches our.exchange, as digits", async () => {
  const patch = await decorate({ our: { exchange: '41' }, their: { call: 'W1AW' }, refs: [{ type: 'cqwpx', ourSerial: 42, theirSerial: '117' }] })
  assert.equal(patch?.our?.exchange, '42')
  assert.equal(patch?.their?.exchange, '117')
})

test("no serial on the ref clears the stale sent one, and leaves theirs alone", async () => {
  const patch = await decorate({ our: { exchange: '41' }, their: { call: 'W1AW' }, refs: [{ type: 'cqwpx' }] })
  assert.equal(patch?.our?.exchange, '')
  assert.equal(patch && 'their' in patch, false)
})

test("a deliberately emptied received serial projects the blank", async () => {
  const patch = await decorate({ their: { call: 'W1AW' }, refs: [{ type: 'cqwpx', theirSerial: '' }] })
  assert.equal(patch?.their?.exchange, '')
  assert.equal(patch && 'refs' in patch, false)
})
