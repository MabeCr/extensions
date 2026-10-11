// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The "Use POTA Dev Servers" developer setting. While it is on, a spot
// reaching api.pota.app is a live spot posted from a test bench, in front of
// real hunters — and no local check can see it happen. While it is off,
// nothing may reach devapi.pota.app: an operator's spot posted there is one
// no hunter ever sees.

import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

const LIVE = "https://api.pota.app"
const DEV = "https://devapi.pota.app"

let useDevServers = false
let developerMode = true
const sent: { url: string; body?: string }[] = []
const saved: Record<string, unknown>[] = []
/// Each server's activator feed, by base URL. A server absent here answers 500.
let feeds: Record<string, unknown[]> = {}

beforeEach(() => {
  useDevServers = false
  developerMode = true
  sent.length = 0
  saved.length = 0
  feeds = {}
})

const pota = await loadExtension(() => import("./index.ts"), {
  hostCalls: {
    getSettings: () => ({ developerMode, extensions: { "extension_ham2k-pota": { useDevServers } } }),
    // Stores what it is given, as the host does, so a hook reads back its own write.
    setSettings: (params) => {
      saved.push(params)
      useDevServers = (params as { values: { useDevServers: boolean } }).values.useDevServers
      return null
    },
    fetch: (params) => {
      const request = params as unknown as { url: string; body?: string }
      sent.push(request)
      if (request.url.endsWith("/spot")) return { status: 200, body: "{}" }
      if (request.url.includes("/park/")) return { status: 200, body: JSON.stringify({ reference: "US-0001", name: "Test Park" }) }
      const feed = feeds[request.url.replace("/spot/activator", "")]
      return feed ? { status: 200, body: JSON.stringify(feed) } : { status: 500, body: "" }
    },
  },
  ctx: { online: true },
})

function apiSpot(activator: string, reference: string) {
  return { spotId: 1, activator, frequency: "14285", mode: "SSB", reference, name: "", locationDesc: "US-NY", spotTime: "2026-10-10T12:00:00", spotter: activator, comments: "", source: "Web", count: 1 }
}

const selfSpot = (operation: Record<string, unknown>) => pota.runHook("spots", "postSelfSpot", { operation, freq: 14285, mode: "SSB" }) as Promise<{ ok: boolean }>
const fetchSpots = () => pota.runHook("spots", "fetchSpots", {}) as Promise<{ their: { call: string } }[]>

test("with the setting on, a spot posts to the dev server and never the live one", async () => {
  useDevServers = true
  await selfSpot({ stationCall: "KI2D", refs: [{ type: "potaActivation", ref: "US-0001" }] })
  const qso = { their: { call: "N0CALL" }, our: { call: "KI2D" }, freq: 14285, mode: "SSB", refs: [{ type: "pota", ref: "US-0002" }] }
  await pota.runHook("spots", "postOtherSpot", { qso, spotterCall: "KI2D" })
  assert.deepEqual(sent.map((r) => r.url), [`${DEV}/spot`, `${DEV}/spot`])
})

test("with the setting on, a Test Operation still spots K-TEST, and an operation with no park posts nothing", async () => {
  useDevServers = true
  await selfSpot({ stationCall: "KI2D/T", refs: [{ type: "potaActivation", ref: "US-0001" }] })
  assert.equal(JSON.parse(sent[0].body ?? "{}").reference, "K-TEST")
  const result = await selfSpot({ stationCall: "KI2D", refs: [] })
  assert.equal(result.ok, false)
  assert.equal(sent.length, 1)
})

test("with the setting on, spots come from both servers", async () => {
  useDevServers = true
  feeds = { [LIVE]: [apiSpot("W1AW", "US-0001")], [DEV]: [apiSpot("KI2D", "US-0002")] }
  assert.deepEqual((await fetchSpots()).map((s) => s.their.call).sort(), ["KI2D", "W1AW"])
})

test("with the setting on, a failing dev server fails the fetch rather than passing for a quiet one", async () => {
  useDevServers = true
  feeds = { [LIVE]: [apiSpot("W1AW", "US-0001")] }
  await assert.rejects(fetchSpots(), /HTTP 500/)
})

test("with the setting on, a park missing from the offline table is looked up on the dev server", async () => {
  useDevServers = true
  await pota.runHook("ref:pota", "decorateRef", { ref: { type: "pota", ref: "US-0001" } })
  assert.deepEqual(sent.map((r) => r.url), [`${DEV}/park/US-0001`])
})

test("with the setting off, nothing reaches the dev server", async () => {
  feeds = { [LIVE]: [apiSpot("W1AW", "US-0001")], [DEV]: [apiSpot("KI2D", "US-0002")] }
  await selfSpot({ stationCall: "KI2D", refs: [{ type: "potaActivation", ref: "US-0001" }] })
  assert.deepEqual((await fetchSpots()).map((s) => s.their.call), ["W1AW"])
  await pota.runHook("ref:pota", "decorateRef", { ref: { type: "pota", ref: "US-0003" } })
  assert.deepEqual(sent.map((r) => r.url), [`${LIVE}/spot`, `${LIVE}/spot/activator`, `${LIVE}/park/US-0003`])
})

test("the switch lives in the Developer panel, hidden from anyone not in developer mode, and saves where the hooks read it", async () => {
  const definition = (await pota.runHook("settingsPanel", "getDefinition", { panelKey: "ham2k-pota" })) as { elements: Record<string, unknown>[] }
  const field = definition.elements.find((element) => element.key === "useDevServers")
  assert.equal(field?.target, "developer")
  assert.equal(field?.devMode, true)
  await pota.runHook("settingsPanel", "onChangeField", { panelKey: "ham2k-pota", fieldKey: "useDevServers", value: true, state: {} })
  assert.deepEqual(saved, [{ ns: "ham2k-pota", values: { useDevServers: true } }])
})

test("a switch left on is ignored once developer mode is off — nobody could see it to turn it back", async () => {
  useDevServers = true
  developerMode = false
  feeds = { [LIVE]: [apiSpot("W1AW", "US-0001")] }
  await selfSpot({ stationCall: "KI2D", refs: [{ type: "potaActivation", ref: "US-0001" }] })
  await fetchSpots()
  assert.deepEqual(sent.map((r) => r.url), [`${LIVE}/spot`, `${LIVE}/spot/activator`])
})

test("turning the switch on forgets parks the live server answered", async () => {
  await pota.runHook("ref:pota", "decorateRef", { ref: { type: "pota", ref: "US-0009" } })
  await pota.runHook("settingsPanel", "onChangeField", { panelKey: "ham2k-pota", fieldKey: "useDevServers", value: true, state: {} })
  await pota.runHook("ref:pota", "decorateRef", { ref: { type: "pota", ref: "US-0009" } })
  assert.deepEqual(sent.map((r) => r.url), [`${LIVE}/park/US-0009`, `${DEV}/park/US-0009`])
})
