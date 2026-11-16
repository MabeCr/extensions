// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { test } from "node:test"

import { bandBreakdown, counted, SECTION_ROWS, sectionsChecklist, sortBands } from "./index.ts"

const ctx = { locale: 'en' }

test("a count agrees with its number", () => {
  assert.equal(counted(1, 'qso', ctx), '1 QSO')
  assert.equal(counted(1_234, 'qso', ctx), '1,234 QSOs')
  assert.equal(counted(1, 'point', ctx), '1 pt')
  assert.equal(counted(0, 'mult', ctx), '0 mults')
})

test("bands go longest wavelength first, whatever order they were worked in", () => {
  // Sorted by name, 10m would come before 160m and 70cm before 2m.
  assert.deepEqual(sortBands(['10m', '70cm', '160m', '2m', '20m', '1.25m']), ['160m', '20m', '10m', '2m', '1.25m', '70cm'])
})

test("a band line carries QSOs, points and multipliers", () => {
  const lines = bandBreakdown(
    [{ band: '20m', qsos: 12, points: 30, mults: 8 }, { band: '40m', qsos: 1, points: 1, mults: 1 }],
    ctx,
    { bands: ['80m', '40m', '20m'] },
  )
  assert.equal(lines, '**80m**: —\n**40m**: 1 QSO, 1 pt, 1 mult\n**20m**: 12 QSOs, 30 pts, 8 mults')
})

test("a contest names its multiplier, leaves out what it does not score, and adds its own notes", () => {
  const lines = bandBreakdown(
    [{ band: '2m', qsos: 2, points: 300, more: ['Longest: 165 km'] }, { band: '15m', qsos: 1, mults: 1 }],
    ctx,
    { multNoun: (count) => (count === 1 ? '1 prefix' : `${count} prefixes`) },
  )
  assert.equal(lines, '**15m**: 1 QSO, 1 prefix\n**2m**: 2 QSOs, 300 pts • Longest: 165 km')
})

test("a band outside the contest's list still shows when it was worked", () => {
  // Without it, contacts on an unexpected band would vanish from the breakdown
  // while still counting in the total above it.
  assert.equal(bandBreakdown([{ band: '60m', qsos: 1 }], ctx, { bands: ['80m'] }), '**80m**: —\n**60m**: 1 QSO')
})

test("the sections checklist strikes what was worked, a row per call area", () => {
  const detail = sectionsChecklist(['CT', 'SDG', 'ONS'], ctx)
  assert.match(detail, /^### Sections: 3 of 85\n\n/)
  assert.match(detail, /^W1 \*\*~~CT~~\*\* EMA ME NH RI VT WMA$/m)
  assert.match(detail, /^VE AB BC GH MB NB NL NS ONE ONN \*\*~~ONS~~\*\* PE QC SK TER$/m)
  // Sweepstakes takes no DX: an empty "Other" row there would be a row of nothing.
  assert.doesNotMatch(detail, /Other/)
})

test("the checklist holds the 85 contest sections, each once", () => {
  // A section on two rows would count twice toward a Clean Sweep; YT, which
  // RAC lists and the ARRL's contest list does not, would make one impossible.
  const codes = SECTION_ROWS.flatMap(([, row]) => row)
  assert.equal(codes.length, 85)
  assert.equal(new Set(codes).size, 85)
  assert.ok(!codes.includes('YT'))
})

test("a worked code outside the 85 gets a row of its own, and does not count toward the sweep", () => {
  // Field Day takes DX and MX in the exchange; dropping them would hide
  // contacts the score counts, and counting them would claim a section never
  // worked.
  const all = SECTION_ROWS.flatMap(([, row]) => row)
  const detail = sectionsChecklist([...all.slice(1), 'MX', 'DX'], ctx)
  assert.match(detail, /^### Sections: 84 of 85/)
  assert.match(detail, /^Other \*\*~~DX~~\*\* \*\*~~MX~~\*\*$/m)
  assert.match(sectionsChecklist(all, ctx), /^### Clean Sweep! All 85 sections/)
})

test("the checklist's words follow the operator's language", () => {
  const detail = sectionsChecklist(['DX'], { locale: 'es' })
  assert.match(detail, /^### Secciones: 0 de 85/)
  assert.match(detail, /^Otras \*\*~~DX~~\*\*$/m)
})
