// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Both grids in SOTA's own files. The traps: a stated locator republished as
// a finer square its center happens to fall in, claiming a precision nobody
// entered; our own eight-character grid leaking from a file that has no
// private-data switch; and a lookup's guess overriding the grid the operator
// typed to correct it.

import { test } from "node:test"
import assert from "node:assert/strict"

import { sotaGridFields } from "./grid.ts"

// FN20's own center, which the app stores beside a stated "FN20".
const FN20_CENTER = { lat: 40.5, lon: -75 }

const grids = (qso: Record<string, unknown>, operation: Record<string, unknown> = {}) =>
  Object.fromEntries(sotaGridFields(qso, operation).map((f) => [f.name, f.value]))

test("a stated locator goes out as stated, not as the finer square its center falls in", () => {
  assert.deepEqual(grids({ their: { grid: "FN20", ...FN20_CENTER } }, { grid: "FN20", ...FN20_CENTER }), { GRIDSQUARE: "FN20", MY_GRIDSQUARE: "FN20" })
})

test("a real coordinate outranks the stored grid, as its six-character square", () => {
  assert.deepEqual(grids({ their: { grid: "FN31", lat: 40.7128, lon: -74.006 } }), { GRIDSQUARE: "FN20xr" })
})

test("our grid never goes out finer than six characters", () => {
  assert.equal(grids({}, { grid: "FN20xr12" }).MY_GRIDSQUARE, "FN20xr")
})

test("a contact that states our location replaces the operation's", () => {
  assert.equal(grids({ our: { grid: "FN31" } }, { grid: "FN20" }).MY_GRIDSQUARE, "FN31")
})

test("the grid the operator typed wins over the lookup's guessed position", () => {
  assert.equal(grids({ their: { grid: "FN31", guess: { lat: 40.7128, lon: -74.006 } } }).GRIDSQUARE, "FN31")
})

test("a country's centroid is not the station's position", () => {
  assert.equal(grids({ their: { guess: { grid: "FN20", lat: 39.8, lon: -98.5, locSource: "prefix" } } }).GRIDSQUARE, "FN20")
})
