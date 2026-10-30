// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// GENERATED — `node scripts/convert-parties.mjs` writes this from
// `fixtures/hi.json`. Edit the fixture and re-run; an edit here is lost
// on the next re-sync.

import type { QsoPartyParams } from "@ham2k/lib-qso-party"

import counties from "./hi.counties.json" with { type: "json" }

export const PARTY: QsoPartyParams = {
  refType: "hi-qso-party",
  name: "Hawaii QSO Party",
  short: "HIQP",
  // The bundled extension's own pair for this party, which nothing rewrites.
  legacyRefs: [{ type: "qp", prefix: "hi" }],
  state: "HI",
  cabrilloName: "HI-QSO-PARTY",
  url: "https://www.hawaiiqsoparty.org/",
  status: "Updated for 2026, but not verified",
  lastUpdated: "2026-04-21 12:00Z",
  periods: [
    // 2026-8-22 16:00Z — 2026-8-23 01:59Z
    { startMillis: 1787414400000, endMillis: 1787450340000 },
  ],
  stateCountsForInState: true,
  dxEntityIsMultiplier: true,
  multsPerBandMode: true,
  inStateMultsPerBand: true,
  pointsByMode: { PHONE: 2, CW: 3, DATA: 3 },
  entryClasses: {
    operator: ["SINGLE-OP", "MULTI-ONE", "MULTI-UNLIMITED"],
    power: ["QRP", "LOW", "HIGH"],
    powerLimits: { QRP: "5 watts", LOW: "100 watts", HIGH: "1500 watts" },
  },
  counties,
  // From scripts/convert-parties.mjs, which polo's files do not carry.
  adifCounties: {
    HIL: "Hawaii",
    KOH: "Hawaii",
    KON: "Hawaii",
    VOL: "Hawaii",
    HON: "Honolulu",
    LHN: "Honolulu",
    PRL: "Honolulu",
    WHN: "Honolulu",
    KAL: "Kalawao",
    KAU: "Kauai",
    NII: "Kauai",
    LNI: "Maui",
    MAU: "Maui",
    MOL: "Maui",
  },
}
