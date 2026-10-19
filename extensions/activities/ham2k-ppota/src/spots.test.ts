// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The spot feed and the spot poster, against a recorded `fetch`. The shapes
// are ppota.app's own: the feed wraps its list in an object and often leaves
// the mode empty; posting takes one activator at one reference per request,
// with Ham2K's integration key as a Bearer token, and only a 201 is success.
//
// The registered hook carries the key that ships; the posting tests build
// the same hook around a stand-in key, so no test ever posts with the real one.

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
let replies: { status: number; body: string }[] = []

const ppota = await loadExtension(() => import("./index.ts"), {
  hostCalls: {
    fetch: (params) => {
      sent.push(params as unknown as Request)
      return replies.length > 1 ? replies.shift() : replies[0]
    },
  },
})
// After the load, which installs the stand-in kernel `defineExtension` needs.
const { ppotaSpotsHook } = await import("./index.ts")

/// Each request takes the next reply; the last one repeats.
function respond(...bodies: (string | [string, number])[]) {
  sent = []
  replies = bodies.map((b) => (Array.isArray(b) ? { body: b[0], status: b[1] } : { body: b, status: 200 }))
}

const CREATED: [string, number] = ['{"ok":true,"spot_id":"x","expires_in_minutes":30}', 201]

const hook = ppotaSpotsHook("ppk_test")
const ctx = { locale: "en", online: true } as never
const bodyOf = (request: Request) => JSON.parse(request.body ?? "{}") as Record<string, unknown>
const activation = { stationCall: "LW5ECI/D", refs: [{ type: "ppotaActivation", ref: "PPAR-0004" }] }

/// One row as the live feed publishes it, today.
const FEED_ROW = {
  id: "a96a6b29-a293-4923-8df5-55fbbb6191e5",
  status: "active",
  callsign: "LW5ECI/D",
  reference: "PPAR-0004",
  reference_name: "General Lavalle",
  country_code: "AR",
  grid: "GF13MO",
  frequency_khz: 7135,
  frequency_mhz: 7.135,
  mode: "SSB",
  comment: "Prueba API PPOTA",
  spotted_by: "LW5ECI",
  created_at: "2026-10-01T14:19:56.862Z",
  updated_at: "2026-10-01T14:19:56.862Z",
  expires_at: "2026-10-01T14:49:56.862Z",
  source: "api",
  source_detail: "prueba 2",
}

const feed = (...spots: Record<string, unknown>[]) => JSON.stringify({ program: "PPOTA", count: spots.length, spots })

test("a feed row becomes a spot with a frequency, a band, a time and the reference", async () => {
  respond(feed(FEED_ROW))
  const spots = (await ppota.runHook("spots", "fetchSpots", {}, { ctx: { online: true } })) as any[]

  assert.equal(sent[0].url, "https://ppota.app/api/v1/spots")
  assert.equal(spots.length, 1)
  assert.equal(spots[0].their.call, "LW5ECI/D")
  assert.equal(spots[0].freq, 7135)
  assert.equal(spots[0].band, "40m")
  assert.equal(spots[0].mode, "SSB")
  assert.equal(spots[0].spot.timeInMillis, Date.parse("2026-10-01T14:19:56.862Z"))
  assert.equal(spots[0].spot.source, "ppota")
  assert.equal(spots[0].spot.label, "PPAR-0004: General Lavalle")
  assert.deepEqual(spots[0].refs, [{ ref: "PPAR-0004", type: "ppota" }])
  assert.deepEqual(spots[0].spot.sourceInfo, { comments: "Prueba API PPOTA", spotter: "LW5ECI" })
})

test("an empty mode is no mode, and a frequency only in MHz is still a frequency", async () => {
  respond(feed({ ...FEED_ROW, mode: "", frequency_khz: null, frequency_mhz: 14.285 }))
  const [spot] = (await ppota.runHook("spots", "fetchSpots", {}, { ctx: { online: true } })) as any[]
  assert.equal(spot.mode, undefined)
  assert.equal(spot.freq, 14285)
  assert.equal(spot.band, "20m")
})

test("a mode typed freely on the site is filed the way the app logs it", async () => {
  respond(feed({ ...FEED_ROW, mode: "usb" }, { ...FEED_ROW, mode: "ft8" }))
  const spots = (await ppota.runHook("spots", "fetchSpots", {}, { ctx: { online: true } })) as any[]
  assert.deepEqual(spots.map((s) => s.mode), ["SSB", "FT8"])
})

test("a closed spot is left off the list", async () => {
  respond(feed({ ...FEED_ROW, status: "closed" }))
  assert.deepEqual(await ppota.runHook("spots", "fetchSpots", {}, { ctx: { online: true } }), [])
})

test("a feed that answers with no list of spots is a clear error", async () => {
  respond('{"error":"maintenance"}')
  await assert.rejects(ppota.runHook("spots", "fetchSpots", {}, { ctx: { online: true } }), /list of spots/)
})

test("offline, the feed is not asked at all", async () => {
  respond(feed())
  assert.deepEqual(await ppota.runHook("spots", "fetchSpots", {}, { ctx: { online: false } }), [])
  assert.deepEqual(sent, [])
})

test("spotting is offered only with a key, and only where there is a PPOTA reference", async () => {
  assert.equal((await hook.isSelfSpotEnabled!({ operation: activation }, ctx)).enabled, true)
  assert.equal((await hook.isSelfSpotEnabled!({ operation: { stationCall: "LU1ABC", refs: [] } }, ctx)).enabled, false)
  // A QSO carries the HUNTING type; the activation type there means nothing.
  assert.equal((await hook.isOtherSpotEnabled!({ qso: { refs: [{ type: "ppota", ref: "PPAR-0004" }] } }, ctx)).enabled, true)
  assert.equal((await hook.isOtherSpotEnabled!({ qso: { refs: [{ type: "ppotaActivation", ref: "PPAR-0004" }] } }, ctx)).enabled, false)

  // The registered hook carries the key that ships, so it offers posting too.
  const shipped = (await ppota.runHook("spots", "isSelfSpotEnabled", { operation: activation })) as { enabled: boolean }
  assert.equal(shipped.enabled, true, "the bundle ships without PPOTA_API_KEY")

  const keyless = ppotaSpotsHook("")
  assert.equal((await keyless.isSelfSpotEnabled!({ operation: activation }, ctx)).enabled, false)
  assert.equal((await keyless.isOtherSpotEnabled!({ qso: { refs: [{ type: "ppota", ref: "PPAR-0004" }] } }, ctx)).enabled, false)
})

test("a self-spot names the unit of its frequency, and carries the key as a Bearer token", async () => {
  respond(CREATED)
  const result = await hook.postSelfSpot!({ operation: activation, freq: 7135, mode: "USB", comment: "Activando PPOTA" }, ctx)

  assert.equal(result.ok, true)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].url, "https://ppota.app/api/v1/spots")
  assert.equal(sent[0].method, "POST")
  assert.equal(sent[0].headers?.Authorization, "Bearer ppk_test")
  assert.ok(!sent[0].url.includes("ppk_test"), "the key leaked into the URL")
  assert.deepEqual(bodyOf(sent[0]), {
    callsign: "LW5ECI/D",
    reference: "PPAR-0004",
    frequencyKHz: 7135,
    mode: "SSB",
    comment: "Activando PPOTA",
    spotterCallsign: "LW5ECI/D",
  })
})

test("two references and two operators are four posts, one pair each", async () => {
  respond(CREATED)
  const result = await hook.postSelfSpot!(
    {
      operation: {
        stationCall: "LU1ABC, LU2DEF",
        refs: [{ type: "ppotaActivation", ref: "PPAR-0004" }, { type: "ppotaActivation", ref: "PPAR-0005" }],
      },
      freq: 7135,
    },
    ctx,
  )
  assert.equal(result.ok, true)
  assert.deepEqual(
    sent.map((r) => `${bodyOf(r).callsign}@${bodyOf(r).reference}`),
    ["LU1ABC@PPAR-0004", "LU1ABC@PPAR-0005", "LU2DEF@PPAR-0004", "LU2DEF@PPAR-0005"],
  )
})

test("a frequency handed over as text is still posted as a number", async () => {
  respond(CREATED)
  await hook.postSelfSpot!({ operation: activation, freq: "7135" as unknown as number }, ctx)
  assert.equal(bodyOf(sent[0]).frequencyKHz, 7135)
})

test("a mode is sent upper-case and canonical, and an absent one is left out", async () => {
  const modeSent = async (mode: string | undefined) => {
    respond(CREATED)
    await hook.postSelfSpot!({ operation: activation, freq: 7074, mode }, ctx)
    return bodyOf(sent[0]).mode
  }
  assert.equal(await modeSent("CW"), "CW")
  assert.equal(await modeSent("ft8"), "FT8")
  assert.equal(await modeSent("LSB"), "SSB")
  assert.equal(await modeSent(undefined), undefined)
})

test("a hunter's re-spot names the station worked, its reference, and us as spotter", async () => {
  respond(CREATED)
  const result = await hook.postOtherSpot!(
    {
      qso: { their: { call: "LW6DGI/D" }, our: { call: "" }, freq: 7142, mode: "SSB", refs: [{ type: "ppota", ref: "PPAR-0057" }] },
      comment: "59 tnx",
      spotterCall: "LU1EAF",
    },
    ctx,
  )
  assert.equal(result.ok, true)
  const body = bodyOf(sent[0])
  assert.equal(body.callsign, "LW6DGI/D")
  assert.equal(body.reference, "PPAR-0057")
  assert.equal(body.frequencyKHz, 7142)
  // An empty `our.call` falls through to the spotter the core names.
  assert.equal(body.spotterCallsign, "LU1EAF")
})

test("no frequency, or no callsign, is refused rather than posted", async () => {
  respond(CREATED)
  for (const freq of [undefined, 0, Number.NaN]) {
    const result = await hook.postSelfSpot!({ operation: activation, freq: freq as number }, ctx)
    assert.equal(result.ok, false, String(freq))
  }
  const blank = await hook.postOtherSpot!({ qso: { their: { call: "" }, freq: 7130, refs: [{ type: "ppota", ref: "PPAR-0004" }] } }, ctx)
  assert.equal(blank.ok, false)
  assert.deepEqual(sent, [])
})

test("only a 201 is success", async () => {
  respond(['{"ok":true}', 200])
  const result = await hook.postSelfSpot!({ operation: activation, freq: 7135 }, ctx)
  assert.equal(result.ok, false)
})

test("an unknown reference says so by name", async () => {
  respond(['{"error":"REFERENCE_NOT_FOUND"}', 404])
  const result = await hook.postSelfSpot!({ operation: activation, freq: 7135 }, ctx)
  assert.equal(result.ok, false)
  assert.match(result.message ?? "", /PPOTA does not know PPAR-0004/)
})

test("one refused reference among two is a failure naming it, though the other landed", async () => {
  respond(CREATED, ['{"error":"REFERENCE_NOT_FOUND"}', 404])
  const result = await hook.postSelfSpot!(
    {
      operation: { stationCall: "LU1ABC", refs: [{ type: "ppotaActivation", ref: "PPAR-0004" }, { type: "ppotaActivation", ref: "PPAR-9999" }] },
      freq: 7135,
    },
    ctx,
  )
  assert.equal(result.ok, false)
  assert.equal(sent.length, 2)
  assert.match(result.message ?? "", /PPAR-9999/)
  assert.doesNotMatch(result.message ?? "", /PPAR-0004/)
})

test("with several operators, a failure names which of them it was", async () => {
  respond(CREATED, ['{"error":"INVALID_SPOT"}', 400])
  const result = await hook.postSelfSpot!({ operation: { ...activation, stationCall: "LU1ABC, LU2DEF" }, freq: 7135 }, ctx)
  assert.equal(result.ok, false)
  assert.match(result.message ?? "", /LU2DEF at PPAR-0004 \(INVALID_SPOT\)/)
  assert.match(result.message ?? "", /1 other spot\(s\) did go out/)
})

test("a key rejected after a spot went out says that one did", async () => {
  respond(CREATED, ['{"error":"API_PERMISSION_REQUIRED"}', 403])
  const result = await hook.postSelfSpot!({ operation: { ...activation, stationCall: "LU1ABC, LU2DEF" }, freq: 7135 }, ctx)
  assert.equal(result.ok, false)
  assert.equal(sent.length, 2)
  assert.match(result.message ?? "", /API_PERMISSION_REQUIRED/)
  assert.match(result.message ?? "", /1 other spot\(s\) did go out/)
})

test("a rejected key stops at the first post and names PPOTA's code", async () => {
  respond(['{"error":"INVALID_API_KEY"}', 401])
  const result = await hook.postSelfSpot!(
    {
      operation: { stationCall: "LU1ABC", refs: [{ type: "ppotaActivation", ref: "PPAR-0004" }, { type: "ppotaActivation", ref: "PPAR-0005" }] },
      freq: 7135,
    },
    ctx,
  )
  assert.equal(result.ok, false)
  assert.equal(sent.length, 1)
  assert.match(result.message ?? "", /INVALID_API_KEY/)
})
