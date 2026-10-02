// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The spot feed, the spot poster and the account check through their HOOKS,
// against a recorded `fetch`. The shapes are cqhota.app's own: the feed sends
// numbers as strings, posting takes lists of activators and references and
// answers which pairs it refused, and the key is the operator's, in a header.

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
let reply = { status: 200, body: "[]" }

const hota = await loadExtension(() => import("./index.ts"), {
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

const LOGIN = { credentials: { apiKey: "hik_secret" } }
const activation = { stationCall: "YO3BEE", refs: [{ type: "hotaActivation", ref: "RO-H0001" }] }

/// One row as the live feed publishes it, today.
const FEED_ROW = {
  id: "211",
  callsign: "F4JXY/P",
  freq_khz: "24915.0",
  mode: "FT8",
  comment: "QSY (RBN)",
  source: "rbn",
  spotter: "RBN",
  created_at: "2026-10-01T12:46:53.472Z",
  reference: "FR-H0195",
  reference_name: "MAISON FORTE AU FRECHET",
  program: "HOTA",
  ended: false,
  band: "12m",
  activator: "F4JXY/P",
}

test("the feed's string numbers become a frequency, a band and a time", async () => {
  respond(JSON.stringify([FEED_ROW]))
  const spots = (await hota.runHook("spots", "fetchSpots", {}, { ctx: { online: true } })) as any[]

  assert.equal(spots.length, 1)
  assert.equal(spots[0].their.call, "F4JXY/P")
  assert.equal(spots[0].freq, 24915)
  assert.equal(spots[0].band, "12m")
  assert.equal(spots[0].mode, "FT8")
  assert.equal(spots[0].spot.timeInMillis, Date.parse("2026-10-01T12:46:53.472Z"))
  assert.equal(spots[0].spot.source, "hota")
  assert.equal(spots[0].spot.label, "FR-H0195: MAISON FORTE AU FRECHET")
  assert.deepEqual(spots[0].refs, [{ ref: "FR-H0195", type: "hota" }])
  assert.deepEqual(spots[0].spot.sourceInfo, { comments: "QSY (RBN)", spotter: "RBN" })
})

test("the feed's Digi becomes DATA, and a lower-case reference is upper-cased everywhere", async () => {
  respond(JSON.stringify([{ ...FEED_ROW, mode: "Digi", reference: "fr-h0195" }]))
  const [spot] = (await hota.runHook("spots", "fetchSpots", {}, { ctx: { online: true } })) as any[]
  assert.equal(spot.mode, "DATA")
  assert.equal(spot.refs[0].ref, "FR-H0195")
  assert.equal(spot.spot.label, "FR-H0195: MAISON FORTE AU FRECHET")
})

test("a feed that answers with something other than a list is a clear error", async () => {
  respond('{"error":"maintenance"}')
  await assert.rejects(hota.runHook("spots", "fetchSpots", {}, { ctx: { online: true } }), /list of spots/)
})

test("a QRT'd spot is left off the list", async () => {
  // The live feed omits them already; one that slips through is an activator
  // who has gone home.
  respond(JSON.stringify([{ ...FEED_ROW, ended: true }]))
  assert.deepEqual(await hota.runHook("spots", "fetchSpots", {}, { ctx: { online: true } }), [])
})

test("offline, the feed is not asked at all", async () => {
  respond("[]")
  assert.deepEqual(await hota.runHook("spots", "fetchSpots", {}, { ctx: { online: false } }), [])
  assert.deepEqual(sent, [])
})

test("spotting is offered only with a key, and only where there is a HOTA reference", async () => {
  const selfEnabled = async (ctx: Record<string, unknown>, operation: unknown = activation) =>
    ((await hota.runHook("spots", "isSelfSpotEnabled", { operation }, { ctx })) as { enabled: boolean }).enabled
  const otherEnabled = async (ctx: Record<string, unknown>, qso: unknown) =>
    ((await hota.runHook("spots", "isOtherSpotEnabled", { qso }, { ctx })) as { enabled: boolean }).enabled

  assert.equal(await selfEnabled({ account: LOGIN }), true)
  assert.equal(await selfEnabled({}), false)
  assert.equal(await selfEnabled({ account: { credentials: { apiKey: "  " } } }), false)
  assert.equal(await selfEnabled({ account: LOGIN }, { stationCall: "YO3BEE", refs: [] }), false)

  // A QSO carries the HUNTING type; the activation type there means nothing.
  assert.equal(await otherEnabled({ account: LOGIN }, { refs: [{ type: "hota", ref: "RO-H0001" }] }), true)
  assert.equal(await otherEnabled({ account: LOGIN }, { refs: [{ type: "hotaActivation", ref: "RO-H0001" }] }), false)
})

test("a self-spot posts every reference and every operator in one request, key in a header", async () => {
  respond('{"created":[{},{}],"refused":[]}', 201)
  const result = (await hota.runHook(
    "spots",
    "postSelfSpot",
    {
      operation: {
        stationCall: "YO3BEE, YO3ABC",
        refs: [{ type: "hotaActivation", ref: "RO-H0001" }, { type: "hotaActivation", ref: "RO-H0002" }],
      },
      freq: 14285,
      mode: "USB",
      comment: "cq hota",
    },
    { ctx: { account: LOGIN } },
  )) as { ok: boolean }

  assert.equal(result.ok, true)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].url, "https://cqhota.app/api/v1/spots")
  assert.equal(sent[0].method, "POST")
  assert.equal(sent[0].headers?.["X-Integration-Key"], "hik_secret")
  assert.ok(!sent[0].url.includes("hik_secret"), "the key leaked into the URL")
  assert.deepEqual(bodyOf(sent[0]), {
    activators: ["YO3BEE", "YO3ABC"],
    references: ["RO-H0001", "RO-H0002"],
    freq_khz: 14285,
    // HOTA files sideband as SSB.
    mode: "SSB",
    comment: "cq hota",
  })
})

test("modes are filed under HOTA's own names; other data is Digi, and a voice mode HOTA can't name is left out", async () => {
  const modeSent = async (mode: string | undefined) => {
    respond('{"created":[{}]}', 201)
    await hota.runHook("spots", "postSelfSpot", { operation: activation, freq: 14070, mode }, { ctx: { account: LOGIN } })
    return bodyOf(sent[0]).mode
  }
  assert.equal(await modeSent("CW"), "CW")
  assert.equal(await modeSent("ft8"), "FT8")
  assert.equal(await modeSent("LSB"), "SSB")
  assert.equal(await modeSent("PSK31"), "Digi")
  assert.equal(await modeSent("SSTV"), "Digi")
  assert.equal(await modeSent("DV"), undefined)
  assert.equal(await modeSent("DMR"), undefined)
  assert.equal(await modeSent(undefined), undefined)
})

test("a hunter's re-spot names the station worked and the references it is at", async () => {
  respond('{"created":[{}]}', 201)
  const result = (await hota.runHook(
    "spots",
    "postOtherSpot",
    { qso: { their: { call: "SP9ABC" }, freq: 7130, mode: "CW", refs: [{ type: "hota", ref: "PL-H0042" }] }, comment: "tnx" },
    { ctx: { account: LOGIN } },
  )) as { ok: boolean }

  assert.equal(result.ok, true)
  const body = bodyOf(sent[0])
  assert.deepEqual(body.activators, ["SP9ABC"])
  assert.deepEqual(body.references, ["PL-H0042"])
  assert.equal(body.freq_khz, 7130)
})

test("a self-spot with no frequency is refused rather than posted at 0 kHz", async () => {
  respond('{"created":[{}]}', 201)
  for (const freq of [undefined, 0, Number.NaN]) {
    const result = (await hota.runHook("spots", "postSelfSpot", { operation: activation, freq }, { ctx: { account: LOGIN } })) as {
      ok: boolean
    }
    assert.equal(result.ok, false, String(freq))
  }
  assert.deepEqual(sent, [])
})

test("a QSO with no callsign is refused rather than spotted blank", async () => {
  respond('{"created":[{}]}', 201)
  const result = (await hota.runHook(
    "spots",
    "postOtherSpot",
    { qso: { their: { call: "" }, freq: 7130, refs: [{ type: "hota", ref: "PL-H0042" }] } },
    { ctx: { account: LOGIN } },
  )) as { ok: boolean }
  assert.equal(result.ok, false)
  assert.deepEqual(sent, [])
})

test("a refused pair is a failure that names the reference and the reason, even when others landed", async () => {
  respond('{"created":[{}],"refused":[{"activator":"YO3BEE","reference":"RO-H0002","reason":"unknown reference"}]}', 201)
  const result = (await hota.runHook("spots", "postSelfSpot", { operation: activation, freq: 14285 }, { ctx: { account: LOGIN } })) as {
    ok: boolean
    message?: string
  }
  assert.equal(result.ok, false)
  assert.match(result.message ?? "", /RO-H0002 \(unknown reference\)/)
})

test("with several operators, a refusal names which of them it was", async () => {
  respond('{"created":[{}],"refused":[{"activator":"YO3ABC","reference":"RO-H0001","reason":"not your call"}]}', 201)
  const result = (await hota.runHook(
    "spots",
    "postSelfSpot",
    { operation: { ...activation, stationCall: "YO3BEE,YO3ABC" }, freq: 14285 },
    { ctx: { account: LOGIN } },
  )) as { ok: boolean; message?: string }
  assert.equal(result.ok, false)
  assert.match(result.message ?? "", /YO3ABC at RO-H0001 \(not your call\)/)
})

test("a rejected key says so, rather than reporting a bare HTTP status", async () => {
  respond('{"error":"invalid integration key"}', 403)
  const result = (await hota.runHook("spots", "postSelfSpot", { operation: activation, freq: 14285 }, { ctx: { account: LOGIN } })) as {
    ok: boolean
    message?: string
  }
  assert.equal(result.ok, false)
  assert.match(result.message ?? "", /integration API key/)
})

test("the account check reads the key's own summary, and reports a rejected key", async () => {
  respond('{"callsign":"YO3BEE","activations":12}')
  const ok = (await hota.runHook("account", "testCredentials", { apiKey: " hik_secret " })) as string
  assert.equal(sent[0].url, "https://cqhota.app/api/v1/me/summary")
  assert.equal(sent[0].headers?.["X-Integration-Key"], "hik_secret")
  assert.match(ok, /✅.*YO3BEE/)

  respond('{"error":"invalid integration key"}', 403)
  const rejected = (await hota.runHook("account", "testCredentials", { apiKey: "hik_bogus" })) as string
  assert.doesNotMatch(rejected, /✅/)

  respond("")
  const empty = (await hota.runHook("account", "testCredentials", { apiKey: "" })) as string
  assert.doesNotMatch(empty, /✅/)
  assert.deepEqual(sent, [], "an empty key is not sent to be checked")
})
