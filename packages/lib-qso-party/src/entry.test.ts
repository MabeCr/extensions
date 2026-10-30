// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Which reference a party answers for. Its own type, and the pair the bundled
// extension wrote before there was one extension per event — those operations
// are not migrated, so every read has to find either shape.

import assert from "node:assert/strict"
import { test } from "node:test"

import { exchangeRefType, ourSerialOf, partyContactRefIn, partyRefIn, theirSerialOf } from "./entry.ts"
import type { Party } from "./party.ts"

function party(refType: string, legacyRefs?: { type: string; prefix: string }[]): Party {
  return { refType, legacyRefs, name: refType, short: refType, entryClasses: {} } as unknown as Party
}

const NY = party("ny-qso-party", [{ type: "qp", prefix: "ny" }])

test("a party finds a reference of its own type", () => {
  const operation = { refs: [{ type: "ny-qso-party", location: "ALB" }] }
  assert.equal(partyRefIn(NY, operation)?.location, "ALB")
})

test("a party reaches back for the pair the bundled extension wrote", () => {
  // The whole point: nothing rewrote this operation, and the party has to
  // drive it as it stands — location, entry class, exchange and all.
  const operation = { refs: [{ type: "qp", ref: "NY", location: "ALB" }] }
  assert.equal(partyRefIn(NY, operation)?.location, "ALB")
})

test("the code is matched case-folded, because it was hand-typed", () => {
  assert.ok(partyRefIn(NY, { refs: [{ type: "qp", ref: "ny" }] }))
  assert.ok(partyRefIn(NY, { refs: [{ type: "qp", ref: "Ny" }] }))
})

test("another party's legacy reference is not this one's", () => {
  // Fifty parties each claim `qp/<their own>`. Read as a claim on the bare
  // type, every one of them would answer for every other one's operations.
  assert.equal(partyRefIn(NY, { refs: [{ type: "qp", ref: "TX" }] }), undefined)
  // And a `qp` reference with no code at all begins no prefix.
  assert.equal(partyRefIn(NY, { refs: [{ type: "qp" }] }), undefined)
})

test("a prefix claim covers the codes filed under it", () => {
  assert.ok(partyRefIn(NY, { refs: [{ type: "qp", ref: "NY-ALB" }] }))
})

test("the party's own type wins where an operation carries both", () => {
  // An operation set up again under the current name. The entry class and
  // exchange the operator can see belong to that reference, not to the one
  // they last touched years ago.
  const operation = {
    refs: [
      { type: "qp", ref: "NY", location: "OLD" },
      { type: "ny-qso-party", location: "NEW" },
    ],
  }
  assert.equal(partyRefIn(NY, operation)?.location, "NEW")
})

test("a party with no legacy claims answers only for its own type", () => {
  const plain = party("cqww")
  assert.equal(partyRefIn(plain, { refs: [{ type: "qp", ref: "CQWW" }] }), undefined)
})

const LEGACY_NY = { refs: [{ type: "qp", ref: "NY", location: "ALB" }] }

test("a contact's code-less legacy ref is the party's when its operation claims it", () => {
  // The old extension and app-polo put the code on the operation only; each
  // contact carries a bare `{type: 'qp'}`. Read by code, every contact of
  // such a log has no exchange at all.
  assert.equal(partyContactRefIn(NY, { refs: [{ type: "qp", location: "ERI" }] }, LEGACY_NY)?.location, "ERI")
})

test("a contact's code-less legacy ref is not this party's under another party's operation", () => {
  // Every party is offered every `qp` operation; Texas's contacts must not
  // read as New York's because both are bare `qp`.
  const texas = { refs: [{ type: "qp", ref: "TX", location: "AUS" }] }
  assert.equal(partyContactRefIn(NY, { refs: [{ type: "qp", location: "TRAV" }] }, texas), undefined)
})

test("a legacy log the party was added to again by its current name still reads its old contacts", () => {
  // Adding the party from the activity search puts its own ref beside the old
  // one. Found through the operation's own-type ref, the claim is lost, and
  // every contact logged before reads as having no exchange again.
  const both = { refs: [...LEGACY_NY.refs, { type: "ny-qso-party", location: "ALB" }] }
  assert.equal(partyContactRefIn(NY, { refs: [{ type: "qp", location: "ERI" }] }, both)?.location, "ERI")
  // And the contacts logged from now on keep the old shape and its serials.
  assert.equal(exchangeRefType(NY, both), "qp")
})

test("a contact's legacy ref that names a code is read by that code", () => {
  // Coded contact refs are this party's under any operation, and another
  // party's code is never this one's, even under this party's operation.
  assert.equal(partyContactRefIn(NY, { refs: [{ type: "qp", ref: "NY", location: "ERI" }] }, { refs: [] })?.location, "ERI")
  assert.equal(partyContactRefIn(NY, { refs: [{ type: "qp", ref: "TX", location: "TRAV" }] }, LEGACY_NY), undefined)
})

test("a contact's own-type ref wins over its legacy one", () => {
  const qso = { refs: [{ type: "qp", location: "OLD" }, { type: "ny-qso-party", location: "NEW" }] }
  assert.equal(partyContactRefIn(NY, qso, LEGACY_NY)?.location, "NEW")
})

test("the exchange is written under the type the operation is logged under", () => {
  // Under the party's own type on a legacy operation, the core shows no
  // exchange field at all (it admits only a type the operation carries), and
  // a contact logged after the switch would not match the ones before it.
  assert.equal(exchangeRefType(NY, LEGACY_NY), "qp")
  assert.equal(exchangeRefType(NY, { refs: [{ type: "qp", ref: "TX" }] }), "ny-qso-party")
  assert.equal(exchangeRefType(NY, { refs: [{ type: "ny-qso-party" }] }), "ny-qso-party")
  assert.equal(exchangeRefType(NY, { refs: [] }), "ny-qso-party")
})

test("app-polo's serials are read under its own names", () => {
  // app-polo files the serials as `ourNumber`/`theirNumber`. Read under this
  // engine's names alone, a log kept there files 0 and -, and a save in HaLo
  // re-projects the exchange without the number.
  assert.equal(ourSerialOf({ ourNumber: "12" }), "12")
  assert.equal(theirSerialOf({ theirNumber: "34" }), "34")
  assert.equal(ourSerialOf({ ourSerial: 7, ourNumber: "12" }), "7")
  assert.equal(theirSerialOf({}), "")
})
