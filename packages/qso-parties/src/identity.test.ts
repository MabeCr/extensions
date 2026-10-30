// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The generated identities, held to the fixtures and to each other, and the
// two readers the spotting extensions share.

import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"

import { PARTY_IDENTITIES } from "./identities.ts"
import { locationsOf, partyOf } from "./identity.ts"
import { PARTIES } from "./index.ts"

const FIXTURES_DIR = join(import.meta.dirname, "..", "fixtures")

test("every party has one identity, and it agrees with the party's own module", () => {
  const byRefType = new Map(PARTY_IDENTITIES.map((identity) => [identity.refType, identity]))
  assert.equal(byRefType.size, PARTY_IDENTITIES.length, "two identities share a ref type")
  for (const [key, party] of Object.entries(PARTIES)) {
    const identity = byRefType.get(party.refType)
    assert.ok(identity, `${key} has no identity`)
    assert.equal(identity.short, party.short, key)
    assert.equal(identity.name, party.name, key)
    assert.equal(identity.legacyPrefix, key.toLowerCase(), key)
    assert.deepEqual(identity.periods, party.periods, `${key}'s identity runs on other dates than its rules`)
  }
})

/// The hub's own names where they are not the party's short, as its index at
/// qsopartyhub.com links them: [the page listing spots, the page taking one].
const HUB_NAMES: Record<string, [string, string]> = {
  CA: ["caqp", "cqp"],
  FL: ["flqp", "fqp"],
  HI: ["hiqp", "hqp"],
  MD: ["mdcqp", "mdcqp"],
  NS: ["nsqp", "nsqp"],
  WA: ["waqp", "wasr"],
}

test("the feed names come from the fixtures: the sponsor's APRS token and hub page where stated, the hub's own names where it differs, the party's own otherwise", () => {
  for (const file of readdirSync(FIXTURES_DIR).filter((name) => name.endsWith(".json"))) {
    const raw = JSON.parse(readFileSync(join(FIXTURES_DIR, file), "utf8"))
    const key = String(raw.key).toUpperCase()
    const identity = PARTY_IDENTITIES.find((i) => i.legacyPrefix === key.toLowerCase())!
    assert.ok(identity, key)
    assert.equal(identity.aprsShort, raw.aprsShort ?? identity.short, `${key} aprsShort`)
    const ownPage = raw.qsoPartyHubName ?? identity.short.toLowerCase()
    const [tablePage, spotPage] = HUB_NAMES[key] ?? [ownPage, ownPage]
    assert.equal(identity.hubTablePage, tablePage, `${key} hubTablePage`)
    assert.equal(identity.hubSpotPage, spotPage, `${key} hubSpotPage`)
    // The tracker files a state party under its state and a multi-state one
    // under its token; the Canadian parties are not on it at all.
    const canadian = raw.options?.entity?.toUpperCase() === "VE"
    assert.equal(identity.trackerCode, canadian ? undefined : (raw.aprsShort ?? key), `${key} trackerCode`)
  }
})

test("New England is NEWE on the air, because NEQP is Nebraska's short too", () => {
  const newEngland = PARTY_IDENTITIES.find((i) => i.legacyPrefix === "neqp")!
  const nebraska = PARTY_IDENTITIES.find((i) => i.legacyPrefix === "ne")!
  assert.equal(newEngland.short, nebraska.short)
  assert.equal(newEngland.aprsShort, "NEWE")
  assert.equal(newEngland.trackerCode, "NEWE")
  assert.equal(nebraska.trackerCode, "NE")
})

test("an operation's party is read off its own ref type, or the legacy qp pair by longest prefix", () => {
  const all = PARTY_IDENTITIES
  assert.equal(partyOf({ refs: [{ type: "neqp", location: "MAWOR" }] }, all)?.party.legacyPrefix, "neqp")
  // `NEQP` starts with Nebraska's `ne` too; the longer claim wins, both ways.
  assert.equal(partyOf({ refs: [{ type: "qp", ref: "NEQP", location: "MAWOR" }] }, all)?.party.legacyPrefix, "neqp")
  assert.equal(partyOf({ refs: [{ type: "qp", ref: "NE", location: "NELAN" }] }, all)?.party.legacyPrefix, "ne")
  assert.equal(partyOf({ refs: [{ type: "pota", ref: "US-0001" }] }, all), undefined)
  assert.equal(partyOf({}, all), undefined)
  // The ref handed back is the operation's own, location and all.
  assert.equal(partyOf({ refs: [{ type: "txqp", location: "TRAV" }] }, all)?.ref.location, "TRAV")
})

test("a county line is every county, with the shorthand's state filled in", () => {
  assert.deepEqual(locationsOf({ location: "MAWOR" }), ["MAWOR"])
  assert.deepEqual(locationsOf({ location: "ORDES/JEF" }), ["ORDES", "ORJEF"])
  assert.deepEqual(locationsOf({ location: "ordes, orjef" }), ["ORDES", "ORJEF"])
  assert.deepEqual(locationsOf({}), [])
})
