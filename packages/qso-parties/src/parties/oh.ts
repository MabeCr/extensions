// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// GENERATED — `node scripts/convert-parties.mjs` writes this from
// `fixtures/oh.json`. Edit the fixture and re-run; an edit here is lost
// on the next re-sync.

import type { QsoPartyParams } from "@ham2k/lib-qso-party"

import counties from "./oh.counties.json" with { type: "json" }

export const PARTY: QsoPartyParams = {
  refType: "mrrc-ohqp",
  name: "Ohio QSO Party",
  short: "OHQP",
  // The bundled extension's own pair for this party, which nothing rewrites.
  legacyRefs: [{ type: "qp", prefix: "oh" }],
  state: "OH",
  cabrilloName: "MRRC-OHQP",
  url: "https://www.ohqp.org/",
  status: "Updated for 2026, but not verified",
  lastUpdated: "2026-04-21 12:00Z",
  periods: [
    // 2026-8-22 16:00Z — 2026-8-23 03:59Z
    { startMillis: 1787414400000, endMillis: 1787457540000 },
  ],
  dcCountsAsMaryland: true,
  dxIsMultiplier: true,
  multsPerMode: true,
  selfSpotting: false,
  bonus: {
    perActivatedCounty: 100,
    perActivatedCountyRoverOnly: true,
  },
  pointsByMode: { PHONE: 1, CW: 2 },
  entryClasses: {
    operator: ["SINGLE-OP", "MULTI-ONE"],
    power: ["QRP", "LOW", "HIGH"],
    powerLimits: { QRP: "5 watts", LOW: "100 watts", HIGH: ">100 watts" },
    station: ["FIXED", "MOBILE", "ROVER", "EOC"],
  },
  counties,
}
