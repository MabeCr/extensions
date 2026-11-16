// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The stream against a stand-in Club Log and a clock the test moves: what
// reaches Club Log and when, what is never sent again, and what an edit or a
// deletion in the log turns into there.

import { test } from "node:test"
import assert from "node:assert/strict"

import type { JSONValue } from "@ham2k/extension-sdk"

import { DAILY_REQUESTS, FIRST_BACKOFF_MS, MIN_GAP_MS, Stream, recordOf } from "./stream.ts"
import type { FetchAnswer, Problem } from "./stream.ts"

type Qso = Record<string, JSONValue>
type Sent = { url: string; token: string; body: Record<string, JSONValue> }

const T0 = Date.UTC(2026, 10, 4, 14, 0)

function harness() {
  let now = T0
  let timers: { at: number; callback: () => void }[] = []
  const sent: Sent[] = []
  const told: Problem[] = []
  let nextId = 1000
  let answer: (request: Sent) => FetchAnswer = (request) => {
    if (request.url.endsWith("/qso/deletions")) {
      return { status: 200, body: JSON.stringify({ results: (request.body.qsoids as number[]).map((qsoid) => ({ qsoid, status: "deleted" })) }) }
    }
    const qsos = request.body.qsos as Qso[]
    return { status: 200, body: JSON.stringify({ results: qsos.map(() => ({ status: "created", qsoid: nextId++ })) }) }
  }
  const stream = new Stream({
    async fetch(url, options) {
      const request = { url, token: options.headers.Authorization.replace("Bearer ", ""), body: JSON.parse(options.body) }
      sent.push(request)
      return answer(request)
    },
    async adif(qso) {
      return `<CALL:${String((qso.their as Qso).call).length}>${(qso.their as Qso).call} <EOR>`
    },
    now: () => now,
    setTimeout(callback, ms) {
      timers.push({ at: now + ms, callback })
      return timers.length
    },
    log: () => {},
    tell: (problem) => told.push(problem),
  })

  /// Moves the clock, firing every timer that falls due, and lets each
  /// request it starts finish.
  async function advance(ms: number) {
    const until = now + ms
    for (;;) {
      timers.sort((a, b) => a.at - b.at)
      const due = timers[0]
      if (!due || due.at > until) break
      timers = timers.slice(1)
      now = due.at
      due.callback()
      for (let i = 0; i < 3; i++) await new Promise((resolve) => setImmediate(resolve))
    }
    now = until
  }

  return {
    stream,
    sent,
    told,
    advance,
    get now() {
      return now
    },
    answering(fn: (request: Sent) => FetchAnswer) {
      answer = fn
    },
  }
}

const operation: Qso = { uuid: "op-1", stationCall: "KI2D", refs: [{ type: "clublogLivestream" }] }

let serial = 0
function contact(call: string, overrides: Qso = {}): Qso {
  serial += 1
  return { their: { call }, startAtMillis: T0 + serial * 1000, band: "20m", mode: "SSB", ...overrides }
}

/// A contact as the log holds it once saved: with the uuid the app gave it.
function stored(qso: Qso, uuid: string): Qso {
  return { ...qso, uuid }
}

const callsIn = (request: Sent) => (request.body.qsos as Qso[]).map((item) => String(item.adif).match(/>(\S+)/)![1])

test("a contact goes out as soon as it is logged, as its station's, with the operator's token", async () => {
  const h = harness()
  h.stream.saving({ token: "cl_abc", operation, qso: contact("W1AW"), log: [] })
  await h.advance(0)

  assert.equal(h.sent.length, 1)
  assert.equal(h.sent[0].url, "https://clublog.org/api/v1/qso/batch")
  assert.equal(h.sent[0].token, "cl_abc")
  assert.deepEqual((h.sent[0].body.qsos as Qso[]).map((item) => item.call), ["KI2D"])
  assert.deepEqual(callsIn(h.sent[0]), ["W1AW"])
})

// The app's save hook is handed its operation without a uuid, so there is
// no log to read. The trap is treating that as an empty log: every contact
// already sent would then read as deleted, and the next save would delete
// them all on Club Log.
test("an operation handed over without a uuid still streams, and nothing sent is deleted", async () => {
  const h = harness()
  const bare: Qso = { stationCall: "KI2D", refs: [{ type: "clublogLivestream" }] }
  h.stream.saving({ token: "cl_abc", operation: bare, qso: contact("W1AW") })
  await h.advance(0)
  assert.deepEqual(callsIn(h.sent[0]), ["W1AW"])

  h.stream.saving({ token: "cl_abc", operation: bare, qso: contact("K2ABC") })
  await h.advance(MIN_GAP_MS)
  assert.equal(h.sent.length, 2)
  assert.ok(h.sent.every((request) => request.url.endsWith("/qso/batch")), "no deletion without a log to tell one")
  assert.deepEqual(callsIn(h.sent[1]), ["K2ABC"])
})

test("contacts logged inside the gap wait for it and go out together, as one request", async () => {
  const h = harness()
  const first = contact("W1AW")
  h.stream.saving({ token: "cl_abc", operation, qso: first, log: [] })
  await h.advance(0)
  const second = contact("K2ABC")
  h.stream.saving({ token: "cl_abc", operation, qso: second, log: [stored(first, "u1")] })
  const third = contact("N3XYZ")
  h.stream.saving({ token: "cl_abc", operation, qso: third, log: [stored(first, "u1"), stored(second, "u2")] })
  await h.advance(MIN_GAP_MS - 1)
  assert.equal(h.sent.length, 1, "a second request inside the gap spends the minute's allowance")

  await h.advance(1)
  assert.equal(h.sent.length, 2)
  assert.deepEqual(callsIn(h.sent[1]), ["K2ABC", "N3XYZ"])
})

test("the gap widens as the day's allowance runs low, so streaming lasts until UTC midnight", async () => {
  const h = harness()
  let log: Qso[] = []
  // Most of the allowance spent by 14:00 UTC, one request per gap.
  for (let i = 0; i < DAILY_REQUESTS - 10; i++) {
    const qso = contact(`K${i}AA`)
    h.stream.saving({ token: "cl_abc", operation, qso, log })
    log = [stored(qso, `u${i}`)]
    await h.advance(MIN_GAP_MS)
  }
  const before = h.sent.length
  h.stream.saving({ token: "cl_abc", operation, qso: contact("W1AW"), log })
  await h.advance(MIN_GAP_MS)
  assert.equal(h.sent.length, before, "ten requests left for ten hours must not go out every 30 seconds")
  await h.advance(60 * 60 * 1000)
  assert.equal(h.sent.length, before + 1)
})

test("a refused token stops every request until the operator enters another", async () => {
  const h = harness()
  h.answering(() => ({ status: 401, body: JSON.stringify({ error: { code: "unauthorized", message: "revoked" } }) }))
  const first = contact("W1AW")
  h.stream.saving({ token: "cl_old", operation, qso: first, log: [] })
  await h.advance(0)
  h.stream.saving({ token: "cl_old", operation, qso: contact("K2ABC"), log: [stored(first, "u1")] })
  await h.advance(10 * 60 * 1000)

  assert.equal(h.sent.length, 1, "Club Log asks that a 401 is never retried in a loop")
  assert.deepEqual(h.told, [{ key: "tokenRefused" }])

  h.answering(() => ({ status: 200, body: JSON.stringify({ results: [{ status: "created", qsoid: 1 }, { status: "created", qsoid: 2 }] }) }))
  h.stream.saving({ token: "cl_new", operation, qso: contact("N3XYZ"), log: [stored(first, "u1")] })
  await h.advance(MIN_GAP_MS)
  assert.equal(h.sent.at(-1)!.token, "cl_new")
  assert.deepEqual(callsIn(h.sent.at(-1)!), ["W1AW", "N3XYZ"], "what waited goes out under the new token")
})

test("a contact Club Log rejects is never sent again, and the operator hears of it once", async () => {
  const h = harness()
  h.answering(() => ({ status: 200, body: JSON.stringify({ results: [{ status: "rejected", message: "Invalid band" }] }) }))
  const qso = contact("W1AW", { band: "11m" })
  h.stream.saving({ token: "cl_abc", operation, qso, log: [] })
  await h.advance(MIN_GAP_MS * 10)

  assert.equal(h.sent.length, 1)
  assert.deepEqual(h.told, [{ key: "rejected", call: "KI2D", theirCall: "W1AW", message: "Invalid band" }])
})

test("an operation under a callsign the account does not hold raises one notice, not one per contact", async () => {
  const h = harness()
  // What Club Log answers, seen with a test token: a 200, the item rejected.
  h.answering((request) => ({
    status: 200,
    body: JSON.stringify({ results: (request.body.qsos as Qso[]).map(() => ({ status: "rejected", qsoid: null, message: "That callsign is not on this account." })) }),
  }))
  let log: Qso[] = []
  for (const call of ["W1AW", "K2ABC", "N3XYZ"]) {
    const qso = contact(call)
    h.stream.saving({ token: "cl_abc", operation, qso, log })
    log = [...log, stored(qso, call)]
    await h.advance(MIN_GAP_MS)
  }
  assert.equal(h.sent.length, 3)
  assert.equal(h.told.length, 1)
})

test("a request Club Log answers 422 is not sent again", async () => {
  const h = harness()
  h.answering(() => ({ status: 422, body: JSON.stringify({ error: { code: "invalid", message: "Missing call" } }) }))
  h.stream.saving({ token: "cl_abc", operation, qso: contact("W1AW"), log: [] })
  await h.advance(MIN_GAP_MS * 10)
  assert.equal(h.sent.length, 1, "Club Log: fix the request, do not send the same body again")
})

test("a 429 waits as long as Club Log says before the next request", async () => {
  const h = harness()
  h.answering(() => ({ status: 429, body: JSON.stringify({ error: { code: "rate_limited", message: "slow down", details: { retry_after: 300 } } }) }))
  h.stream.saving({ token: "cl_abc", operation, qso: contact("W1AW"), log: [] })
  await h.advance(0)
  h.answering(() => ({ status: 200, body: JSON.stringify({ results: [{ status: "created", qsoid: 1 }] }) }))
  await h.advance(299 * 1000)
  assert.equal(h.sent.length, 1)
  await h.advance(1000)
  assert.equal(h.sent.length, 2)
})

test("an unreachable Club Log is retried after a pause, never at once", async () => {
  const h = harness()
  let down = true
  h.answering(() => {
    if (down) throw new Error("offline")
    return { status: 200, body: JSON.stringify({ results: [{ status: "created", qsoid: 1 }] }) }
  })
  h.stream.saving({ token: "cl_abc", operation, qso: contact("W1AW"), log: [] })
  await h.advance(0)
  await h.advance(FIRST_BACKOFF_MS - 1)
  assert.equal(h.sent.length, 1, "a write that may have applied is not repeated straight away")
  down = false
  await h.advance(1)
  assert.equal(h.sent.length, 2)
  assert.deepEqual(callsIn(h.sent[1]), ["W1AW"])
})

test("an edit to the call replaces the contact on Club Log: the old one is deleted, the new one sent", async () => {
  const h = harness()
  const original = contact("W1AX")
  h.stream.saving({ token: "cl_abc", operation, qso: original, log: [] })
  await h.advance(0)
  const qsoid = 1000

  const edited = { ...stored(original, "u1"), their: { call: "W1AW" } }
  h.stream.saving({ token: "cl_abc", operation, qso: edited, log: [stored(original, "u1")] })
  await h.advance(MIN_GAP_MS)
  assert.equal(h.sent[1].url, "https://clublog.org/api/v1/qso/deletions")
  assert.deepEqual(h.sent[1].body.qsoids, [qsoid])
  await h.advance(MIN_GAP_MS)
  assert.deepEqual(callsIn(h.sent[2]), ["W1AW"])
})

test("an edit that leaves the call, time, band and mode alone deletes nothing", async () => {
  const h = harness()
  const original = contact("W1AW")
  h.stream.saving({ token: "cl_abc", operation, qso: original, log: [] })
  await h.advance(0)
  const edited = { ...stored(original, "u1"), notes: "nice signal" }
  h.stream.saving({ token: "cl_abc", operation, qso: edited, log: [stored(original, "u1")] })
  await h.advance(MIN_GAP_MS * 4)
  assert.equal(h.sent.filter((request) => request.url.endsWith("/deletions")).length, 0)
})

test("a contact deleted from the log is deleted on Club Log at the next save in the operation", async () => {
  const h = harness()
  const doomed = contact("W1AX")
  h.stream.saving({ token: "cl_abc", operation, qso: doomed, log: [] })
  await h.advance(0)

  // The log no longer holds it: deleted while nothing was being saved.
  h.stream.saving({ token: "cl_abc", operation, qso: contact("K2ABC"), log: [] })
  await h.advance(MIN_GAP_MS)
  assert.deepEqual(h.sent[1].body.qsoids, [1000])
})

test("a contact deleted before it was sent is never sent", async () => {
  const h = harness()
  const first = contact("W1AW")
  h.stream.saving({ token: "cl_abc", operation, qso: first, log: [] })
  await h.advance(0)
  const doomed = contact("W1AX")
  h.stream.saving({ token: "cl_abc", operation, qso: doomed, log: [stored(first, "u1")] })
  // Deleted inside the gap; the next save's log lacks it.
  h.stream.saving({ token: "cl_abc", operation, qso: contact("K2ABC"), log: [stored(first, "u1")] })
  await h.advance(MIN_GAP_MS)
  assert.deepEqual(callsIn(h.sent[1]), ["K2ABC"])
})

test("the first save in an operation also sends its last hour, for what a restart forgot", async () => {
  const h = harness()
  await h.advance(2 * 60 * 60 * 1000)
  const now = h.now
  const log = [
    stored({ their: { call: "OLD1" }, startAtMillis: now - 2 * 60 * 60 * 1000, band: "20m", mode: "CW" }, "u1"),
    stored({ their: { call: "RECENT" }, startAtMillis: now - 10 * 60 * 1000, band: "20m", mode: "CW" }, "u2"),
    stored({ their: { call: "START" }, startAtMillis: now - 5 * 60 * 1000, band: "event", mode: "CW" }, "u3"),
  ]
  const first = { their: { call: "W1AW" }, startAtMillis: now, band: "20m", mode: "CW" }
  h.stream.saving({ token: "cl_abc", operation, qso: first, log })
  await h.advance(0)
  assert.deepEqual(callsIn(h.sent[0]), ["RECENT", "W1AW"])

  const next = { their: { call: "K2ABC" }, startAtMillis: now + 1000, band: "20m", mode: "CW" }
  h.stream.saving({ token: "cl_abc", operation, qso: next, log: [...log, stored(first, "u4")] })
  await h.advance(MIN_GAP_MS)
  assert.deepEqual(callsIn(h.sent[1]), ["K2ABC"], "the sweep runs once per operation, not on every save")
})

test("a callsign the token's account does not hold stops that callsign's contacts, and says why", async () => {
  const h = harness()
  h.answering(() => ({ status: 403, body: JSON.stringify({ error: { code: "forbidden", message: "Callsign not on this account" } }) }))
  h.stream.saving({ token: "cl_abc", operation, qso: contact("W1AW"), log: [] })
  await h.advance(MIN_GAP_MS * 4)
  assert.equal(h.sent.length, 1)
  assert.deepEqual(h.told, [{ key: "callRefused", call: "KI2D", message: "Callsign not on this account" }])
})

test("recordOf hands Club Log the record without the file's header", () => {
  const file = "ADIF export for KI2D\n<ADIF_VER:5>3.1.5\n<EOH>\n<CALL:4>W1AW <BAND:3>20m <EOR>\n"
  assert.equal(recordOf(file), "<CALL:4>W1AW <BAND:3>20M <EOR>")
  assert.throws(() => recordOf("header only <EOH>\n"))
})

// Club Log answers `40m` with "Invalid or unsupported band" and takes `40M`.
// Only the band's own characters change: upper-casing the record would
// rewrite the operator's comments and names too.
test("recordOf upper-cases the bands Club Log matches on, and nothing else", () => {
  const record = "<CALL:4>W1AW <COMMENT:9>nice 40m! <BAND:4>70cm <band_rx:3:E>40m <NAME:3>bob <EOR>"
  assert.equal(recordOf(record), "<CALL:4>W1AW <COMMENT:9>nice 40m! <BAND:4>70CM <band_rx:3:E>40M <NAME:3>bob <EOR>")
})
