// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The Cabrillo LOCATION: the section for a US or Canadian station, DX for
// everyone else. Callsigns resolve against the bundled country file.

import { test } from "node:test"
import assert from "node:assert/strict"

import { cabrilloLocation, normalizeSection } from "./location.ts"

test("a US or Canadian station writes its section, the possessions included", () => {
  assert.equal(cabrilloLocation('W1AW', { section: 'ct' }), 'CT')
  assert.equal(cabrilloLocation('VE3ABC', { section: 'ONS' }), 'ONS')
  assert.equal(cabrilloLocation('KH6ABC', { section: 'PAC' }), 'PAC')
  assert.equal(cabrilloLocation('KL7ABC', { section: 'AK' }), 'AK')
  assert.equal(cabrilloLocation('KP4ABC', { section: 'PR' }), 'PR')
})

test("everyone else writes DX, whatever section was set", () => {
  assert.equal(cabrilloLocation('DL1ABC', {}), 'DX')
  assert.equal(cabrilloLocation('XE1ABC', { section: 'STX' }), 'DX')
  assert.equal(cabrilloLocation('CY0ABC', {}), 'DX')
})

test("a section that isn't one is written as typed, and none at all writes no line", () => {
  assert.equal(cabrilloLocation('W1AW', { section: ' nyc ' }), 'NYC')
  assert.equal(cabrilloLocation('W1AW', {}), '')
  assert.equal(cabrilloLocation('W1AW', { section: '  ' }), '')
  assert.equal(cabrilloLocation('', { section: 'CT' }), '')
  assert.equal(normalizeSection('DX'), '')
  assert.equal(normalizeSection(' eny '), 'ENY')
})
