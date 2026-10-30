// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// DIVERGES from app-polo, deliberately. polo's copy still carries 2025
// dates; these were re-read from the sponsor's own rules in September 2026.
// Never take polo's file back over this one without re-reading the sponsor —
// its dates are OLDER than these, not newer.
//
// GENERATED — `node scripts/convert-parties.mjs` writes this from
// `fixtures/bc.json`. Edit the fixture and re-run; an edit here is lost
// on the next re-sync.

import type { QsoPartyParams } from "@ham2k/lib-qso-party"

import counties from "./bc.counties.json" with { type: "json" }

export const PARTY: QsoPartyParams = {
  refType: "bc-qso-party",
  name: "British Columbia QSO Party",
  short: "BCQP",
  // The bundled extension's own pair for this party, which nothing rewrites.
  legacyRefs: [{ type: "qp", prefix: "bc" }],
  state: "BC",
  cabrilloName: "BC-QSO-PARTY",
  url: "https://www.orcadxcc.org/bcqp_rules.html",
  status: "Dates verified for 2026 against the sponsor’s rules",
  lastUpdated: "2026-09-06 12:00Z",
  periods: [
    // 2026-2-7 16:00Z — 2026-2-8 03:59Z
    { startMillis: 1770480000000, endMillis: 1770523140000 },
    // 2026-2-8 16:00Z — 2026-2-8 23:59Z
    { startMillis: 1770566400000, endMillis: 1770595140000 },
  ],
  entity: "VE",
  countyLine: true,
  dcCountsAsMaryland: true,
  dxEntityIsMultiplier: true,
  multsPerBandMode: true,
  selfSpotting: false,
  pointsByMode: { PHONE: 2, CW: 4, DATA: 0 },
  bonusStations: { VA7ODX: 20 },
  entryClasses: {
    operator: ["SINGLE-OP", "MULTI-ONE"],
    power: ["QRP", "LOW", "HIGH"],
    powerLimits: { QRP: "5 watts", LOW: "100 watts", HIGH: ">100 watts" },
    mode: ["CW", "PHONE", "MIXED"],
  },
  counties,
}
