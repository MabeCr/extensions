// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// A Test Operation's self-spot, through `postSelfSpot`. The app appends both
// the /TEST suffix and a multi-station operator suffix before the hook sees
// the call, so what arrives is `KI2D/TEST/OP1`. An extension that stops
// recognising that as a test call posts a LIVE spot to a real park nobody is
// at — the one failure the K-TEST sandbox exists to prevent, and one no local
// check can see.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

const sent: { url: string; body?: string }[] = []
/// What the stand-in POTA server answers a spot for [activator] with.
let respond = (_activator: string) => ({ status: 200, body: "{}" })

const pota = await loadExtension(() => import("./index.ts"), {
  hostCalls: {
    fetch: (params) => {
      const request = params as unknown as { url: string; body?: string }
      sent.push(request)
      return respond(JSON.parse(request.body ?? "{}").activator)
    },
  },
})

test("a multi-station Test Operation spots the K-TEST sandbox ref, not its real park", async () => {
  const result = (await pota.runHook("spots", "postSelfSpot", {
    operation: { stationCall: "KI2D/TEST/OP1", refs: [{ type: "potaActivation", ref: "US-0001" }] },
    freq: 14285,
    mode: "SSB",
  })) as { ok: boolean }
  assert.equal(result.ok, true)
  assert.equal(sent.length, 1)
  const body = JSON.parse(sent[0].body ?? "{}")
  assert.equal(body.reference, "K-TEST")
  assert.equal(body.activator, "KI2D/TEST/OP1")
})

test("a multi-call operation posts one spot per call, each spotted by itself", async () => {
  // One spot listing every call reaches a hunter as a single call to log,
  // `KI2D/OP1,NK2Y`, which matches nobody's log.
  sent.length = 0
  const result = (await pota.runHook("spots", "postSelfSpot", {
    operation: { stationCall: "KI2D/OP1, NK2Y", refs: [{ type: "potaActivation", ref: "US-0001" }] },
    freq: 14285,
    mode: "SSB",
  })) as { ok: boolean }
  assert.equal(result.ok, true)
  const bodies = sent.map((r) => JSON.parse(r.body ?? "{}"))
  assert.deepEqual(
    bodies.map((b) => [b.activator, b.spotter]).sort(),
    [["KI2D/OP1", "KI2D/OP1"], ["NK2Y", "NK2Y"]],
  )
})

test("a partly refused multi-call spot names the refused call, its reason, and how many went out", async () => {
  // Reported as a bare failure, the operator resends and posts the call that
  // already went out a second time, while the refused one stays unnamed.
  sent.length = 0
  respond = (activator) => (activator === "NK2Y" ? { status: 400, body: "Invalid activator" } : { status: 200, body: "{}" })
  try {
    const result = (await pota.runHook("spots", "postSelfSpot", {
      operation: { stationCall: "KI2D/OP1,NK2Y", refs: [{ type: "potaActivation", ref: "US-0001" }] },
      freq: 14285,
      mode: "SSB",
    })) as { ok: boolean; message?: string }
    assert.equal(result.ok, false)
    assert.match(result.message ?? "", /NK2Y \(POTA API returned HTTP 400: Invalid activator\)/)
    assert.match(result.message ?? "", /1 other spot/)
    assert.doesNotMatch(result.message ?? "", /KI2D/)
  } finally {
    respond = () => ({ status: 200, body: "{}" })
  }
})

test("spotting a hunted QSO credits the operator as spotter, falling back past an empty our.call", async () => {
  // The spotted call is the activator; posting it as its own spotter (or as
  // nobody) credits the spot to the station that never sent it.
  const qso = { their: { call: "N0CALL" }, refs: [{ type: "pota", ref: "US-0002" }], freq: 14285 }
  for (const [our, spotterCall, expected] of [[{ call: "KI2D/P" }, "N0DEV", "KI2D/P"], [{ call: "" }, "N0DEV", "N0DEV"]] as const) {
    sent.length = 0
    const result = (await pota.runHook("spots", "postOtherSpot", { qso: { ...qso, our }, spotterCall })) as { ok: boolean }
    assert.equal(result.ok, true)
    const body = JSON.parse(sent[0].body ?? "{}")
    assert.equal(body.activator, "N0CALL")
    assert.equal(body.spotter, expected)
  }
})

test("a refused single-call spot reports POTA's reason alone, cut short", async () => {
  // The server's words tell a refused park from an outage, but a proxy's
  // whole HTML error page in the message buries everything else in it.
  sent.length = 0
  const long = "x".repeat(300)
  respond = () => ({ status: 400, body: `  ${long}  ` })
  try {
    const result = (await pota.runHook("spots", "postSelfSpot", {
      operation: { stationCall: "KI2D", refs: [{ type: "potaActivation", ref: "US-0001" }] },
      freq: 14285,
      mode: "SSB",
    })) as { ok: boolean; message?: string }
    assert.equal(result.ok, false)
    assert.equal(result.message, `POTA API returned HTTP 400: ${long.slice(0, 200)}`)
  } finally {
    respond = () => ({ status: 200, body: "{}" })
  }
})

test("a multi-call spot refused for every call claims none went out", async () => {
  // Counting spots that did not go out tells the operator not to resend
  // calls that are in fact unspotted.
  sent.length = 0
  respond = () => ({ status: 503, body: "" })
  try {
    const result = (await pota.runHook("spots", "postSelfSpot", {
      operation: { stationCall: "KI2D/OP1,NK2Y", refs: [{ type: "potaActivation", ref: "US-0001" }] },
      freq: 14285,
      mode: "SSB",
    })) as { ok: boolean; message?: string }
    assert.equal(result.ok, false)
    assert.equal(result.message, "POTA refused the spot for KI2D/OP1 (POTA API returned HTTP 503), NK2Y (POTA API returned HTTP 503)")
  } finally {
    respond = () => ({ status: 200, body: "{}" })
  }
})
