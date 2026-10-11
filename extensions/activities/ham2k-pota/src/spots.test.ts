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

const pota = await loadExtension(() => import("./index.ts"), {
  hostCalls: {
    fetch: (params) => {
      sent.push(params as unknown as { url: string; body?: string })
      return { status: 200, body: "{}" }
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

test("a multi-call operation spots every call as the activator, and only the first as the spotter", async () => {
  // POTA accepts several calls in `activator` but refuses more than one in
  // `spotter`, so the whole list there loses the spot.
  sent.length = 0
  const result = (await pota.runHook("spots", "postSelfSpot", {
    operation: { stationCall: "KI2D/OP1,NK2Y", refs: [{ type: "potaActivation", ref: "US-0001" }] },
    freq: 14285,
    mode: "SSB",
  })) as { ok: boolean }
  assert.equal(result.ok, true)
  assert.equal(sent.length, 1)
  const body = JSON.parse(sent[0].body ?? "{}")
  assert.equal(body.activator, "KI2D/OP1,NK2Y")
  assert.equal(body.spotter, "KI2D/OP1")
})

test("more than ten calls post in batches of ten, each spotted by its own first call", async () => {
  // POTA refuses an activator list longer than ten, so one spot for them all
  // posts nothing at all.
  sent.length = 0
  const calls = Array.from({ length: 23 }, (_, i) => `K${i}A`)
  const result = (await pota.runHook("spots", "postSelfSpot", {
    operation: { stationCall: calls.join(","), refs: [{ type: "potaActivation", ref: "US-0001" }] },
    freq: 14285,
    mode: "SSB",
  })) as { ok: boolean }
  assert.equal(result.ok, true)
  const bodies = sent.map((r) => JSON.parse(r.body ?? "{}"))
  assert.deepEqual(
    bodies.map((b) => b.activator),
    [calls.slice(0, 10).join(","), calls.slice(10, 20).join(","), calls.slice(20).join(",")],
  )
  assert.deepEqual(
    bodies.map((b) => b.spotter),
    ["K0A", "K10A", "K20A"],
  )
})
