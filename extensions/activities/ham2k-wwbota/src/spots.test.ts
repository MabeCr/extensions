// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The WWBOTA spot feed and poster through the `spots` HOOK, against a recorded
// `fetch`. The API is unlike the other spot services in ways a guess gets
// wrong: its feed publishes MHz, and its poster takes ONE FLAT RECORD with the
// bunkers named in the comment — a `references` array posts a spot carrying no
// bunker at all. Only a test that reads the request sees either.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

let sent: { url: string; method?: string; body?: string }[] = []
let reply = { status: 201, body: "{}" }

const wwbota = await loadExtension(() => import("./index.ts"), {
  hostCalls: {
    fetch: (params) => {
      sent.push(params as unknown as { url: string; method?: string; body?: string })
      return reply
    },
  },
})

test("the feed's MHz become kHz, and each reference is typed as a hunted bunker", async () => {
  reply = {
    status: 200,
    body: JSON.stringify([
      { call: "g1abc", freq: 14.285, mode: "ssb", time: "2026-07-01T12:00:00Z", type: "Live", comment: "B/G-0001", spotter: "G1ABC", references: [{ reference: "B/G-0001" }] },
    ]),
  }
  const spots = (await wwbota.runHook("spots", "fetchSpots", {}, { ctx: { online: true } })) as any[]
  assert.equal(spots.length, 1)
  // A missed conversion puts every spot on no band at all.
  assert.equal(spots[0].freq, 14285)
  assert.equal(spots[0].band, "20m")
  assert.equal(spots[0].their.call, "G1ABC")
  assert.deepEqual(spots[0].refs[0], { ref: "B/G-0001", type: "wwbota" })
  assert.equal(spots[0].spot.sourceInfo.spotter, "G1ABC")
})

async function post(method: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  sent = []
  reply = { status: 201, body: "{}" }
  const result = (await wwbota.runHook("spots", method, args)) as { ok: boolean }
  assert.equal(result.ok, true, "a 201 is a posted spot")
  assert.equal(sent.length, 1)
  return JSON.parse(sent[0].body ?? "{}")
}

test("a self-spot names its bunkers in the comment, grouped by scheme", async () => {
  const body = await post("postSelfSpot", {
    operation: {
      stationCall: "G1ABC",
      refs: [{ type: "wwbotaActivation", ref: "B/G-0001" }, { type: "wwbotaActivation", ref: "B/G-0002" }],
    },
    freq: 14285,
    mode: "SSB",
    comment: "up 5",
  })
  assert.equal(body.comment, "B/G-0001,0002 up 5")
  assert.equal("references" in body, false)
  // MHz, the unit the feed publishes.
  assert.ok(Math.abs((body.freq as number) - 14.285) < 1e-9, `freq ${body.freq}`)
  assert.equal(body.type, "Live")
  assert.equal(body.spotter, "G1ABC")
  assert.equal(body.call, "G1ABC")
})

test("QRT is read out of the comment, and an unknown mode stays null", async () => {
  // Telling the feed SSB for an activator on CW sends hunters to the wrong mode.
  const body = await post("postSelfSpot", {
    operation: { stationCall: "G1ABC", refs: [{ type: "wwbotaActivation", ref: "B/G-0001" }] },
    freq: 14285,
    comment: "QRT",
  })
  assert.equal(body.type, "QRT")
  assert.equal(body.mode, null)
})

test("spotting somebody else names them, and us as the spotter", async () => {
  const body = await post("postOtherSpot", {
    qso: { their: { call: "M0XYZ" }, our: { call: "G1ABC" }, freq: 7120, mode: "SSB", refs: [{ type: "wwbota", ref: "B/G-0511" }] },
    comment: "loud",
  })
  assert.equal(body.call, "M0XYZ")
  assert.equal(body.spotter, "G1ABC")
  assert.equal(body.comment, "B/G-0511 loud")
})

test("an in-progress QSO with no callsign of our own omits the spotter", async () => {
  // Rather than naming the spotted station as its own spotter.
  const body = await post("postOtherSpot", {
    qso: { their: { call: "M0XYZ" }, freq: 7120, refs: [{ type: "wwbota", ref: "B/G-0511" }] },
  })
  assert.equal("spotter" in body, false)
})

test("an EMPTY callsign of our own still falls back to the spotter we were handed", async () => {
  // `'' ?? fallback` is '': absent falls back, empty does not, unless the
  // chain treats both alike.
  const body = await post("postOtherSpot", {
    qso: { their: { call: "M0XYZ" }, our: { call: "" }, freq: 7120, refs: [{ type: "wwbota", ref: "B/G-0511" }] },
    spotterCall: "G1ABC",
  })
  assert.equal(body.spotter, "G1ABC")
})
