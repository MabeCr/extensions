// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The cluster feed and the self-spot poster through the `spots` HOOK, against
// a recorded `fetch`. The traps are the cluster's own: it answers an ENVELOPE
// rather than a bare array, refuses a dead key with HTTP 200 and an `error`
// field, takes one tower per POST, and carries the key in the query string —
// so no message may quote the URL.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

interface Request {
  url: string
  method?: string
  body?: string
}

let sent: Request[] = []
let answer: (request: Request) => { status: number; body: string } = () => ({ status: 200, body: "{}" })

const tota = await loadExtension(() => import("./index.ts"), {
  hostCalls: {
    fetch: (params) => {
      const request = params as unknown as Request
      sent.push(request)
      return answer(request)
    },
  },
})

function respond(body: string, status = 200) {
  sent = []
  answer = () => ({ status, body })
}

const bodyOf = (request: Request) => JSON.parse(request.body ?? "{}") as Record<string, unknown>

const towers = (...refs: string[]) => ({ stationCall: "OK1ABC", refs: refs.map((ref) => ({ type: "totaActivation", ref })) })

type PostResult = { ok: boolean; message?: string }

test("spots are read out of the feed's envelope, not off a bare array", async () => {
  // Mapping the parsed body directly throws `not a function` before a single
  // spot is read, and the board shows no TOTA at all.
  respond(
    JSON.stringify({
      api: "TOTA Cluster",
      version: "1.0",
      count: 1,
      error: null,
      spots: [{ callsign: "ok1abc", frequency: 14285, mode: "ssb", tower_ref: "OKR-0001", time_utc: "2026-07-01T12:00:00Z", comment: "hi" }],
    }),
  )
  const spots = (await tota.runHook("spots", "fetchSpots", {}, { ctx: { online: true } })) as {
    freq: number
    their: { call: string }
    refs: { ref: string; type: string }[]
    spot: { timeInMillis: number }
  }[]

  assert.equal(spots.length, 1)
  assert.equal(spots[0].their.call, "OK1ABC")
  assert.equal(spots[0].freq, 14285)
  assert.deepEqual(spots[0].refs, [{ ref: "OKR-0001", type: "tota" }])
  assert.equal(spots[0].spot.timeInMillis, Date.UTC(2026, 6, 1, 12))
})

test("a refusal the cluster dresses as success fails the fetch, without quoting the URL", async () => {
  // Reading only `spots` turns a dead key into a permanently quiet band: the
  // panel treats "answered with no spots" as healthy and empty.
  respond(JSON.stringify({ api: "TOTA Cluster", version: "1.0", count: 0, spots: [], error: "invalid_api_key" }))
  await assert.rejects(tota.runHook("spots", "fetchSpots", {}, { ctx: { online: true } }), (error: Error) => {
    assert.match(error.message, /invalid_api_key/)
    const key = new URL(sent[0].url).searchParams.get("key")
    assert.ok(key && !error.message.includes(key), "the error quotes the key")
    return true
  })
})

test("a self-spot is one POST per tower, with only the key in the query string", async () => {
  // The endpoint takes a single `tower_ref`, so an n-fer joined into one post
  // spots one tower and silently drops the rest.
  respond("{}")
  const result = (await tota.runHook("spots", "postSelfSpot", { operation: towers("OKR-0001", "OKR-0002"), freq: 14285, mode: "SSB" })) as PostResult

  assert.equal(result.ok, true)
  assert.equal(sent.length, 2)
  assert.equal(sent[0].method, "POST")
  const query = new URL(sent[0].url).searchParams
  assert.deepEqual([...query.keys()], ["key"])
  assert.ok(query.get("key"), "no key on the self-spot")
  const first = bodyOf(sent[0])
  assert.equal(first.callsign, "OK1ABC")
  assert.equal(first.tower_ref, "OKR-0001")
  assert.equal(first.frequency, 14285)
  assert.equal(bodyOf(sent[1]).tower_ref, "OKR-0002")
})

test("an unset mode is sent as null, not guessed as SSB", async () => {
  // Telling the cluster SSB while the activator is on CW sends hunters to the
  // wrong mode.
  respond("{}")
  await tota.runHook("spots", "postSelfSpot", { operation: towers("OKR-0001"), freq: 14285 })
  assert.equal(bodyOf(sent[0]).mode, null)
})

test("a duplicate spot is a success, and any other refusal is still a failure", async () => {
  // Re-spotting a tower is routine and the cluster answers it with a 400.
  respond('{"message":"Duplicate self-spot"}', 400)
  assert.equal(((await tota.runHook("spots", "postSelfSpot", { operation: towers("OKR-0001"), freq: 14285 })) as PostResult).ok, true)

  respond('{"message":"Bad reference"}', 400)
  assert.equal(((await tota.runHook("spots", "postSelfSpot", { operation: towers("OKR-0001"), freq: 14285 })) as PostResult).ok, false)
})

test("every tower is attempted even when one fails, and the failure is named", async () => {
  // Stopping at the first failure leaves a tower the operator IS activating
  // unspotted, with nothing saying which.
  sent = []
  answer = (request) =>
    bodyOf(request).tower_ref === "OKR-0002" ? { status: 500, body: '{"message":"Server exploded"}' } : { status: 200, body: "{}" }
  const result = (await tota.runHook("spots", "postSelfSpot", { operation: towers("OKR-0001", "OKR-0002", "OKR-0003"), freq: 14285 })) as PostResult

  assert.deepEqual(sent.map((r) => bodyOf(r).tower_ref), ["OKR-0001", "OKR-0002", "OKR-0003"])
  assert.equal(result.ok, false)
  assert.match(result.message ?? "", /OKR-0002/)
  assert.doesNotMatch(result.message ?? "", /key=/)
})

test("a QSO with no callsign is refused rather than spotted blank", async () => {
  // TOTA posts no spotter field, so the empty callsign is the whole spot —
  // and it reaches everybody on the cluster.
  respond("{}")
  const result = (await tota.runHook("spots", "postOtherSpot", {
    qso: { their: { call: "" }, freq: 7120, refs: [{ type: "tota", ref: "X-0001" }] },
    spotterCall: "W1AW",
  })) as PostResult
  assert.equal(result.ok, false)
  assert.deepEqual(sent, [])
})
