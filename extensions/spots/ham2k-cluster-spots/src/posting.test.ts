// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Posting through the HOOKS, against a stand-in host whose cluster records
// each spot posted and answers as the test says: what a spot's comment
// carries, when the Cluster icon is offered, and how the node's answer
// reaches the operator.

import { test } from "node:test"
import assert from "node:assert/strict"

import { fixtureOperation, fixtureQso, loadExtension } from "./sdkGapTesting.ts"
import { activityWords } from "./spotText.ts"

const posted: Record<string, unknown>[] = []
let reply: Record<string, unknown> = { ok: true, lines: [] }
let status: Record<string, unknown> = { state: "idle", node: { name: "K3LR", host: "dx.k3lr.com", port: 23 }, lastSeq: 0 }

const ext = await loadExtension(() => import("./index.ts"), {
  hostCalls: {
    clusterStatus: () => status,
    clusterPostSpot: (params) => {
      posted.push(params)
      return reply
    },
  },
})

function reset(next: Record<string, unknown> = { ok: true, lines: [] }) {
  posted.length = 0
  reply = next
  status = { state: "idle", node: { name: "K3LR", host: "dx.k3lr.com", port: 23 }, lastSeq: 0 }
}

const pota = { type: "potaActivation", ref: "US-1234", shortLabel: "POTA US-1234" }
const nyqp = { type: "ny-qso-party", ref: "NY", location: "SUL/DEL" }

test("a spot's comment names every activity, contests first, then the operator's words", async () => {
  assert.deepEqual(activityWords({ refs: [pota, nyqp] }), ["NYQP SUL/DEL", "POTA US-1234"])
  assert.deepEqual(activityWords({ refs: [{ type: "wwff", ref: "KFF-1234" }] }), ["WWFF KFF-1234"], "an undecorated ref still names its program")
  reset()
  const operation = fixtureOperation({ refs: [pota, nyqp] })
  assert.deepEqual(await ext.runHook("spots", "postSelfSpot", { operation, freq: 14285, mode: "SSB", comment: "QRV till 1600" }), { ok: true })
  assert.deepEqual(posted, [{ freq: 14285, call: "KI2D", comment: "NYQP SUL/DEL - POTA US-1234 - QRV till 1600" }])
})

test("a test operation's spot says TESTING first, since nothing on the cluster filters it", async () => {
  reset()
  await ext.runHook("spots", "postSelfSpot", { operation: fixtureOperation({ stationCall: "KI2D/T", refs: [pota] }), freq: 7200 })
  assert.equal(posted[0].comment, "TESTING - POTA US-1234")
})

test("a multi-station seat spots the station's plain call, without the app's /OP<n>", async () => {
  // `KI2D/OP1` on a cluster reads as a portable call, so hunters call, log
  // and dupe-check a station that does not exist. A test call keeps its
  // TESTING warning once the seat comes off.
  reset()
  const seat = (stationCall: string, multiIdentifier: string | number) =>
    ext.runHook("spots", "postSelfSpot", { operation: fixtureOperation({ stationCall, local: { multiIdentifier } }), freq: 14285 })
  await seat("KI2D/OP1", "1")
  await seat("KI2D/OP2,NK2Y", 2)
  await seat("KI2D/TEST/OP1", "1")
  await seat("KI2D/OP1", "")
  assert.deepEqual(
    posted.map((spot) => [spot.call, spot.comment]),
    [["KI2D", ""], ["KI2D", ""], ["KI2D/TEST", "TESTING"], ["KI2D/OP1", ""]],
  )
})

test("a spot of a station worked carries that QSO's activities, under its first call", async () => {
  reset()
  const qso = fixtureQso({ freq: 14062.5, their: { call: "n2abc, n2xyz" }, refs: [{ type: "pota", ref: "US-5678" }] })
  assert.deepEqual(await ext.runHook("spots", "postOtherSpot", { qso, comment: "tnx" }), { ok: true })
  assert.deepEqual(posted, [{ freq: 14062.5, call: "N2ABC", comment: "POTA US-5678 - tnx" }])
})

test("the Cluster icon is offered while the app can reach a cluster and there is something to spot", async () => {
  reset()
  const offered = async (method: string, args: Record<string, unknown>) => ((await ext.runHook("spots", method, args)) as { enabled: boolean }).enabled
  assert.equal(await offered("isSelfSpotEnabled", { operation: fixtureOperation() }), true)
  assert.equal(await offered("isSelfSpotEnabled", { operation: fixtureOperation({ stationCall: "" }) }), false)
  assert.equal(await offered("isOtherSpotEnabled", { qso: fixtureQso({ their: { call: "N2ABC" }, freq: 7200 }) }), true)
  assert.equal(await offered("isOtherSpotEnabled", { qso: fixtureQso({ their: { call: "N2ABC" }, freq: 0 }) }), false)
  status = { ...status, error: "unsupported" }
  assert.equal(await offered("isSelfSpotEnabled", { operation: fixtureOperation() }), false, "an app without cluster support offers nothing")
})

test("a failed spot says why, in the operator's language", async () => {
  const self = (locale = "en") => ext.runHook("spots", "postSelfSpot", { operation: fixtureOperation(), freq: 14285 }, { ctx: { locale } })
  reset({ ok: false, lines: [], error: "needsPassword" })
  assert.deepEqual(await self(), { ok: false, message: "The cluster node asks for a password — set it in Settings › DX Cluster" })
  reset({ ok: false, lines: [], error: "refused", message: "Sorry, you are not registered" })
  assert.deepEqual(await self(), { ok: false, message: "The cluster node said: Sorry, you are not registered" })
  reset({ ok: false, lines: [], error: "timeout" })
  assert.deepEqual(await self("es"), { ok: false, message: "El nodo del cluster no respondió" })
  reset({ ok: false, lines: [], error: "somethingNew", message: "Node rebooting" })
  assert.deepEqual(await self(), { ok: false, message: "Node rebooting" }, "an error this version has no words for passes on what the node said")
})
