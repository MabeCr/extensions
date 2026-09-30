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
