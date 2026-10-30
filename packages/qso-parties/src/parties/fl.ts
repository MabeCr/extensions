// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// GENERATED — `node scripts/convert-parties.mjs` writes this from
// `fixtures/fl.json`. Edit the fixture and re-run; an edit here is lost
// on the next re-sync.

import type { QsoPartyParams } from "@ham2k/lib-qso-party"

import counties from "./fl.counties.json" with { type: "json" }

export const PARTY: QsoPartyParams = {
  refType: "fcg-fqp",
  name: "Florida QSO Party",
  short: "FLQP",
  // The bundled extension's own pair for this party, which nothing rewrites.
  legacyRefs: [{ type: "qp", prefix: "fl" }],
  state: "FL",
  cabrilloName: "FCG-FQP",
  url: "https://www.floridaqsoparty.org/",
  status: "Updated for 2026, but not yet verified.",
  lastUpdated: "2026-03-18 12:00Z",
  periods: [
    // 2026-4-25 16:00Z — 2026-4-26 01:59Z
    { startMillis: 1777132800000, endMillis: 1777168740000 },
    // 2026-4-26 12:00Z — 2026-4-26 21:59Z
    { startMillis: 1777204800000, endMillis: 1777240740000 },
  ],
  stateCountsForInState: true,
  dxLocationIsPrefix: true,
  multsPerMode: true,
  selfSpotting: false,
  pointsByMode: { PHONE: 1, CW: 2 },
  powerMultipliers: { QRP: 3, LOW: 2, HIGH: 1 },
  entryClasses: {
    operator: ["SINGLE-OP", "SINGLE-OP-ASSISTED", "MULTI-ONE", "MULTI-UNLIMITED"],
    power: ["QRP", "LOW", "HIGH"],
    powerLimits: { QRP: "5 watts", LOW: "100 watts", HIGH: ">100 watts" },
    station: ["FIXED", "MOBILE", "EXPEDITION", "SCHOOL"],
    mode: ["CW", "PHONE", "MIXED"],
    overlay: ["NOVICE-TECH"],
  },
  counties,
}
