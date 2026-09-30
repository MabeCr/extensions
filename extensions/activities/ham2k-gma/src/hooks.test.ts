// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// GMA through its HOOKS, the way the app calls them. GMA is a HUNTING program
// — a QSO carries the summits the OTHER station was on — so the traps here are
// the ones that side has: a hunted summit that never reaches the export, several
// summits split into records the award would count twice, a summit list that
// resurrects retired summits, a spot posted in a shape cqgma.org cannot read,
// and an ADIF import that claims another program's summit as GMA's.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

interface FetchParams {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
}

let sent: FetchParams[] = []

const gma = await loadExtension(() => import("./index.ts"), {
  hostCalls: {
    fetch: (params) => {
      sent.push(params as unknown as FetchParams)
      return { status: 200, body: "OK" }
    },
  },
})

type Field = { name: string; value: string }

const hunting = (...refs: string[]) => ({ their: { call: "W1AW" }, refs: refs.map((ref) => ({ type: "gma", ref })) })

test("the hunting control is keyed for search scoping and takes several summits", async () => {
  // The key's part before the slash is the search scope the core derives, and
  // the ref type is the QSO's HUNTING type — the activation type here would
  // record the other station's summit as one we activated.
  const controls = (await gma.runHook("activity", "loggingControls", { operation: { uuid: "op" } })) as {
    key: string
    allowsMultiple?: boolean
    input: { refType: string }
  }[]
  assert.equal(controls.length, 1)
  assert.equal(controls[0].key, "gma/hunter")
  assert.equal(controls[0].input.refType, "gma")
  assert.equal(controls[0].allowsMultiple, true)
})

test("hunted summits reach the export as SIG/SIG_INFO beside our own", async () => {
  // GMA names no `*_REF` field of its own, so SIG/SIG_INFO is the only place a
  // hunted summit can reach the award's log checker.
  const fields = (await gma.runHook("adifFields", "fieldsForOneQSO", {
    qso: hunting("DL/AL-001"),
    operation: { refs: [{ type: "gmaActivation", ref: "DL/AL-999" }] },
  })) as Field[]
  assert.deepEqual(fields.map((f) => f.name), ["SIG", "SIG_INFO", "MY_SIG", "MY_SIG_INFO"])
  assert.deepEqual(fields.map((f) => f.value), ["GMA", "DL/AL-001", "GMA", "DL/AL-999"])
})

test("several hunted summits are joined into one record rather than split", async () => {
  // POTA and MOTA submit one record per reference; GMA names them all in one.
  // Declaring per-reference combinations would make the exporter write the
  // contact once per summit, and the award would count it that many times.
  const hook = gma.hooks.find((h) => h.category === "adifFields")!.hook
  assert.equal(typeof hook.fieldCombinationsForOneQSO, "undefined")

  const fields = (await gma.runHook("adifFields", "fieldsForOneQSO", {
    qso: hunting("DL/AL-001", "DL/AL-002"),
    operation: { refs: [] },
  })) as Field[]
  assert.equal(fields.find((f) => f.name === "SIG_INFO")?.value, "DL/AL-001,DL/AL-002")
})

test("spotting somebody else is offered for a QSO carrying a summit, and only then", async () => {
  const enabled = async (refs: unknown[]) =>
    ((await gma.runHook("spots", "isOtherSpotEnabled", { qso: { refs } })) as { enabled: boolean }).enabled
  assert.equal(await enabled([{ type: "gma", ref: "DL/AL-001" }]), true)
  assert.equal(await enabled([]), false)
})

// The summit list, fed rows in the shape cqgma.org's CSV has, with names.
const mapSummits = (rows: Record<string, string>[]) => {
  const hook = gma.hooks.find((h) => h.category === "dataFile" && h.key === "ham2k-gma-all-summits")!.hook
  const mapper = hook.csvToLookupEntry as (row: Record<string, string>) => any
  return rows.map((row) => mapper(row)).filter((entry) => entry !== null && entry !== undefined)
}

test("a live summit keeps its association prefix, altitude, and a lower-cased locator tail", () => {
  const [entry, ...rest] = mapSummits([
    { Reference: "DL/AL-001", Name: "Zugspitze", Latitude: "47.4211", Longitude: "10.9853", "Maidenhead Locator": "JN57AK", "Height (m)": "2962", deleted: "0" },
  ])
  assert.equal(rest.length, 0)
  assert.equal(entry.key, "DL/AL-001")
  // The prefix is how an operator narrows a search to their own country.
  assert.equal(entry.subCategory, "DL")
  // Published upper-case; the rest of HaLo compares grids as plain strings
  // with the tail lower-case, so an unconverted locator matches nothing.
  assert.equal(entry.data.grid, "JN57ak")
  assert.equal(entry.data.altitude, 2962)
})

test("a summit the list has retired is dropped, not stored", () => {
  const entries = mapSummits([
    { Reference: "DL/AL-001", Name: "Live", Latitude: "47.4", Longitude: "10.9", deleted: "0" },
    { Reference: "DL/AL-002", Name: "Retired", Latitude: "47.4", Longitude: "10.9", deleted: "1" },
  ])
  assert.deepEqual(entries.map((e) => e.key), ["DL/AL-001"])
})

test("a summit with no published locator gets one from its coordinates", () => {
  const [entry] = mapSummits([
    { Reference: "UNM-SH001", Name: "No locator", Latitude: "47.4211", Longitude: "10.9853", "Maidenhead Locator": "", deleted: "0" },
  ])
  assert.ok(String(entry.data.grid).startsWith("JN57"), `derived ${entry.data.grid}`)
  // The UNM series follows no prefix rule, so the whole reference is its own scope.
  assert.equal(entry.subCategory, "UNM-SH001")
})

// cqgma.org's spot endpoint takes a form POST. QuickJS has no
// URLSearchParams, so the body is encoded by hand — and every award built on
// this endpoint posts through the same encoder.
const post = async (method: string, args: Record<string, unknown>) => {
  sent = []
  return (await gma.runHook("spots", method, args)) as { ok: boolean; message?: string }
}

test("a self-spot posts a form body, spaces as '+'", async () => {
  const result = await post("postSelfSpot", {
    operation: { stationCall: "DL1ABC", refs: [{ type: "gmaActivation", ref: "DL/AL-001" }] },
    freq: 14285,
    mode: "SSB",
    comment: "up 5",
  })
  assert.equal(result.ok, true)
  assert.equal(sent.length, 1)
  assert.match(sent[0].headers?.["Content-Type"] ?? "", /application\/x-www-form-urlencoded/)
  const body = sent[0].body ?? ""
  assert.ok(body.includes("ycall=DL1ABC"), body)
  assert.ok(body.includes("yreference=DL%2FAL-001"), body)
  assert.ok(body.includes("ycomment=up+5"), body)
  assert.ok(body.includes("B1=Submit"), body)
})

test("the endpoint takes one reference, so the rest are named in the comment", async () => {
  await post("postSelfSpot", {
    operation: { stationCall: "DL1ABC", refs: [{ type: "gmaActivation", ref: "DL/AL-001" }, { type: "gmaActivation", ref: "DL/AL-002" }] },
    freq: 14285,
  })
  const body = sent[0].body ?? ""
  assert.ok(body.includes("yreference=DL%2FAL-001"), body)
  assert.ok(body.includes("also+DL%2FAL-002"), body)
})

test("an empty callsign of our own falls back to the spotter we were handed", async () => {
  // The core hands over '' as readily as it omits a key, and `'' ?? fallback`
  // is ''. An empty `yspotter=` reads on the cluster as a spot nobody sent.
  const spotterFor = async (our: Record<string, string> | undefined) => {
    await post("postOtherSpot", {
      qso: { their: { call: "M0XYZ" }, ...(our ? { our } : {}), freq: 7120, mode: "SSB", refs: [{ type: "gma", ref: "DL/AL-001" }] },
      spotterCall: "DL1ABC",
    })
    return /(?:^|&)yspotter=([^&]*)/.exec(sent[0].body ?? "")?.[1]
  }
  assert.equal(await spotterFor(undefined), "DL1ABC")
  assert.equal(await spotterFor({ call: "" }), "DL1ABC")
  assert.equal(await spotterFor({ call: "  " }), "DL1ABC")
  assert.equal(await spotterFor({ call: "G1ABC" }), "G1ABC")
})

test("a QSO with no callsign is refused rather than spotted blank", async () => {
  // An empty `ycall` reaches everybody watching the cluster.
  const result = await post("postOtherSpot", {
    qso: { their: { call: "" }, freq: 7120, refs: [{ type: "gma", ref: "DL/AL-001" }] },
    spotterCall: "DL1ABC",
  })
  assert.equal(result.ok, false)
  assert.equal(sent.length, 0)
})

// ADIF import. The parser produces no references, so this hook is all that
// makes an imported GMA log a GMA log — and every program writes the same
// SIG/MY_SIG pair, so reading it without checking WHOSE it is invents
// references on foreign records.
const importOne = async (fields: Record<string, string>) =>
  ((await gma.runHook("adifImport", "refsForRecords", { records: [{ fields }] })) as unknown[])[0]

test("reads the activation it wrote, whatever its case", async () => {
  const expected = { refs: [{ type: "gmaActivation", ref: "DL/AL-001", for: "operation" }] }
  assert.deepEqual(await importOne({ my_sig: "GMA", my_sig_info: "DL/AL-001" }), expected)
  // Ref types are compared as strings downstream; an unnormalized reference matches nothing.
  assert.deepEqual(await importOne({ my_sig: "gma", my_sig_info: "dl/al-001" }), expected)
})

test("reads the other station's summit too", async () => {
  assert.deepEqual(await importOne({ sig: "GMA", sig_info: "DL/AL-001", my_sig: "GMA", my_sig_info: "DL/AL-001" }), {
    refs: [
      { type: "gma", ref: "DL/AL-001" },
      { type: "gmaActivation", ref: "DL/AL-001", for: "operation" },
    ],
  })
})

test("declines a record whose SIG names another program, even for a summit of its own shape", async () => {
  // The reference is GMA-shaped on purpose: a foreign-looking one would be
  // turned away before the SIG was ever consulted.
  assert.equal(await importOne({ sig: "POTA", sig_info: "DL/AL-001", my_sig: "POTA", my_sig_info: "DL/AL-001" }), null)
  // GMA's pattern accepts every SOTA summit, so the SIG is the only thing
  // keeping a SOTA log from importing as GMA as well.
  assert.equal(await importOne({ sig: "SOTA", sig_info: "W2/GC-001", sota_ref: "W2/GC-001" }), null)
})

test("keeps a reference that does not match its pattern", async () => {
  // The pattern flags a bad reference when it is decorated; it does not decide
  // whether the operator's text survives the import.
  assert.deepEqual(await importOne({ my_sig: "GMA", my_sig_info: "not a reference" }), {
    refs: [{ type: "gmaActivation", ref: "NOT A REFERENCE", for: "operation" }],
  })
})
