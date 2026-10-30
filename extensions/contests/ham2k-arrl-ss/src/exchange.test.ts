// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Who counts, and which sections the picker ranks first for a station.
// Callsigns resolve against the bundled country file (no network).

import { test } from "node:test"
import assert from "node:assert/strict"

import { isWVE, normalizeSection, preferredSections } from "./exchange.ts"

test("W/VE is the US and Canada with their territories and possessions", () => {
  for (const call of ['W1AW', 'VE3ABC', 'VY1ABC', 'KL7ABC', 'KH6ABC', 'KP4ABC', 'KP2ABC', 'KH2ABC']) {
    assert.equal(isWVE(call), true, call)
  }
  // Sable and St. Paul are DX by the rules' definitions, as is everywhere else.
  for (const call of ['DL1ABC', 'XE1ABC', 'CY0ABC', 'CY9ABC']) {
    assert.equal(isWVE(call), false, call)
  }
})

test("only the 85 sections are sections", () => {
  assert.equal(normalizeSection('ens'), '')
  assert.equal(normalizeSection(' eny '), 'ENY')
  assert.equal(normalizeSection('TER'), 'TER')
  // Yukon sends TER; DX and MX are Field Day's, not Sweepstakes'.
  assert.equal(normalizeSection('YT'), '')
  assert.equal(normalizeSection('DX'), '')
  assert.equal(normalizeSection('MX'), '')
})

test("a looked-up state that is a whole section is ranked alone", () => {
  assert.deepEqual(preferredSections({ call: 'W1AW', state: 'CT' }), ['CT'])
  assert.deepEqual(preferredSections({ call: 'K3ABC', guess: { state: 'MD' } }), ['MDC'])
  assert.deepEqual(preferredSections({ call: 'KH6ABC', state: 'HI' }), ['PAC'])
})

test("a split state falls back to the call area", () => {
  const sections = preferredSections({ call: 'W6ABC', state: 'CA' })
  assert.ok(sections.includes('SCV') && sections.includes('LAX'))
  assert.ok(!sections.includes('CT'))
})

test("a prefix that names its section wins; Ontario gives no single answer", () => {
  assert.deepEqual(preferredSections({ call: 'KL7ABC' }), ['AK'])
  assert.deepEqual(preferredSections({ call: 'VE7ABC' }), ['BC'])
  assert.deepEqual(preferredSections({ call: 'VE3ABC' }), [])
})
