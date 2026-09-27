// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The QSO-party engine: one set of rules, one scorer, one exchange field and
// one submittable file for every party that hands this module a
// `QsoPartyParams`.
//
// An extension for one party is its manifest, its counties and its options —
// `defineQsoParty(params)` answers with everything it registers, so a party
// file states rules and never repeats a hook.

import { contestScorer, entityPrefixForCall } from "@ham2k/extension-sdk"
import type {
  ActivityHook,
  AdifFieldsHook,
  ContestScorer,
  ExportHook,
  RefHandlerHook,
  ScoringHook,
  ScoringScope,
} from "@ham2k/extension-sdk"

import { qsoPartyActivity } from "./activity.ts"
import { registerEntityLookup } from "./dxcc.ts"
import { qsoPartyAdifFields, qsoPartyExport } from "./exports.ts"
import type { QsoPartyExtensionParams } from "./params.ts"
import { qsoPartyRefHandler } from "./refHandler.ts"
import { qsoPartyScorer } from "./scorer.ts"
import type { MultKind } from "./scorer.ts"

export type {
  ModeClass,
  OperatorClass,
  OverlayClass,
  PartyEntity,
  PowerClass,
  QsoPartyBonus,
  QsoPartyEntryClasses,
  QsoPartyExchangeFields,
  QsoPartyExtensionParams,
  QsoPartyLabel,
  QsoPartyLabels,
  QsoPartyLocation,
  QsoPartyParams,
  QsoPartyPeriod,
  QsoPartyPointsArgs,
  QsoPartyStanding,
  StationClass,
} from "./params.ts"

// The host's country file, handed to the seam the scorer and the exchange read
// it through (`dxcc.ts`). Registered here because this module is the package's
// only entry — an extension that imports anything from this engine has already
// run this line — and because it is the SDK's runtime that the engine's own
// tests cannot load.
registerEntityLookup(entityPrefixForCall)

export { qsoPartyActivity } from "./activity.ts"
export { qsoPartyAdifFields, qsoPartyExport } from "./exports.ts"
export { qsoPartyRefHandler } from "./refHandler.ts"
export { qsoPartyScorer } from "./scorer.ts"

/// The scorer's running record. A `type` rather than an `interface`, which is
/// what makes it satisfy the SDK's `Scoresheet` (JSON) constraint: the core
/// snapshots it as a checkpoint, so every field has to be JSON.
export type QsoPartyScoresheet = {
  /// Whether WE are inside the party, and what our entry multiplies by. Both
  /// are recorded from the first QSO scored, because the summary is handed the
  /// BASE operation's ref and a rover's segment may be the only place they are
  /// stated.
  weAreInParty?: boolean
  powerMult?: number
  /// Whether we entered as a mobile or rover station. Once true it stays true:
  /// a rover who parks for an hour is still a rover.
  mobile?: boolean
  /// Multiplier key (band/mode prefix + code) → times claimed. Its SIZE is the
  /// multiplier.
  mults: Record<string, number>
  /// Multiplier key → what kind of place it names, recorded as the key is
  /// credited. The key alone cannot say: a county code and a state code can be
  /// the same letters, and a county may multiply as its state. Optional because
  /// a scoresheet cached by an earlier build has none.
  multKinds?: Record<string, MultKind>
  /// The party's own counties worked, for the checklist the operator reads
  /// while deciding what to chase.
  counties: Record<string, number>
  states: Record<string, number>
  provinces: Record<string, number>
  /// DX entity prefix → contacts, or the single key `DX` where a party counts
  /// every DX station as one multiplier.
  entities: Record<string, number>
  /// The entities a multiplier was actually CREDITED for — what
  /// `dxEntityMultiplierMax` caps, and never the same as `entities` once a
  /// party is at its limit.
  creditedEntities: Record<string, number>
  rareCounties: Record<string, number>
  /// Bonus key (band/mode prefix + callsign) → the points it paid, once.
  bonuses: Record<string, number>
  /// Bonus station callsign → points, regardless of how many band/mode slots
  /// paid: the sweep counts STATIONS.
  bonusStations: Record<string, number>
  /// Our own counties → contacts made from each. What the per-county bonus
  /// counts.
  activatedCounties: Record<string, number>
  /// Callsign → `band|mode|ourCounty` → their counties already credited there.
  worked: Record<string, Record<string, string[]>>
  /// Callsign → the location they last sent, so a second contact with a
  /// station whose exchange went untyped is scored under the county they gave
  /// the first time.
  lastLocation: Record<string, string>
  bands: Record<string, number>
  modes: Record<string, number>
  /// Band → super-mode (`CW`, `PHONE`, `DATA`) → contacts, for the summary's
  /// band table. The super-mode, not the party's scoring mode: a party that
  /// folds digital into CW for its rules still reports them apart. Optional
  /// because a scoresheet cached by an earlier build has none.
  bandModes?: Record<string, Record<string, number>>
  qsos: number
  points: number
  dupes: number
}

/// Everything one party's extension registers, built from its params.
export interface QsoPartyHooks {
  /// The ref type these hooks answer for — `registerHook('ref:${refType}')`,
  /// and the scoring scope.
  refType: string
  activity: ActivityHook
  refHandler: RefHandlerHook
  adifFields: AdifFieldsHook
  export: ExportHook
  /// Already wrapped by the SDK's `contestScorer`, scoped to `refType`.
  scoring: ScoringHook & { scope: ScoringScope }
}

/// One party's whole app-facing surface.
///
/// Every hook is built from the SAME params object, which is what keeps the
/// scoreboard and the submitted file reading one set of rules: an extension that
/// built its scorer from one set of options and its export from another would
/// disagree with itself, contact by contact, and only in the file.
export function defineQsoParty(params: QsoPartyExtensionParams): QsoPartyHooks {
  return {
    refType: params.refType,
    activity: qsoPartyActivity(params),
    refHandler: qsoPartyRefHandler(params),
    adifFields: qsoPartyAdifFields(params),
    export: qsoPartyExport(params),
    // The legacy types too, or an operation logged when fifty parties were one
    // extension scores zero while its row sits there answered. The scope is a
    // filter on which operations reach a scorer, not a claim of ownership:
    // every party's scorer is offered a `qp` operation and `partyRefIn` hands
    // back nothing for the forty-eight it does not belong to.
    scoring: contestScorer(qsoPartyScorer(params), {
      scope: { refTypes: [...new Set([params.refType, ...(params.legacyRefs ?? []).map((c) => c.type)])] },
    }),
  }
}

/// Re-exported so an extension can name the scorer's type without reaching into
/// the engine's own modules.
export type { ContestScorer }
