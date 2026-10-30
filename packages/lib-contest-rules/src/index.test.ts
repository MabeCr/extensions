// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT

import { test } from "node:test"
import assert from "node:assert/strict"

import { NO_RESTRICTIONS, rulesLine, rulesNote, rulesNotes, withRules } from "./index.ts"

const ctx = { locale: 'en' }

test('withRules states only what is forbidden, as false', () => {
  assert.deepEqual(withRules({ type: 'x' }, { assistance: false, selfSpotting: true }), { type: 'x', assistance: false })
  assert.deepEqual(withRules({ type: 'x' }, NO_RESTRICTIONS), { type: 'x' })
})

test('withRules drops a false an earlier category left on the ref', () => {
  // The host reads any `false` as forbidden: a single operator who switches to
  // an assisted class would otherwise stay locked out of spots.
  const before = { type: 'x', assistance: false, selfSpotting: false }
  assert.deepEqual(withRules(before, { assistance: true, selfSpotting: false }), { type: 'x', selfSpotting: false })
})

test('the rules line marks what is allowed green and what is not red', () => {
  assert.equal(rulesLine(ctx, { assistance: true, selfSpotting: false }), '🟢 Assistance: ON, 🔴 Self-spotting: OFF')
  assert.equal(rulesLine({ locale: 'es' }, { assistance: false, selfSpotting: true }), '🔴 Asistencia: NO, 🟢 Auto-spot: SÍ')
})

test('rules that do not depend on the field show one note, always', () => {
  const notes = rulesNotes(ctx, 'operator', ['SINGLE-OP', 'MULTI-ONE'], () => NO_RESTRICTIONS)
  assert.deepEqual(notes, [rulesNote(ctx, NO_RESTRICTIONS)])
})

test('one note per verdict, each shown for the values that lead to it', () => {
  const notes = rulesNotes(ctx, 'operator', ['SINGLE-OP', 'SINGLE-OP-ASSISTED', 'MULTI-ONE'], (op) => ({
    assistance: op !== 'SINGLE-OP',
    selfSpotting: false,
  }))
  assert.equal(notes.length, 2)
  // Nothing chosen yet is a value the select really holds ('' or, for a ref
  // stored without it, null): left out, the form shows no line until a pick.
  assert.deepEqual(notes[0].visibleWhen, { field: 'operator', equals: ['', null, 'SINGLE-OP-ASSISTED', 'MULTI-ONE'] })
  assert.match(notes[0].text, /Assistance: ON/)
  assert.deepEqual(notes[1].visibleWhen, { field: 'operator', equals: ['SINGLE-OP'] })
  assert.match(notes[1].text, /Assistance: OFF/)
})
