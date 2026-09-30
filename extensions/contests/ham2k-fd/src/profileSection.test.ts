// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The setup form's OUR-section field, seeded from the operator profile so the
// section is typed once in Settings rather than at every running.
//
// Its own file because the default is module state (`lastKnownSection`) and
// these tests are its lifecycle: nothing read yet, then a read, then a host
// that stops answering. They run in order, against one stub whose answer each
// test sets.
//
// The trap is the rejecting host. FormRenderer re-applies a field's `value`
// when a re-fetched definition disagrees with the previous one on a field the
// operator hasn't edited, and operationControls is re-fetched on every ref
// change — so a getSettings that works once and then rejects must not blank
// the section in front of the operator, and one that rejects from the start
// must cost the default, never the whole setup form.

import assert from "node:assert/strict"
import { mock, test } from "node:test"

import { loadExtension } from "./sdkGapTesting.ts"

// The extension logs its own recovery; silenced so a passing run does not
// print stack traces that read as failures.
mock.method(console, 'warn', () => {})

let settings: () => unknown = () => ({})

const fd = await loadExtension(() => import("./index.ts"), {
  hostCalls: { getSettings: () => settings() },
})

async function sectionValue(): Promise<unknown> {
  const controls = (await fd.runHook('activity', 'operationControls', { operation: { refs: [] } })) as {
    input: { form: { elements: { key?: string; value?: unknown }[] } }
  }[]
  assert.equal(controls.length, 1, 'the setup form must survive whatever getSettings does')
  const field = controls[0].input.form.elements.find((e) => e.key === 'ourSection')
  assert.ok(field, 'no ourSection field')
  return field.value
}

const hostGone = () => {
  throw new Error('the host went away')
}

test('a host that rejects getSettings before any read costs only the default', async () => {
  settings = hostGone
  assert.equal(await sectionValue(), '')
})

test('a profile with no section leaves our section blank', async () => {
  settings = () => ({})
  assert.equal(await sectionValue(), '')
})

test("our section defaults to the profile's", async () => {
  settings = () => ({ operatorSection: 'ENY' })
  assert.equal(await sectionValue(), 'ENY')
})

test('a failed re-read keeps the section already read', async () => {
  settings = () => ({ operatorSection: 'ENY' })
  assert.equal(await sectionValue(), 'ENY')
  settings = hostGone
  assert.equal(await sectionValue(), 'ENY', 'a failed re-read must not blank the field')
})
