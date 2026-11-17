// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The host's queue to the tracker: what it sends, when, and what it does with
// each answer.

import { test } from "node:test"
import assert from "node:assert/strict"

import type { JSONValue } from "@ham2k/extension-sdk"

import { FIRST_BACKOFF_MS, HEARTBEAT_MS, SEND_DELAY_MS, UNREACHABLE_NOTICE_MS, Uploader, qsoBody, qsoId, statusRefs } from "./uploader.ts"
import type { FetchAnswer, Problem } from "./uploader.ts"

type Data = Record<string, JSONValue>
type Answer = FetchAnswer | Error | Promise<FetchAnswer>

const START = Date.UTC(2026, 10, 21, 18, 30)
const ME: FetchAnswer = { status: 200, body: JSON.stringify({ host: { id: "k4swl", call: "K4SWL", name: "Thomas" } }) }

function harness(answer: (path: string, body: Data) => Answer) {
  let now = START
  const timers: { at: number; callback: () => void }[] = []
  const sent: { path: string; body: Data; auth: string }[] = []
  const told: Problem[] = []
  const uploader = new Uploader(
    {
      async fetch(url, options) {
        const path = url.replace(/^.*\/api\/v1/, "")
        const body = (options.body ? JSON.parse(options.body) : {}) as Data
        sent.push({ path, body, auth: options.headers.Authorization ?? "" })
        const result = await answer(path, body)
        if (result instanceof Error) throw result
        return result
      },
      now: () => now,
      setTimeout(callback, ms) {
        timers.push({ at: now + ms, callback })
        return timers.length
      },
      log: () => {},
      tell: (problem) => told.push(problem),
    },
    "hrwbota",
  )
  return {
    uploader,
    sent,
    told,
    /// The paths sent, without the one-time question of whose key it is.
    get paths() {
      return sent.map((s) => s.path).filter((path) => path !== "/me")
    },
    /// Moves the clock and runs every timer that comes due, and whatever they
    /// schedule in turn.
    async advance(ms: number) {
      now += ms
      for (;;) {
        await settle()
        const due = timers.filter((timer) => timer.at <= now)
        if (!due.length) return
        for (const timer of due) timers.splice(timers.indexOf(timer), 1)
        for (const timer of due) timer.callback()
        await settle()
      }
    },
    setNow(value: number) {
      now = value
    },
  }
}

const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

const ok = (path: string, body: Data): FetchAnswer => {
  if (path === "/me") return ME
  if (path === "/status") return { status: 200, body: '{"ok":true,"result":"posted"}' }
  const qsos = (body.qsos as Data[]) ?? []
  return { status: 200, body: JSON.stringify({ results: qsos.map((q) => ({ id: q.id, result: q.deleted ? "deleted" : "added" })) }) }
}

const operation: Data = { uuid: "op", stationCall: "K4SWL", grid: "EM95", refs: [{ type: "hrwbota" }, { type: "potaActivation", ref: "US-2093" }] }

function contact(minute: number, overrides: Data = {}): Data {
  return {
    uuid: `q${minute}`,
    startAtMillis: START + minute * 60 * 1000,
    freq: 14061,
    band: "20m",
    mode: "CW",
    power: 5,
    our: { call: "K4SWL", sent: "599" },
    their: { call: "K2ABC", sent: "579" },
    ...overrides,
  }
}

const idAt = (minute: number, call = "K2ABC") => qsoId("op", { startAtMillis: START + minute * 60 * 1000, their: { call } })

test("a saved contact goes out a moment later with the host's status", async () => {
  const h = harness(ok)
  const qso = contact(0, { uuid: undefined as unknown as JSONValue })
  h.uploader.saving({ key: "hrwb_a", operation, qso, log: [] })
  assert.equal(h.sent.length, 0)
  await h.advance(SEND_DELAY_MS)
  assert.deepEqual(h.sent.map((s) => s.path), ["/me", "/qsos", "/status"])
  assert.equal(h.sent[1].auth, "Bearer hrwb_a")
  assert.deepEqual(h.sent[1].body.qsos, [
    { id: idAt(0), call: "K2ABC", time: START, mode: "CW", freq: 14061, band: "20m", txPower: 5, rstSent: "599", rstRcvd: "579" },
  ])
  assert.deepEqual(h.sent[2].body, {
    state: "on_air", frequencyKhz: 14061, mode: "CW", channel: null, note: null, locationText: null, grid: "EM95",
    refs: [{ type: "pota", ref: "US-2093" }],
  })
})

test("contacts at the same time with different calls are different contacts", async () => {
  const h = harness(ok)
  h.uploader.saving({ key: "k", operation, qso: contact(0), log: [] })
  h.uploader.saving({ key: "k", operation, qso: contact(0, { uuid: "other", their: { call: "W1AW/P" } }), log: [contact(0)] })
  await h.advance(SEND_DELAY_MS)
  const ids = (h.sent.find((s) => s.path === "/qsos")!.body.qsos as Data[]).map((q) => q.id)
  assert.deepEqual(ids, [idAt(0), idAt(0, "W1AW")])
  assert.ok(ids.every((id) => String(id).length <= 64))
})

test("a call list's later contacts, numbered after they were handed over, go again with their serial", async () => {
  const h = harness(ok)
  const numbered = (minute: number, call: string, serial?: number) =>
    contact(minute, { uuid: call, their: { call }, refs: [{ type: "hrwbota", ...(serial !== undefined && { ourSerial: serial }) }] })
  h.uploader.saving({ key: "k", operation, qso: numbered(0, "K2ABC", 1), log: [] })
  h.uploader.saving({ key: "k", operation, qso: numbered(0, "N2DEF"), log: [numbered(0, "K2ABC", 1)] })
  await h.advance(SEND_DELAY_MS)
  const posted = () => h.sent.filter((s) => s.path === "/qsos").flatMap((s) => s.body.qsos as Data[])
  assert.deepEqual(posted().map((q) => [q.call, q.serialSent]), [["K2ABC", 1], ["N2DEF", undefined]])

  h.sent.length = 0
  h.uploader.saving({ key: "k", operation, qso: numbered(1, "W3GHI", 3), log: [numbered(0, "K2ABC", 1), numbered(0, "N2DEF", 2)] })
  await h.advance(SEND_DELAY_MS)
  assert.deepEqual(posted().map((q) => [q.call, q.serialSent]).sort(), [["N2DEF", 2], ["W3GHI", 3]])

  // Once it has gone with one, it doesn't go again.
  h.sent.length = 0
  h.uploader.saving({ key: "k", operation, qso: numbered(2, "K4JKL", 4), log: [numbered(0, "K2ABC", 1), numbered(0, "N2DEF", 2), numbered(1, "W3GHI", 3)] })
  await h.advance(SEND_DELAY_MS)
  assert.deepEqual(posted().map((q) => q.call), ["K4JKL"])
})

test("the status repeats only when it changes or the heartbeat is due", async () => {
  const h = harness(ok)
  const log: Data[] = []
  for (const minute of [0, 1]) {
    h.setNow(START + minute * 60 * 1000)
    h.uploader.saving({ key: "k", operation, qso: contact(minute), log: [...log] })
    log.push(contact(minute))
    await h.advance(SEND_DELAY_MS)
  }
  assert.deepEqual(h.paths, ["/qsos", "/status", "/qsos"])

  h.setNow(START + 2 * 60 * 1000)
  h.uploader.saving({ key: "k", operation, qso: contact(2, { freq: 7030, band: "40m" }), log: [...log] })
  await h.advance(SEND_DELAY_MS)
  assert.equal(h.sent.at(-1)?.path, "/status")
  assert.equal(h.sent.at(-1)?.body.frequencyKhz, 7030)

  h.setNow(START + HEARTBEAT_MS + 3 * 60 * 1000)
  h.uploader.saving({ key: "k", operation, qso: contact(13, { freq: 7030, band: "40m" }), log: [...log, contact(2)] })
  await h.advance(SEND_DELAY_MS)
  assert.equal(h.sent.at(-1)?.path, "/status")
})

test("a contact typed in long after it was made sends no status", async () => {
  const h = harness(ok)
  h.setNow(START + 60 * 60 * 1000)
  h.uploader.saving({ key: "k", operation, qso: contact(0), log: [] })
  await h.advance(SEND_DELAY_MS)
  assert.deepEqual(h.paths, ["/qsos"])
})

test("the power is read as the logger keeps it, typed text included", async () => {
  const h = harness(ok)
  h.uploader.saving({ key: "k", operation, qso: contact(0, { power: "100W" }), log: [] })
  h.uploader.saving({ key: "k", operation, qso: contact(1, { power: "lots" }), log: [contact(0)] })
  await h.advance(SEND_DELAY_MS)
  const posted = h.sent.find((s) => s.path === "/qsos")!.body.qsos as Data[]
  assert.deepEqual(posted.map((q) => q.txPower), [100, undefined])
})

test("a grid longer than the tracker takes is cut to eight characters", async () => {
  const h = harness(ok)
  h.uploader.saving({ key: "k", operation: { ...operation, grid: "EM95ab12cd" }, qso: contact(0), log: [] })
  await h.advance(SEND_DELAY_MS)
  assert.equal(h.sent.find((s) => s.path === "/status")?.body.grid, "EM95ab12")
})

test("a deletion and a move in time reach the tracker at the next save", async () => {
  const h = harness(ok)
  h.uploader.saving({ key: "k", operation, qso: contact(0), log: [] })
  await h.advance(SEND_DELAY_MS)
  h.uploader.saving({ key: "k", operation, qso: contact(1), log: [contact(0)] })
  await h.advance(SEND_DELAY_MS)

  // q0 is gone from the log; q1 moves to minute 3.
  h.uploader.saving({ key: "k", operation, qso: contact(3, { uuid: "q1" }), log: [contact(1)] })
  await h.advance(SEND_DELAY_MS)
  const last = h.sent.filter((s) => s.path === "/qsos").at(-1)!.body.qsos as Data[]
  assert.deepEqual(last.map((q) => [q.id, q.deleted ?? false]), [
    [idAt(0), true],
    [idAt(1), true],
    [idAt(3), false],
  ])
})

test("the first save in an operation sends the whole log, which covers what was missed", async () => {
  const h = harness(ok)
  h.uploader.saving({ key: "k", operation, qso: contact(5), log: [contact(0), contact(1), contact(2, { deleted: true })] })
  await h.advance(SEND_DELAY_MS)
  const ids = (h.sent.find((s) => s.path === "/qsos")!.body.qsos as Data[]).map((q) => q.id)
  assert.deepEqual(ids.sort(), [idAt(0), idAt(1), idAt(5)].sort())
})

test("a refused key stops everything until the key changes, and says so once", async () => {
  const h = harness(() => ({ status: 401, body: '{"error":"bad_key"}' }))
  h.uploader.saving({ key: "bad", operation, qso: contact(0), log: [] })
  await h.advance(SEND_DELAY_MS)
  h.uploader.saving({ key: "bad", operation, qso: contact(1), log: [contact(0)] })
  await h.advance(SEND_DELAY_MS)
  assert.equal(h.sent.length, 1)
  assert.deepEqual(h.told, [{ key: "keyRefused" }])
})

test("a key the account check accepts again sends what waited", async () => {
  let refuse = true
  const h = harness((path, body) => (refuse ? { status: 401, body: "" } : ok(path, body)))
  h.uploader.saving({ key: "k", operation, qso: contact(0), log: [] })
  await h.advance(SEND_DELAY_MS)
  refuse = false
  h.uploader.keyAccepted("k", "K4SWL")
  await h.advance(SEND_DELAY_MS)
  assert.deepEqual(h.paths, ["/qsos", "/status"])
  assert.equal(h.uploader.pending, 0)
})

test("contacts logged under another host's call than the key's are not sent", async () => {
  const h = harness(ok)
  h.uploader.saving({ key: "k", operation: { ...operation, stationCall: "KI2D" }, qso: contact(0), log: [] })
  await h.advance(SEND_DELAY_MS)
  assert.deepEqual(h.paths, [])
  assert.deepEqual(h.told, [{ key: "wrongKey", call: "KI2D", owner: "K4SWL" }])
  assert.deepEqual(await h.uploader.selfSpot({ key: "k", operation: { ...operation, stationCall: "KI2D" }, freq: 14285 }), {
    ok: false,
    problem: "wrongKey",
    owner: "K4SWL",
  })
})

test("contacts dropped for another host's call go out once the operation is under the key's", async () => {
  const h = harness(ok)
  h.uploader.saving({ key: "k", operation: { ...operation, stationCall: "KI2D" }, qso: contact(0), log: [] })
  await h.advance(SEND_DELAY_MS)
  h.uploader.saving({ key: "k", operation, qso: contact(1), log: [contact(0)] })
  await h.advance(SEND_DELAY_MS)
  const ids = h.sent.filter((s) => s.path === "/qsos").flatMap((s) => (s.body.qsos as Data[]).map((q) => q.id))
  assert.deepEqual(ids.sort(), [idAt(0), idAt(1)].sort())
})

test("a 200 that is not the tracker's answer keeps the contacts for the next try", async () => {
  let portal = true
  const h = harness((path, body) => (portal && path === "/qsos" ? { status: 200, body: "<html>Sign in to Wi-Fi</html>" } : ok(path, body)))
  h.uploader.saving({ key: "k", operation, qso: contact(0), log: [] })
  await h.advance(SEND_DELAY_MS)
  assert.equal(h.uploader.pending, 2)
  portal = false
  await h.advance(FIRST_BACKOFF_MS)
  assert.equal(h.uploader.pending, 0)
  assert.equal(h.paths.filter((p) => p === "/qsos").length, 2)
})

test("after a QRT self-spot, a contact made before it does not put the host back on the air", async () => {
  const h = harness(ok)
  h.setNow(START + 5 * 60 * 1000)
  await h.uploader.selfSpot({ key: "k", operation, freq: 14061, mode: "CW", comment: "QRT" })
  h.uploader.saving({ key: "k", operation, qso: contact(4), log: [] })
  await h.advance(SEND_DELAY_MS)
  assert.deepEqual(h.paths, ["/status", "/qsos"])
  h.uploader.saving({ key: "k", operation, qso: contact(6), log: [contact(4)] })
  await h.advance(SEND_DELAY_MS)
  assert.equal(h.sent.at(-1)?.body.state, "on_air")
})

test("a network failure backs off and sends the same contacts again", async () => {
  let fail = true
  const h = harness((path, body) => (fail ? new Error("offline") : ok(path, body)))
  h.uploader.saving({ key: "k", operation, qso: contact(0), log: [] })
  await h.advance(SEND_DELAY_MS)
  assert.equal(h.sent.length, 1)
  fail = false
  await h.advance(FIRST_BACKOFF_MS)
  assert.deepEqual(h.paths, ["/qsos", "/status"])
  assert.equal(h.uploader.pending, 0)
})

test("an answer that says nothing about the contacts keeps them; only a 400 drops them, and says so", async () => {
  let status = 403
  const h = harness((path, body) => (path === "/qsos" && status !== 200 ? { status, body: '{"error":"invalid","message":"send { \\"qsos\\": [ … ] }"}' } : ok(path, body)))
  h.uploader.saving({ key: "k", operation, qso: contact(0), log: [] })
  await h.advance(SEND_DELAY_MS)
  assert.equal(h.uploader.pending, 2)
  status = 400
  await h.advance(FIRST_BACKOFF_MS)
  assert.equal(h.uploader.pending, 0)
  assert.deepEqual(h.told, [{ key: "batchRefused", message: 'send { "qsos": [ … ] }' }])
})

test("a tracker down for long, with contacts waiting, is told once", async () => {
  const h = harness(() => new Error("offline"))
  h.uploader.saving({ key: "k", operation, qso: contact(0), log: [] })
  await h.advance(SEND_DELAY_MS)
  assert.deepEqual(h.told, [])
  for (let waited = 0; waited <= UNREACHABLE_NOTICE_MS + FIRST_BACKOFF_MS * 8; waited += FIRST_BACKOFF_MS) await h.advance(FIRST_BACKOFF_MS)
  assert.deepEqual(h.told, [{ key: "unreachable" }])
})

test("a status the tracker refuses is told once and not sent again until it changes", async () => {
  const h = harness((path, body) => (path === "/status" ? { status: 400, body: '{"error":"invalid","message":"grid must be a Maidenhead locator"}' } : ok(path, body)))
  h.uploader.saving({ key: "k", operation, qso: contact(0), log: [] })
  await h.advance(SEND_DELAY_MS)
  h.uploader.saving({ key: "k", operation, qso: contact(1), log: [contact(0)] })
  await h.advance(SEND_DELAY_MS)
  assert.deepEqual(h.paths, ["/qsos", "/status", "/qsos"])
  assert.deepEqual(h.told, [{ key: "statusRefused", message: "grid must be a Maidenhead locator" }])
})

test("a save while a send is out waits for it, instead of sending the same contacts twice", async () => {
  let release: (answer: FetchAnswer) => void = () => {}
  let first = true
  const h = harness((path, body) => {
    if (path === "/qsos" && first) {
      first = false
      return new Promise<FetchAnswer>((resolve) => (release = () => resolve(ok(path, body))))
    }
    return ok(path, body)
  })
  h.uploader.saving({ key: "k", operation, qso: contact(0), log: [] })
  await h.advance(SEND_DELAY_MS)
  h.uploader.saving({ key: "k", operation, qso: contact(1), log: [contact(0)] })
  await h.advance(SEND_DELAY_MS * 3)
  assert.equal(h.paths.filter((p) => p === "/qsos").length, 1)
  release(ok("/qsos", {}))
  await h.advance(SEND_DELAY_MS)
  const posted = h.sent.filter((s) => s.path === "/qsos").map((s) => (s.body.qsos as Data[]).map((q) => q.id))
  assert.deepEqual(posted, [[idAt(0)], [idAt(1)]])
})

test("a rejected contact is told once, by call and reason", async () => {
  const h = harness((path, body) =>
    path === "/qsos"
      ? { status: 200, body: JSON.stringify({ results: (body.qsos as Data[]).map((q) => ({ id: q.id, result: "rejected", problem: "no mode" })) }) }
      : ok(path, body),
  )
  h.uploader.saving({ key: "k", operation, qso: contact(0), log: [] })
  await h.advance(SEND_DELAY_MS)
  assert.deepEqual(h.told, [{ key: "rejected", call: "K2ABC", message: "no mode" }])
})

test("a self-spot sends the status at once, and QRT takes the host off the air", async () => {
  const h = harness(ok)
  assert.deepEqual(await h.uploader.selfSpot({ key: "k", operation, freq: 14285, mode: "SSB", comment: "QRV workbench tour" }), { ok: true })
  const statuses = () => h.sent.filter((s) => s.path === "/status")
  assert.equal(statuses()[0].body.state, "on_air")
  assert.equal(statuses()[0].body.note, "QRV workbench tour")
  await h.uploader.selfSpot({ key: "k", operation, freq: 14285, mode: "SSB", comment: "QRT thanks all" })
  assert.equal(statuses()[1].body.state, "qrt")
})

test("only the operation's own activations are status refs, under the hunter's type", () => {
  assert.deepEqual(
    statusRefs({ refs: [{ type: "hrwbota" }, { type: "potaActivation", ref: "US-2093" }, { type: "sotaActivation", ref: "W4C/CM-001" }, { type: "pota", ref: "US-1" }] }, "hrwbota"),
    [{ type: "pota", ref: "US-2093" }, { type: "sota", ref: "W4C/CM-001" }],
  )
})

test("a contact goes to the tracker with the serial sent and the listener's irons and brand", () => {
  const qso = {
    their: { call: "K2ABC", state: "NY" },
    startAtMillis: Date.UTC(2026, 10, 21, 18, 34),
    mode: "CW",
    refs: [{ type: "hrwbota", ourSerial: 7, theirIrons: "3", theirBrand: "hakko" }],
  }
  assert.deepEqual(qsoBody("q", qso, "hrwbota"), {
    id: "q",
    call: "K2ABC",
    time: Date.UTC(2026, 10, 21, 18, 34),
    mode: "CW",
    state: "NY",
    serialSent: 7,
    exchange: "3 HAKKO",
  })
  // Nothing logged, nothing sent.
  assert.equal("exchange" in qsoBody("q", { ...qso, refs: [] }, "hrwbota"), false)
})
