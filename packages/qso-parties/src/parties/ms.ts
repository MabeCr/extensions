// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// GENERATED — `node scripts/convert-parties.mjs` writes this from
// `fixtures/ms.json`. Edit the fixture and re-run; an edit here is lost
// on the next re-sync.

import type { QsoPartyParams } from "@ham2k/lib-qso-party"

import counties from "./ms.counties.json" with { type: "json" }

export const PARTY: QsoPartyParams = {
  refType: "ms-qso-party",
  name: "Mississippi QSO Party",
  short: "MSQP",
  // The bundled extension's own pair for this party, which nothing rewrites.
  legacyRefs: [{ type: "qp", prefix: "ms" }],
  state: "MS",
  cabrilloName: "MS-QSO-PARTY",
  url: "https://arrlmiss.org/mississippi-qso-party/",
  status: "Updated for 2026, but not yet verified.",
  lastUpdated: "2026-03-18 12:00Z",
  periods: [
    // 2026-4-4 14:00Z — 2026-4-5 01:59Z
    { startMillis: 1775311200000, endMillis: 1775354340000 },
  ],
  dcCountsAsMaryland: true,
  dxEntityIsMultiplier: true,
  dxLocationIsPrefix: true,
  selfSpotting: false,
  pointsByMode: { PHONE: 1, CW: 2, DATA: 2 },
  entryClasses: {
    operator: ["SINGLE-OP", "MULTI-UNLIMITED"],
    station: ["FIXED", "MOBILE", "PORTABLE"],
  },
  counties,
}
