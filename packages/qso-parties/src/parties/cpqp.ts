// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// GENERATED — `node scripts/convert-parties.mjs` writes this from
// `fixtures/cpqp.json`. Edit the fixture and re-run; an edit here is lost
// on the next re-sync.

import type { QsoPartyParams } from "@ham2k/lib-qso-party"

import counties from "./cpqp.counties.json" with { type: "json" }
import countyStates from "./cpqp.county-states.json" with { type: "json" }

/// A county's own state, for a party spanning several: its codes carry no
/// state prefix for the ordinary rule to read.
const COUNTY_STATES: Record<string, string> = countyStates

export const PARTY: QsoPartyParams = {
  refType: "cp-qso-party",
  name: "Canadian Prairies QSO Party",
  short: "CPQP",
  // The bundled extension's own pair for this party, which nothing rewrites.
  legacyRefs: [{ type: "qp", prefix: "cpqp" }],
  // Several states, no one of them this party's own. Every county below names
  // its state, in its abbreviation or in the table, and `states` is the list
  // each of those has to fall in — a check on the county data, and nothing a
  // score reads.
  states: ["AB", "MB", "SK"],
  cabrilloName: "CP-QSO-PARTY",
  url: "https://cpqp.ve6hams.ca/",
  status: "Updated for 2026, but not verified",
  lastUpdated: "2026-04-21 12:00Z",
  periods: [
    // 2026-5-9 17:00Z — 2026-5-10 03:00Z
    { startMillis: 1778346000000, endMillis: 1778382000000 },
  ],
  entity: "VE",
  countyLine: true,
  dcCountsAsMaryland: true,
  stateCountsForInState: true,
  multsPerBand: true,
  countiesAreMultipliersInParty: false,
  selfSpotting: false,
  labelForCounties: "Districts",
  pointsByMode: { PHONE: 1, CW: 1 },
  entryClasses: {
    operator: ["SINGLE-OP", "MULTI-ONE"],
    power: ["QRP", "LOW", "HIGH"],
    powerLimits: { QRP: "5W", LOW: "100W", HIGH: ">100W" },
    station: ["FIXED", "ROVER"],
  },
  counties,
  stateOfCounty: (county) => COUNTY_STATES[county.toUpperCase()],
}
