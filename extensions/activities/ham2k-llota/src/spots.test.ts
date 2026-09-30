// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The spot feed and the spot poster through the `spots` HOOK, against a
// recorded `fetch`. The traps are the award's own: a POST to the `spots`
// collection the feed reads does nothing useful — spots go to `spots/spot` —
// the endpoint takes one lake, and it names the spotting station
// `operator_callsign`.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

interface Request {
  url: string
  method?: string
  body?: string
}

let sent: Request[] = []
let reply = { status: 200, body: "[]" }

const llota = await loadExtension(() => import("./index.ts"), {
  hostCalls: {
    fetch: (params) => {
      sent.push(params as unknown as Request)
      return reply
    },
  },
})

function respond(body: string, status = 200) {
  sent = []
  reply = { status, body }
}

const bodyOf = (request: Request) => JSON.parse(request.body ?? "{}") as Record<string, unknown>

type PostResult = { ok: boolean; message?: string }

test("a spot whose comments say QRT is dropped", async () => {
  // Showing an operator who has packed up sends hunters to a dead frequency.
  respond(
    JSON.stringify([
      { id: 1, callsign: "W1AW", reference: "LLUS-0001", reference_name: "Placid", frequency: 14285, mode: "SSB", updated_at: "2026-07-01T12:00:00Z", comments: "QRT now" },
      { id: 2, callsign: "K2ABC", reference: "LLUS-0002", reference_name: "George", frequency: 7120, mode: "SSB", updated_at: "2026-07-01T12:05:00Z" },
    ]),
  )
  const spots = (await llota.runHook("spots", "fetchSpots", {}, { ctx: { online: true } })) as {
    their: { call: string }
    spot: { label: string }
  }[]

  assert.equal(spots.length, 1)
  assert.equal(spots[0].their.call, "K2ABC")
  assert.equal(spots[0].spot.label, "LLUS-0002: George")
})

test("a self-spot posts to spots/spot, naming the first lake and the rest in the comment", async () => {
  respond("{}", 201)
  const result = (await llota.runHook("spots", "postSelfSpot", {
    operation: { stationCall: "W1AW", refs: [{ type: "llotaActivation", ref: "LLUS-0001" }, { type: "llotaActivation", ref: "LLUS-0002" }] },
    freq: 14285,
  })) as PostResult

  assert.equal(result.ok, true)
  assert.equal(sent.length, 1)
  assert.equal(new URL(sent[0].url).pathname, "/api/public/spots/spot")
  const body = bodyOf(sent[0])
  assert.equal(body.callsign, "W1AW")
  assert.equal(body.operator_callsign, "W1AW")
  assert.equal(body.reference, "LLUS-0001")
  assert.match(String(body.comments), /2-fer: LLUS-0001 LLUS-0002/)
  assert.ok(body.source, "no source named")
})

test("a blank callsign of our own still falls back to the spotter", async () => {
  // The core hands over '' (or whitespace) as readily as it omits the key,
  // and `'' ?? x` is ''; only a trimmed, empty-as-absent check keeps it.
  respond("{}", 201)
  await llota.runHook("spots", "postOtherSpot", {
    qso: { their: { call: "M0XYZ" }, our: { call: "  " }, freq: 7120, refs: [{ type: "llota", ref: "LLUS-0001" }] },
    spotterCall: "W1AW",
  })
  assert.equal(bodyOf(sent[0]).operator_callsign, "W1AW")
})

test("a QSO with no callsign is refused rather than spotted blank", async () => {
  // A spot naming no station reaches everybody watching the feed.
  respond("{}", 201)
  const result = (await llota.runHook("spots", "postOtherSpot", {
    qso: { their: { call: "" }, freq: 7120, refs: [{ type: "llota", ref: "X-0001" }] },
    spotterCall: "W1AW",
  })) as PostResult
  assert.equal(result.ok, false)
  assert.deepEqual(sent, [])
})
