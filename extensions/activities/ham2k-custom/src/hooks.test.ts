// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The Custom Activity, through its hooks. Nothing here can be checked against
// a published list, so what the tests pin down is the ADIF the operator ends
// up submitting: an award's log checker reads MY_SIG/MY_SIG_INFO and
// SIG/SIG_INFO, and a wrong one is a rejected activation the operator finds
// out about weeks later.
//
// Three rules carry the weight, all of them app-polo's:
//   - SIG is the ACTIVATION's program, not the hunted reference's. A hunted
//     reference is typed as a bare string and has no program of its own.
//   - a contact crediting several of the other station's references is
//     submitted as one record each, like a POTA n-fer.
//   - the hunting control only exists while activating, because of the first
//     rule.

import { describe, test } from "node:test"
import assert from "node:assert/strict"

import { loadExtension } from "./sdkGapTesting.ts"

const extension = await loadExtension(() => import("./index.ts"))

const activation = ({ program = "COTA" as string | null, reference = "XY-1234", name = "" } = {}) => ({
  refs: [
    {
      type: "customActivation",
      ...(program !== null ? { mySig: program } : {}),
      mySigInfo: reference,
      ...(name ? { name } : {}),
    },
  ],
})

const qsoHunting = (refs: string[]) => ({ refs: refs.map((ref) => ({ type: "custom", ref })) })

/// The ADIF a record would carry, one map per record written.
async function adif(operation: Record<string, unknown>, qso: Record<string, unknown> = { refs: [] }): Promise<Record<string, string>[]> {
  const sets = (await extension.runHook("adifFields", "fieldCombinationsForOneQSO", { qso, operation })) as { name: string; value: string }[][]
  return sets.map((set) => Object.fromEntries(set.map((field) => [field.name, field.value])))
}

const decorate = async (category: string, ref: Record<string, unknown>) =>
  (await extension.runHook(category, "decorateRef", { ref })) as Record<string, unknown>

describe("what the log checker reads", () => {
  test("an activation with no contacts to a reference is one record", async () => {
    assert.deepEqual(await adif(activation()), [{ MY_SIG: "COTA", MY_SIG_INFO: "XY-1234" }])
  })

  test("a contact to one of their references adds SIG from OUR program", async () => {
    // The only place a program is written down is our own activation. Taking
    // SIG from the hunted reference leaves it empty on every record.
    assert.deepEqual(await adif(activation(), qsoHunting(["AB-9"])), [
      { MY_SIG: "COTA", MY_SIG_INFO: "XY-1234", SIG: "COTA", SIG_INFO: "AB-9" },
    ])
  })

  test("a contact crediting two of their references is submitted twice", async () => {
    // One record per reference — the n-fer rule the other programs follow —
    // and every one of them still names our own activation.
    const records = await adif(activation(), qsoHunting(["AB-9", "CD-7"]))

    assert.equal(records.length, 2)
    assert.deepEqual(records.map((r) => r.SIG_INFO), ["AB-9", "CD-7"])
    assert.ok(records.every((r) => r.MY_SIG_INFO === "XY-1234"))
    assert.ok(records.every((r) => r.SIG === "COTA"))
  })

  test("an unnamed program writes NEITHER half of the pair", async () => {
    // A half pair is worse than nothing. The exporter writes each field once
    // and the first hook to answer it wins, so beside a POTA activation a lone
    // MY_SIG_INFO lands under POTA's MY_SIG and claims a park for this
    // activity — and a hunted SIG_INFO with no SIG names no program at all.
    assert.deepEqual(await adif(activation({ program: null }), qsoHunting(["AB-9"])), [{}])
  })

  test("a program with no reference of our own still credits the one we worked", async () => {
    // The two pairs stand or fall separately: the hunted pair is whole — the
    // program names it — however empty our own reference box was left.
    assert.deepEqual(await adif(activation({ reference: "" }), qsoHunting(["AB-9"])), [{ SIG: "COTA", SIG_INFO: "AB-9" }])
  })

  test("no activation means this extension claims nothing", async () => {
    // Enabling the extension must not write custom fields into an operation
    // that is not a custom activation.
    assert.deepEqual(await adif({ refs: [] }), [])
  })
})

describe("the controls", () => {
  test("the hunting control appears only while activating", async () => {
    // SIG is taken from the activation, so a hunted reference recorded without
    // one exports a SIG_INFO with no SIG to name its program.
    assert.deepEqual(await extension.runHook("activity", "loggingControls", { operation: { refs: [] } }), [])

    const controls = (await extension.runHook("activity", "loggingControls", { operation: activation() })) as Record<string, unknown>[]
    assert.equal(controls.length, 1)
    assert.equal(controls[0].allowsMultiple, true)
  })

  test("the operation control is a three-field form on the activation ref", async () => {
    // A form is what saves the program, reference and name onto the ref as
    // three separate keys — the ones the ADIF hook above reads.
    const controls = (await extension.runHook("activity", "operationControls", { operation: { refs: [] } })) as {
      input: { kind: string; refType: string; form: { elements: { key: string }[] } }
    }[]

    const input = controls[0].input
    assert.equal(controls.length, 1)
    assert.equal(input.kind, "form")
    assert.equal(input.refType, "customActivation")
    assert.deepEqual(input.form.elements.map((e) => e.key), ["mySig", "mySigInfo", "name"])
  })
})

describe("how a reference reads", () => {
  test("the program and reference become one addressable string", async () => {
    const ref = await decorate("ref:customActivation", { type: "customActivation", mySig: "COTA", mySigInfo: "XY-1234", name: "XYZ Castle" })

    assert.equal(ref.ref, "COTA XY-1234")
    assert.equal(ref.shortLabel, "COTA XY-1234")
    assert.equal(ref.label, "COTA XY-1234: XYZ Castle")
  })

  test("re-saving does not compound the program onto the reference", async () => {
    // decorateRef runs on EVERY save, and the edit path hands back
    // `{...existing, ...formResult}`, so the already-joined `ref` comes back in.
    // Reading it as a fallback for the activation's reference joins the program
    // on again each save — "COTA COTA XY-1234" — straight into MY_SIG_INFO.
    let ref = await decorate("ref:customActivation", { type: "customActivation", mySig: "COTA", mySigInfo: "XY-1234" })
    assert.equal(ref.ref, "COTA XY-1234")

    ref = await decorate("ref:customActivation", { ...ref, mySig: "COTA", mySigInfo: "XY-1234" })
    assert.equal(ref.ref, "COTA XY-1234")

    // Saved with the Reference field cleared: the case that compounds.
    ref = await decorate("ref:customActivation", { ...ref, mySig: "COTA", mySigInfo: "" })
    assert.equal(ref.ref, "COTA", "the program alone, not re-joined onto the old value")
    ref = await decorate("ref:customActivation", { ...ref, mySig: "COTA", mySigInfo: "" })
    assert.equal(ref.ref, "COTA", "and it stays put however often it is saved")
  })

  test("a hunted reference keeps reading its own ref, however often it is saved", async () => {
    // A hunted ref is typed as a single string, so `ref` IS its reference —
    // reading `mySigInfo` for it, as an activation does, empties it.
    let ref = await decorate("ref:custom", { type: "custom", ref: "AB-9" })
    assert.equal(ref.ref, "AB-9")

    ref = await decorate("ref:custom", ref)
    assert.equal(ref.ref, "AB-9")
    assert.equal(ref.shortLabel, "Custom AB-9")
  })

  test("a hunted reference never retitles the operation", async () => {
    // It describes where the OTHER station was. Titling the operation with it
    // claims their activation as ours.
    assert.equal(await extension.runHook("ref:custom", "suggestOperationTitle", { ref: { type: "custom", ref: "AB-9" } }), null)

    const ours = (await extension.runHook("ref:customActivation", "suggestOperationTitle", {
      ref: { type: "customActivation", mySig: "COTA", mySigInfo: "XY-1234", name: "XYZ Castle" },
    })) as Record<string, unknown>
    assert.equal(ours.at, "XY-1234")
    assert.equal(ours.subtitle, "XYZ Castle")
  })

  test("an empty reference is the only thing that fails validation", async () => {
    // This activity exists for the programs whose reference shapes HaLo does
    // not know, so any pattern here rejects the very references it carries.
    const valid = async (ref: string) =>
      ((await extension.runHook("ref:customActivation", "validateRef", { ref: { type: "customActivation", ref } })) as { valid: boolean }).valid

    assert.equal(await valid("XY-1234"), true)
    assert.equal(await valid("anything at all"), true)
    assert.equal(await valid("   "), false)
    assert.equal(await valid(""), false)
  })
})
