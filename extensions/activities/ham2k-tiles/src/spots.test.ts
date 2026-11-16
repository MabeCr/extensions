// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The spot feed, the self-spot poster and the account check through their
// HOOKS, against a recorded `fetch`. The shapes are tilesontheair.com's own:
// the feed wraps its spots in an object and sends MHz as a string, a QRT is a
// marker spot, and posting takes the operator's callsign and spot PIN in the
// body.

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
let reply = { status: 200, body: '{"spots":[]}' }

const tiles = await loadExtension(() => import("./index.ts"), {
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
const feed = (...spots: Record<string, unknown>[]) => JSON.stringify({ spots, count: spots.length })
const fetchSpots = async () => (await tiles.runHook("spots", "fetchSpots", {}, { ctx: { online: true } })) as any[]

const LOGIN = { credentials: { callsign: "kk4oda", pin: "4837" } }
const activation = { stationCall: "KK4ODA/P", grid: "EM73uu", refs: [{ type: "tilesActivation", ref: "EM73UU" }] }

/// One row as the live feed published it, on 2026-10-30.
const FEED_ROW = {
  id: "c48549ff-83ec-4c8c-abfb-0a2d16893443",
  call_sign: "AC1RH",
  frequency: "14.243",
  mode: "SSB",
  maidenhead_grid: "FN42HN",
  latitude: 42.5625,
  longitude: -71.375,
  notes: "57 FL",
  pota_ref: "US-2435",
  sota_ref: null,
  state: "Massachusetts",
  country: "United States",
  created_at: "2026-10-30T14:23:54.510Z",
  name: "57 FL",
}

test("a feed row becomes a spot on its tile, in kHz, with the park it is stacked with", async () => {
  respond(feed(FEED_ROW))
  const [spot] = await fetchSpots()

  assert.equal(spot.their.call, "AC1RH")
  assert.equal(spot.freq, 14243)
  assert.equal(spot.band, "20m")
  assert.equal(spot.mode, "SSB")
  assert.equal(spot.spot.timeInMillis, Date.parse("2026-10-30T14:23:54.510Z"))
  assert.equal(spot.spot.source, "tiles")
  assert.equal(spot.spot.label, "FN42HN: Massachusetts")
  assert.deepEqual(spot.refs, [{ type: "tiles", ref: "FN42HN" }, { type: "pota", ref: "US-2435" }])
  assert.deepEqual(spot.spot.sourceInfo, { spotter: "AC1RH", comments: "57 FL" })
  assert.match(sent[0].url, /\/functions\/v1\/spots\?limit=200$/)
})

test("a 4-character grid names no tile, and Tiles' own mode names become the app's", async () => {
  respond(feed({ ...FEED_ROW, maidenhead_grid: "em73", mode: "D-STAR", pota_ref: null, sota_ref: "W4G/CE-003", frequency: "145.390" }))
  const [spot] = await fetchSpots()
  assert.deepEqual(spot.refs, [{ type: "sota", ref: "W4G/CE-003" }])
  assert.equal(spot.spot.label, "EM73: Massachusetts")
  assert.equal(spot.mode, "DSTAR")
  assert.equal(spot.freq, 145390)

  respond(feed({ ...FEED_ROW, mode: "Other" }, { ...FEED_ROW, id: "2", mode: "JS8Call" }))
  assert.deepEqual((await fetchSpots()).map((s) => s.mode), [undefined, "JS8"])
})

test("a QRT marker is no spot, and takes the operator's earlier spots with it", async () => {
  respond(feed(
    { ...FEED_ROW, id: "3", notes: "QRT", created_at: "2026-10-30T14:30:00Z" },
    { ...FEED_ROW, id: "2", created_at: "2026-10-30T14:20:00Z" },
    { ...FEED_ROW, id: "1", call_sign: "KK4ODA", created_at: "2026-10-30T14:10:00Z" },
  ))
  assert.deepEqual((await fetchSpots()).map((s) => s.their.call), ["KK4ODA"])

  // A spot AFTER the QRT is the operator back on the air.
  respond(feed(
    { ...FEED_ROW, id: "4", created_at: "2026-10-30T14:40:00Z" },
    { ...FEED_ROW, id: "3", notes: "qrt, thanks all", created_at: "2026-10-30T14:30:00Z" },
  ))
  assert.equal((await fetchSpots()).length, 1)
})

test("a feed that answers without its list is a clear error, and offline it is not asked", async () => {
  respond("[]")
  await assert.rejects(fetchSpots(), /no list of spots/)
  respond(feed(), 503)
  await assert.rejects(fetchSpots(), /HTTP 503/)

  respond(feed(FEED_ROW))
  assert.deepEqual(await tiles.runHook("spots", "fetchSpots", {}, { ctx: { online: false } }), [])
  assert.deepEqual(sent, [])
})

test("self-spotting is offered only with a callsign and PIN, and only on a Tiles activation", async () => {
  const enabled = async (ctx: Record<string, unknown>, operation: unknown = activation) =>
    ((await tiles.runHook("spots", "isSelfSpotEnabled", { operation }, { ctx })) as { enabled: boolean }).enabled

  assert.equal(await enabled({ account: LOGIN }), true)
  assert.equal(await enabled({}), false)
  assert.equal(await enabled({ account: { credentials: { callsign: "KK4ODA", pin: " " } } }), false)
  assert.equal(await enabled({ account: LOGIN }, { ...activation, refs: [] }), false)
  // There is no spotting of others: every Tiles spot is a self-spot.
  assert.equal(tiles.hooks.find((h) => h.category === "spots")?.hook.postOtherSpot, undefined)
})

const postSelfSpot = (args: Record<string, unknown>, ctx: Record<string, unknown> = { account: LOGIN }) =>
  tiles.runHook("spots", "postSelfSpot", { operation: activation, ...args }, { ctx }) as Promise<{ ok: boolean; message?: string }>

test("a self-spot posts the station call as worked, the PIN and the tile", async () => {
  respond('{"ok":true,"spot":{"id":"f96"}}')
  assert.deepEqual(await postSelfSpot({ freq: 14285, mode: "USB", comment: "CQ TILE" }), { ok: true })

  assert.equal(sent.length, 1)
  assert.equal(sent[0].method, "POST")
  assert.match(sent[0].url, /\/functions\/v1\/self-spot$/)
  assert.deepEqual(bodyOf(sent[0]), {
    call_sign: "KK4ODA/P",
    pin: "4837",
    grid: "EM73UU",
    freq: "14285",
    mode: "SSB",
    comment: "CQ TILE",
  })
})

test("a mode Tiles has no name for goes as Other, and below 1 MHz the frequency goes in MHz", async () => {
  respond('{"ok":true}')
  await postSelfSpot({ freq: 475.5, mode: "RTTY" })
  assert.equal(bodyOf(sent[0]).freq, "0.4755")
  assert.equal(bodyOf(sent[0]).mode, "Other")
  assert.equal("comment" in bodyOf(sent[0]), false)

  respond('{"ok":true}')
  await postSelfSpot({ freq: 145390, mode: "DSTAR" })
  assert.equal(bodyOf(sent[0]).mode, "D-STAR")
})

test("a QRT comment is Tiles' own QRT", async () => {
  respond('{"ok":true}')
  assert.deepEqual(await postSelfSpot({ freq: 14285, mode: "SSB", comment: "QRT, 73" }), { ok: true })
  assert.deepEqual(bodyOf(sent[0]), { call_sign: "KK4ODA/P", pin: "4837", qrt: true })
})

test("a refused PIN, the rate limit and a bad request each say what happened", async () => {
  respond('{"error":"Invalid PIN"}', 401)
  assert.match((await postSelfSpot({ freq: 14285, mode: "SSB" })).message!, /did not accept this callsign and PIN/)
  respond('{"error":"slow down"}', 429)
  assert.match((await postSelfSpot({ freq: 14285, mode: "SSB" })).message!, /six spots a minute/)
  respond('{"error":"grid is required"}', 400)
  assert.deepEqual(await postSelfSpot({ freq: 14285, mode: "SSB" }), { ok: false, message: "grid is required" })
})

test("nothing is posted without credentials, an activation or a frequency", async () => {
  respond('{"ok":true}')
  assert.equal((await postSelfSpot({ freq: 14285 }, {})).ok, false)
  assert.equal((await postSelfSpot({ freq: 14285, operation: { ...activation, refs: [] } })).ok, false)
  assert.equal((await postSelfSpot({ freq: 0 })).ok, false)
  assert.deepEqual(sent, [])
})

test("the account check says what it can, without putting anyone on the air", async () => {
  respond('{"ok":true}')
  const check = (credentials: Record<string, string>) =>
    tiles.runHook("account", "testCredentials", credentials) as Promise<string>
  assert.match(await check({ callsign: "kk4oda", pin: "4837" }), /KK4ODA/)
  assert.match(await check({ callsign: "KK4ODA", pin: "" }), /Enter your Tiles callsign/)
  assert.deepEqual(sent, [])
})

test("a self-spot from an operation on another call is refused, not posted as the account's", async () => {
  respond('{"ok":true}')
  const result = await postSelfSpot({ freq: 14285, mode: "SSB", operation: { ...activation, stationCall: "W1AW" } })
  assert.equal(result.ok, false)
  assert.match(result.message!, /account is for KK4ODA, but this operation is on W1AW/)
  assert.deepEqual(sent, [])

  // A country prefix is the same operator, and the spot carries it.
  respond('{"ok":true}')
  assert.equal((await postSelfSpot({ freq: 14285, mode: "SSB", operation: { ...activation, stationCall: "W1AW, ve3/kk4oda" } })).ok, true)
  assert.equal(bodyOf(sent[0]).call_sign, "VE3/KK4ODA")

  // An operation with no station call yet is spotted as the account's.
  respond('{"ok":true}')
  await postSelfSpot({ freq: 14285, mode: "SSB", operation: { ...activation, stationCall: undefined } })
  assert.equal(bodyOf(sent[0]).call_sign, "KK4ODA")
})

test("a 2xx that does not confirm the spot is no spot", async () => {
  respond("<html>gateway</html>")
  assert.match((await postSelfSpot({ freq: 14285, mode: "SSB" })).message!, /HTTP 200 without confirming/)
  respond("{}", 202)
  assert.equal((await postSelfSpot({ freq: 14285, mode: "SSB" })).ok, false)
})

test("a comment with QRT anywhere goes as Tiles' QRT, as the feed would read it", async () => {
  respond('{"ok":true}')
  await postSelfSpot({ freq: 14285, mode: "SSB", comment: "last call then QRT" })
  assert.equal(bodyOf(sent[0]).qrt, true)
})

test("a JSON null reply is an unconfirmed spot, not a crash", async () => {
  respond("null")
  assert.match((await postSelfSpot({ freq: 14285, mode: "SSB" })).message!, /without confirming/)
})
