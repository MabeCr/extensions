// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// GENERATED — `node scripts/convert-parties.mjs` writes this from
// `fixtures/md.json`. Edit the fixture and re-run; an edit here is lost
// on the next re-sync.

import type { QsoPartyParams } from "@ham2k/lib-qso-party"

import counties from "./md.counties.json" with { type: "json" }

export const PARTY: QsoPartyParams = {
  refType: "mdc-qso-party",
  name: "Maryland-DC QSO Party",
  short: "MDQP",
  // The bundled extension's own pair for this party, which nothing rewrites.
  legacyRefs: [{ type: "qp", prefix: "md" }],
  state: "MD",
  cabrilloName: "MDC-QSO-PARTY",
  url: "https://w3vpr.org/wp/2025/12/21/mdc-qso-party/",
  status: "Updated for 2026, but not verified",
  lastUpdated: "2026-04-21 12:00Z",
  periods: [
    // 2026-8-8 14:00Z — 2026-8-9 03:59Z
    { startMillis: 1786197600000, endMillis: 1786247940000 },
  ],
  dxEntityIsMultiplier: true,
  dxLocationIsPrefix: true,
  bonusPostMultiplier: true,
  selfSpotting: false,
  pointsByMode: { PHONE: 1, CW: 3 },
  bonusStations: { W3VPR: 50 },
  entryClasses: {
    operator: ["SINGLE-OP", "MULTI-ONE"],
    power: ["QRP", "LOW", "HIGH"],
    powerLimits: { QRP: "5 watts", LOW: "100 watts", HIGH: ">100 watts" },
    station: ["FIXED", "MOBILE", "PORTABLE", "ROVER", "CLUB"],
  },
  counties,
}
