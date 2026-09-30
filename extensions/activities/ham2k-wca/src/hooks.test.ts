// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// WCA through its HOOKS. Two things set it apart from the other castle and
// lighthouse awards, and both are traps:
//
// - It ANSWERS for the English and Belgian castle types too, because their
//   references are WCA references. Whatever it answers for them — a name, a
//   title, a link — must hold for them as well as for its own type, and must
//   not claim them as WCA's.
// - Its reference pattern is the loosest of the family, so it accepts BCA's and
//   ECA's references as its own. On import the SIG is the only thing telling
//   them apart, and a hook that reads the pair without checking it invents a
//   WCA activation on every Belgian castle log.

import { test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

const BEERSEL = {
  key: "ON-00558",
  name: "Kasteel van Beersel",
  lat: 50.766,
  lon: 4.307,
  flags: 1,
  data: { location: "Vlaams-Brabant", grid: "JO20eq" },
}

let lookups = 0

const wca = await loadExtension(() => import("./index.ts"), {
  hostCalls: {
    dbLookupSelectOne: (params) => {
      lookups++
      return params.key === BEERSEL.key ? BEERSEL : null
    },
  },
})

type Link = { url: string; label?: string } | null

const linkFor = async (type: string, ref?: string) => {
  lookups = 0
  const answer = (await wca.runHook(`ref:${type}`, "linkForRef", { ref: ref === undefined ? { type } : { type, ref } })) as Link
  // Built from the reference alone: the operation sheet asks on every refs
  // change, so a link that went to the host would cost a lookup per keystroke.
  assert.equal(lookups, 0, "linkForRef must not touch the host")
  return answer
}

const decorate = async (type: string, ref: string) =>
  (await wca.runHook(`ref:${type}`, "decorateRef", { ref: { type, ref } })) as Record<string, unknown>

test("links to the reference page by its canonical, upper-cased code", async () => {
  // The operator types any case; the program's page is keyed by the canonical code.
  assert.equal((await linkFor("wcaActivation", "on-00558"))?.url, "https://www.gma.rocks/zinfo.php?ref=ON-00558")
})

test("answering for another program's castle, it links without naming itself", async () => {
  // WCA wins dispatch for ECA and BCA refs when it is loaded. A label built
  // from its own program name would have a screen reader announce
  // "WCA G-00001" on an English castle; the core names the row instead.
  for (const type of ["ecaActivation", "bcaActivation"]) {
    const link = await linkFor(type, "G-00001")
    assert.equal(link?.url, "https://www.gma.rocks/zinfo.php?ref=G-00001", type)
    assert.equal(link?.label, undefined, type)
  }
})

test("a reference the program would not accept gets no link", async () => {
  // A half-typed code still carries a `ref` while it is edited, and a link
  // built from it lands on a page that cannot exist.
  assert.equal(await linkFor("wcaActivation", "ON-0055"), null, "four digits is one short")
  assert.equal(await linkFor("wcaActivation", ""), null)
  assert.equal(await linkFor("wcaActivation"), null)
})

test("an activation-only award offers no per-QSO control at all", () => {
  // WCA has no hunting side, so nothing is recorded per contact. The core's
  // fan-out skips an absent method; a control invented here would put an
  // empty WCA field on every QSO row.
  const activity = wca.hooks.find((h) => h.category === "activity")!.hook
  assert.equal(activity.loggingControls, undefined)
})

test("English and Belgian castle references resolve through WCA", async () => {
  // They ARE WCA references. With ECA or BCA switched off, WCA is the only
  // thing that can name one an operator types.
  for (const type of ["ecaActivation", "bcaActivation"]) {
    assert.equal((await decorate(type, "ON-00558")).name, "Kasteel van Beersel", type)
  }
})

test("...and are given an operation title, not only a decoration", async () => {
  // Title dispatch resolves to ONE hook, and WCA wins it by registration
  // order. Titling only its own type would quietly cost ECA and BCA their
  // "at ON-00558" whenever WCA is on beside them — while the ref still
  // decorates, so the loss would look like a rendering bug.
  for (const type of ["wcaActivation", "ecaActivation", "bcaActivation"]) {
    const title = (await wca.runHook(`ref:${type}`, "suggestOperationTitle", {
      ref: { type, ref: "ON-00558", name: "Kasteel van Beersel" },
    })) as { at?: string; subtitle?: string } | null
    assert.ok(title, type)
    assert.equal(title.at, "ON-00558", type)
    assert.equal(title.subtitle, "Kasteel van Beersel", type)
  }
})

test("a WCA reference is prefix and five digits, whatever case it was typed in", async () => {
  assert.deepEqual(await wca.runHook("ref:wcaActivation", "validateRef", { ref: { type: "wcaActivation", ref: "on-00558" } }), {
    valid: true,
    normalized: "ON-00558",
  })
  const short = (await wca.runHook("ref:wcaActivation", "validateRef", { ref: { type: "wcaActivation", ref: "ON-0055" } })) as { valid: boolean }
  assert.equal(short.valid, false)
})

test("a decorated castle carries the list's facts under WCA's name", async () => {
  const known = await decorate("wcaActivation", "on-00558")
  assert.equal(known.name, "Kasteel van Beersel")
  assert.equal(known.program, "WCA")
  assert.equal(known.grid, "JO20eq")
  assert.equal(known.location, "Vlaams-Brabant")
  assert.equal(known.shortLabel, "WCA ON-00558")
  assert.equal(known.label, "WCA ON-00558: Kasteel van Beersel")

  // Not in the list yet: still a WCA castle, and says it is unknown rather
  // than going blank.
  const unknown = await decorate("wcaActivation", "ON-99999")
  assert.equal(unknown.name, "Unknown castle")
  assert.equal(unknown.program, "WCA")
})

test("the activation control is a reference list scoped by its key", async () => {
  // The core derives the `wca:` search scope from the part of the key before
  // the slash, so a renamed key searches every program's list.
  const controls = (await wca.runHook("activity", "operationControls", { operation: { uuid: "op" } })) as {
    key: string
    input: { kind: string; refType: string }
  }[]
  assert.equal(controls.length, 1)
  assert.equal(controls[0].key, "wca/activation")
  assert.equal(controls[0].input.refType, "wcaActivation")
  assert.equal(controls[0].input.kind, "refList")
})

test("an activation writes MY_SIG and MY_SIG_INFO, and no program-specific field", async () => {
  const fields = (await wca.runHook("adifFields", "fieldsForOneQSO", {
    qso: { their: { call: "W1AW" } },
    operation: { refs: [{ type: "wcaActivation", ref: "ON-00558" }] },
  })) as { name: string; value: string }[]
  assert.deepEqual(fields, [
    { name: "MY_SIG", value: "WCA" },
    { name: "MY_SIG_INFO", value: "ON-00558" },
  ])
})

test("fifty contacts activate a castle, and there is no hunting tally", async () => {
  const ref = { type: "wcaActivation", ref: "ON-00558" }
  const qsos = Array.from({ length: 50 }, (_, i) => ({
    uuid: `q${i}`,
    their: { call: `W${i}ABC` },
    band: "20m",
    mode: "SSB",
    startAtMillis: Date.UTC(2026, 6, 1, 12, i),
  }))
  const result = (await wca.runHook("scoring", "scoreQsos", { operation: { uuid: "op", refs: [ref] }, qsos, ref })) as {
    operationSummary: Record<string, { summary?: string; activated?: boolean } | undefined>
  }
  assert.equal(result.operationSummary.activation?.summary, "50 ✓")
  assert.equal(result.operationSummary.activation?.activated, true)
  assert.equal(result.operationSummary.hunting, undefined)
})
