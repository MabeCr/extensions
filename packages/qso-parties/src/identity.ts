// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// One QSO party as the SPOTTING services know it — enough to name the party
// an operation is in and to reach the feeds that carry it, and nothing of the
// rules or the county tables. An extension that reads every party at once
// (the QSO-party spots source, the APRS beacon) imports `identities.ts`, which
// holds one of these per party and weighs a few kilobytes, where the full
// `PARTIES` map would carry every county list into its bundle.
//
// The two readers below are the only code in this package: which party an
// operation is in, and which counties its ref names. Both spotting
// extensions ask them, and two copies of the legacy-prefix rule would be two
// answers to which party a `qp` ref belongs to.

import type { QsoPartyPeriod } from "@ham2k/lib-qso-party"

export interface QsoPartyIdentity {
  /// The ref `type` an operation in this party carries (`neqp`).
  refType: string
  /// The lower-cased party code the bundled `qp` extension filed the party
  /// under, matched as a prefix of a `{type: 'qp', ref}` ref's `ref` — the
  /// same claim the party's own `legacyRefs` makes, except Nebraska's, whose
  /// extension makes none (scripts/convert-parties.mjs). Here every party is
  /// weighed at once and the longest prefix wins, so `ne` still names
  /// Nebraska safely.
  legacyPrefix: string
  name: string
  short: string
  /// The states or provinces the party's own counties are in — one for a
  /// state party, several for 7QP or New England. What tells a county code
  /// on a hub page four parties share which of the four it belongs to.
  states: string[]
  /// The token the Mobile Tracker parses out of an APRS comment to file a
  /// station under this party — `NJQP 14.230`. The party's own short unless
  /// the sponsor has said otherwise: New England's is `NEWE`, because `NEQP`
  /// is Nebraska's short too.
  aprsShort: string
  /// The path segment of this party's feed on `mobiletracker.stateqso.com` —
  /// the US state for a state party, the party's own code for one spanning
  /// several. Absent for the Canadian parties, which the tracker does not
  /// carry.
  trackerCode?: string
  /// The page that lists this party's spots at qsopartyhub.com, without the
  /// `-table.php` suffix. Several parties on one weekend share one page
  /// (`in7qpne_de`).
  hubTablePage: string
  /// The page that takes a new spot for this party at qsopartyhub.com, without
  /// the `-spots.php` suffix. Usually the table's name, but not always: the
  /// hub takes California's spots on `cqp` and lists them on `caqp`.
  hubSpotPage: string
  /// The party's operating periods, UTC millis — what decides whether its
  /// feeds are worth reading right now.
  periods: QsoPartyPeriod[]
}

export interface PartyRef {
  party: QsoPartyIdentity
  /// The operation's own ref, whose `location` is the county (or county line)
  /// it is operating from.
  ref: Record<string, unknown>
}

/// The party an operation is in, or undefined. Reads the party's own ref type
/// first (`{type: 'neqp'}`), then the pair the bundled `qp` extension wrote
/// (`{type: 'qp', ref: 'NEQP'}`) — matched as a prefix, longest first, so that
/// `NEQP` reaches New England and not Nebraska's `NE`.
export function partyOf(operation: Record<string, unknown>, parties: QsoPartyIdentity[]): PartyRef | undefined {
  const refs = Array.isArray(operation.refs) ? (operation.refs as Record<string, unknown>[]) : []
  for (const ref of refs) {
    if (!ref || typeof ref !== 'object') continue
    const type = typeof ref.type === 'string' ? ref.type : ''
    const own = parties.find((party) => party.refType === type)
    if (own) return { party: own, ref }
    if (type === 'qp') {
      const code = typeof ref.ref === 'string' ? ref.ref.toLowerCase() : ''
      const claimed = parties
        .filter((party) => code.startsWith(party.legacyPrefix))
        .sort((a, b) => b.legacyPrefix.length - a.legacyPrefix.length)[0]
      if (claimed) return { party: claimed, ref }
    }
  }
  return undefined
}

/// The county codes an operation's location names — `ORDES/ORJEF` is two,
/// and so is the shorthand `ORDES/JEF`: where the first code carries a state
/// prefix, a later short code inherits it. The engine's own `splitLocations`
/// rule, restated here because importing the engine would carry its scorer
/// and its SDK registrations into a bundle that scores nothing.
export function locationsOf(ref: Record<string, unknown>): string[] {
  const text = typeof ref.location === 'string' ? ref.location : ''
  const codes = text.split(/[/,]/).map((code) => code.trim().toUpperCase()).filter((code) => code)
  if (codes.length > 1 && codes[0].length > 4) {
    const state = codes[0].slice(0, 2)
    return codes.map((code) => (code.length < 4 ? state + code : code))
  }
  return codes
}
