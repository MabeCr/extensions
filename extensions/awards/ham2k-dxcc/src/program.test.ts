// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// What a contact claims for DXCC. Callsigns resolve against the bundled
// country file: W1AW is the US (291), DL1ABC Germany (230), KI2D/VE2 is KI2D
// operating from Canada (1). A wrong holder or slot puts a line on the wrong
// checklist, or sends the operator after an entity they have.

import { test } from "node:test"
import assert from "node:assert/strict"

import type { ClaimSlot, JSONValue, QsoClaim } from "@ham2k/extension-sdk"

import { dxccProgram } from "./program.ts"
import type { ChasingProgramWithNotices } from "./sdkGap.ts"

const ctx = { locale: "en" } as Parameters<typeof dxccProgram.summarizeClaims>[1]

function qso(uuid: string, extra: Record<string, JSONValue> = {}): Record<string, JSONValue> {
  return { uuid, our: { call: "KI2D" }, their: { call: "DL1ABC" }, band: "20m", mode: "CW", startAtMillis: 0, ...extra }
}

function claims(...qsos: Record<string, JSONValue>[]): Record<string, QsoClaim[]> {
  return dxccProgram.claimsForQsos({ qsos }, ctx) as Record<string, QsoClaim[]>
}

test("the program describes itself as data, and words its own notices", () => {
  const program = dxccProgram.program as ChasingProgramWithNotices
  assert.equal(program.label, "DXCC")
  assert.equal(program.editions, "lifetime")
  assert.deepEqual(program.supersedes, ["newDXCC"])
  assert.deepEqual(program.notices, { newRef: "DXCC ATNO", newMode: "DXCC in {{mode}}", newBand: "DXCC in {{band}}" })
  assert.equal(program.modeLabels?.PHONE, "Phone")
  assert.deepEqual(program.translations?.es?.notices, { newRef: "DXCC ATNO", newMode: "DXCC en {{mode}}", newBand: "DXCC en {{band}}" })
  assert.equal(program.translations?.es?.modeLabels?.PHONE, "Fonía")
})

// Mixed, mode and band are three checklists: working Germany on 40m after
// 20m is nothing new for Mixed and a new slot for 40m.
test("a contact claims its entity for Mixed, in its mode group and on its band", () => {
  const { q1 } = claims(qso("q1"))
  assert.deepEqual(
    q1.map(({ band, mode }) => [band, mode]),
    [
      [null, null],
      [null, "CW"],
      ["20m", null],
    ],
  )
  assert.ok(q1.every((claim) => claim.ref === "230" && claim.label === "Germany" && claim.level === "worked"))
})

test("modes group into the three DXCC mode awards, and an unknown mode claims no mode slot", () => {
  const answer = claims(qso("ssb", { mode: "USB" }), qso("ft8", { mode: "FT8" }), qso("other", { mode: "" }))
  const modes = (uuid: string) => answer[uuid].map((claim) => claim.mode).filter((mode) => mode !== null)
  assert.deepEqual(modes("ssb"), ["PHONE"])
  assert.deepEqual(modes("ft8"), ["DIGITAL"])
  assert.deepEqual(modes("other"), [], "superModeForMode calls an empty mode DATA; claiming it would invent a Digital contact")
})

test("every band claims its slot, the Challenge's or not, and a contact with no band claims none", () => {
  const bands = (extra: Record<string, JSONValue>) => claims(qso("q", extra)).q.flatMap((claim) => (claim.band ? [claim.band] : []))
  assert.deepEqual(bands({ band: "60m" }), ["60m"])
  assert.deepEqual(bands({ band: "2m" }), ["2m"])
  assert.deepEqual(bands({ band: "" }), [])
})

// The holder decides whose checklist a contact lands on: the same holders
// as the app's core `dxcc` program, so its checklist carries over.
test("KI2D and KI2D/P share a checklist, and KI2D/VE2 keeps its own", async () => {
  const answer = claims(qso("home"), qso("portable", { our: { call: "KI2D/P" } }), qso("abroad", { our: { call: "KI2D/VE2" } }))
  assert.equal(answer.home[0].holder, "KI2D@291")
  assert.equal(answer.portable[0].holder, "KI2D@291")
  assert.equal(answer.abroad[0].holder, "KI2D@1")
  assert.deepEqual(await dxccProgram.holdersFor({ station: { call: "KI2D/P" } }, ctx), ["KI2D@291"])
  assert.deepEqual(await dxccProgram.holdersFor({ station: { call: "KI2D", dxccCode: 110 } }, ctx), ["KI2D@110"])
  assert.deepEqual(await dxccProgram.holdersFor({ station: { call: "" } }, ctx), [], "a station with no call yet has no checklist")
})

test("LoTW and paper confirm, sponsor credit verifies, and eQSL counts for nothing", () => {
  const answer = claims(
    qso("lotw", { qsl: { received: true, lotw: { received: true } } }),
    qso("card", { qsl: { received: true, qsl: { received: true } } }),
    qso("eqsl", { qsl: { received: true, eqsl: { received: true } } }),
    qso("credited", { credits: { dxcc: { level: "verified", by: "lotw" } } }),
    qso("credited-somehow", { credits: { dxcc: { level: "verified" } } }),
  )
  assert.deepEqual([answer.lotw[0].level, answer.lotw[0].by], ["confirmed", "lotw"])
  assert.deepEqual([answer.card[0].level, answer.card[0].by], ["confirmed", "qsl"])
  assert.equal(answer.eqsl[0].level, "worked")
  assert.deepEqual([answer.credited[0].level, answer.credited[0].by], ["verified", "lotw"])
  assert.deepEqual([answer["credited-somehow"][0].level, answer["credited-somehow"][0].by], ["verified", undefined])
})

// ARRL credits Mixed, band and mode separately: a contact credited only for
// 20m still needs a QSL to count as confirmed toward Mixed.
test("a credit that lists its awards verifies only the slots it was granted for", () => {
  const answer = claims(qso("band-only", { qsl: { lotw: { received: true } }, credits: { dxcc: { level: "verified", by: "lotw", awards: ["DXCC_BAND"] } } }))
  assert.deepEqual(
    answer["band-only"].map((claim) => [claim.band ?? claim.mode ?? "mixed", claim.level]),
    [
      ["mixed", "confirmed"],
      ["CW", "confirmed"],
      ["20m", "verified"],
    ],
  )
})

// A log made from Hawaii under a mainland call records 110 where the call
// says 291, and an imported contact with a deleted entity records it where
// the call resolves to its successor. Re-deriving from the calls would file
// both on the wrong checklist line.
test("the entity a contact records outranks the one its callsign resolves to, and a lookup's is a guess", () => {
  const answer = claims(
    qso("hawaii", { our: { call: "KI2D", dxccCode: 110 } }),
    qso("ddr", { their: { call: "DL1ABC", dxccCode: 229 } }),
    qso("looked-up", { their: { call: "DL1ABC", guess: { dxccCode: 81 } } }),
    qso("agreed", { their: { call: "DL1ABC", guess: { dxccCode: 230 } } }),
  )
  assert.equal(answer.hawaii[0].holder, "KI2D@110")
  assert.equal(answer.ddr[0].ref, "229")
  assert.equal(answer.ddr[0].guess, undefined, "a recorded entity is not a guess")
  assert.equal(answer["looked-up"][0].ref, "81")
  assert.equal(answer["looked-up"][0].guess, true, "a lookup's entity is inferred, not reported")
  assert.equal(answer.agreed[0].guess, undefined, "a lookup repeating the callsign's entity infers nothing the callsign does not settle")
})

// One name per entity: a recorded code and a callsign would otherwise name
// Germany two ways, and a lookup's guessed entity would carry the name of
// the callsign's.
test("an entity is named the same however it was resolved", () => {
  const answer = claims(
    qso("call"),
    qso("stored", { their: { call: "DL1ABC", dxccCode: 230, entityName: "Fed. Rep. of Germany" } }),
    qso("guessed", { their: { call: "W1AW", entityName: "United States", guess: { dxccCode: 110 } } }),
  )
  assert.equal(answer.call[0].label, "Germany")
  assert.equal(answer.stored[0].label, "Germany")
  assert.deepEqual([answer.guessed[0].ref, answer.guessed[0].label], ["110", "Hawaii"])
})

// ADIF's code 0 is no entity, and a station at sea or in the air is in none
// whatever its prefix says: neither side's contacts count for DXCC.
test("maritime and aeronautical mobile, or a recorded code 0, claim nothing", async () => {
  const answer = claims(
    qso("their-mm", { their: { call: "W1AW/MM" } }),
    qso("their-am", { their: { call: "DL1ABC/AM" } }),
    qso("their-mm-region", { their: { call: "DL1ABC/MM2" } }),
    qso("their-mm-then", { their: { call: "W1AW/MM/R1" } }),
    qso("their-zero", { their: { call: "DL1ABC", dxccCode: 0 } }),
    qso("our-mm", { our: { call: "KI2D/MM" } }),
    qso("our-zero", { our: { call: "KI2D", dxccCode: 0 } }),
  )
  for (const [uuid, claimed] of Object.entries(answer)) assert.deepEqual(claimed, [], uuid)
  assert.deepEqual(await dxccProgram.holdersFor({ station: { call: "KI2D/MM" } }, ctx), [])
  assert.equal(claims(qso("guess-zero", { their: { call: "DL1ABC", guess: { dxccCode: 0 } } }))["guess-zero"][0].ref, "230", "a lookup's 0 says nothing the callsign does not")
})

test("a band claims one slot however the log spelled it", () => {
  assert.equal(claims(qso("upper", { band: "20M" })).upper[2].band, "20m")
})

test("a satellite contact claims Mixed and its mode, and no band", () => {
  const { sat } = claims(qso("sat", { band: "2m", mode: "FM", refs: [{ type: "satellite", ref: "SO-50/145.85/fm" }] }))
  assert.deepEqual(
    sat.map(({ band, mode }) => [band, mode]),
    [
      [null, null],
      [null, "PHONE"],
    ],
  )
})

// A marker's calls are placeholders — `EVENT` worked `START` — and resolve
// to real entities, so a marker passed along with a log would claim Sudan.
test("event markers, deleted contacts and contacts without a uuid claim nothing", () => {
  const answer = claims(qso("marker", { band: "event", our: { call: "EVENT" }, their: { call: "START" } }), qso("gone", { deleted: true }), qso(""))
  assert.deepEqual(answer, { marker: [], gone: [] })
  assert.deepEqual(claims(qso("nocall", { their: {} }), qso("nostation", { our: {} })), { nocall: [], nostation: [] })
})

const slot = (ref: string, band: string | null, mode: string | null, level: ClaimSlot["level"]): ClaimSlot => ({ ref, band, mode, level })

// Entities count once, from Mixed; the Challenge sums the band slots on its
// bands. The DDR (229) was deleted in 1990: it counts toward All, not Current.
test("the tallies count entities and the Challenge's band-entities, Current and All", async () => {
  const slots = [
    slot("230", null, null, "verified"),
    slot("230", null, "CW", "verified"),
    slot("230", "20m", null, "confirmed"),
    slot("230", "40m", null, "worked"),
    slot("230", "60m", null, "confirmed"),
    slot("291", null, null, "confirmed"),
    slot("291", "20m", null, "verified"),
    slot("1", null, null, "worked"),
    slot("229", null, null, "confirmed"),
    slot("229", "20m", null, "confirmed"),
  ]
  const { entities, challenge } = await dxccProgram.summarizeClaims({ holder: "KI2D@291", slots }, ctx)
  assert.deepEqual(
    [entities.label, entities.summary, entities.total, entities.current],
    ["DXCC: 3 Current, 4 All", "Confirmed: 2 Current, 3 All", 4, 3],
  )
  assert.deepEqual(
    [challenge.label, challenge.summary, challenge.total, challenge.current],
    ["Challenge: 3 Current, 4 All", "Confirmed: 2 Current, 3 All", 4, 3],
  )
  const es = await dxccProgram.summarizeClaims({ holder: "KI2D@291", slots }, { locale: "es" } as typeof ctx)
  assert.equal(es.entities.label, "DXCC: 3 actuales, 4 en total")
})
