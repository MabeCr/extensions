// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The exchange this contest keeps on its own ref, projected onto the QSO by
// `processQsoBeforeSave`. The received exchange lives on the contest's ref,
// which nothing generic reads: the QSO row's exchange column and a plain ADIF
// export read `their.exchange`, so without the projection a contest log shows
// an empty exchange everywhere. The patch is narrow — a `their` holding a
// `call` would overwrite the station — and a pure projection rewrites nothing:
// a free-form exchange cannot be guessed, so the ref is the operator's typing
// alone.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

const contest = await loadExtension(() => import("./index.ts"))

type Patch = { their?: Record<string, unknown>; our?: Record<string, unknown>; refs?: Record<string, unknown>[] } | null

async function decorate(
  qso: Record<string, unknown>,
  refs: Record<string, unknown>[] = [{ type: 'simple-contest', mode: 'CW', exchange: '59 001' }],
): Promise<Patch> {
  return (await contest.runHook('activity', 'processQsoBeforeSave', {
    operation: { stationCall: 'N0DEV', refs },
    qso: { band: '20m', mode: 'CW', ...qso },
  })) as Patch
}

test("the received exchange reaches their.exchange, and nothing else is rewritten", async () => {
  const patch = await decorate({ their: { call: 'W1AW' }, refs: [{ type: 'simple-contest', exchange: '59 042' }] })
  assert.equal(patch?.their?.exchange, '59 042')
  assert.equal('call' in (patch?.their ?? {}), false)
  assert.equal(patch && 'refs' in patch, false)
})

test("a deliberately emptied exchange projects the blank", async () => {
  // Returning nothing here leaves the previous save's exchange in the QSO row
  // and in a plain ADIF export.
  const patch = await decorate({ their: { call: 'W1AW' }, refs: [{ type: 'simple-contest', exchange: '' }] })
  assert.deepEqual(patch, { their: { exchange: '' } })
})
