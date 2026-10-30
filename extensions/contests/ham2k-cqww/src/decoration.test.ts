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
// makes the field impossible to clear. The zone is guessed from the country
// file: the scorer already falls back to it, so a QSO left with an empty
// exchange earns a zone multiplier while its Cabrillo line prints a dash.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

const contest = await loadExtension(() => import("./index.ts"))

type Patch = { their?: Record<string, unknown>; our?: Record<string, unknown>; refs?: Record<string, unknown>[] } | null

async function decorate(
  qso: Record<string, unknown>,
  refs: Record<string, unknown>[] = [{ type: 'cqww', mode: 'CW', exchange: '59 001' }],
): Promise<Patch> {
  return (await contest.runHook('activity', 'processQsoBeforeSave', {
    operation: { stationCall: 'N0DEV', refs },
    qso: { band: '20m', mode: 'CW', ...qso },
  })) as Patch
}

test("the received zone reaches their.exchange, normalized, and is recorded on the ref", async () => {
  const patch = await decorate({ their: { call: 'W1AW' }, refs: [{ type: 'cqww', theirZone: '05' }] })
  assert.equal(patch?.their?.exchange, '5')
  assert.equal('call' in (patch?.their ?? {}), false)
  assert.deepEqual(patch?.refs, [{ type: 'cqww', theirZone: '5' }])
})

test("an operation not running the contest is left alone, whatever the QSO carries", async () => {
  // A stale contest ref on a QSO of a POTA operation.
  const patch = await decorate({ their: { call: 'W1AW' }, refs: [{ type: 'cqww', theirZone: '5' }] }, [{ type: 'pota', ref: 'US-1234' }])
  assert.equal(patch, null)
})

test("an exchange nobody typed is filled from the country file and recorded on the ref", async () => {
  const patch = await decorate({ their: { call: 'W1AW' } })
  assert.equal(patch?.refs?.[0].theirZone, '5')
  assert.equal(patch?.their?.exchange, '5')
})

test("the country file never overwrites what the operator typed", async () => {
  const patch = await decorate({ their: { call: 'W1AW' }, refs: [{ type: 'cqww', theirZone: '14' }] })
  assert.equal(patch?.refs?.[0].theirZone, '14')
  assert.equal(patch?.their?.exchange, '14')
})

test("a call the country file cannot place is left empty, not invented", async () => {
  assert.equal(await decorate({ their: { call: '' } }), null)
})

test("a deliberately emptied zone stays empty, and the guess is not put back", async () => {
  const patch = await decorate({ their: { call: 'W1AW' }, refs: [{ type: 'cqww', theirZone: '' }] })
  assert.deepEqual(patch, { their: { exchange: '' } })
})

test("on RTTY a W/VE station's QTH joins the exchange, and is recorded on the ref", async () => {
  const rtty = [{ type: 'cqww', mode: 'RTTY' }]
  const typed = await decorate({ mode: 'RTTY', their: { call: 'W1AW' }, refs: [{ type: 'cqww', theirZone: '5', theirQth: 'ct' }] }, rtty)
  assert.equal(typed?.their?.exchange, '5 CT')
  assert.deepEqual(typed?.refs, [{ type: 'cqww', theirZone: '5', theirQth: 'CT' }])

  // Guessed from the call area when nothing was typed, like the zone.
  const guessed = await decorate({ mode: 'RTTY', their: { call: 'VE3XYZ' } }, rtty)
  assert.equal(guessed?.their?.exchange, '4 ON')

  // A DX station sends no QTH, whatever was typed.
  const dx = await decorate({ mode: 'RTTY', their: { call: 'DL1ABC' }, refs: [{ type: 'cqww', theirQth: 'MA' }] }, rtty)
  assert.equal(dx?.their?.exchange, '14')
})

test("setup asks for each part of the entry, undeclared until answered", async () => {
  const controls = async (locale: string) =>
    ((await contest.runHook('activity', 'operationControls', { operation: { stationCall: 'N0DEV', refs: [] } }, { ctx: { locale } })) as {
      input: { form: { elements: { key?: string; value?: string; options?: { value: string; label: string }[] }[] } }
    }[])[0].input.form.elements

  const elements = await controls('en')
  for (const key of ['operator', 'band', 'power', 'overlay']) {
    const select = elements.find((element) => element.key === key)
    assert.equal(select?.value, '', key)
    assert.deepEqual(select?.options?.[0], { value: '', label: 'Not declared' })
  }
  const operator = elements.find((element) => element.key === 'operator')
  assert.equal(operator?.options?.find((option) => option.value === 'MULTI-ONE')?.label, 'Multi-Single')

  const spanish = await controls('es')
  assert.equal(spanish.find((element) => element.key === 'power')?.options?.[1]?.label, 'Alta (1500 W)')
})
