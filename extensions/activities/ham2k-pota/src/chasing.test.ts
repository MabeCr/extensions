// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// POTA hunting through its `chasing` hook, the way the app calls it.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { JSONValue } from '@ham2k/extension-sdk'

import { loadExtension } from './sdkGapTesting.ts'

const extension = await loadExtension(() => import('./index.ts'))

function qso(uuid: string, extra: Record<string, JSONValue> = {}): Record<string, JSONValue> {
  return { uuid, our: { call: 'KI2D' }, their: { call: 'W1AW' }, band: '20m', mode: 'SSB', refs: [{ type: 'pota', ref: 'US-1234', name: 'Somewhere SP' }], ...extra }
}

async function claims(...qsos: Record<string, JSONValue>[]): Promise<Record<string, Record<string, JSONValue>[]>> {
  return (await extension.runHook('chasing', 'claimsForQsos', { qsos })) as Record<string, Record<string, JSONValue>[]>
}

test('the program is registered under the extension key and describes itself as data', () => {
  const { hook, key } = extension.hooks.find((h) => h.category === 'chasing')!
  assert.equal(key, 'ham2k-pota')
  assert.equal((hook.program as Record<string, unknown>).editions, 'lifetime')
  // A notice names one line of the checklist: "New POTA Park", not "New POTA Hunter".
  assert.equal((hook.program as Record<string, unknown>).refLabel, 'POTA Park')
})

// The hunter checklist is parks, not park-band-mode: working the same park
// again on another band adds nothing, so the claim says "any".
test('every hunted park is a worked claim on any band and in any mode', async () => {
  const { q1 } = await claims(qso('q1', { refs: [{ type: 'pota', ref: 'us-1234' }, { type: 'pota', ref: 'US-5678' }] }))
  assert.deepEqual(q1, [
    { holder: 'KI2D', ref: 'US-1234', band: null, mode: null, level: 'worked' },
    { holder: 'KI2D', ref: 'US-5678', band: null, mode: null, level: 'worked' },
  ])
})

// The operator's own activation is a ref on the same contact: counted as a
// hunt, a park-to-park contact would fill the operator's checklist with the
// park they were standing in.
test('only hunted parks claim, never the activated one', async () => {
  const { q1 } = await claims(qso('q1', { refs: [{ type: 'potaActivation', ref: 'US-0001' }, { type: 'pota', ref: 'US-1234' }] }))
  assert.deepEqual(
    q1.map((claim) => claim.ref),
    ['US-1234'],
  )
})

test('a park typed without its dash is the same line of the checklist', async () => {
  const answer = await claims(qso('dashless', { refs: [{ type: 'pota', ref: 'us1234' }] }), qso('dashed'))
  assert.equal(answer.dashless[0].ref, 'US-1234')
  assert.equal(answer.dashed[0].ref, 'US-1234')
})

// A marker's calls are placeholders (`EVENT` worked `START`), not a hunt.
test('event markers, deleted contacts and contacts without a uuid claim nothing', async () => {
  const answer = await claims(qso('marker', { band: 'event', our: { call: 'EVENT' } }), qso('gone', { deleted: true }), qso(''))
  assert.deepEqual(answer, { marker: [], gone: [] })
  assert.deepEqual(await extension.runHook('chasing', 'holdersFor', { station: {} }), [])
})

test('portable calls hunt for the same checklist as the home call', async () => {
  const answer = await claims(qso('home'), qso('portable', { our: { call: 'KI2D/P' } }))
  assert.equal(answer.home[0].holder, 'KI2D')
  assert.equal(answer.portable[0].holder, 'KI2D')
  assert.deepEqual(await extension.runHook('chasing', 'holdersFor', { station: { call: 'KI2D/M' } }), ['KI2D'])
})

test("POTA's own credit verifies a hunt, and nothing else lifts it above worked", async () => {
  const answer = await claims(
    qso('credited', { credits: { 'ham2k-pota': { level: 'verified', by: 'pota' } } }),
    qso('lotw', { qsl: { received: true, lotw: { received: true } } }),
  )
  assert.deepEqual([answer.credited[0].level, answer.credited[0].by], ['verified', 'pota'])
  assert.equal(answer.lotw[0].level, 'worked', 'a LoTW confirmation says nothing about which park the station was in')
})

test('the summary counts parks hunted', async () => {
  const slots = [
    { ref: 'US-1234', band: null, mode: null, level: 'worked' },
    { ref: 'US-5678', band: null, mode: null, level: 'verified' },
  ]
  const tallies = (await extension.runHook('chasing', 'summarizeClaims', { holder: 'KI2D', slots })) as Record<string, Record<string, JSONValue>>
  assert.equal(tallies.hunted.total, 2)
  assert.equal(tallies.hunted.label, '2 Parks Hunted')
})

const HUNTED = [
  '﻿"DX Entity","Location","HASC","Reference","Park Name","First QSO Date","QSOs"',
  '"Alaska","Alaska","US-AK","US-0022","Denali National Park","2023-07-15",1',
  '"New York","New York","US-NY","US-1234","Smith, Jones ""Twin"" Lakes","2025-07-22",3',
  '"Nowhere","","","not a park","Nothing","2025-07-22",1',
].join('\r\n')

async function importFile(text: string, station: Record<string, JSONValue> = { call: 'KI2D/P' }, importer = 'hunted-parks') {
  return (await extension.runHook('chasing', 'importClaims', { importer, file: { name: 'hunter_parks.csv', text }, station })) as {
    claims: Record<string, JSONValue>[]
    skipped?: number
  }
}

test('the program offers to import CSV files of hunted parks', () => {
  const { hook } = extension.hooks.find((h) => h.category === 'chasing')!
  assert.deepEqual((hook.program as Record<string, unknown>).imports, [{ key: 'hunted-parks', label: 'POTA Hunted Parks (CSV)', extensions: ['csv'] }])
})

// Every park on POTA's list is one it credited, so the line is verified, for
// the station's base call — the export does not say whose it is.
test('each hunted park is a verified line for the station, from its first contact', async () => {
  const { claims: imported, skipped } = await importFile(HUNTED)
  assert.deepEqual(imported, [
    { holder: 'KI2D', ref: 'US-0022', band: null, mode: null, level: 'verified', by: 'pota', label: 'Denali National Park', at: Date.UTC(2023, 6, 15) },
    { holder: 'KI2D', ref: 'US-1234', band: null, mode: null, level: 'verified', by: 'pota', label: 'Smith, Jones "Twin" Lakes', at: Date.UTC(2025, 6, 22) },
  ])
  assert.equal(skipped, 1)
})

// The activator export has the same columns plus its activations. Read as
// hunts, every park the operator activated would be marked hunted.
test('the export of activated parks claims nothing', async () => {
  const activated = [
    '"DX Entity","Location","HASC","Reference","Park Name","First QSO Date","Attempts","Activations","QSOs"',
    '"Belgium","Antwerpen","BE-VAN","BE-0024","Het Goor Nature Reserve","2025-08-12",1,1,60',
  ].join('\n')
  assert.deepEqual(await importFile(activated), { claims: [], skipped: 1 })
})

test('without a station, or for another importer, nothing is claimed', async () => {
  assert.deepEqual((await importFile(HUNTED, {})).claims, [])
  assert.deepEqual((await importFile(HUNTED, { call: 'KI2D' }, 'other')).claims, [])
})
