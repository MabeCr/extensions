// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The QSY rule on the FYI line: what a contact obliges, and the message as
// the dial turns.

import { test } from "node:test"
import assert from "node:assert/strict"

import type { FyiMessageParams, JSONValue } from "@ham2k/extension-sdk"

import { tFor } from "./i18n.ts"
import { QsyWatcher, WATCH_MILLIS, dutyAfter, previousContact, qsyMessage, setOf } from "./qsy.ts"

const t = tFor({ locale: 'en' })

test("two contacts in a row on one frequency prove the duty; one alone leaves it to the operator", () => {
  assert.equal(dutyAfter({ freq: 14250 }, { freq: 14250.9 }), 'must')
  assert.equal(dutyAfter({ freq: 14250 }, { freq: 14251 }), 'maybe')
  assert.equal(dutyAfter({ freq: 14250 }, { freq: 7200 }), 'maybe')
  assert.equal(dutyAfter({ freq: 14250 }, undefined), 'maybe')
  assert.equal(dutyAfter({}, { freq: 14250 }), undefined)
})

test("the contact before is the latest one earlier than this, never this one or an event", () => {
  const log: Record<string, JSONValue>[] = [
    { uuid: 'a', startAtMillis: 1000, freq: 14200 },
    { uuid: 'b', startAtMillis: 3000, freq: 14250 },
    { uuid: 'e', startAtMillis: 3500, band: 'event' },
    { uuid: 'c', startAtMillis: 2000, freq: 7200 },
    { uuid: 'd', startAtMillis: 4000, freq: 14260 },
  ]
  assert.equal(previousContact(log, { uuid: 'd', startAtMillis: 4000 })?.uuid, 'b')
  assert.equal(previousContact(log, { uuid: 'x', startAtMillis: 2500 })?.uuid, 'c')
  assert.equal(previousContact(log, { uuid: 'x', startAtMillis: 500 }), undefined)
})

test("the message says how much further, rounded up, and goes from 5 kHz out", () => {
  const must = { duty: 'must' as const, anchorHz: 14250000, left: false }
  assert.deepEqual(qsyMessage(must, 600, t), { category: 'warning', priority: 'normal', text: '**QSY:** 0.4 kHz more to call, 4.4 kHz more to CQ' })
  assert.equal(qsyMessage(must, 0, t)?.text, '**QSY:** 1.0 kHz more to call, 5.0 kHz more to CQ')
  assert.equal(qsyMessage(must, 999, t)?.text, '**QSY:** 0.1 kHz more to call, 4.1 kHz more to CQ')
  assert.deepEqual(qsyMessage(must, 2300, t), { category: 'info', priority: 'normal', text: '**QSY:** 2.7 kHz more to CQ' })
  assert.equal(qsyMessage(must, 4950, t)?.text, '**QSY:** 0.1 kHz more to CQ')
  assert.equal(qsyMessage(must, 5000, t), undefined)

  // Back on the vacated frequency.
  assert.deepEqual(qsyMessage({ ...must, left: true }, 300, t), { category: 'warning', priority: 'normal', text: "**QSY:** no contact on 14.250 until you've made one elsewhere" })
  assert.equal(qsyMessage({ ...must, left: true }, 1500, t)?.text, '**QSY:** 3.5 kHz more to CQ')

  // Hedged: information, never a warning.
  const maybe = { ...must, duty: 'maybe' as const }
  assert.deepEqual(qsyMessage(maybe, 600, t), { category: 'info', priority: 'low', text: '**QSY, unless you answered a CQ:** 0.4 kHz more to call, 4.4 kHz more to CQ' })

  // No dial: the rule alone, for a minute, and only when it is proven.
  assert.deepEqual(qsyMessage(must, undefined, t), { category: 'warning', priority: 'normal', text: '**QSY:** move 1 kHz to call, 5 kHz to CQ', expiresInSeconds: 60 })
  assert.equal(qsyMessage(maybe, undefined, t), undefined)

  assert.equal(tFor({ locale: 'es' })('qsyMaybe'), 'QSY, salvo que respondieras a un CQ')
})

function standIn() {
  const state = {
    dialHz: 14250000 as number | null,
    connected: true,
    throws: false,
    stale: false,
    postFails: false,
    /// Holds the radio's answers back until released, oldest first.
    held: undefined as (() => void)[] | undefined,
    now: 0,
    posted: [] as (FyiMessageParams | 'cleared')[],
    intervals: 0,
    cleared: 0,
  }
  const host = {
    async readRadio() {
      if (state.throws) throw new Error('no radio permission')
      const answer = { status: state.connected ? 'connected' : 'disconnected', stale: state.stale, frequencyHz: state.dialHz }
      if (state.held) await new Promise<void>((resolve) => state.held!.push(resolve))
      return answer
    },
    async post(params: FyiMessageParams) {
      if (state.postFails) throw new Error('line refused')
      state.posted.push(params)
    },
    async clear() {
      state.posted.push('cleared')
    },
    setInterval: () => ++state.intervals,
    clearInterval: () => {
      state.cleared++
    },
  }
  const texts = () => state.posted.map((p) => (p === 'cleared' ? p : p.text))
  return { state, texts, watcher: new QsyWatcher(host, () => state.now) }
}

test("the message follows the dial: tuning away, past 5 kHz, and back", async () => {
  const { state, texts, watcher } = standIn()
  await watcher.contact({ freq: 14250 }, { freq: 14250 }, t)
  assert.deepEqual(texts(), ['**QSY:** 1.0 kHz more to call, 5.0 kHz more to CQ'])
  assert.equal((state.posted[0] as FyiMessageParams).key, 'qsy')
  assert.equal(state.intervals, 1)

  // The same reading posts nothing new.
  await watcher.read()
  assert.equal(state.posted.length, 1)

  state.dialHz = 14251200
  await watcher.read()
  state.dialHz = 14255000
  await watcher.read()
  state.dialHz = 14250400
  await watcher.read()
  assert.deepEqual(texts().slice(1), ['**QSY:** 3.8 kHz more to CQ', 'cleared', "**QSY:** no contact on 14.250 until you've made one elsewhere"])

  // The next contact elsewhere is a new anchor, on the same timer.
  state.dialHz = 14262000
  await watcher.contact({ freq: 14262 }, { freq: 14250 }, t)
  assert.equal(texts().at(-1), '**QSY, unless you answered a CQ:** 1.0 kHz more to call, 5.0 kHz more to CQ')
  assert.equal(state.intervals, 1)

  // A contact with no frequency ends the watch.
  await watcher.contact({}, undefined, t)
  assert.equal(texts().at(-1), 'cleared')
  assert.equal(state.cleared, 1)
})

test("without a readable radio a proven duty shows the rule; the watch ends on its own", async () => {
  const { state, texts, watcher } = standIn()
  state.connected = false
  await watcher.contact({ freq: 7200 }, { freq: 7200.2 }, t)
  assert.deepEqual(texts(), ['**QSY:** move 1 kHz to call, 5 kHz to CQ'])

  state.throws = true
  await watcher.contact({ freq: 7210 }, undefined, t)
  assert.equal(texts().at(-1), 'cleared')

  state.throws = false
  state.connected = true
  state.dialHz = 7210000
  state.now = WATCH_MILLIS + 1
  await watcher.read()
  assert.equal(state.cleared, 1)
  await watcher.read()
  assert.equal(texts().at(-1), 'cleared')
})

test("a message that expired, or failed to post, is sent again", async () => {
  const { state, texts, watcher } = standIn()
  state.connected = false
  await watcher.contact({ freq: 7200 }, { freq: 7200 }, t)
  // The third in a row, after the first message's minute is up: posted again.
  state.now = 120_000
  await watcher.contact({ freq: 7200 }, { freq: 7200 }, t)
  assert.deepEqual(texts(), ['**QSY:** move 1 kHz to call, 5 kHz to CQ', '**QSY:** move 1 kHz to call, 5 kHz to CQ'])

  // A post that fails leaves the line unknown, so the clear still goes out.
  state.connected = true
  state.dialHz = 7200000
  state.postFails = true
  await watcher.read()
  state.postFails = false
  state.dialHz = 7210000
  await watcher.read()
  assert.equal(texts().at(-1), 'cleared')
})

test("a stale frequency is no reading, and a late answer never overwrites a newer one", async () => {
  const { state, texts, watcher } = standIn()
  state.stale = true
  await watcher.contact({ freq: 14250 }, undefined, t)
  assert.deepEqual(texts(), [])

  state.stale = false
  state.held = []
  state.dialHz = 14250000
  const older = watcher.read()
  state.dialHz = 14260000
  const newer = watcher.read()
  await new Promise((resolve) => setImmediate(resolve))
  const [first, second] = state.held
  second()
  await newer
  first()
  await older
  // Only the newer reading — 10 kHz out, nothing to say — counted.
  assert.deepEqual(texts(), [])
})

test("under SO2R the contact before is the one on the same radio, and a contact without one is Radio A's", () => {
  const log: Record<string, JSONValue>[] = [
    { uuid: 'a1', startAtMillis: 1000, freq: 14250, our: { radio: 'A' } },
    { uuid: 'b1', startAtMillis: 2000, freq: 7200, our: { radio: 'B' } },
    { uuid: 'x', startAtMillis: 500, freq: 14300 },
  ]
  assert.equal(previousContact(log, { startAtMillis: 3000, our: { radio: 'A' } })?.uuid, 'a1')
  assert.equal(previousContact(log, { startAtMillis: 3000, our: { radio: 'B' } })?.uuid, 'b1')
  assert.equal(previousContact(log, { startAtMillis: 900 })?.uuid, 'x')
  assert.deepEqual([setOf({}), setOf({ our: { radio: 'A' } }), setOf({ our: { radio: 'B' } }), setOf(undefined)], ['A', 'A', 'B', 'A'])
})

test("a radio's message goes to that radio's set, under its own key", async () => {
  const { state } = standIn()
  const host = {
    readRadio: async () => ({ status: 'connected', frequencyHz: 7200000 }),
    post: async (params: FyiMessageParams) => { state.posted.push(params) },
    clear: async () => { state.posted.push('cleared') },
    setInterval: () => 1,
    clearInterval: () => {},
  }
  const b = new QsyWatcher(host, () => 0, 'qsy-b')
  await b.contact({ freq: 7200, our: { radio: 'B' } }, undefined, t)
  const posted = state.posted[0] as FyiMessageParams
  assert.equal(posted.key, 'qsy-b')
  assert.equal(posted.radio, 'B')

  // Without SO2R the contact names no radio, and neither does the message.
  const a = new QsyWatcher(host, () => 0)
  await a.contact({ freq: 7200 }, undefined, t)
  assert.equal((state.posted[1] as FyiMessageParams).key, 'qsy')
  assert.equal((state.posted[1] as FyiMessageParams).radio, undefined)
})
