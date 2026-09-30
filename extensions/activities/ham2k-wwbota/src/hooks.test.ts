// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The extension through its HOOKS — what the app actually calls — rather than
// through the plain functions behind them. `loadExtension` activates the real
// module against a stand-in kernel, so a registration that stops happening,
// or a control that stops being offered, fails here. The harness is the SDK's
// own, copied into `sdkGapTesting.ts` because the published package does not ship it.

import { test } from "node:test"
import assert from "node:assert/strict"

import { applyRefTransforms, fixtureOperation, fixtureQso, loadExtension, typeRefText } from "./sdkGapTesting.ts"
import manifest from "../manifest.json" with { type: "json" }

// The bunker list, one row per entity prefix a test asks about: Canada's
// bunkers are "B/CA", which no rule derives from the "VE" entity prefix.
const bunkers: Record<string, string[]> = { VE: ["B/CA-0001", "B/CA-0002"] }
const wwbota = await loadExtension(() => import("./index.ts"), {
  hostCalls: {
    dbLookupSelectAll: (params) => (bunkers[params.subCategory as string] ?? []).map((key) => ({ key, name: key })),
  },
})

const operationWith = (...refs: { type: string; ref: string }[]) => fixtureOperation({ refs })

async function controlRefTypes(operation: Record<string, unknown>): Promise<string[]> {
  const controls = [
    ...((await wwbota.runHook("activity", "operationControls", { operation })) as any[]),
    ...((await wwbota.runHook("activity", "loggingControls", { operation })) as any[]),
  ]
  return controls.map((control) => control?.input?.refType).filter(Boolean)
}

test("the legacy UKBOTA ref types are answered but never offered", async () => {
  // Both halves matter and they pull apart. The registrations keep old synced
  // references decorated; the manifest must NOT list them, because the host
  // reads that list to offer enabling this extension for an unhandled
  // reference — and there is no control for a legacy type, so the offer would
  // leave the row exactly as red. extensions/hook-check.mjs fails the build on
  // the mismatch; this says why the two differ on purpose.
  assert.ok(wwbota.categories().includes("ref:ukbotaActivation"), "legacy refs still resolve")
  assert.ok(wwbota.categories().includes("ref:ukbota"))
  assert.ok(!manifest.hooks.includes("ref:ukbotaActivation"), "and are not advertised to the host")
  assert.ok(!manifest.hooks.includes("ref:ukbota"))

  const offered = await controlRefTypes(operationWith({ type: "ukbotaActivation", ref: "B/GX-0001" }))
  assert.ok(!offered.includes("ukbotaActivation"), "no control clears a legacy row")
})

test("an operation activating a bunker is offered the controls that fill it in", async () => {
  const offered = await controlRefTypes(operationWith({ type: "wwbotaActivation", ref: "B/GX-0001" }))
  assert.deepEqual(offered.sort(), ["wwbota", "wwbotaActivation"])
})

test("Slovenia and North Macedonia activate at 10 contacts, everywhere else at 25", async () => {
  // The threshold is read off the reference's second segment, and getting it
  // wrong is silent: an activator is simply shown the wrong target. Scored
  // through the hook because that is where the operation's refs meet it.
  // One contact in, the tally reads "1/<target>" — the target IS what the
  // activator is shown, so asserting the rendered summary catches the wrong
  // threshold the way they would notice it, if they knew to.
  const progressFor = async (ref: string) => {
    const operation = operationWith({ type: "wwbotaActivation", ref })
    const result = (await wwbota.runHook("scoring", "scoreQsos", {
      operation,
      qsos: [fixtureQso()],
      ref: { type: "wwbotaActivation", ref },
    })) as { operationSummary: Record<string, { summary?: string }> }
    return Object.values(result.operationSummary)
      .map((tally) => tally.summary)
      .find((summary) => typeof summary === "string" && summary.includes("/"))
  }
  assert.equal(await progressFor("B/S5-0001"), "1/10", "Slovenia")
  assert.equal(await progressFor("B/Z3-0001"), "1/10", "North Macedonia")
  assert.equal(await progressFor("B/GX-0001"), "1/25", "everywhere else")
})

async function huntingInput(theirCall: string) {
  const qso = fixtureQso({ their: { call: theirCall } })
  const controls = (await wwbota.runHook("activity", "loggingControls", { operation: fixtureOperation(), qso })) as any[]
  return controls[0].input as { placeholder: string; transforms: { pattern: string; replacement: string; flags?: string }[] }
}

test("a bare bunker number takes the prefix the list uses for the other station's entity", async () => {
  const canada = await huntingInput("VE3ABC")
  assert.equal(canada.placeholder, "B/CA-...")
  assert.equal(applyRefTransforms("0001", canada.transforms), "B/CA-0001")
  assert.equal(applyRefTransforms("B/CA-0001,0002", canada.transforms), "B/CA-0001,B/CA-0002")

  // No rows for England in the stubbed list: the DXCC prefix stands in.
  const england = await huntingInput("G4ABC")
  assert.equal(applyRefTransforms("0001", england.transforms), "B/G-0001")
})

test("a reference typed without its scheme or dash is completed as it is typed", async () => {
  const { transforms } = await huntingInput("G4ABC")
  assert.equal(typeRefText("G-0001", transforms), "B/G-0001")
  assert.equal(typeRefText("G0001", transforms), "B/G-0001")
  assert.equal(typeRefText("B/G0001", transforms), "B/G-0001")
  // A country segment ending in a digit reads as "E" plus a number until the
  // fifth digit proves otherwise — the repair has to happen, and only then.
  assert.equal(typeRefText("E7000", transforms), "B/E-7000")
  assert.equal(typeRefText("E70001", transforms), "B/E7-0001")
  assert.equal(typeRefText("E7-0001", transforms), "B/E7-0001")
  assert.equal(typeRefText("9A0001", transforms), "B/9A-0001")
  // A finished reference is left alone.
  assert.equal(applyRefTransforms("B/G-0001", transforms), "B/G-0001")
})

test("a hunt with no activation is tallied in the award's own words", async () => {
  // `refNoun`/`refNounPlural` resolve through this extension's i18n keys, and a
  // mistyped key falls back to the raw key string rather than throwing — so
  // only a rendered summary shows it.
  const result = (await wwbota.runHook("scoring", "scoreQsos", {
    operation: fixtureOperation({ refs: [] }),
    qsos: [fixtureQso({ refs: [{ type: "wwbota", ref: "B/G-0001" }] })],
    ref: null,
  })) as { operationSummary: { hunting?: { label?: string } } }
  assert.equal(result.operationSummary.hunting?.label, "WWBOTA: 1 bunker hunted")
})

// The bunker list, fed rows in the shape the API's CSV has, with names.
const mapBunkers = (rows: Record<string, string>[]) => {
  const hook = wwbota.hooks.find((h) => h.category === "dataFile" && h.key === "ham2k-wwbota-all-bunkers")!.hook
  const mapper = hook.csvToLookupEntry as (row: Record<string, string>) => any
  return rows.map((row) => mapper(row)).filter((entry) => entry !== null && entry !== undefined)
}

test("a bunker is scoped by its DXCC entity, falling back to the reference's country when the list omits it", () => {
  const [withDxcc, withoutDxcc, ...rest] = mapBunkers([
    { Reference: "B/G-0001", Name: "With DXCC", Type: "Pillbox", Lat: "51.5", Long: "-0.1", Maidenhead: "IO91WM", DXCC: "223" },
    { Reference: "B/S5-0001", Name: "No DXCC", Type: "Bunker", Lat: "46.0", Long: "14.5", Locator: "JN76AA", DXCC: "" },
  ])
  assert.equal(rest.length, 0)
  // DXCC 223 is England: the code is authoritative when present.
  assert.equal(withDxcc.subCategory, "G")
  assert.equal(withDxcc.data.grid, "IO91wm")
  // No code: the country segment of the reference, or the bunker has no scope.
  assert.equal(withoutDxcc.subCategory, "S5")
  // The locator column is `Locator` in some exports rather than `Maidenhead`.
  assert.equal(withoutDxcc.data.grid, "JN76aa")
})

// ADIF import. Every program writes the same SIG/MY_SIG pair, so reading it
// without checking WHOSE it is invents references on foreign records.
const importOne = async (fields: Record<string, string>) =>
  ((await wwbota.runHook("adifImport", "refsForRecords", { records: [{ fields }] })) as unknown[])[0]

test("ADIF import reads its own activation and hunt, whatever their case", async () => {
  const activation = { type: "wwbotaActivation", ref: "B/G-0001", for: "operation" }
  assert.deepEqual(await importOne({ my_sig: "WWBOTA", my_sig_info: "B/G-0001" }), { refs: [activation] })
  // Ref types are compared as strings downstream; an unnormalized reference matches nothing.
  assert.deepEqual(await importOne({ my_sig: "wwbota", my_sig_info: "b/g-0001" }), { refs: [activation] })
  assert.deepEqual(await importOne({ sig: "WWBOTA", sig_info: "B/G-0001", my_sig: "WWBOTA", my_sig_info: "B/G-0001" }), {
    refs: [{ type: "wwbota", ref: "B/G-0001" }, activation],
  })
})

test("ADIF import declines another program's SIG, even on a bunker-shaped reference", async () => {
  // A foreign-looking reference would be turned away before the SIG was ever
  // consulted, so the reference here is WWBOTA's own shape.
  assert.equal(await importOne({ sig: "POTA", sig_info: "B/G-0001", my_sig: "POTA", my_sig_info: "B/G-0001" }), null)
})

test("ADIF import keeps a reference that does not match the pattern", async () => {
  // The pattern flags it when decorated; it does not decide whether the
  // operator's text survives.
  assert.deepEqual(await importOne({ my_sig: "WWBOTA", my_sig_info: "not a reference" }), {
    refs: [{ type: "wwbotaActivation", ref: "NOT A REFERENCE", for: "operation" }],
  })
})
