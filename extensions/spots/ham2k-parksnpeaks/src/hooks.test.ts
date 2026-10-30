// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The feed and the spot poster through the `spots` HOOK, against a recorded
// `fetch`. Each test pins a way the real service differs from what code
// written by inference would assume: it publishes MHz in a string, stamps UTC
// without saying so, misspells `actSpoter`, carries other awards' spots that
// arrive from their own sources, and answers a REJECTED spot with HTTP 200.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

// A zone far from UTC, set before anything parses a date: `actTime` read as
// local time is only wrong where local is not UTC, and CI runs in UTC.
process.env.TZ = "Australia/Sydney"

interface FetchParams {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
}

let sent: FetchParams[] = []
let reply = { status: 200, body: "[]" }
let unreachable: Error | undefined

const pnp = await loadExtension(() => import("./index.ts"), {
  hostCalls: {
    fetch: (params) => {
      sent.push(params as unknown as FetchParams)
      if (unreachable) throw unreachable
      return reply
    },
  },
})

function respond(body: string, status = 200) {
  sent = []
  unreachable = undefined
  reply = { status, body }
}

const LOGIN = { credentials: { userId: "vk2abc", apiKey: "k" } }

interface Spot {
  their: { call: string }
  freq?: number
  band?: string
  mode?: string
  refs: { ref: string; type: string }[]
  spot: { timeInMillis: number; sourceInfo: { spotter?: string } }
}

const fetchSpots = async (body: string) => {
  respond(body)
  return (await pnp.runHook("spots", "fetchSpots", {}, { ctx: { online: true } })) as Spot[]
}

function spotJson({
  call,
  cls = "WWFF",
  site = "VKFF-1997",
  freq = "7.160",
  time = "2026-08-05 00:07:27",
  mode = "SSB",
  location = "Stony Creek Nature Reserve",
  spotter = "vk2vw",
  comments = "Calling now",
}: { call: string; cls?: string; site?: string; freq?: string; time?: string; mode?: string; location?: string; spotter?: string; comments?: string }) {
  return JSON.stringify({
    actTime: time,
    actSiteID: site,
    actCallsign: call,
    actMode: mode,
    actFreq: freq,
    actClass: cls,
    actLocation: location,
    actComments: comments,
    actSpoter: spotter,
  })
}

test("reads MHz strings as kHz and the unmarked timestamp as UTC", async () => {
  const spots = await fetchSpots(`[${spotJson({ call: "vk2ozo" })}]`)

  // The worldwide feed is hundreds of rows of US POTA; this source is for VK
  // and ZL.
  assert.match(sent[0].url, /\/api\/ALL\?continent=OC$/)
  assert.equal(spots.length, 1)
  // Everything downstream is kHz; a missed conversion puts the spot 1000x off
  // and on no band at all.
  assert.equal(spots[0].freq, 7160)
  assert.equal(spots[0].band, "40m")
  assert.equal(spots[0].their.call, "VK2OZO")
  assert.deepEqual(spots[0].refs[0], { ref: "VKFF-1997", type: "wwff" })
  // Parsed as local time, a VK activator lands hours away from now and sorts
  // wrong.
  assert.equal(spots[0].spot.timeInMillis, Date.UTC(2026, 7, 5, 0, 7, 27))
  // Reading a correctly spelled `actSpotter` finds nothing.
  assert.equal(spots[0].spot.sourceInfo.spotter, "VK2VW")
})

test("keeps only WWFF and SiOTA, dropping the awards that arrive from their own sources", async () => {
  // POTA and SOTA copies would show one activator twice, in two sources, with
  // nothing marking them the same.
  const spots = await fetchSpots(
    `[${[
      spotJson({ call: "vk1aa", cls: "WWFF", site: "VKFF-0001" }),
      spotJson({ call: "vk1bb", cls: "SiOTA", site: "VK-SI0001" }),
      spotJson({ call: "vk1cc", cls: "POTA", site: "VK-0001" }),
      spotJson({ call: "vk1dd", cls: "SOTA", site: "VK1/AC-001" }),
    ].join(",")}]`,
  )

  assert.deepEqual(spots.map((s) => s.their.call), ["VK1AA", "VK1BB"])
  assert.deepEqual(spots.map((s) => s.refs[0].type), ["wwff", "siota"])
})

test("reads the class whatever its case, as the rewritten site spells SiOTA 'SIOTA'", async () => {
  // The October 2026 site publishes 'SIOTA' where the old one published
  // 'SiOTA'; matched exactly, every silo vanished from the feed.
  const spots = await fetchSpots(`[${spotJson({ call: "vk3sio", cls: "SIOTA", site: "VK-SI0042" })}]`)
  assert.equal(spots.length, 1)
  assert.deepEqual(spots[0].refs[0], { ref: "VK-SI0042", type: "siota" })
})

test("a spot with an unreadable time never evicts a good one, in either feed order", async () => {
  // Malformed-row-FIRST is the order that catches a NaN time: NaN fails every
  // comparison, so it holds the slot and discards every good row after it,
  // then reads as time 0 and the panel's age filter drops the station. Feed
  // order is the service's choice, so both are pinned.
  for (const malformedFirst of [true, false]) {
    const good = spotJson({ call: "vk4aaa", freq: "7.090", time: "2026-08-05 01:00:00", site: "VKFF-0004" })
    const bad = spotJson({ call: "vk4aaa", freq: "14.310", time: "not a time", site: "VKFF-0005" })
    const spots = await fetchSpots(`[${malformedFirst ? `${bad},${good}` : `${good},${bad}`}]`)

    assert.equal(spots.length, 1, `malformedFirst=${malformedFirst}`)
    assert.equal(spots[0].freq, 7090, `malformedFirst=${malformedFirst}`)
    assert.equal(spots[0].spot.timeInMillis, Date.UTC(2026, 7, 5, 1), `malformedFirst=${malformedFirst}`)
  }
})

test("an empty mode falls back to the VK band plan rather than hiding the spot", async () => {
  // The panel's default mode filter compares super-modes, and a missing mode
  // matches none of them — the spot would never appear at all.
  const spots = await fetchSpots(`[${spotJson({ call: "vk6zzz", freq: "7.090", mode: "" })}]`)
  assert.equal(spots.length, 1)
  assert.equal(spots[0].mode, "SSB")
})

test("an operator on two awards at once keeps both rows", async () => {
  // A WWFF park and a SiOTA silo worked together are published as two rows.
  // Keyed by call alone, one is dropped here — and the panel's own
  // call+freq merge, which would have carried both references on one row,
  // never sees it.
  const spots = await fetchSpots(
    `[${[
      spotJson({ call: "vk7bb", cls: "WWFF", site: "VKFF-0300", freq: "7.090" }),
      spotJson({ call: "vk7bb", cls: "SiOTA", site: "VK-SI0300", freq: "7.090" }),
    ].join(",")}]`,
  )

  assert.equal(spots.length, 2)
  assert.deepEqual(new Set(spots.map((s) => s.refs[0].type)), new Set(["wwff", "siota"]))
})

test("one row per station per award, keeping the newest spot rather than the first", async () => {
  // Keeping the first shows a station that moved band where it WAS, and makes
  // the answer depend on feed order rather than on time.
  const spots = await fetchSpots(
    `[${[
      spotJson({ call: "vk3xyz", freq: "7.090", time: "2026-08-05 01:00:00", site: "VKFF-0002" }),
      spotJson({ call: "vk3xyz", freq: "14.310", time: "2026-08-05 02:30:00", site: "VKFF-0003" }),
    ].join(",")}]`,
  )

  assert.equal(spots.length, 1)
  assert.equal(spots[0].freq, 14310)
  assert.equal(spots[0].refs[0].ref, "VKFF-0003")
})

const operation = () => ({
  stationCall: "VK2ABC",
  refs: [{ type: "wwffActivation", ref: "VKFF-1997" }],
})

const OK = JSON.stringify({ success: true, message: "" })

const postedBody = () => {
  assert.equal(sent.length, 1)
  assert.match(sent[0].url, /\/api\/spots$/)
  assert.equal(sent[0].method, "POST")
  return Object.fromEntries(new URLSearchParams(sent[0].body ?? ""))
}

test("posts the activator, reference and kHz frequency the API expects", async () => {
  respond(OK)
  const result = (await pnp.runHook(
    "spots",
    "postSelfSpot",
    { operation: operation(), freq: 7160, mode: "SSB", comment: "up 5" },
    { ctx: { account: LOGIN } },
  )) as { ok: boolean }

  assert.equal(result.ok, true)
  const body = postedBody()
  assert.equal(body.activator, "VK2ABC")
  assert.equal(body.spotter, "VK2ABC")
  assert.equal(body.reference, "VKFF-1997")
  // kHz since the October 2026 rewrite: the old MHz '7.160' spots 7 kHz.
  assert.equal(body.frequency, "7160")
  assert.equal(body.mode, "SSB")
  assert.equal(body.comments, "up 5")
  assert.equal(body.userID, "vk2abc")
  assert.equal(body.APIKey, "k")
  // Without it, a silo inside a park is spotted as a park activation too.
  assert.equal(body.do_not_lookup, "true")
})

test("an operation on two awards posts one spot carrying both references", async () => {
  respond(OK)
  await pnp.runHook(
    "spots",
    "postSelfSpot",
    {
      operation: { stationCall: "VK2ABC", refs: [{ type: "wwffActivation", ref: "VKFF-1997" }, { type: "siotaActivation", ref: "VK-SI0042" }, { type: "potaActivation", ref: "AU-0001" }] },
      freq: 7160,
    },
    { ctx: { account: LOGIN } },
  )
  // POTA has its own source and is not this one's to spot.
  assert.equal(postedBody().reference, "VKFF-1997,VK-SI0042")
})

test("spotting someone else reads the HUNTING ref a QSO carries", async () => {
  // A logged contact with a park carries `wwff`, never `wwffActivation` — that
  // one is the operation's. Matching the activation type here leaves the
  // whole other-spot path dead with no error anywhere.
  respond(OK)
  const qso = {
    their: { call: "VK5DEF" },
    our: { call: "VK2ABC" },
    freq: 14310,
    mode: "SSB",
    refs: [{ type: "wwff", ref: "VKFF-0100" }],
  }

  const eligibility = (await pnp.runHook("spots", "isOtherSpotEnabled", { qso }, { ctx: { account: LOGIN } })) as { enabled: boolean }
  assert.equal(eligibility.enabled, true)

  const result = (await pnp.runHook("spots", "postOtherSpot", { qso, comment: "" }, { ctx: { account: LOGIN } })) as { ok: boolean }
  assert.equal(result.ok, true)
  const body = postedBody()
  assert.equal(body.activator, "VK5DEF")
  assert.equal(body.spotter, "VK2ABC")
  assert.equal(body.reference, "VKFF-0100")
  assert.equal(body.frequency, "14310")
})

test("a frequency off a whole kHz still posts a plain kHz string", async () => {
  // A radio reporting 7160.5 kHz is ordinary, and float noise off a VFO is
  // not something to publish.
  respond(OK)
  await pnp.runHook("spots", "postSelfSpot", { operation: operation(), freq: 7160.5 }, { ctx: { account: LOGIN } })
  assert.equal(postedBody().frequency, "7160.5")

  respond(OK)
  await pnp.runHook("spots", "postSelfSpot", { operation: operation(), freq: 14074.000000001 }, { ctx: { account: LOGIN } })
  assert.equal(postedBody().frequency, "14074")
})

test("a rejected spot answers HTTP 200, so the body decides, and its reason is shown", async () => {
  // Trusting the status reports success for a spot nobody can see.
  respond(JSON.stringify({ success: false, message: "Authentication failed!" }))
  const result = (await pnp.runHook(
    "spots",
    "postSelfSpot",
    { operation: operation(), freq: 7160 },
    { ctx: { account: { credentials: { userId: "vk2abc", apiKey: "wrong" } } } },
  )) as { ok: boolean; message?: string }

  assert.equal(result.ok, false)
  assert.match(result.message ?? "", /VKFF-1997/)
  assert.match(result.message ?? "", /Authentication failed!/)
  // Logins saved before the move are the likely cause, so it says where to
  // fix one.
  assert.match(result.message ?? "", /Settings › Accounts, Services & Data Sources › ParksnPeaks/)
})

test("a refusal of the spot itself is not blamed on the login", async () => {
  respond(JSON.stringify({ success: false, message: "Unknown reference VKFF-9999" }))
  const result = (await pnp.runHook("spots", "postSelfSpot", { operation: operation(), freq: 7160 }, { ctx: { account: LOGIN } })) as { ok: boolean; message?: string }
  assert.equal(result.ok, false)
  assert.match(result.message ?? "", /Unknown reference VKFF-9999/)
  assert.doesNotMatch(result.message ?? "", /Settings/)
})

const selfSpot = async () =>
  (await pnp.runHook("spots", "postSelfSpot", { operation: operation(), freq: 7160 }, { ctx: { account: LOGIN } })) as { ok: boolean; message?: string }

test("an answer that is not the service's JSON verdict is not a spot that landed, nor called a refusal", async () => {
  // An error page served with 200 has confirmed nothing — but the spot may
  // have landed, so the operator is told to look rather than that it was
  // refused, which invites a duplicate.
  respond("<!DOCTYPE html><html>Something went wrong</html>")
  const result = await selfSpot()
  assert.equal(result.ok, false)
  assert.doesNotMatch(result.message ?? "", /rejected/)
  assert.match(result.message ?? "", /check its spot list/)
})

test("a spot with no answer is not called refused, and may have gone out", async () => {
  // The host also gives up on a request it already sent, once the answer is
  // slow; telling the operator it never left invites a duplicate spot.
  respond("")
  unreachable = new Error("TimeoutException after 0:00:15.000000: Future not completed")
  const result = await selfSpot()
  assert.equal(result.ok, false)
  assert.doesNotMatch(result.message ?? "", /rejected/)
  assert.match(result.message ?? "", /No answer.*TimeoutException.*check before posting again/)
})

test("an answer of the wrong shape is unreadable, not a refusal", async () => {
  // A redirect to the spot list after a spot was created is followed as a GET
  // and reads back as the list itself.
  for (const body of ["[]", JSON.stringify({ id: 123 }), JSON.stringify({ success: "true" })]) {
    respond(body)
    const result = await selfSpot()
    assert.equal(result.ok, false, body)
    assert.match(result.message ?? "", /check its spot list/, body)
  }
})

test("a plain refusal with no reason still says it was refused", async () => {
  respond(JSON.stringify({ success: false }))
  assert.match((await selfSpot()).message ?? "", /rejected the spot for VKFF-1997$/)
})

test("any 2xx carrying success is a spot that landed", async () => {
  respond(JSON.stringify({ success: true, message: "Spot created" }), 201)
  assert.equal((await selfSpot()).ok, true)
})

test("an HTTP error names its status, or the service's reason when it gives one", async () => {
  respond("<html>Service Unavailable</html>", 503)
  assert.match((await selfSpot()).message ?? "", /HTTP 503.*check its spot list/)

  // A server error that explains itself keeps its status: it is no refusal.
  respond(JSON.stringify({ success: false, message: "Something went wrong" }), 500)
  const serverError = (await selfSpot()).message ?? ""
  assert.match(serverError, /HTTP 500.*Something went wrong/)
  assert.doesNotMatch(serverError, /rejected/)

  respond(JSON.stringify({ success: false, message: "Authentication failed!" }), 401)
  assert.match((await selfSpot()).message ?? "", /Authentication failed!.*Settings/)

  respond("<html>Unauthorized</html>", 401)
  assert.match((await selfSpot()).message ?? "", /HTTP 401.*Settings/)

  // The site's firewall answers 403 with a page of its own; the login was
  // never looked at, so it is not blamed.
  respond("<html>Attention Required! | Cloudflare</html>", 403)
  const blocked = (await selfSpot()).message ?? ""
  assert.match(blocked, /HTTP 403/)
  assert.doesNotMatch(blocked, /Settings/)

  // A 500 is no confirmation, whatever its body claims.
  respond(JSON.stringify({ success: true }), 500)
  assert.equal((await selfSpot()).ok, false)
})

test("a self-spot with no frequency is not posted", async () => {
  respond(OK)
  const result = (await pnp.runHook("spots", "postSelfSpot", { operation: operation(), freq: 0 }, { ctx: { account: LOGIN } })) as { ok: boolean }
  assert.equal(result.ok, false)
  assert.equal(sent.length, 0)
})

test("offers spotting only once a whole login is stored", async () => {
  // Reading the feed needs no account, but the spot button must not invite a
  // post that can only be rejected — and posting sends both halves, so a key
  // with no user id is not a login either.
  const enabled = async (account: unknown) =>
    ((await pnp.runHook("spots", "isSelfSpotEnabled", { operation: operation() }, { ctx: { account } as never })) as { enabled: boolean }).enabled

  assert.equal(await enabled(undefined), false)
  assert.equal(await enabled({ credentials: { apiKey: "k" } }), false)
  assert.equal(await enabled(LOGIN), true)
})
