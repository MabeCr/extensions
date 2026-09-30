// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Satellite operations through their HOOKS: the ADIF an award reads, the
// import that reads it back, the feed mapper, the pickers and the SAT command.
//
// The birds below are copied from the real feed
// (polo.ham2k.com/data/satellites.json), not invented. AO-7 is here because it
// is the ONE bird whose two transponders answer on different bands — 2m up →
// 10m down, 70cm up → 2m down — which is the whole reason the reference names a
// transponder rather than a satellite. Get that wrong and BAND_RX is wrong on
// every AO-7 contact, which nobody notices until an award rejects the log.
//
// The extension caches its transponder table at module level: the pickers and
// the import refresh it, the ADIF path and the SAT command read whatever was
// last loaded. So every test names its birds through `withBirds`, which loads
// them the way opening the picker does — a test that skipped it would be
// reading the previous test's table.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

type Bird = Record<string, unknown>

/// Verbatim from the feed.
const SO_50: Bird = {
  name: "SO-50",
  number: 27607,
  modulation: "fm",
  uplinks: [{ mode: "fm", lowerMHz: 145.85, upperMHz: 145.85 }],
  downlinks: [{ mode: "fm", lowerMHz: 436.795, upperMHz: 436.795 }],
}

const AO_7: Bird = {
  name: "AO-7",
  number: 7530,
  modulation: "linear",
  uplinks: [
    { mode: "linear", lowerMHz: 145.85, upperMHz: 145.95 },
    { mode: "linear", lowerMHz: 432.125, upperMHz: 432.175 },
  ],
  downlinks: [
    { mode: "linear", lowerMHz: 29.4, upperMHz: 29.5 },
    { mode: "linear", lowerMHz: 145.925, upperMHz: 145.975 },
  ],
}

/// A verbatim slice of polo.ham2k.com/data/satellites.json. Inferring an
/// award's data shape is the mistake this pins against: the mapper is read
/// against the real feed, key order and all.
const FEED: Bird[] = [
  {
    name: "AO-7",
    number: 7530,
    modulation: "linear",
    downlinks: [
      { mode: "linear", lowerMHz: 29.4, upperMHz: 29.5 },
      { mode: "linear", lowerMHz: 145.925, upperMHz: 145.975 },
    ],
    uplinks: [
      { mode: "linear", lowerMHz: 145.85, upperMHz: 145.95 },
      { mode: "linear", lowerMHz: 432.125, upperMHz: 432.175 },
    ],
  },
  {
    name: "SO-50",
    number: 27607,
    modulation: "fm",
    downlinks: [{ mode: "fm", lowerMHz: 436.795, upperMHz: 436.795 }],
    uplinks: [{ mode: "fm", lowerMHz: 145.85, upperMHz: 145.85 }],
  },
  {
    name: "QO-100",
    number: 43700,
    modulation: "linear",
    downlinks: [
      { mode: "linear", lowerMHz: 10489.5, upperMHz: 10489.8 },
      { mode: "linear", lowerMHz: 10491.0, upperMHz: 10499.8 },
    ],
    uplinks: [
      { mode: "linear", lowerMHz: 2400.05, upperMHz: 2400.3 },
      { mode: "linear", lowerMHz: 2401.5, upperMHz: 2409.5 },
    ],
  },
  {
    name: "IO-117",
    number: 53106,
    modulation: "digital",
    downlinks: [{ mode: "digital", lowerMHz: 435.31, upperMHz: 435.31 }],
    uplinks: [{ mode: "digital", lowerMHz: 435.31, upperMHz: 435.31 }],
  },
]

/// The bird table the lookup stub answers with — the rows the data file
/// would have produced.
let birds: Bird[] = []

const satellites = await loadExtension(() => import("./index.ts"), {
  hostCalls: {
    dbLookupSelectAll: (params) =>
      params.category === "satellites"
        ? birds.map((bird) => ({ category: "satellites", key: String(bird.name).toUpperCase(), name: bird.name, data: bird }))
        : [],
  },
})

type Control = { key: string; optionType?: string; input: Record<string, unknown> }

const loggingControls = async (operation: Record<string, unknown> = { refs: [] }) =>
  (await satellites.runHook("activity", "loggingControls", { operation })) as Control[]

/// Names the table and loads it, as opening the picker does.
async function withBirds(table: Bird[]) {
  birds = table
  await loggingControls()
}

async function adifFor(ref: string | null): Promise<Record<string, string>> {
  const fields = (await satellites.runHook("adifFields", "fieldsForOneQSO", {
    qso: { refs: ref === null ? [] : [{ type: "satellite", ref }] },
    operation: { refs: [] },
  })) as { name: string; value: string }[]
  return Object.fromEntries(fields.map((f) => [f.name, f.value]))
}

type ImportResult = { refs: { type: string; ref: string }[] } | null

const importFrom = async (records: Record<string, string>[]) =>
  (await satellites.runHook("adifImport", "refsForRecords", {
    records: records.map((fields) => ({ fields })),
  })) as ImportResult[]

type Interpretation = {
  commands?: Record<string, Record<string, unknown>>[]
  expectsParams?: boolean
  error?: string
} | null

const interpret = async (input: string, qso?: Record<string, unknown>) =>
  (await satellites.runHook("command", "interpret", { input, qso }, { key: "ham2k-satellites-sat" })) as Interpretation

// --- What an award reads ---

test("a satellite QSO carries PROP_MODE, SAT_NAME and the downlink band", async () => {
  await withBirds([SO_50])
  // BAND_RX is the DOWNLINK's band (436.795 MHz), not the uplink's 2m — a
  // band read off the uplink files every FM bird under 2m.
  assert.deepEqual(await adifFor("SO-50/145.85/fm"), { PROP_MODE: "SAT", SAT_NAME: "SO-50", BAND_RX: "70cm" })
})

test("AO-7's two transponders report DIFFERENT downlink bands", async () => {
  // Same bird, same SAT_NAME, different BAND_RX — a reference that named only
  // "AO-7", or a lookup matching on the bird alone, is wrong half the time.
  await withBirds([AO_7])
  assert.equal((await adifFor("AO-7/145.85/linear")).BAND_RX, "10m")
  assert.equal((await adifFor("AO-7/432.125/linear")).BAND_RX, "2m")
})

test("a QSO with no satellite gets no satellite fields", async () => {
  // `adifFields` fans out to every hook; PROP_MODE=SAT on an ordinary contact
  // would claim it went through a bird.
  await withBirds([SO_50])
  assert.deepEqual(await adifFor(null), {})
})

test("a bare satellite name, with no transponder, still exports", async () => {
  // What import leaves behind when a record does not say which transponder
  // was used. A reference that split wrong here exports a mangled SAT_NAME,
  // or none — and the "import the bird and move on" rule rests on it.
  await withBirds([SO_50])
  const fields = await adifFor("AO-7")
  assert.equal(fields.SAT_NAME, "AO-7")
  assert.equal(fields.PROP_MODE, "SAT")
  assert.equal("BAND_RX" in fields, false)
})

test("an unknown bird still logs the name, just without a band", async () => {
  // A bird retired from the feed since the contact was logged. PROP_MODE and
  // SAT_NAME come from the reference itself, so they are always right; only
  // BAND_RX needs the table, and guessing it would be worse than leaving it.
  await withBirds([SO_50])
  const fields = await adifFor("XW-2A/435.03/linear")
  assert.equal(fields.SAT_NAME, "XW-2A")
  assert.equal("BAND_RX" in fields, false)
})

// --- Reading a satellite log back ---
//
// Hand-written rather than `activityAdifImport`, because satellites write no
// SIG. The reconstruction is lossy — the log stores a TRANSPONDER and ADIF
// carries only the bird and its downlink band — so most of these assert when
// the hook must refuse to guess.

test("a one-transponder bird round-trips what the exporter wrote", async () => {
  await withBirds([SO_50])
  const results = await importFrom([{ prop_mode: "SAT", sat_name: "SO-50", band_rx: "70cm" }])
  assert.deepEqual(results[0]?.refs, [{ type: "satellite", ref: "SO-50/145.85/fm" }])
})

test("BAND_RX tells AO-7's two transponders apart", async () => {
  // The inverse of the export pair above. An import that could not read the
  // downlink band back would put an AO-7 log on the wrong transponder, and
  // its next export would claim a band the operator never listened on.
  await withBirds([AO_7])
  const results = await importFrom([
    { sat_name: "AO-7", band_rx: "10m" },
    { sat_name: "AO-7", band_rx: "2m" },
  ])
  assert.deepEqual(results[0]?.refs, [{ type: "satellite", ref: "AO-7/145.85/linear" }])
  assert.deepEqual(results[1]?.refs, [{ type: "satellite", ref: "AO-7/432.125/linear" }])
})

test("the record's own band narrows it too, being the UPLINK", async () => {
  // ADIF's BAND/FREQ is the transmit side. A file with no BAND_RX still says
  // which transponder was used, in the field every logger fills in — read as
  // the downlink, it would pick the other transponder.
  await withBirds([AO_7])
  const results = await importFrom([
    { sat_name: "AO-7", band: "70cm" },
    { sat_name: "AO-7", freq: "145.850" },
  ])
  assert.deepEqual(results[0]?.refs, [{ type: "satellite", ref: "AO-7/432.125/linear" }])
  assert.deepEqual(results[1]?.refs, [{ type: "satellite", ref: "AO-7/145.85/linear" }])
})

test("a FREQ that names no band is no information, not a contradiction", async () => {
  // `bandForFrequency` answers 'other' for a frequency it cannot place, never
  // anything falsy. Passed through as a band it eliminates every candidate, so
  // a junk FREQ would cost SO-50 the transponder its name alone settles.
  await withBirds([SO_50])
  const results = await importFrom([{ sat_name: "SO-50", freq: "0" }])
  assert.deepEqual(results[0]?.refs, [{ type: "satellite", ref: "SO-50/145.85/fm" }])
})

test("an ambiguous bird imports as the bare bird, not a guessed transponder", async () => {
  // Nothing in the record says which of AO-7's transponders was used. Taking
  // the first candidate would claim a band the operator never transmitted on.
  await withBirds([AO_7])
  const results = await importFrom([{ prop_mode: "SAT", sat_name: "AO-7" }])
  assert.deepEqual(results[0]?.refs, [{ type: "satellite", ref: "AO-7" }])
})

test("a BAND_RX the table contradicts still imports the bird", async () => {
  // SO-50 answers on one band and the file says another. Resolving that
  // either way invents something, but it is no reason to drop the satellite.
  await withBirds([SO_50])
  const results = await importFrom([{ sat_name: "SO-50", band_rx: "2m" }])
  assert.deepEqual(results[0]?.refs, [{ type: "satellite", ref: "SO-50" }])
})

test("a bird the table has never heard of imports anyway", async () => {
  // Nothing is validated against the table: a retired bird, one the feed has
  // not caught up with, or a data file that never downloaded must not cost
  // the operator the satellite.
  await withBirds([SO_50])
  const results = await importFrom([{ prop_mode: "SAT", sat_name: "XW-2A" }])
  assert.deepEqual(results[0]?.refs, [{ type: "satellite", ref: "XW-2A" }])
})

test("a bird named without its dash is the same bird", async () => {
  // Other software writes what the operator typed; an exact-name match would
  // leave `so50` on no transponder at all.
  await withBirds([SO_50])
  const results = await importFrom([{ sat_name: "so50", band_rx: "70cm" }])
  assert.deepEqual(results[0]?.refs, [{ type: "satellite", ref: "SO-50/145.85/fm" }])
})

test("returns one result per record, nulls included", async () => {
  // The host matches results back to records by index; a hook that dropped
  // its empties would put one QSO's satellite on another.
  await withBirds([SO_50])
  const results = await importFrom([
    { sat_name: "SO-50", band_rx: "70cm" },
    { call: "W1AW" },
    { sat_name: "XW-2A", band_rx: "70cm" },
  ])
  assert.equal(results.length, 3)
  assert.deepEqual(results[0]?.refs, [{ type: "satellite", ref: "SO-50/145.85/fm" }])
  // No SAT_NAME at all — the only shape that is genuinely no satellite.
  assert.equal(results[1], null)
  assert.deepEqual(results[2]?.refs, [{ type: "satellite", ref: "XW-2A" }])
})

test("an import reloads the table rather than trusting what an earlier call cached", async () => {
  // An import can be the first thing a session does. Read from the cache, it
  // would resolve against the table as it stood before the data file landed —
  // here, a table with no AO-7 — and import every AO-7 contact as a bare bird.
  await withBirds([SO_50])
  birds = [AO_7]
  const results = await importFrom([{ sat_name: "AO-7", band_rx: "10m" }])
  assert.deepEqual(results[0]?.refs, [{ type: "satellite", ref: "AO-7/145.85/linear" }])
})

// --- The published feed ---

const dataFile = satellites.hooks.find((h) => h.category === "dataFile" && h.key === "ham2k-satellites-data")?.hook as
  | { jsonToLookupEntry: (entry: unknown) => Record<string, any> | null | undefined }
  | undefined

/// What the kernel's `mapJsonBatch` does with the mapper: every entry
/// through it, the empties dropped.
function mapFeed(entries: unknown[]) {
  assert.ok(dataFile, "the satellite data file is registered under ham2k-satellites-data")
  return entries.map((entry) => dataFile.jsonToLookupEntry(entry)).filter((row) => row !== null && row !== undefined) as Record<string, any>[]
}

test("maps the real feed into one row per bird", () => {
  const rows = mapFeed(FEED)
  // One row per BIRD, not per transponder — the lookup query caps at 100 rows
  // and the cap is silent, so a row per transponder loses birds without a word.
  assert.equal(rows.length, FEED.length)
  assert.deepEqual(rows.map((r) => r.key), ["AO-7", "SO-50", "QO-100", "IO-117"])
  assert.equal(rows[0].subCategory, "linear")
  // The transponders ride in `data`, which is what the pickers expand.
  assert.equal(rows[0].data.uplinks.length, 2)
})

test("every bird in the feed yields a usable transponder", async () => {
  // End to end on real data: feed → rows → picker options. A malformed code
  // is unselectable and exports a wrong SAT_NAME.
  birds = mapFeed(FEED).map((row) => row.data)
  const [control] = await loggingControls()
  const options = control.input.options as { code: string; name: string }[]

  // AO-7 and QO-100 have two uplinks each; SO-50 and IO-117 one.
  assert.equal(options.length, 6)
  for (const option of options) {
    assert.equal(option.code.split("/").length, 3, `${option.code} should be name/freq/mode`)
    assert.equal(option.code.includes("undefined"), false, `${option.code} has a missing part`)
    assert.ok(option.name.includes("→"), `${option.code} has no frequencies`)
  }
})

// --- The pickers ---

test("the per-QSO control offers one option per transponder", async () => {
  await withBirds([SO_50, AO_7])
  const [control] = await loggingControls()
  const input = control.input
  assert.equal(input.kind, "options")
  assert.equal(input.field, "ref")
  // The stored code carries a lowercase mode, and app-polo reads the same
  // strings; uppercasing the field would never match them.
  assert.equal(input.uppercase, false)

  const options = input.options as { code: string; name: string }[]
  assert.deepEqual(options.map((o) => o.code), ["SO-50/145.85/fm", "AO-7/145.85/linear", "AO-7/432.125/linear"])
  // MHz to three decimals — `fmtFreq` reads its argument as kHz and would
  // render QO-100's 10489.5 as "10.489.500".
  assert.equal(options[0].name, "SO-50 • FM: 145.850 → 436.795")
})

test("the operation's bird becomes each QSO's suggested value", async () => {
  // A pass is one choice, not one per contact.
  await withBirds([SO_50])
  const [control] = await loggingControls({ refs: [{ type: "satellite", ref: "SO-50/145.85/fm" }] })
  assert.equal(control.input.suggestedValue, "SO-50/145.85/fm")
  // Every contact on a pass goes through the bird; one that forgot to say so
  // cannot be uploaded as a satellite QSO.
  assert.equal(control.optionType, "mandatory")
})

test("the operation control is a form, which is all operationControls renders", async () => {
  // `operationControls` handles `refList` and `form` only — an `options`
  // control there never appears, and says nothing about it.
  await withBirds([SO_50, AO_7])
  const [control] = (await satellites.runHook("activity", "operationControls", { operation: { refs: [] } })) as Control[]
  const input = control.input as { kind: string; refType: string; form: { elements: Record<string, unknown>[] } }
  assert.equal(input.kind, "form")
  assert.equal(input.refType, "satellite")
  assert.equal(input.form.elements.length, 1)
  const [field] = input.form.elements
  assert.equal(field.fieldType, "select")
  assert.equal(field.key, "ref")
  assert.equal((field.options as unknown[]).length, 3)
})

// --- The SAT command ---

test("SAT names the bird AND tunes the radio, which a control cannot", async () => {
  // The whole reason the command exists: a `loggingControls` selection writes
  // its value and cannot ask for anything else to happen.
  await withBirds([SO_50])
  const result = await interpret("SAT SO-50")
  const commands = result?.commands ?? []
  // Uplink in kHz, and FM because this transponder really is FM.
  assert.deepEqual(commands[0].setVfo, { freq: 145850, mode: "FM" })
  assert.deepEqual((commands[commands.length - 1].updateQso as { refs: unknown[] }).refs, [{ type: "satellite", ref: "SO-50/145.85/fm" }])
})

test("a linear transponder is tuned but not moded", async () => {
  // Only FM says anything about the mode. On a linear transponder the operator
  // chooses, and overwriting that is worse than leaving it.
  await withBirds([AO_7])
  const setVfo = (await interpret("SAT AO-7"))?.commands?.[0].setVfo as Record<string, unknown>
  assert.equal(setVfo.freq, 145850)
  assert.equal("mode" in setVfo, false)
})

test("SAT keeps the other activities on the QSO", async () => {
  // `updateQso` writes whole fields, so a bare refs list drops the park this
  // contact is also for — a silent loss from the operator's log.
  await withBirds([SO_50])
  const result = await interpret("SAT SO-50", {
    refs: [
      { type: "pota", ref: "US-0001" },
      { type: "satellite", ref: "AO-7/145.85/linear" },
    ],
  })
  const commands = result?.commands ?? []
  assert.deepEqual((commands[commands.length - 1].updateQso as { refs: unknown[] }).refs, [
    { type: "pota", ref: "US-0001" },
    { type: "satellite", ref: "SO-50/145.85/fm" },
  ])
})

test("a bare SAT asks for the bird rather than guessing one", async () => {
  await withBirds([SO_50])
  const result = await interpret("SAT")
  assert.equal(result?.expectsParams, true)
  assert.equal(result !== null && "commands" in result, false)
})

test("an unknown bird is an error, not a silent no-op", async () => {
  await withBirds([SO_50])
  const result = await interpret("SAT NOTABIRD")
  assert.match(result?.error ?? "", /NOTABIRD/)
  assert.equal(result !== null && "commands" in result, false)
})

test("anything that is not SAT is left to other commands", async () => {
  // `interpret` fans out to every command hook; answering for SATURDAY or a
  // callsign would hijack them.
  await withBirds([SO_50])
  assert.equal(await interpret("SATURDAY"), null)
  assert.equal(await interpret("W1AW"), null)
})
