// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// N1MM's Sweepstakes call history, read as the files are published and
// offered while logging.

import { test } from "node:test"
import assert from "node:assert/strict"

import { fixtureOperation, loadExtension } from "./sdkGapTesting.ts"
import { historyFor, loadHistory, parseHistory, removeHistory } from "./history.ts"

/// The head of SSSSB_2025-009.txt as published, CRLF and all, plus rows for
/// the cases the full file has a handful of.
const FILE = [
  '!!Order!!,Call,Sect,State,CK,UserText,',
  '#',
  '# Current contest: SSCW',
  '# Helping file, LOG what you copy',
  '# MAR are now NB or NS, NT is TER',
  '4U1WB,MDC,DC,89,',
  'AA0A,MO,MO,60,',
  'AA1RB,VA,VA,8,',
  'AA1WA,EMA,MA,0,',
  'K1IEB,AZ,AZ,-1,',
  'VA3HUN,,ON,2,',
  'VE9MY,NB,,',
  'K2LE/1,WMA,MA,72,',
  'K2LE,ENY,NY,72,',
  'W1XYZ,XX,CT,ab,',
  '',
].join('\r\n')

test("each call's section and check, by the columns the Order line names", () => {
  const index = parseHistory(FILE)
  assert.deepEqual(index['4U1WB'], ['MDC', '89'])
  assert.deepEqual(index['AA0A'], ['MO', '60'])
  // A check is sent as two digits; the file writes a number.
  assert.deepEqual(index['AA1RB'], ['VA', '08'])
  // -1 and 0 are the file's "unknown": the section alone is kept.
  assert.deepEqual(index['AA1WA'], ['EMA', ''])
  assert.deepEqual(index['K1IEB'], ['AZ', ''])
  assert.deepEqual(index['VA3HUN'], ['', '02'])
  assert.deepEqual(index['VE9MY'], ['NB', ''])
  // Nothing valid, nothing kept.
  assert.equal(index['W1XYZ'], undefined)
  assert.equal(Object.keys(index).length, 9)
})

test("the Order line is read, not assumed, and a file without one has N1MM's default order", () => {
  assert.deepEqual(parseHistory('!!ORDER!!;CK;Call;Sect\n79;w9jj;il')['W9JJ'], ['IL', '79'])
  assert.deepEqual(parseHistory('W9JJ,Bob,,,IL,IL,79')['W9JJ'], ['IL', '79'])
})

test("this weekend's file answers first, the other's when it has nothing", () => {
  loadHistory('CW', parseHistory('!!Order!!,Call,Sect,CK\nW9JJ,IL,79\n'))
  loadHistory('SSB', parseHistory('!!Order!!,Call,Sect,CK\nW9JJ,WI,79\nK8MM,MI,92\n'))
  assert.deepEqual(historyFor('W9JJ', 'CW'), { section: 'IL', check: '79' })
  assert.deepEqual(historyFor('w9jj', 'SSB'), { section: 'WI', check: '79' })
  assert.deepEqual(historyFor('K8MM', 'CW'), { section: 'MI', check: '92' })
  assert.equal(historyFor('N0NE', 'CW'), undefined)
  removeHistory('SSB')
  assert.equal(historyFor('K8MM', 'CW'), undefined)
  removeHistory('CW')
})

test("a portable call the file doesn't list keeps its check, not the home section", () => {
  loadHistory('CW', parseHistory(FILE))
  assert.deepEqual(historyFor('K2LE/1', 'CW'), { section: 'WMA', check: '72' })
  assert.deepEqual(historyFor('K2LE/4', 'CW'), { section: '', check: '72' })
  assert.equal(historyFor('AA1WA/3', 'CW'), undefined)
  removeHistory('CW')
})

type Control = { key: string; input: Record<string, unknown> }

test("logging offers the check and section the station sent before, as a guess", async () => {
  const contest = await loadExtension(() => import("./index.ts"), { hostCalls: { getSettings: () => ({}) } })
  await contest.runHook('dataFile', 'onLoadRawData', parseHistory(FILE), { key: 'ham2k-arrl-ss-sscw' })
  const operation = fixtureOperation({ stationCall: 'N0DEV', refs: [{ type: 'arrl-ss', mode: 'CW', entry: 'SO-LOW', check: '79', section: 'CT' }] })
  const controls = async (their: Record<string, string>) =>
    (await contest.runHook('activity', 'loggingControls', { operation, qso: { their } })) as Control[]

  const known = await controls({ call: 'AA0A' })
  const check = known.find((c) => c.key === 'arrl-ss/theirCheck')!.input
  const section = known.find((c) => c.key === 'arrl-ss/theirSection')!.input
  assert.equal(check.suggestedValue, '60')
  assert.equal(section.suggestedValue, 'MO')
  assert.equal((section.preferredCodes as string[])[0], 'MO')

  // A lookup's state still ranks the picker, behind what the station sent.
  const both = await controls({ call: 'AA1WA', state: 'CT' })
  const bothSection = both.find((c) => c.key === 'arrl-ss/theirSection')!.input
  assert.equal(bothSection.suggestedValue, 'EMA')
  assert.deepEqual(bothSection.preferredCodes, ['EMA', 'CT'])
  assert.equal(both.find((c) => c.key === 'arrl-ss/theirCheck')!.input.suggestedValue, undefined)

  // A station the file doesn't know gets no guess at all.
  const unknown = await controls({ call: 'W1AW', state: 'CT' })
  assert.equal(unknown.find((c) => c.key === 'arrl-ss/theirCheck')!.input.suggestedValue, undefined)
  assert.equal(unknown.find((c) => c.key === 'arrl-ss/theirSection')!.input.suggestedValue, undefined)
  assert.deepEqual(unknown.find((c) => c.key === 'arrl-ss/theirSection')!.input.preferredCodes, ['CT'])
})
