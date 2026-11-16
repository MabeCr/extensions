// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The extension through its hooks: who is offered a key, who sends contacts,
// what a chaser scores and sees, and the spots.

import { test } from "node:test"
import assert from "node:assert/strict"

import type { HookContext, JSONValue } from "@ham2k/extension-sdk"

import { loadExtension } from "./sdkGapTesting.ts"

type Data = Record<string, JSONValue>

const HOSTS = {
  hosts: [
    { id: "k4swl", call: "K4SWL", name: "Thomas", kind: "host", powerClass: "qrp", pointsOverride: null },
    { id: "n6mts", call: "N6MTS", name: "Mark", kind: "host", powerClass: "100w", pointsOverride: null },
    { id: "w1wc", call: "W1WC", name: "Wildcard", kind: "wildcard", powerClass: "100w", pointsOverride: 6.52 },
  ],
}
const EVENT = { event: { name: "HRWBOTA 2026", startsAt: "2026-11-21T18:00:00Z", endsAt: "2026-11-21T21:00:00Z" } }
const SPOTS = {
  spots: [
    { hostId: "k4swl", call: "K4SWL", kind: "host", frequencyKhz: 14061, band: "20m", mode: "CW", refs: [], points: { cw: 8, phone: 4, digital: 4, dmr: 2 }, updatedAt: "2026-11-21T18:40:00Z" },
  ],
}

let operatorCall = "K2ABC"
const fetched: string[] = []
const saved: Data[] = []

function answer(url: string, headers: Record<string, string> = {}): { status: number; body: string } {
  if (url.endsWith("/api/hosts")) return { status: 200, body: JSON.stringify(HOSTS) }
  if (url.endsWith("/api/event")) return { status: 200, body: JSON.stringify(EVENT) }
  if (url.endsWith("/api/v1/spots")) return { status: 200, body: JSON.stringify(SPOTS) }
  if (url.endsWith("/api/v1/me")) {
    return headers.Authorization === "Bearer hrwb_good"
      ? { status: 200, body: JSON.stringify({ host: { id: "k4swl", call: "K4SWL", name: "Thomas" } }) }
      : { status: 401, body: '{"error":"bad_key"}' }
  }
  return { status: 404, body: "" }
}

const ext = await loadExtension(() => import("./index.ts"), {
  hostCalls: {
    getSettings: () => ({ operatorCall }),
    setSettings: (params) => {
      saved.push(params as Data)
      return null
    },
    fetch: (params) => {
      const { url, headers } = params as { url: string; headers?: Record<string, string> }
      fetched.push(url)
      return answer(url, headers)
    },
  },
  ctx: { online: true },
})

const withKey = (key: string | undefined): Partial<HookContext> => ({ account: key ? { credentials: { key } } : undefined })

test("it is one activity, with the hooks the manifest promises", () => {
  assert.deepEqual(ext.categories(), ["account", "activity", "adifFields", "lookup", "ref:hrwbota", "scoring", "spots"])
})

test("the operation setup pane draws the activity with the soldering iron icon: a listener's asks what they send", async () => {
  const [listener] = (await ext.runHook("activity", "operationControls", { operation: { stationCall: "K2ABC" } })) as Data[]
  assert.equal(listener.icon, "soldering-iron")
  assert.equal(listener.color, "#1D5A44")
  const input = listener.input as Data
  assert.deepEqual({ kind: input.kind, refType: input.refType }, { kind: "form", refType: "hrwbota" })
  const fields = ((input.form as Data).elements as Data[]).filter((e) => e.type === "field").map((e) => e.key)
  assert.deepEqual(fields, ["irons", "brand", "state"])

  // A host has nothing to set up: adding the activity stays one tap.
  const [host] = (await ext.runHook("activity", "operationControls", { operation: { stationCall: "K4SWL" } })) as Data[]
  assert.equal(host.icon, "soldering-iron")
  assert.deepEqual({ kind: (host.input as Data).kind, refType: (host.input as Data).refType }, { kind: "refList", refType: "hrwbota" })
})

test("a host logs the serial they send and the listener's irons and brand; a listener the host's serial", async () => {
  const hostOp = { uuid: "host-op", stationCall: "K4SWL", refs: [{ type: "hrwbota" }] }
  const hostControls = (await ext.runHook("activity", "loggingControls", { operation: hostOp })) as Data[]
  assert.deepEqual(
    hostControls.map((c) => [c.key, (c.input as Data).kind, (c.input as Data).field]),
    [
      ["hrwbota/ourSerial", "serial", "ourSerial"],
      ["hrwbota/theirIrons", "text", "theirIrons"],
      ["hrwbota/theirBrand", "text", "theirBrand"],
    ],
  )
  const listenerOp = { uuid: "chaser-op", stationCall: "K2ABC", refs: [{ type: "hrwbota", irons: "3", brand: "hakko", state: "ny" }] }
  const [serial] = (await ext.runHook("activity", "loggingControls", { operation: listenerOp })) as Data[]
  assert.equal(serial.key, "hrwbota/theirSerial")
  assert.equal((serial.input as Data).ourExchange, "3 HAKKO NY", "what the listener sends, beside the field")
  assert.deepEqual(await ext.runHook("activity", "loggingControls", { operation: { stationCall: "K2ABC", refs: [] } }), [])

  // The row shows each side's copy of the other's exchange.
  const hostQso = { their: { call: "K2ABC" }, startAtMillis: Date.UTC(2026, 10, 21, 18, 34), mode: "CW", refs: [{ type: "hrwbota", ourSerial: 7, theirIrons: "3", theirBrand: "hakko" }] }
  assert.deepEqual(await ext.runHook("activity", "processQsoBeforeSave", { qso: hostQso, operation: hostOp }), { their: { exchange: "3 HAKKO" } })
  const listenerQso = { their: { call: "K4SWL" }, startAtMillis: Date.UTC(2026, 10, 21, 18, 34), mode: "CW", refs: [{ type: "hrwbota", theirSerial: "007" }] }
  saved.length = 0
  assert.deepEqual(await ext.runHook("activity", "processQsoBeforeSave", { qso: listenerQso, operation: listenerOp }), { their: { exchange: "7" } })
  assert.deepEqual(saved, [{ ns: "ki2d-hrwbota", values: { ownExchange: { irons: "3", brand: "hakko", state: "ny" } } }], "kept for the next setup")

  // ADIF: the serials, and each side's exchange whole.
  assert.deepEqual(await ext.runHook("adifFields", "fieldsForOneQSO", { qso: hostQso, operation: hostOp }), [
    { name: "STX", value: "7" },
    { name: "STX_STRING", value: "7" },
    { name: "SRX_STRING", value: "3 HAKKO" },
  ])
  assert.deepEqual(await ext.runHook("adifFields", "fieldsForOneQSO", { qso: listenerQso, operation: listenerOp }), [
    { name: "SRX", value: "7" },
    { name: "STX_STRING", value: "3 HAKKO NY" },
    { name: "SRX_STRING", value: "7" },
  ])
})

test("the key field shows only for a host, or for whoever already entered a key", async () => {
  operatorCall = "K2ABC"
  assert.deepEqual(await ext.runHook("account", "fields"), [])
  assert.match(String(await ext.runHook("account", "description")), /K2ABC is not on the host list/)
  assert.equal(((await ext.runHook("account", "fields", {}, { ctx: withKey("hrwb_x") })) as unknown[]).length, 1)

  operatorCall = "K4SWL/P"
  const fields = (await ext.runHook("account", "fields")) as Data[]
  assert.deepEqual(fields.map((f) => [f.key, f.type]), [["key", "secret"]])
  assert.ok(saved.length > 0, "the host list is kept in the extension's settings")
})

test("the key check names the host, and notices a profile under another call", async () => {
  operatorCall = "K4SWL"
  assert.equal(await ext.runHook("account", "testCredentials", { key: "hrwb_good" }), "Connected as K4SWL (Thomas)")
  operatorCall = "N6MTS"
  assert.match(String(await ext.runHook("account", "testCredentials", { key: "hrwb_good" })), /your profile's callsign is N6MTS/)
  await assert.rejects(ext.runHook("account", "testCredentials", { key: "hrwb_bad" }), /revoked/)
  await assert.rejects(ext.runHook("account", "testCredentials", { key: " " }), /Enter your logger key/)
})

test("only a host's operation with the activity and a key reads its log to send it", async () => {
  const reads: string[] = []
  const ctx = (key?: string): Partial<HookContext> => ({
    ...withKey(key),
    getQsos: async (uuid: string) => {
      reads.push(uuid)
      return []
    },
  })
  const qso = { their: { call: "K2ABC" }, startAtMillis: Date.UTC(2026, 10, 21, 18, 30), band: "20m", mode: "CW", freq: 14061 }
  const host = { uuid: "host-op", stationCall: "K4SWL", refs: [{ type: "hrwbota" }] }
  const chaser = { uuid: "chaser-op", stationCall: "K2ABC", refs: [{ type: "hrwbota" }] }
  const plain = { uuid: "plain-op", stationCall: "K4SWL", refs: [{ type: "potaActivation", ref: "US-2093" }] }

  assert.equal(await ext.runHook("activity", "processQsoBeforeSave", { qso, operation: chaser }, { ctx: ctx("hrwb_good") }), null)
  assert.equal(await ext.runHook("activity", "processQsoBeforeSave", { qso, operation: plain }, { ctx: ctx("hrwb_good") }), null)
  assert.equal(await ext.runHook("activity", "processQsoBeforeSave", { qso, operation: host }, { ctx: ctx(undefined) }), null)
  assert.deepEqual(reads, [])
  assert.equal(await ext.runHook("activity", "processQsoBeforeSave", { qso, operation: host }, { ctx: ctx("hrwb_good") }), null)
  assert.deepEqual(reads, ["host-op"])
})

test("a chaser scores each host once per band and mode group, at the best value, inside the event", async () => {
  const at = (minute: number) => Date.UTC(2026, 10, 21, 18, minute)
  const qsos = [
    { uuid: "1", their: { call: "K4SWL" }, startAtMillis: at(1), band: "20m", mode: "SSB" },
    { uuid: "2", their: { call: "K4SWL/P" }, startAtMillis: at(2), band: "20m", mode: "SSB" },
    { uuid: "3", their: { call: "K4SWL" }, startAtMillis: at(3), band: "20m", mode: "CW" },
    { uuid: "4", their: { call: "W1WC" }, startAtMillis: at(4), band: "20m", mode: "FT8" },
    { uuid: "5", their: { call: "W9XYZ" }, startAtMillis: at(5), band: "20m", mode: "CW" },
    { uuid: "6", their: { call: "N6MTS" }, startAtMillis: Date.UTC(2026, 10, 21, 22, 0), band: "20m", mode: "CW" },
    // The same host on another band scores again.
    { uuid: "7", their: { call: "K4SWL" }, startAtMillis: at(7), band: "40m", mode: "SSB" },
  ]
  const result = (await ext.runHook("scoring", "scoreQsos", {
    operation: { uuid: "chaser-op", stationCall: "K2ABC", refs: [{ type: "hrwbota" }] },
    qsos,
  })) as { qsoScores: Record<string, Data>; operationSummary: Record<string, Data> }
  assert.deepEqual(
    qsos.map((q) => result.qsoScores[q.uuid]?.value),
    [4, 0, 8, 6.52, 0, 0, 4],
  )
  assert.equal(result.qsoScores["2"].dupe, true)
  const tally = Object.values(result.operationSummary).find((t) => t.key === "hrwbota")!
  assert.equal(tally.total, 22.52)
  assert.equal(tally.summary, "22.52 pts")
  assert.equal(tally.summaryWithDetail, true, "the total stands beside the title, above its detail")
  assert.match(String(tally.longSummary), /^22\.52 pts from 2 hosts · 1 QSO outside the event hours\n/)
  assert.match(String(tally.longSummary), /- \*\*K4SWL\*\*: 20m CW 8, 20m Phone 4, 40m Phone 4/)
})

test("a host's own operation counts the points its log gives, each listener once per band and mode group", async () => {
  const at = (minute: number) => Date.UTC(2026, 10, 21, 18, minute)
  const qsos = [
    { uuid: "1", their: { call: "K2ABC" }, power: 5, startAtMillis: at(1), band: "20m", mode: "CW", refs: [{ type: "hrwbota", theirIrons: "3" }] },
    { uuid: "2", their: { call: "K2ABC/P" }, power: "5", startAtMillis: at(2), band: "20m", mode: "CW", refs: [{ type: "hrwbota", theirIrons: "lots" }] },
    { uuid: "3", their: { call: "K2ABC" }, power: "50W", startAtMillis: at(3), band: "20m", mode: "SSB", refs: [{ type: "hrwbota", theirIrons: "4" }] },
    { uuid: "4", their: { call: "W1AW" }, startAtMillis: at(4), band: "20m", mode: "FT8", refs: [{ type: "hrwbota", theirIrons: "2" }] },
    { uuid: "5", their: { call: "N0XYZ" }, startAtMillis: Date.UTC(2026, 10, 21, 22, 0), band: "20m", mode: "CW", refs: [{ type: "hrwbota", theirIrons: "5" }] },
  ]
  const result = (await ext.runHook("scoring", "scoreQsos", {
    operation: { uuid: "host-op", stationCall: "K4SWL", refs: [{ type: "hrwbota" }] },
    qsos,
  })) as { qsoScores: Record<string, Data>; operationSummary: Record<string, Data>; daySections: Data[] }
  // QRP CW 8; the same listener on CW on the same band adds nothing; 50 W SSB is 100 W class, 2; no power logged: the card's
  // QRP, digital 4.
  assert.deepEqual(
    qsos.map((q) => result.qsoScores[q.uuid]?.value),
    [8, 0, 2, 4, 0],
  )
  const tally = Object.values(result.operationSummary).find((t) => t.key === "hrwbota")!
  assert.equal(tally.total, 14)
  // Each listener's irons count once, as last logged: K2ABC's 4 (a count that isn't a number is skipped) and W1AW's 2. The log's
  // day header says the same for the day. The 22:00 contact is the same UTC day.
  assert.deepEqual(
    result.daySections.map((d) => (d.scores as Record<string, Data>).hrwbota?.summary),
    ["6 irons, 14 pts"],
  )
  assert.equal(tally.summary, "6 irons, 14 pts")
  assert.match(String(tally.longSummary), /^4 QSOs, 14 pts given to 2 listeners with 6 irons · 1 QSO outside the event hours\n/)
  assert.match(String(tally.longSummary), /- CW: 2 QSOs, 8 pts to 1 listener\n- Phone: 1 QSO, 2 pts to 1 listener\n- Digital: 1 QSO, 4 pts to 1 listener/)

  // Developer mode ignores the event's hours, for trying the score before the event.
  const anyTime = (await ext.runHook(
    "scoring",
    "scoreQsos",
    { operation: { uuid: "host-op", stationCall: "K4SWL", refs: [{ type: "hrwbota" }] }, qsos },
    { ctx: { developerMode: true } },
  )) as { operationSummary: Record<string, Data> }
  const anyTimeTally = Object.values(anyTime.operationSummary).find((t) => t.key === "hrwbota")!
  assert.match(String(anyTimeTally.longSummary), /^5 QSOs, 22 pts given to 3 listeners with 11 irons · event hours ignored \(developer mode\)\n/)
})

test("each day's header counts the irons of that day's listeners; the operation counts each listener once", async () => {
  const irons = (n: string) => [{ type: "hrwbota", theirIrons: n }]
  const qsos = [
    { uuid: "1", their: { call: "K2ABC" }, startAtMillis: Date.UTC(2026, 10, 21, 23, 0), band: "20m", mode: "CW", refs: irons("3") },
    { uuid: "2", their: { call: "W1AW" }, startAtMillis: Date.UTC(2026, 10, 21, 23, 5), band: "20m", mode: "CW", refs: irons("2") },
    { uuid: "3", their: { call: "K2ABC" }, startAtMillis: Date.UTC(2026, 10, 22, 1, 0), band: "40m", mode: "CW", refs: irons("4") },
  ]
  // Developer mode, so contacts on two UTC days both count.
  const result = (await ext.runHook(
    "scoring",
    "scoreQsos",
    { operation: { uuid: "host-op", stationCall: "K4SWL", refs: [{ type: "hrwbota" }] }, qsos },
    { ctx: { developerMode: true } },
  )) as { operationSummary: Record<string, Data>; daySections: Data[] }
  assert.deepEqual(
    result.daySections.map((d) => (d.scores as Record<string, Data>).hrwbota?.summary),
    ["5 irons, 16 pts", "4 irons, 8 pts"],
  )
  assert.equal(Object.values(result.operationSummary).find((t) => t.key === "hrwbota")!.summary, "6 irons, 24 pts")
})

test("a call being logged is marked as a host, with its worth in the mode at hand", async () => {
  const operation = { uuid: "chaser-op", stationCall: "K2ABC", refs: [{ type: "hrwbota" }] }
  const notes = (await ext.runHook("lookup", "lookupCall", { callInfo: { call: "K4SWL" }, qso: { mode: "CW" }, operation })) as Data[]
  assert.deepEqual(notes[0].notes, ["HRWBOTA host: 8 pts CW · Thomas"])
  assert.deepEqual(await ext.runHook("lookup", "lookupCall", { callInfo: { call: "W9XYZ" }, qso: {}, operation }), [])
  assert.deepEqual(await ext.runHook("lookup", "lookupCall", { callInfo: { call: "K4SWL" }, qso: {}, operation: { refs: [] } }), [])
})

test("hosts on the air are spots; offline there are none", async () => {
  const spots = (await ext.runHook("spots", "fetchSpots")) as Data[]
  assert.equal(spots.length, 1)
  assert.equal((spots[0].spot as Data).label, "HRWBOTA 8 pts CW")
  assert.deepEqual(await ext.runHook("spots", "fetchSpots", {}, { ctx: { online: false } }), [])
})

test("self-spotting is offered only to a host's operation with the activity and a key", async () => {
  const host = { uuid: "host-op", stationCall: "K4SWL", refs: [{ type: "hrwbota" }] }
  const chaser = { uuid: "chaser-op", stationCall: "K2ABC", refs: [{ type: "hrwbota" }] }
  assert.equal(((await ext.runHook("spots", "isSelfSpotEnabled", { operation: host }, { ctx: withKey("hrwb_good") })) as Data).enabled, true)
  assert.equal(((await ext.runHook("spots", "isSelfSpotEnabled", { operation: host })) as Data).enabled, false)
  assert.equal(((await ext.runHook("spots", "isSelfSpotEnabled", { operation: chaser }, { ctx: withKey("hrwb_good") })) as Data).enabled, false)
})

test("a contact with no band can't score a host again beside a banded one, as on the tracker", async () => {
  const { slotFor } = await import("./scorer.ts")
  const best: Record<string, number> = {}
  // Band-less first: a slot of its own...
  assert.equal(slotFor(best, "K4SWL", "cw", undefined), "K4SWL|cw|?")
  best["K4SWL|cw|?"] = 8
  // ...which the first banded contact takes over, as the same contact.
  assert.equal(slotFor(best, "K4SWL", "cw", "20M"), "K4SWL|cw|20m")
  assert.deepEqual(best, { "K4SWL|cw|20m": 8 })
  Object.assign(best, { "K4SWL|cw|40m": 4 })
  // Another band-less one can only raise the lowest.
  assert.equal(slotFor(best, "K4SWL", "cw", ""), "K4SWL|cw|40m")
  // The linked networks: one slot, whatever the band.
  assert.equal(slotFor(best, "K4SWL", "dmr", "70cm"), "K4SWL|dmr|")
})
