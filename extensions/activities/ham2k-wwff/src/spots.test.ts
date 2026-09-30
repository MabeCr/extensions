// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The spot feed and the spot poster through the `spots` HOOK, against a
// recorded `fetch`. The request and response shapes are the award's own, and
// only a test that observes the request catches one written from what the API
// "probably" wants: the key has to ride in a header, the feed stamps epoch
// SECONDS, and a spot the award already has comes back as an HTTP 400.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

interface Request {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
}

let sent: Request[] = []
let reply = { status: 200, body: "[]" }

const wwff = await loadExtension(() => import("./index.ts"), {
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

const activation = { stationCall: "W1AW", refs: [{ type: "wwffActivation", ref: "KFF-0001" }] }

test("the feed request carries the award's key in a header, never in the URL", async () => {
  // A header keeps the key out of every log, error report and proxy trace a
  // URL ends up in. Presence only: a copy of the literal here would be a
  // second place to rotate it.
  respond("[]")
  await wwff.runHook("spots", "fetchSpots", {}, { ctx: { online: true } })

  assert.equal(sent.length, 1)
  const key = sent[0].headers?.["X-API-Key"]
  assert.ok(key, "no X-API-Key header")
  assert.ok(!sent[0].url.includes(key), "the key leaked into the URL")
})

test("a park reference validates with no network at all", async () => {
  // The directory is public and the reference shape is known; only the feed
  // is remote, so validating a typed park must not wait on (or fail with) it.
  respond("[]")
  const result = (await wwff.runHook("ref:wwffActivation", "validateRef", { ref: { type: "wwffActivation", ref: "kff-0001" } })) as {
    valid: boolean
    normalized?: string
  }
  assert.equal(result.valid, true)
  assert.equal(result.normalized, "KFF-0001")
  assert.deepEqual(sent, [])
})

test("spot times are read as epoch SECONDS", async () => {
  // The only feed here publishing seconds; read as milliseconds, every spot
  // lands in January 1970 and the age filter drops the lot.
  respond(
    '[{"activator":"w1aw","reference":"KFF-0001","frequency_khz":14285,"mode":"ssb","spot_time":1782000000,"remarks":"up 5","spotter":"g1abc"}]',
  )
  const spots = (await wwff.runHook("spots", "fetchSpots", {}, { ctx: { online: true } })) as {
    freq: number
    their: { call: string }
    spot: { timeInMillis: number }
  }[]

  assert.equal(spots.length, 1)
  assert.equal(spots[0].freq, 14285)
  assert.equal(spots[0].spot.timeInMillis, 1782000000000)
  assert.equal(spots[0].their.call, "W1AW")
})

test("a self-spot posts the fields the award names, to its add endpoint", async () => {
  respond("{}", 201)
  const result = (await wwff.runHook("spots", "postSelfSpot", { operation: activation, freq: 14285, mode: "SSB", comment: "up 5" })) as {
    ok: boolean
  }

  assert.equal(result.ok, true)
  assert.equal(sent.length, 1)
  assert.equal(new URL(sent[0].url).pathname, "/api/spots/add")
  const body = bodyOf(sent[0])
  assert.equal(body.activator, "W1AW")
  assert.equal(body.reference, "KFF-0001")
  assert.equal(body.frequency_khz, 14285)
  assert.equal(body.remarks, "up 5")
})

test("an unset mode is sent as null, not guessed as SSB", async () => {
  // Telling the feed SSB while the activator is on CW sends hunters to the
  // wrong mode; unknown is the truthful answer.
  respond("{}", 201)
  await wwff.runHook("spots", "postSelfSpot", { operation: activation, freq: 14285 })
  assert.equal(bodyOf(sent[0]).mode, null)
})

test("a duplicate spot is a success, and any other refusal is still a failure", async () => {
  // Re-spotting is routine — a new comment, back after a break — and the award
  // answers it with a 400. Reporting that paints an error over a spot that is
  // fine; treating EVERY 400 that way hides the refusals that are real.
  respond('{"message":"Duplicate spot detected"}', 400)
  assert.equal(((await wwff.runHook("spots", "postSelfSpot", { operation: activation, freq: 14285 })) as { ok: boolean }).ok, true)

  respond('{"message":"Bad reference"}', 400)
  assert.equal(((await wwff.runHook("spots", "postSelfSpot", { operation: activation, freq: 14285 })) as { ok: boolean }).ok, false)
})

test("an EMPTY callsign of our own still falls back to the spotter", async () => {
  // The core hands over '' as readily as it omits the key, and `'' ?? x` is
  // ''; only a check that treats empty as absent keeps the spotter.
  respond("{}", 201)
  await wwff.runHook("spots", "postOtherSpot", {
    qso: { their: { call: "M0XYZ" }, our: { call: "" }, freq: 7120, refs: [{ type: "wwff", ref: "GFF-0001" }] },
    spotterCall: "W1AW",
  })
  assert.equal(bodyOf(sent[0]).spotter, "W1AW")
})

test("a QSO with no callsign is refused rather than spotted blank", async () => {
  // A spot naming no station reaches everybody watching the feed.
  respond("{}", 201)
  const result = (await wwff.runHook("spots", "postOtherSpot", {
    qso: { their: { call: "" }, freq: 7120, refs: [{ type: "wwff", ref: "X-0001" }] },
    spotterCall: "W1AW",
  })) as { ok: boolean }
  assert.equal(result.ok, false)
  assert.deepEqual(sent, [])
})
