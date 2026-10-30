// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The IARU Region 1 VHF family through its HOOKS. Two traps. What the QSO row
// shows as sent is the serial alone — a serial is DROPPED from the ref when
// cleared, and an edited QSO's `our.exchange` rides onto calls added to it
// while the serial is stripped for re-issue, so a hook that projects only when
// the field is present leaves a number this QSO never sent. And the ADIF export
// must reach the core writer alone, as this contest's own log, carrying the
// operator's privacy choice.

import { test } from "node:test"
import assert from "node:assert/strict"

import type { JSONValue } from "@ham2k/extension-sdk"

import { loadExtension } from "./sdkGapTesting.ts"

const r1 = await loadExtension(() => import("./index.ts"))

type Delegation = { category: string; method: string; args: Record<string, unknown>; key?: string }
let delegated: Delegation[] = []

// Where `adifForExport` hands the file to the core ADIF writer; recorded so
// what the contest PASSES is what is tested.
;(globalThis as unknown as { __polo: Record<string, unknown> }).__polo.invokeLocal = async (
  category: string,
  method: string,
  args: Record<string, unknown>,
  _online: unknown,
  key?: string,
) => {
  delegated.push({ category, method, args, key })
  return [{ ok: true, key, value: { content: '<CALL:4>W1AW <EOR>\n' } }]
}

const TYPE = 'r1-vhf-tests'
const EVENT = 'R1-VHF-SUB1-MARCH'

const operation: Record<string, JSONValue> = { uuid: 'op-1', stationCall: 'N0DEV', grid: 'IO91wo', refs: [{ type: TYPE, ref: EVENT }] }

async function decorate(qsoRef: Record<string, JSONValue>, our: Record<string, JSONValue> = { exchange: '41' }) {
  return (await r1.runHook('activity', 'processQsoBeforeSave', {
    operation,
    qso: { band: '2m', mode: 'CW', our, their: { call: 'W1AW' }, refs: [{ type: TYPE, ...qsoRef }] },
  })) as { our?: { exchange?: string }; their?: { exchange?: string } } | null
}

test('the serial alone is what we sent — our grid is not repeated on every row', async () => {
  const patch = await decorate({ ourSerial: 42, theirSerial: '117', grid: 'JO01ab' })
  assert.equal(patch?.our?.exchange, '42')
  assert.equal(patch?.their?.exchange, '117 JO01AB')
})

test('nothing of theirs to write still clears a stale sent serial', async () => {
  const patch = await decorate({})
  assert.equal(patch?.our?.exchange, '')
})

test('the contest ADIF is handed to the core writer alone, with the privacy choice it was given', async () => {
  // Through the whole category it would re-enter this hook; without
  // `mainHandler` every other program's fields land on the contest log.
  for (const includePrivateData of [false, true]) {
    delegated = []
    const result = (await r1.runHook('export', 'generateExport', {
      exportType: `${TYPE}-adif`,
      operation: { ...operation, refs: [...(operation.refs as JSONValue[]), { type: 'potaActivation', ref: 'US-0001' }] },
      qsos: [{ uuid: 'q0', band: '2m', mode: 'CW', startAtMillis: Date.UTC(2026, 2, 7, 15), their: { call: 'W1AW', name: 'Alice' } }],
      includePrivateData,
    })) as { filename: string }
    assert.equal(delegated.length, 1)
    assert.equal(delegated[0].key, 'adif')
    assert.equal(delegated[0].args.exportType, 'adif')
    assert.equal(delegated[0].args.mainHandler, 'ham2k-r1-vhf-tests')
    assert.equal(delegated[0].args.includeFieldsFrom, undefined)
    assert.equal(delegated[0].args.includePrivateData, includePrivateData)
    assert.match(result.filename, /\.adi$/)
  }
})

test("each suggestion names the weekend its next running starts", async (t) => {
  // New Year's Day: every running is this year's. July's Subregional is the
  // first full weekend (the 4th) — app-polo's table had it on a Wednesday.
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 0, 1) })
  const suggestions = (await r1.runHook("activity", "suggest", {})) as { ref: string; name: string }[]
  assert.deepEqual(Object.fromEntries(suggestions.map((s) => [s.ref, s.name])), {
    "R1-VHF-SUB1-MARCH": "Subregional 1 - March • 2026-03-07",
    "R1-VHF-SUB2-MAY": "Subregional 2 - May • 2026-05-02",
    "R1-VHF-SUB3-JULY": "Subregional 3 - July • 2026-07-04",
    "R1-VHF-50-JUNE": "50 MHz CW/SSB - June • 2026-06-20",
    "R1-VHF-70-JULY": "70 MHz CW/SSB - July • 2026-07-18",
    "R1-VHF-145-SEPTEMBER": "145 MHz CW/SSB - September • 2026-09-05",
    "R1-VHF-UHF-OCTOBER": "UHF - October • 2026-10-03",
    "R1-VHF-MARCONI-NOVEMBER": "Marconi Memorial CW 145 MHz - November • 2026-11-07",
  })

  // A week after a weekend, its suggestion offers next year's.
  t.mock.timers.setTime(Date.UTC(2026, 9, 12))
  const uhf = (await r1.runHook("activity", "suggest", { searchTerm: "uhf" })) as { name: string }[]
  assert.equal(uhf[0].name, "UHF - October • 2027-10-02")
})
