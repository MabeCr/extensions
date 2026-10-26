// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// GENERATED — `node scripts/convert-parties.mjs` writes this from
// `fixtures/la.json`. Edit the fixture and re-run; an edit here is lost
// on the next re-sync.

import type { QsoPartyParams } from "@ham2k/lib-qso-party"

import counties from "./la.counties.json" with { type: "json" }

export const PARTY: QsoPartyParams = {
  refType: "la-qso-party",
  name: "Louisiana QSO Party",
  short: "LAQP",
  // The bundled extension's own pair for this party, which nothing rewrites.
  legacyRefs: [{ type: "qp", prefix: "la" }],
  state: "LA",
  cabrilloName: "LA-QSO-PARTY",
  url: "https://laqp.louisianacontestclub.org/",
  status: "Based on 2025 rules, not yet verified for 2026.",
  lastUpdated: "2026-03-18 12:00Z",
  periods: [
    // 2026-4-4 14:00Z — 2026-4-5 01:59Z
    { startMillis: 1775311200000, endMillis: 1775354340000 },
  ],
  countyLine: true,
  dcCountsAsMaryland: true,
  dxEntityIsMultiplier: true,
  dxLocationIsPrefix: true,
  multsPerBandMode: true,
  dataAndCWCountAsSameMode: true,
  selfSpotting: false,
  bonus: {
    perActivatedCounty: 50,
    perActivatedCountyRoverOnly: true,
  },
  pointsByMode: { PHONE: 2, CW: 4, DATA: 4 },
  bonusStations: { N5LCC: 100 },
  entryClasses: {
    power: ["QRP", "LOW", "HIGH"],
    powerLimits: { QRP: "5 watts", LOW: "100 watts", HIGH: "1500 watts" },
    station: ["FIXED", "ROVER"],
    mode: ["CW", "PHONE", "DIGITAL", "MIXED"],
    overlay: ["TB-WIRES", "POTA"],
  },
  counties,
}
