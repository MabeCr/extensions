// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// SOTA's ADIF, both ways, through its hooks.
//
// Import: the core parser produces no references, so `refsForRecords` is all
// that keeps an imported SOTA log attached to its summits. SOTA's own exporter
// writes SOTA_REF/MY_SOTA_REF and no SIG, other software writes SIG/SIG_INFO,
// and every reference program writes that same SIG pair — so a hook that
// requires a SIG reads none of SOTA's own files, and one that ignores WHOSE
// SIG it is invents summits on another program's records.
//
// Export: in SOTA's own file its grids outrank the contact's, so they have to
// read a location by the same rules the rest of the log does — a real
// coordinate over a stored grid, and never a coordinate that is only a
// square's center or a country's centroid. grid.test.ts pins those rules on
// the function; these pin that the hook applies them, and only in SOTA's own
// file.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

const sota = await loadExtension(() => import("./index.ts"))

const refsFor = async (fields: Record<string, string>) => {
  const [result] = (await sota.runHook("adifImport", "refsForRecords", { records: [{ fields }] })) as ({ refs: unknown[] } | null)[]
  return result?.refs ?? null
}

test("reads its own SOTA_REF, which carries no SIG at all", async () => {
  assert.deepEqual(await refsFor({ sota_ref: "W2/GC-001", my_sota_ref: "G/LD-001" }), [
    { type: "sota", ref: "W2/GC-001" },
    // ADIF flattens an activation onto every record; the hook sees one record,
    // so it has to say the summit belongs to the operation.
    { type: "sotaActivation", ref: "G/LD-001", for: "operation" },
  ])
})

test("reads a summit other software wrote as SIG_INFO, normalized", async () => {
  // Ref types are compared as strings downstream; a lower-case summit matches
  // nothing.
  assert.deepEqual(await refsFor({ sig: "SOTA", sig_info: "w2/gc-001" }), [{ type: "sota", ref: "W2/GC-001" }])
})

test("merges SOTA_REF and SIG_INFO rather than preferring either", async () => {
  // A file passed through two tools can carry both spellings, each naming a
  // summit; preferring one loses the other.
  assert.deepEqual(await refsFor({ sota_ref: "W2/GC-001", sig: "SOTA", sig_info: "W2/GC-002" }), [
    { type: "sota", ref: "W2/GC-001" },
    { type: "sota", ref: "W2/GC-002" },
  ])
})

test("the same summit in both fields lands once", async () => {
  assert.deepEqual(await refsFor({ sota_ref: "W2/GC-001", sig: "SOTA", sig_info: "w2/gc-001" }), [{ type: "sota", ref: "W2/GC-001" }])
})

test("reads the activation side from MY_SIG when MY_SOTA_REF is absent", async () => {
  assert.deepEqual(await refsFor({ sota_ref: "W2/GC-001", my_sig: "SOTA", my_sig_info: "G/LD-001" }), [
    { type: "sota", ref: "W2/GC-001" },
    { type: "sotaActivation", ref: "G/LD-001", for: "operation" },
  ])
})

test("leaves a POTA record alone, even one whose SIG_INFO looks like a summit", async () => {
  // A well-formed SUMMIT under POTA's SIG is the only shape that reaches the
  // SIG guard: a park reference would be turned away by SOTA's pattern first,
  // and the test would pass with the guard deleted.
  assert.equal(await refsFor({ sig: "POTA", sig_info: "W2/GC-001", pota_ref: "K-1467" }), null)
})

const grids = async (qso: Record<string, unknown>, operation: Record<string, unknown>, mainHandler = true) => {
  const fields = (await sota.runHook("adifFields", "fieldsForOneQSO", { qso, operation, mainHandler })) as { name: string; value: string }[]
  return Object.fromEntries(fields.map((f) => [f.name, f.value]))
}

const activation = { uuid: "op", stationCall: "N0DEV", refs: [{ type: "sotaActivation", ref: "W1/HA-001" }] }

test("SOTA's file derives both grids from a real coordinate, not the stored string", async () => {
  // What an ADIF import leaves: a coarse MY_GRIDSQUARE beside the MY_LAT/MY_LON
  // the record carried. Cutting the stored string writes the four-character
  // square beside a fix; reading only `grid` gives a station known by its
  // coordinate no GRIDSQUARE at all.
  const fields = await grids(
    { our: { call: "N0DEV", grid: "FN21", lat: 41.7135, lon: -72.7278 }, their: { call: "W0ABC", lat: 39.7589, lon: -84.1916 } },
    activation,
  )
  assert.equal(fields.MY_GRIDSQUARE, "FN31pr")
  assert.equal(fields.GRIDSQUARE, "EM79vs")
})

test("SOTA's file keeps the pairs that are no coordinate out of its grids", async () => {
  // Our typed square stored beside its own center.
  const operation = { ...activation, grid: "FN21", lat: 41.5, lon: -75.0 }
  // A center restates its square; it does not refine it.
  const center = await grids({ their: { call: "W1CTR", grid: "FN31", lat: 41.5, lon: -73.0 } }, operation)
  assert.equal(center.GRIDSQUARE, "FN31")
  assert.equal(center.MY_GRIDSQUARE, "FN21")
  // A synced guess carrying cty.dat's WEST-POSITIVE DXCC centroid: read as a
  // coordinate it is somewhere in China.
  const prefix = await grids({ their: { call: "W2PFX", guess: { grid: "FN31pr", lat: 37.6, lon: 91.87, locSource: "prefix" } } }, operation)
  assert.equal(prefix.GRIDSQUARE, "FN31pr")
  // A typed square correcting a lookup's pair that points elsewhere.
  const typed = await grids({ their: { call: "W3FIX", grid: "EM79", guess: { lat: 41.7135, lon: -72.7278 } } }, operation)
  assert.equal(typed.GRIDSQUARE, "EM79")
})

test("the grids ride only in SOTA's own file", async () => {
  // The full ADIF export leaves grids to the contact's own fields and their
  // privacy rules; SOTA's always-on grids there would publish our location
  // past the operator's private-data switch.
  const fields = await grids({ our: { call: "N0DEV", lat: 41.7135, lon: -72.7278 }, their: { call: "W0ABC", lat: 39.7589, lon: -84.1916 } }, activation, false)
  assert.deepEqual(fields, { MY_SOTA_REF: "W1/HA-001" })
})
