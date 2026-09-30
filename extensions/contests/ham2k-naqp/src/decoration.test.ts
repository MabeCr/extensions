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
// makes the field impossible to clear. Both halves are guessable — the name
// from the lookup, the location from the state — and each decides on its own.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

const contest = await loadExtension(() => import("./index.ts"))

type Patch = { their?: Record<string, unknown>; our?: Record<string, unknown>; refs?: Record<string, unknown>[] } | null

async function decorate(
  qso: Record<string, unknown>,
  refs: Record<string, unknown>[] = [{ type: 'naqp', mode: 'CW', exchange: '59 001' }],
): Promise<Patch> {
  return (await contest.runHook('activity', 'processQsoBeforeSave', {
    operation: { stationCall: 'N0DEV', refs },
    qso: { band: '20m', mode: 'CW', ...qso },
  })) as Patch
}

test("the received exchange reaches their.exchange, joined as the row reads it, and is recorded on the ref", async () => {
  const patch = await decorate({ their: { call: 'W1AW' }, refs: [{ type: 'naqp', name: 'BOB', location: 'ct' }] })
  assert.equal(patch?.their?.exchange, 'BOB CT')
  assert.equal('call' in (patch?.their ?? {}), false)
  assert.deepEqual(patch?.refs, [{ type: 'naqp', name: 'BOB', location: 'CT' }])
})

test("a deliberately emptied exchange stays empty, and the guess is not put back", async () => {
  const patch = await decorate({ their: { call: 'W1AW', guess: { name: 'Hiram', state: 'CT' } }, refs: [{ type: 'naqp', name: '', location: '' }] })
  assert.deepEqual(patch, { their: { exchange: '' } })
})

test("a half it could not guess is left off the ref, not stamped blank", async () => {
  // A blank stamped on the ref reads forever after as "the operator emptied
  // this", so the guess never fires again and the multiplier is lost — the
  // ordinary case offline, before any lookup has answered.
  const unguessed = await decorate({ their: { call: 'W1AW' }, refs: [{ type: 'naqp', name: 'BOB' }] })
  assert.equal(unguessed?.refs?.length, 1)
  assert.equal(unguessed?.refs?.[0].name, 'BOB')
  assert.equal('location' in (unguessed?.refs?.[0] ?? {}), false)

  const guessed = await decorate({ their: { call: 'W1AW', guess: { state: 'CT' } }, refs: [{ type: 'naqp', name: 'BOB' }] })
  assert.equal(guessed?.refs?.[0].location, 'CT')
  assert.equal(guessed?.their?.exchange, 'BOB CT')
})

test("the two halves decide independently", async () => {
  // A cleared name must not re-guess, and must not stop the untouched location
  // from being guessed.
  const patch = await decorate({ their: { call: 'W1AW', state: 'CT', guess: { name: 'Hiram' } }, refs: [{ type: 'naqp', name: '' }] })
  assert.equal(patch?.refs?.[0].name, '')
  assert.equal(patch?.refs?.[0].location, 'CT')
  assert.equal(patch?.their?.exchange, 'CT')
})
