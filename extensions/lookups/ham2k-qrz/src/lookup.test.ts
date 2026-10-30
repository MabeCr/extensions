// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// What a QRZ answer contributes to the guess. The app's ADIF export writes
// EMAIL, CNTY, CQZ and ITUZ from the guess, so a field this hook drops never
// reaches a logbook file however the export is configured.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

let answer = ""

const qrz = await loadExtension(() => import("./index.ts"), {
  hostCalls: { fetch: () => ({ status: 200, body: answer }) },
  ctx: { online: true, account: { session: { sessionKey: "test-session" } } } as never,
})

const lookup = async (call: string) => ((await qrz.runHook("lookup", "lookupCall", { callInfo: { call }, qso: {}, operation: {} })) as any[])[0]

const record = (fields: string) =>
  `<?xml version="1.0" ?><QRZDatabase><Callsign><call>W1AW</call><fname>Hiram</fname><name>Maxim</name>${fields}</Callsign><Session><Key>test-session</Key></Session></QRZDatabase>`

const SUBSCRIBER_FIELDS =
  "<addr1>225 Main St</addr1><addr2>Newington</addr2><state>CT</state><zip>06111</zip><county>Hartford</county>" +
  "<cqzone>5</cqzone><ituzone>8</ituzone><GMTOffset>-5</GMTOffset><DST>Y</DST>" +
  "<email>w1aw@example.org</email><qslmgr>via LoTW</qslmgr><url>https://www.arrl.org/w1aw</url>"

test("a subscriber record's station details land on the result", async () => {
  answer = record(SUBSCRIBER_FIELDS)
  const result = await lookup("W1AW")
  assert.equal(result.email, "w1aw@example.org")
  assert.equal(result.street, "225 Main St")
  // A string: a ZIP+4, a Canadian or UK postcode, and a leading zero are all postal codes.
  assert.strictEqual(result.postal, "06111")
  assert.equal(result.county, "Hartford")
  assert.equal(result.qslVia, "via LoTW")
  assert.equal(result.url, "https://www.arrl.org/w1aw")
})

// The zones are numbers on the guess, as the ADIF importer writes them; a
// string "5" would fail the QSO's type normalization and be dropped.
test("the zones arrive as numbers", async () => {
  answer = record(SUBSCRIBER_FIELDS)
  const result = await lookup("W1AW")
  assert.strictEqual(result.cqZone, 5)
  assert.strictEqual(result.ituZone, 8)
})

// Mutation trap: the country file's own offsets are west-positive, and
// copying that convention here would make "GMT+5" of a station in New England.
test("the UTC offset keeps its ordinary sign", async () => {
  answer = record(SUBSCRIBER_FIELDS)
  assert.equal((await lookup("W1AW")).tz, "GMT-5")
  answer = record("<GMTOffset>5.5</GMTOffset>")
  assert.equal((await lookup("W1AW")).tz, "GMT+5.5")
})

test("a record without them — a free-tier answer, or a profile that hides them — carries none", async () => {
  answer = record("<email></email><cqzone></cqzone>")
  const result = await lookup("W1AW")
  for (const field of ["email", "street", "postal", "county", "cqZone", "ituZone", "tz", "qslVia", "url"]) {
    assert.equal(result[field], undefined, field)
  }
})
