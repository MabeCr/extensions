// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The party as the rest of the engine reads it: the author's params with every
// documented default filled in, and every hand-typed code spelled the one way
// everything else spells it.
//
// Two normalizations survive the move from data to code, because both sides of
// the comparison are still typed by hand off a sponsor's PDF:
//
//   * county codes and bonus callsigns are UPPERCASED, since a logged callsign
//     and a typed exchange both arrive uppercase;
//   * `Ø` — the slashed zero hams write — becomes the digit it stands for, so a
//     bonus station written `WØMA` matches the `W0MA` in the log. Without it
//     Missouri's two 100-point bonuses could not be claimed at all.
//
// The normalizations the params types make impossible are gone: the three
// spellings of the power table, `DIGI` beside `DATA` in one points map, an
// exchange declared as an array of field names, and the two option names for
// the one "counties are multipliers in the party" rule.

import type { HookContext } from "@ham2k/extension-sdk"

import type {
  ModeClass,
  OperatorClass,
  OverlayClass,
  PartyEntity,
  PowerClass,
  QsoPartyBonus,
  QsoPartyLabel,
  QsoPartyLabels,
  QsoPartyParams,
  StationClass,
} from "./params.ts"

/// Bands closed to contests by IARU convention. A contact on one is worth
/// nothing to any sponsor, so it scores zero and never reaches a file.
export const WARC_BANDS = ['60m', '30m', '17m', '12m']

/// A party with nothing left to default. Every optional field of
/// `QsoPartyParams` that has a documented default is required here, so no call
/// site repeats a `?? false` — the place a default is written down twice is the
/// place two readers disagree about it.
export interface Party extends QsoPartyParams {
  entity: PartyEntity
  countiesAreMultipliersInParty: boolean
  bonusStationInStateMult: number
  bonusStationOutOfStateMult: number
  labelForCounties: string
  otherCounties: Record<string, string>
  adifCounties: Record<string, string>
  pointsByMode: Record<string, number>
  bonusStations: Record<string, number>
  rareCountyMultipliers: Record<string, number>
  countySections: Record<string, string>
  powerMultipliers: Partial<Record<PowerClass, number>>
  bonus: Required<QsoPartyBonus>
  entryClasses: {
    operator: OperatorClass[]
    power: PowerClass[]
    powerLimits: Partial<Record<PowerClass, string>>
    station: StationClass[]
    mode: ModeClass[]
    overlay: OverlayClass[]
  }
  exchange: { number: boolean; name: boolean }
  labels: QsoPartyLabels
}

/// One operator-facing label: the party's own translator, a plain override, or
/// the engine's English when it declares neither.
///
/// The `ctx` is the one the hook was already handed, so a translator sees the
/// locale the app is running in without the engine knowing anything about
/// locales.
export function resolveLabel(value: QsoPartyLabel | undefined, ctx: HookContext, fallback: string): string {
  return typeof value === 'function' ? value(ctx) : (value ?? fallback)
}

/// A code as everything else spells it — see the file header.
export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[ØÖ]/g, '0')
}

function codeNames(table: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [code, name] of Object.entries(table ?? {})) {
    const key = normalizeCode(code)
    // A code with no name of its own answers with itself, so a summary line or
    // a picker entry never reads as blank.
    out[key] = name || key
  }
  return out
}

function codeNumbers(table: Record<string, number> | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [code, value] of Object.entries(table ?? {})) out[normalizeCode(code)] = value
  return out
}

/// Resolved once per params object: the generators each ask for it, and the
/// county walk `partyStates` memoizes is only worth memoizing if they all get
/// the same party back.
const RESOLVED = new WeakMap<QsoPartyParams, Party>()

export function resolveParty(params: QsoPartyParams): Party {
  const cached = RESOLVED.get(params)
  if (cached) return cached

  const classes = params.entryClasses ?? {}
  const bonus = params.bonus ?? {}
  const party: Party = {
    ...params,
    entity: params.entity ?? 'K',
    // Positively, once: the ordinary case is that counties are multipliers, and
    // only a handful of sponsors say otherwise.
    countiesAreMultipliersInParty: params.countiesAreMultipliersInParty !== false,
    bonusStationInStateMult: params.bonusStationInStateMult ?? 1,
    bonusStationOutOfStateMult: params.bonusStationOutOfStateMult ?? 1,
    labelForCounties: params.labelForCounties ?? 'Counties',
    counties: codeNames(params.counties),
    otherCounties: codeNames(params.otherCounties),
    adifCounties: codeNames(params.adifCounties),
    pointsByMode: codeNumbers(params.pointsByMode),
    bonusStations: codeNumbers(params.bonusStations),
    rareCountyMultipliers: codeNumbers(params.rareCountyMultipliers),
    countySections: Object.fromEntries(Object.entries(params.countySections ?? {}).map(([county, section]) => [normalizeCode(county), normalizeCode(section)])),
    powerMultipliers: params.powerMultipliers ?? {},
    bonus: {
      perActivatedCounty: bonus.perActivatedCounty ?? 0,
      perActivatedCountyMinimumCount: bonus.perActivatedCountyMinimumCount ?? 1,
      perActivatedCountyRoverOnly: bonus.perActivatedCountyRoverOnly ?? false,
      rareCountySweep: bonus.rareCountySweep ?? 0,
      rareCountySweepMinimumCount: bonus.rareCountySweepMinimumCount ?? 0,
      bonusStationSweep: bonus.bonusStationSweep ?? 0,
      bonusStationSweepMinimumCount: bonus.bonusStationSweepMinimumCount ?? 0,
    },
    entryClasses: {
      operator: classes.operator ?? [],
      power: classes.power ?? [],
      powerLimits: classes.powerLimits ?? {},
      station: classes.station ?? [],
      mode: classes.mode ?? [],
      overlay: classes.overlay ?? [],
    },
    exchange: {
      number: params.exchange?.number ?? false,
      name: params.exchange?.name ?? false,
    },
    labels: params.labels ?? {},
  }
  RESOLVED.set(params, party)
  return party
}

/// Whether [location] is one of this party's OWN counties — the test for
/// "in the party", for us and for them alike.
export function isInParty(party: Party, location: string): boolean {
  return party.counties[normalizeCode(location)] !== undefined
}

/// The state or province a county belongs to, by three rules in this order:
/// the party's own table; then the state a code longer than four characters
/// carries in its first two (`ORDES` is Oregon's Deschutes); then the party's
/// `state`, which is what a single-state party's short codes land in.
///
/// A party spanning several states has no `state` — none of them outranks the
/// others — so a short code it does not table has NO state, and the answer is
/// `''`. Callers have to read that as the absence of an answer: `''` is not a
/// state, and using it as one keys a multiplier on nothing.
export function stateForCounty(party: Party, county: string): string {
  const code = normalizeCode(county)
  const declared = party.stateOfCounty?.(code)
  if (declared) return declared.toUpperCase()
  if (code.length > 4) return code.slice(0, 2)
  return party.state?.toUpperCase() ?? ''
}

const PARTY_STATES = new WeakMap<Party, Set<string>>()

/// The states and provinces this party's own counties sit in — one for most,
/// seven for a party spanning a call area.
///
/// Read to catch an in-party operator who typed their STATE where their county
/// belongs: `NY` in the New York QSO Party resolves cleanly to the state, so
/// the value is valid and the entry would otherwise be scored, silently, under
/// out-of-party rules.
export function partyStates(party: Party): Set<string> {
  // Memoized: this walks every county — 470 for the largest party — and the
  // answer never changes, while the caller is on the per-QSO path that a full
  // rescore and every live-scoring keystroke run.
  const cached = PARTY_STATES.get(party)
  if (cached) return cached
  // `''` is `stateForCounty` saying it has no answer, and a set of states holds
  // states — never the absence of one.
  const states = new Set(
    Object.keys(party.counties)
      .map((county) => stateForCounty(party, county))
      .filter((state) => state),
  )
  PARTY_STATES.set(party, states)
  return states
}

/// Points for a contact in [superMode].
///
/// An unlisted mode is worth one point rather than nothing: no sponsor lists
/// every mode it allows, and zeroing a contact is a rules claim a missing entry
/// does not make.
export function pointsForMode(party: Party, superMode: string): number {
  return party.pointsByMode[superMode.toUpperCase()] ?? 1
}

/// The mode a party SCORES a contact in [superMode] as. A party that counts
/// digital and CW as one mode decides dupes, per-mode multipliers and per-mode
/// bonuses alike by that answer — so it is applied once, here, rather than at
/// each of those three sites.
export function scoringModeFor(party: Party, superMode: string): string {
  const mode = superMode.toUpperCase()
  if (party.dataAndCWCountAsSameMode && mode === 'DATA') return 'CW'
  return mode
}

/// When this party next runs, in days, or a negative count once it has started.
/// A party with no dates at all sorts to the far end of the year.
export function daysUntil(party: Party, nowMillis: number): number {
  const start = party.periods[0]?.startMillis
  if (!start) return 365
  return Math.ceil((start - nowMillis) / (24 * 60 * 60 * 1000))
}

/// Whether every period this party publishes is in the past — the params are
/// waiting for next year's update. Uses the LAST period, so a party between its
/// Saturday and Sunday sessions is still running.
export function hasAlreadyRun(party: Party, nowMillis: number): boolean {
  // Falls back to the START where the last period has no end: a party that
  // began last year has run, whatever its end says, and without this one bad
  // date would rank a year-old party as though it were still to come.
  const last = party.periods[party.periods.length - 1]
  const at = last ? (last.endMillis || last.startMillis) : 0
  return at > 0 && at < nowMillis
}
