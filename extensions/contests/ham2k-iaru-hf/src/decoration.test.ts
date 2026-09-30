// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The exchange this contest keeps on its own ref, projected onto the QSO by
// `processQsoBeforeSave`. The received exchange lives on the contest's ref,
// which nothing generic reads: the QSO row's exchange column and a plain ADIF
// export read `their.exchange`, so without the projection a contest log shows
// an empty exchange everywhere. The patch is narrow — a `their` holding a
// `call` would overwrite the station — and a contest whose exchange can be
// GUESSED writes the guess back onto its own ref as data of record
// (docs/design/contests.md §8), so the log, the score and the submission make
// the same claim.
//
// PRESENCE decides, not truthiness: the core writes '' for a field the operator
// emptied on purpose and drops the key for one never filled, so a guess over ''
// makes the field impossible to clear.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

const contest = await loadExtension(() => import("./index.ts"))

type Patch = { their?: Record<string, unknown>; our?: Record<string, unknown>; refs?: Record<string, unknown>[] } | null

async function decorate(
  qso: Record<string, unknown>,
  refs: Record<string, unknown>[] = [{ type: 'iaru-hf', mode: 'CW', exchange: '59 001' }],
): Promise<Patch> {
  return (await contest.runHook('activity', 'processQsoBeforeSave', {
    operation: { stationCall: 'N0DEV', refs },
    qso: { band: '20m', mode: 'CW', ...qso },
  })) as Patch
}

test("the received exchange reaches their.exchange and is recorded on the ref", async () => {
  const patch = await decorate({ their: { call: 'W1AW' }, refs: [{ type: 'iaru-hf', theirExchange: 'ARRL' }] })
  assert.equal(patch?.their?.exchange, 'ARRL')
  assert.equal('call' in (patch?.their ?? {}), false)
  assert.deepEqual(patch?.refs, [{ type: 'iaru-hf', theirExchange: 'ARRL' }])
})

test("a deliberately emptied exchange stays empty, and the guess is not put back", async () => {
  const patch = await decorate({ their: { call: 'W1AW' }, refs: [{ type: 'iaru-hf', theirExchange: '' }] })
  assert.deepEqual(patch, { their: { exchange: '' } })
})
