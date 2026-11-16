// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The scoring rules and the tracker's feeds as the app sees them.

import { test } from "node:test"
import assert from "node:assert/strict"

import { baseCall, modeGroupFor, qsoPoints } from "./rules.ts"
import { HostTable, inEvent, parseEvent, parseHosts, parseSpots, pointsLabel } from "./tracker.ts"

test("points are power × mode, networked voice is flat, an override replaces both", () => {
  assert.equal(qsoPoints("qrp", "cw", null), 8)
  assert.equal(qsoPoints("100w", "phone", null), 2)
  assert.equal(qsoPoints("qro", "digital", null), 1)
  assert.equal(qsoPoints("qrp", "dmr", null), 2)
  assert.equal(qsoPoints("qrp", "cw", 6.52), 6.52)
  assert.equal(modeGroupFor("usb"), "phone")
  assert.equal(modeGroupFor("FT8"), "digital")
  assert.equal(modeGroupFor("AllStar"), "dmr")
})

test("a prefixed or suffixed call is its base call", () => {
  assert.equal(baseCall("VE3/K2ABC/P"), "K2ABC")
  assert.equal(baseCall("ko4efs/m"), "KO4EFS")
  assert.equal(baseCall("VP2E/W1AW"), "W1AW")
  assert.equal(baseCall("/"), null)
})

const HOSTS = JSON.stringify({
  hosts: [
    { id: "k4swl", call: "K4SWL", name: "Thomas", kind: "host", powerClass: "qrp", pointsOverride: null },
    { id: "w1aw", call: "W1AW", name: "Wildcard", kind: "wildcard", powerClass: "100w", pointsOverride: 6.52 },
    { id: "bad", call: "N0PE", powerClass: "lots" },
  ],
})

test("the host list keeps what it can read and matches calls by their base", () => {
  const table = new HostTable(parseHosts(HOSTS))
  assert.equal(table.size, 2)
  assert.equal(table.forCall("K4SWL/P")?.id, "k4swl")
  assert.equal(table.forCall("w1aw")?.pointsOverride, 6.52)
  assert.equal(table.forCall("N0PE"), undefined)
  assert.throws(() => parseHosts("<html>"), /not a list/)
})

test("the event's hours count five minutes either side", () => {
  const event = parseEvent(JSON.stringify({ event: { name: "HRWBOTA 2026", startsAt: "2026-11-21T18:00:00Z", endsAt: "2026-11-21T21:00:00Z" } }))
  assert.ok(event)
  assert.equal(inEvent(event, Date.UTC(2026, 10, 21, 17, 56)), true)
  assert.equal(inEvent(event, Date.UTC(2026, 10, 21, 17, 54)), false)
  assert.equal(inEvent(event, Date.UTC(2026, 10, 21, 21, 4)), true)
  assert.equal(inEvent(undefined, 0), true)
})

test("points read for the mode being worked, or all of them", () => {
  const points = { cw: 8, phone: 4, digital: 4, dmr: 2 }
  assert.equal(pointsLabel(points, "CW"), "8 pts CW")
  assert.equal(pointsLabel(points, "USB"), "4 pts SSB")
  assert.equal(pointsLabel(points, undefined), "8 CW · 4 SSB · 4 DIGI · 2 DMR")
  assert.equal(pointsLabel({ cw: 6.52, phone: 6.52, digital: 6.52, dmr: 6.52 }, undefined), "6.52 pts")
})

test("spots carry the host's frequency, mode, refs and points; a host without a frequency is no spot", () => {
  const body = JSON.stringify({
    spots: [
      {
        hostId: "k4swl", call: "K4SWL", kind: "host", frequencyKhz: 7030.5, band: "40m", mode: "CW", note: "QRS",
        refs: [{ type: "pota", ref: "US-2093" }], points: { cw: 8, phone: 4, digital: 4, dmr: 2 }, updatedAt: "2026-11-21T18:40:12.481Z",
      },
      { hostId: "kj6vu", call: "KJ6VU", kind: "host", frequencyKhz: null, mode: "DMR", channel: "TG 3100", points: {}, updatedAt: "2026-11-21T18:40:12.481Z" },
    ],
  })
  const spots = parseSpots(body, "HRWBOTA")
  assert.equal(spots.length, 1)
  assert.deepEqual(spots[0].their, { call: "K4SWL" })
  assert.equal(spots[0].freq, 7030.5)
  assert.equal(spots[0].mode, "CW")
  assert.deepEqual(spots[0].refs, [{ type: "pota", ref: "US-2093" }])
  assert.equal(spots[0].spot.label, "HRWBOTA 8 pts CW · QRS")
  assert.equal(spots[0].spot.source, "hrwbota")
  assert.equal(spots[0].spot.timeInMillis, Date.parse("2026-11-21T18:40:12.481Z"))
})
