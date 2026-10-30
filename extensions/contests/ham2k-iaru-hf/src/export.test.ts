// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// IARU HF's export hook, and the half of its ADIF export that is the
// contest's own: the ADIF file is written by the core `adif` exporter, and
// this hook only DELEGATES to it. The traps are in what it hands over. A
// delegation that reaches every export hook instead of `adif` alone re-enters
// this very hook and never returns; one that does not name this contest as the
// main handler gets every program's fields, so a park activated alongside puts
// its MY_SIG on the contest log; and a private-data flag not forwarded
// silently strips (or leaks) what the operator chose.
//
// The core exporter is stood in for by the kernel's local-invoke seam, which
// records the delegation and answers with a file.

import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"
import manifest from "../manifest.json" with { type: "json" }

const contest = await loadExtension(() => import("./index.ts"))

interface Delegation {
  category: string
  method: string
  args: Record<string, unknown>
  key: string | null | undefined
}

let delegated: Delegation[] = []
const polo = (globalThis as unknown as { __polo: Record<string, unknown> }).__polo
polo.invokeLocal = async (category: string, method: string, args: Record<string, unknown>, _online: unknown, key?: string | null) => {
  delegated.push({ category, method, args, key })
  return [{ ok: true, value: { content: '<CALL:4>W0AW <EOR>' } }]
}

beforeEach(() => {
  delegated = []
})

/// Enough on the contest's ref for any event of the family to export, and a
/// POTA activation beside it to give a leaking file something to leak.
const OPERATION = {
  uuid: 'op-1',
  stationCall: 'N0DEV',
  grid: 'EN91',
  refs: [
    { type: 'iaru-hf', mode: 'CW', exchange: '59 001', ourExchange: '59 001', ourClass: '1D', ourSection: 'ENY' },
    { type: 'potaActivation', ref: 'US-0001' },
  ],
}

const QSOS = [0, 1, 2].map((i) => ({
  uuid: `q${i}`,
  our: { call: 'N0DEV' },
  their: { call: `W${i}AW`, state: 'OH', name: 'Alice' },
  band: '20m',
  mode: 'CW',
  freq: 14035,
  startAtMillis: Date.UTC(2026, 2, 28, 12, i),
  refs: [{ type: 'iaru-hf', exchange: `59 00${i}`, theirZone: '5', theirExchange: 'MA', theirSerial: `${i}`, name: 'BOB', location: 'OH' }],
}))

async function exportAdif(extra: Record<string, unknown> = {}) {
  return (await contest.runHook('export', 'generateExport', {
    operation: OPERATION,
    qsos: QSOS,
    exportType: 'iaru-hf-adif',
    ...extra,
  })) as { filename: string; content: string }
}

test("the ADIF export delegates once, to the core exporter alone, as this contest's log", async () => {
  const result = await exportAdif()

  assert.equal(delegated.length, 1)
  const call = delegated[0]
  assert.equal(call.category, 'export')
  assert.equal(call.method, 'generateExport')
  // Keyed to `adif`: an unkeyed fan-out reaches this contest's own
  // generateExport too, which delegates again, forever.
  assert.equal(call.key, 'adif')
  assert.equal(call.args.exportType, 'adif')
  // Without it the core asks every program's adifFields hook for the file.
  assert.equal(call.args.mainHandler, manifest.key)
    // Nothing listed: a park activated alongside the contest must not put
    // its MY_SIG on the contest's log.
  assert.equal(call.args.includeFieldsFrom, undefined)

  assert.equal(result.content, '<CALL:4>W0AW <EOR>')
  assert.match(result.filename, /\.adi$/)
})

test("the private-data choice reaches the core exporter either way", async () => {
  await exportAdif({ includePrivateData: false })
  await exportAdif({ includePrivateData: true })
  assert.deepEqual(delegated.map((d) => d.args.includePrivateData), [false, true])
})

test("an exportType it never offered is declined, not delegated", async () => {
  // `adif` is what the core exporter itself answers for; treating it as
  // "anything that is not our Cabrillo" is the branch that delegates back into
  // the core and round again.
  const result = (await contest.runHook('export', 'generateExport', {
    operation: OPERATION,
    qsos: QSOS,
    exportType: 'adif',
  })) as { content: string }
  assert.equal(result.content, '')
  assert.equal(delegated.length, 0)
})

test("the Cabrillo file comes out of the export hook", async () => {
  // Deliberately generic: enough to prove the hook reaches the Cabrillo
  // writer and hands back a file, never enough to pin a layout.
  const result = (await contest.runHook('export', 'generateExport', {
    operation: OPERATION,
    qsos: QSOS,
    exportType: 'iaru-hf-cabrillo',
  })) as { content: string }
  assert.equal(result.content.split('\n')[0].trim(), 'START-OF-LOG: 3.0')
  assert.equal(delegated.length, 0, 'a Cabrillo file is written here, not delegated')
})

test("the Cabrillo header carries the declared entry, the operators and the club", async () => {
  const exported = async (operation: Record<string, unknown>) =>
    ((await contest.runHook('export', 'generateExport', { operation, qsos: QSOS, exportType: 'iaru-hf-cabrillo' })) as { content: string }).content
  const categories = async (operation: Record<string, unknown>) =>
    (await exported(operation)).split('\n').filter((line) => line.startsWith('CATEGORY-'))

  const declared = { uuid: 'op-1', stationCall: 'N0DEV', refs: [{ type: 'iaru-hf', modeRestriction: 'CW', stationType: 'normal', zone: '8', operator: 'SINGLE-OP', power: 'LOW', overlay: 'YOUTH' }] }
  assert.deepEqual(await categories(declared), [
    'CATEGORY-OPERATOR: SINGLE-OP',
    'CATEGORY-ASSISTED: NON-ASSISTED',
    'CATEGORY-BAND: ALL',
    'CATEGORY-MODE: CW',
    'CATEGORY-POWER: LOW',
    'CATEGORY-OVERLAY: YOUTH',
  ])

  // An HQ station's own category comes from the station type set up for
  // its exchange.
  const hq = { uuid: 'op-2', stationCall: 'W1AW', refs: [{ type: 'iaru-hf', modeRestriction: 'Mixed', stationType: 'hq', society: 'ARRL', operator: 'MULTI-HQ', power: 'HIGH' }] }
  assert.deepEqual(await categories(hq), [
    'CATEGORY-OPERATOR: MULTI-OP',
    'CATEGORY-BAND: ALL',
    'CATEGORY-MODE: MIXED',
    'CATEGORY-POWER: HIGH',
    'CATEGORY-TRANSMITTER: UNLIMITED',
    'CATEGORY-STATION: HQ',
  ])

  // Undeclared, the entry claims nothing beyond the contest's one band.
  assert.deepEqual(await categories({ uuid: 'op-3', stationCall: 'N0DEV', refs: [{ type: 'iaru-hf' }] }), ['CATEGORY-BAND: ALL'])

  const multi = { uuid: 'op-4', stationCall: 'N0DEV', local: { operatorCall: 'N0DEV' }, refs: [{ type: 'iaru-hf', operator: 'MULTI-ONE', operators: 'k1abc, w2def', club: 'Yankee Clipper Contest Club' }] }
  const content = await exported(multi)
  assert.ok(content.includes('\nOPERATORS: K1ABC W2DEF\n'))
  assert.ok(content.includes('\nCLUB: Yankee Clipper Contest Club\n'))
  // With none listed, the app's operator call stands in.
  const solo = { ...multi, refs: [{ type: 'iaru-hf', modeRestriction: 'Mixed' }] }
  assert.ok((await exported(solo)).includes('\nOPERATORS: N0DEV\n'))
})

test("the setup form asks each entry question undeclared first", async () => {
  const controls = (await contest.runHook('activity', 'operationControls', { operation: { refs: [] } })) as {
    input: { form: { elements: { key?: string; value?: unknown; options?: { value: unknown }[] }[] } }
  }[]
  const fields = Object.fromEntries(controls[0].input.form.elements.filter((e) => e.key).map((e) => [e.key, e]))
  for (const key of ['operator', 'power', 'overlay']) {
    assert.equal(fields[key].value, '', key)
    assert.equal(fields[key].options?.[0].value, '', key)
  }
  assert.deepEqual(fields.operator.options?.slice(1).map((o: { value: unknown }) => o.value), ['SINGLE-OP', 'SINGLE-OP-UNLIMITED', 'MULTI-ONE', 'MULTI-TWO', 'MULTI-HQ', 'CHECKLOG'])
  assert.ok(fields.operators && fields.club)
})
