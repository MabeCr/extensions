// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// What a contact claims for WAS. A wrong state, holder or slot puts a line
// on the wrong checklist, or sends the operator after a state they have.

import { test } from "node:test"
import assert from "node:assert/strict"

import type { JSONValue, QsoClaim } from "@ham2k/extension-sdk"

import { wasProgram } from "./program.ts"

const ctx = { locale: "en" } as Parameters<NonNullable<typeof wasProgram.summarizeClaims>>[1]

function qso(extra: Record<string, JSONValue> = {}): Record<string, JSONValue> {
  return { uuid: "q1", our: { call: "KI2D", grid: "FN31pr" }, their: { call: "W1AW", state: "CT" }, band: "20m", mode: "CW", ...extra }
}

function claims(contact: Record<string, JSONValue>): QsoClaim[] {
  return (wasProgram.claimsForQsos({ qsos: [contact] }, ctx) as Record<string, QsoClaim[]>).q1 ?? []
}

const mixed = (contact: Record<string, JSONValue>) => claims(contact).find((claim) => claim.band === null && claim.mode === null)

test("the program describes itself as data, and stands in for scoring's new-state notice", () => {
  assert.equal(wasProgram.program.refLabel, "State")
  assert.deepEqual(wasProgram.program.supersedes, ["newState"])
  assert.equal(wasProgram.program.editions, "lifetime")
})

test("a contact with a state claims it for Mixed, on its band and in its mode", () => {
  assert.deepEqual(claims(qso()), [
    { holder: "KI2D@FN31", ref: "CT", label: "Connecticut", band: null, mode: null, level: "worked" },
    { holder: "KI2D@FN31", ref: "CT", label: "Connecticut", band: "20m", mode: null, level: "worked" },
    { holder: "KI2D@FN31", ref: "CT", label: "Connecticut", band: null, mode: "CW", level: "worked" },
  ])
})

// ARRL counts contacts made within 50 miles of one place: the square stands
// in for it. Portable from home is one checklist, from another square another.
test("the holder is the base call in the square the contact was made from", () => {
  assert.equal(mixed(qso({ our: { call: "KI2D/P", grid: "FN31ab" } }))?.holder, "KI2D@FN31")
  assert.equal(mixed(qso({ our: { call: "KI2D", grid: "EM12" } }))?.holder, "KI2D@EM12")
  assert.equal(mixed(qso({ our: { call: "KI2D" } }))?.holder, "KI2D", "a contact that says nothing of where it was")
  // A coordinate outranks the grid stamped beside it.
  assert.equal(mixed(qso({ our: { call: "KI2D", grid: "FN31", lat: 32.7, lon: -96.8 } }))?.holder, "KI2D@EM12")
  assert.equal(mixed(qso({ our: { call: "KI2D", grid: "FN31", lat: 95, lon: 200 } }))?.holder, "KI2D@FN31", "a coordinate that makes no square")
})

test("holdersFor names the station's checklist the same way its contacts do", async () => {
  assert.deepEqual(await wasProgram.holdersFor({ station: { call: "ki2d", grid: "FN31pr" } }, ctx), ["KI2D@FN31"])
  assert.deepEqual(await wasProgram.holdersFor({ station: { call: "" } }, ctx), [])
})

// A lookup's state is where the station usually is; one operating away from
// home is somewhere else, so the spot reads "probably new".
test("a state from the lookup is a guess, one the contact records is not", () => {
  assert.equal(mixed(qso())?.guess, undefined)
  const guessed = mixed(qso({ their: { call: "W1AW", guess: { state: "CT" } } }))
  assert.equal(guessed?.ref, "CT")
  assert.equal(guessed?.guess, true)
  assert.equal(mixed(qso({ their: { call: "W1AW", state: "ct", guess: { state: "NY" } } }))?.ref, "CT", "the contact's own state outranks the lookup's")
})

test("DC counts for Maryland, and nothing else that is not a state claims", () => {
  assert.equal(mixed(qso({ their: { call: "W3AA", state: "DC" } }))?.ref, "MD")
  assert.deepEqual(claims(qso({ their: { call: "W1AW", state: "PR" } })), [])
  assert.deepEqual(claims(qso({ their: { call: "W1AW" } })), [], "no state at all")
  // A Canadian province code, or a Mexican state that shares a US one, is
  // not a US state: only the three US entities have states.
  assert.deepEqual(claims(qso({ their: { call: "VE3AAA", state: "ON" } })), [])
  assert.deepEqual(claims(qso({ their: { call: "XE1AAA", state: "CA" } })), [])
})

test("Alaska and Hawaii are their entity, whatever the state field says", () => {
  assert.equal(mixed(qso({ their: { call: "KH6AA" } }))?.ref, "HI")
  assert.equal(mixed(qso({ their: { call: "KL7AA", state: "WA" } }))?.ref, "AK")
  assert.equal(mixed(qso({ their: { call: "KL7AA", dxccCode: 291, state: "WA" } }))?.ref, "WA", "the entity the contact records outranks its callsign's")
})

test("FT8 and RTTY claim their own endorsement beside the digital group", () => {
  const modes = (mode: string) => claims(qso({ mode })).flatMap((claim) => (claim.mode ? [claim.mode] : []))
  assert.deepEqual(modes("FT8"), ["DIGITAL", "FT8"])
  assert.deepEqual(modes("RTTY"), ["DIGITAL", "RTTY"])
  assert.deepEqual(modes("FT4"), ["DIGITAL"])
  assert.deepEqual(modes("SSB"), ["PHONE"])
  assert.deepEqual(modes("BOGUS"), [], "an unknown mode is no group at all, not digital")
})

test("a LoTW or paper QSL confirms, and a credit verifies only the awards it lists", () => {
  assert.equal(mixed(qso({ qsl: { lotw: { received: true } } }))?.level, "confirmed")
  assert.equal(mixed(qso({ qsl: { eqsl: { received: true } } }))?.level, "worked", "ARRL does not take eQSL")
  const credited = claims(qso({ qsl: { lotw: { received: true } }, credits: { "ham2k-was": { level: "verified", by: "lotw", awards: ["WAS_BAND"] } } }))
  assert.deepEqual(
    credited.map((claim) => [claim.band ?? claim.mode ?? "mixed", claim.level]),
    [
      ["mixed", "confirmed"],
      ["20m", "verified"],
      ["CW", "confirmed"],
    ],
  )
})

test("event markers claim nothing", () => {
  assert.deepEqual(claims(qso({ band: "event", their: { call: "START", state: "CT" } })), [])
})

test("the tally counts states and how many of them are confirmed", async () => {
  const slot = (ref: string, level: QsoClaim["level"]) => ({ holder: "KI2D@FN31", ref, band: null, mode: null, level }) as never
  const tally = await wasProgram.summarizeClaims({ holder: "KI2D@FN31", edition: "", slots: [slot("CT", "confirmed"), slot("NY", "worked")] }, ctx)
  assert.equal(tally.states.label, "2 States")
  assert.equal(tally.states.summary, "1 confirmed")
})
