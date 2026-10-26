// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// GENERATED — `node scripts/convert-parties.mjs` writes this from
// `fixtures/me.json`. Edit the fixture and re-run; an edit here is lost
// on the next re-sync.

import type { QsoPartyParams } from "@ham2k/lib-qso-party"

import counties from "./me.counties.json" with { type: "json" }

export const PARTY: QsoPartyParams = {
  refType: "me-qso-party",
  name: "Maine QSO Party",
  short: "MEQP",
  // The bundled extension's own pair for this party, which nothing rewrites.
  legacyRefs: [{ type: "qp", prefix: "me" }],
  state: "ME",
  cabrilloName: "ME-QSO-PARTY",
  url: "http://www.ws1sm.com/MEQP.html",
  status: "Added from the sponsor’s rules (2026); scoring not yet verified against a submitted log",
  lastUpdated: "2026-09-06 12:00Z",
  periods: [
    // 2026-9-26 12:00Z — 2026-9-27 12:00Z
    { startMillis: 1790424000000, endMillis: 1790510400000 },
  ],
  dcCountsAsMaryland: true,
  stateCountsForInState: true,
  dxEntityIsMultiplier: true,
  multsPerBandMode: true,
  selfSpotting: false,
  pointsWhenTheyAreOutOfParty: 1,
  pointsByMode: { PHONE: 2, CW: 2 },
  entryClasses: {
    operator: ["SINGLE-OP", "MULTI-ONE", "MULTI-UNLIMITED"],
    power: ["QRP", "LOW", "HIGH"],
    powerLimits: { QRP: "5 watts", LOW: "100 watts", HIGH: ">100 watts" },
    station: ["FIXED", "MOBILE"],
  },
  counties,
}
