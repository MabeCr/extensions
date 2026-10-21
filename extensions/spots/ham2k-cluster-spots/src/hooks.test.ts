// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The extension through its HOOKS, against a stand-in host whose cluster
// holds the lines the test gives it: what reaches the board, and when the
// session is asked for.

import { test } from "node:test"
import assert from "node:assert/strict"

import type { Spot } from "@ham2k/extension-sdk"

import { loadExtension } from "./sdkGapTesting.ts"

interface Line { seq: number; at: number; text: string }

let lines: Line[] = []
let status: Record<string, unknown> = {}
let subscribes = 0

const ext = await loadExtension(() => import("./index.ts"), {
  hostCalls: {
    clusterStatus: () => status,
    clusterLines: ({ after }) => lines.filter((line) => line.seq > ((after as number | undefined) ?? 0)),
    clusterSubscribe: () => {
      subscribes += 1
      return status
    },
  },
})

let seq = 0
function arrive(text: string, minutesAgo = 0): Line {
  const line = { seq: ++seq, at: Date.now() - minutesAgo * 60 * 1000, text }
  lines.push(line)
  return line
}

function dxLine(call: string, freq: number, comment: string, minutesAgo = 0): string {
  const time = new Date(Date.now() - minutesAgo * 60 * 1000)
  const hhmm = `${String(time.getUTCHours()).padStart(2, "0")}${String(time.getUTCMinutes()).padStart(2, "0")}`
  return `DX de W3LPL:     ${freq.toFixed(1).padStart(8)}  ${call.padEnd(12)} ${comment.padEnd(30)} ${hhmm}Z`
}

async function board(): Promise<Spot[]> {
  return (await ext.runHook("spots", "fetchSpots", {})) as Spot[]
}

const calls = (spots: Spot[]) => spots.map((spot) => `${spot.their.call} ${spot.freq}`)

test("an app with no cluster reads nothing and asks for no session", async () => {
  status = { ok: false, error: "unsupported" }
  arrive(dxLine("JA1ABC", 14025, "CW"))
  assert.deepEqual(await board(), [])
  assert.equal(subscribes, 0)
})

test("the first fetch subscribes and reads the scrollback; later ones take only what is new", async () => {
  status = { state: "connected", node: { name: "K3LR", host: "dx.k3lr.com", port: 23 }, lastSeq: seq }
  arrive("KI2D de K3LR 20-Oct-2026 1234Z >")
  arrive(dxLine("OH2BH", 14021, "CW 17 dB", 2))
  assert.deepEqual(calls(await board()), ["JA1ABC 14025", "OH2BH 14021"], "newest first")
  assert.equal(subscribes, 1)

  arrive(dxLine("VP8XYZ", 21300, "SSB"))
  status = { ...status, lastSeq: seq }
  assert.deepEqual(calls(await board()).sort(), ["JA1ABC 14025", "OH2BH 14021", "VP8XYZ 21300"])
  assert.equal(subscribes, 1, "subscribed once, not on every refresh")
})

test("lines pushed through the cluster hook reach the board, and the same line read back is not taken twice", async () => {
  const pushed = arrive(dxLine("ZL2ABC", 7074, ""))
  await ext.runHook("cluster", "onLines", { lines: [pushed] })
  status = { ...status, lastSeq: seq }
  const zl2abc = (await board()).filter((spot) => spot.their.call === "ZL2ABC")
  assert.equal(zl2abc.length, 1)
  assert.equal(zl2abc[0].mode, "FT8")
})

test("a pushed batch that overtakes an older line, or follows a failed delivery, does not cost the board that line", async () => {
  const missed = arrive(dxLine("CE0ABC", 18080, "CW"))
  const pushed = arrive(dxLine("XE1ABC", 18100, "FT8"))
  await ext.runHook("cluster", "onLines", { lines: [pushed] })
  status = { ...status, lastSeq: seq }
  const spots = (await board()).map((spot) => spot.their.call)
  assert.ok(spots.includes("CE0ABC") && spots.includes("XE1ABC"), String(spots))
})

test("the board lists it under its own name, not the poster's", () => {
  const spots = ext.hooks.find((hook) => hook.category === "spots")?.hook
  assert.equal(spots?.sourceName, "Cluster Spots")
})

test("a station keeps its newest spot per band: a move within the band replaces it, another band adds one", async () => {
  arrive(dxLine("OH2BH", 14030, "CW QSY"))
  arrive(dxLine("OH2BH", 7010, "CW"))
  status = { ...status, lastSeq: seq }
  const oh2bh = (await board()).filter((spot) => spot.their.call === "OH2BH")
  assert.deepEqual(calls(oh2bh).sort(), ["OH2BH 14030", "OH2BH 7010"])
})

test("a spot older than an hour leaves the board", async () => {
  arrive(dxLine("K1OLD", 3573, "FT8", 61), 61)
  status = { ...status, lastSeq: seq }
  assert.equal((await board()).some((spot) => spot.their.call === "K1OLD"), false)
})

test("when the app's line numbers start over, reading starts over with them", async () => {
  lines = []
  seq = 0
  arrive(dxLine("W1NEW", 28074, "FT8"))
  status = { ...status, lastSeq: seq }
  assert.equal((await board()).some((spot) => spot.their.call === "W1NEW"), true)
})
