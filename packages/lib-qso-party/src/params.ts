// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// One QSO party, as data: everything the shared engine reads to score a log,
// offer an exchange field and write a submittable file.
//
// A party extension is a manifest and one of these. Nothing here is a lookup
// into a bundled table of 49 parties — each extension carries its own — so the
// two identity fields the app-wide version derives from a party KEY are stated
// outright instead:
//
//   * `refType` is the ref's own `type` (`{type: 'txqp'}` — the sponsor's own
//     Cabrillo contest name, lower-cased), where the bundled version carried
//     `{type: 'qp', ref: 'TX'}`. A ref with no `ref` field cannot name a party
//     by key.
//   * `state` is the state or province a county belongs to when nothing else
//     says — the answer the bundled version took from the party key, which no
//     longer exists. A single-state party needs it, because its own county
//     codes carry no state; a party spanning several must NOT have one, because
//     no one of its states outranks the others.
//
// Every option is optional and every default is stated on the field. A party
// file states the rules its sponsor publishes and nothing else.

import type { HookContext, JSONValue } from "@ham2k/extension-sdk"

/// Which national county/section vocabulary a party belongs to — `K` for the US
/// parties, `VE` for the Canadian ones. Decides which of the two tables an
/// out-of-area location is looked up in, and which one an in-party station
/// sweeps.
export type PartyEntity = 'K' | 'VE'

export type PowerClass = 'QRP' | 'LOW' | 'HIGH'

/// `operator` and `transmitter` are one axis here and two in Cabrillo:
/// "Multi-Single" is `CATEGORY-OPERATOR: MULTI-OP` with
/// `CATEGORY-TRANSMITTER: ONE`. They are joined because that is how sponsors
/// publish them, and split again on the way into a file.
export type OperatorClass =
  | 'SINGLE-OP'
  | 'SINGLE-OP-ASSISTED'
  | 'MULTI-ONE'
  | 'MULTI-TWO'
  | 'MULTI-UNLIMITED'

export type StationClass =
  | 'FIXED'
  | 'MOBILE'
  | 'PORTABLE'
  | 'ROVER'
  | 'EXPEDITION'
  | 'COUNTY-LINE'
  | 'SCHOOL'
  | 'CLUB'
  | 'EOC'

export type ModeClass = 'CW' | 'PHONE' | 'DIGITAL' | 'MIXED'

export type OverlayClass =
  | 'ROOKIE'
  | 'YOUTH'
  | 'YL'
  | 'NOVICE-TECH'
  | 'NEW-CONTESTER'
  | 'TB-WIRES'
  | 'POTA'

/// One operating period, in UTC millis. A party that runs Saturday and Sunday
/// sessions with a break overnight publishes two: one range spanning the gap
/// would claim hours the sponsor does not score.
export interface QsoPartyPeriod {
  startMillis: number
  endMillis: number
}

/// The classes a party publishes, and so the questions its setup form asks.
/// An axis the sponsor does not classify by is a question the operator is not
/// asked; every list defaults to empty.
export interface QsoPartyEntryClasses {
  operator?: OperatorClass[]
  power?: PowerClass[]
  /// What the sponsor says each power class means — "100 watts", ">150 watts",
  /// "5 watts CW or 10 watts phone". Shown beside the choice, because the class
  /// names are shared across parties and the watts are not.
  powerLimits?: Partial<Record<PowerClass, string>>
  station?: StationClass[]
  mode?: ModeClass[]
  overlay?: OverlayClass[]
}

/// What the entry row asks for besides the location. Both default false.
export interface QsoPartyExchangeFields {
  /// A serial each way (CA, VA).
  number?: boolean
  /// The operator's name each way (MN).
  name?: boolean
}

/// One operator-facing label: a plain string that replaces the engine's
/// English, or the party's OWN translator closed over its own catalog.
///
/// A function rather than a catalog handed over, because the engine has nothing
/// to merge one into: an event that ships translations builds a translator from
/// `ctx.locale` (the SDK's `createCachedTranslator`) and hands back the finished
/// string. The same shape the SDK's activity scoring rules take for `refNoun`
/// and `p2pLabel`, and for the same reason.
export type QsoPartyLabel = string | ((ctx: HookContext) => string)

/// The strings an operator reads that are the ENGINE's words rather than the
/// sponsor's — the setup form's questions, the exchange row's labels, the
/// export sheet's options.
///
/// Every key defaults to the English constant the engine carries, so a party
/// that declares none reads exactly as it would with this block absent: the
/// seam costs an event nothing until it uses it.
///
/// What is deliberately NOT here: the party's name and short name, its county
/// names and codes, the sponsor's own power limits, the status and update notes
/// and the contest dates. Those are what the rules are published as, and an
/// operator checking a form against a rule book wants them in the rule book's
/// words.
///
/// A label is the WHOLE string an operator reads, except where the comment on
/// the key says the engine appends a value — a translation that omits the half
/// it thought was appended renders half a label.
export interface QsoPartyLabels {
  /// The setup form's location field — `Our QP Location`.
  ///
  /// Deliberately the engine's own words rather than the sponsor's noun: an
  /// operator reading a row of four-character fields needs to know WHICH of
  /// them the QSO party wants, and `County` is wrong anyway for everyone
  /// sending a state or a province. `labelForCounties` names the sponsor's
  /// county-equivalent for the prose that talks ABOUT them; it does not label
  /// these two fields.
  ourLocation?: QsoPartyLabel
  /// The exchange row's location field — `QP Location`. As `ourLocation`.
  theirLocation?: QsoPartyLabel
  /// The same field where the logging row has squeezed it below that label's
  /// width — `QP Loc`. The core measures and picks between the two, so a
  /// translation states the short form and never when it is used; one as long
  /// as the full label simply never gets shown.
  theirLocationShort?: QsoPartyLabel
  /// The county-line instruction. The engine appends an EXAMPLE built from this
  /// party's own county codes, so a translation states the instruction alone.
  countyLineHelp?: QsoPartyLabel
  /// The standing note shown to a party that classes mobiles and rovers.
  mobileHelp?: QsoPartyLabel
  ourName?: QsoPartyLabel
  ourEmail?: QsoPartyLabel
  ourSerial?: QsoPartyLabel
  theirSerial?: QsoPartyLabel
  theirName?: QsoPartyLabel
  /// The empty option every class select carries — `Not declared`, and the
  /// answer a fresh setup keeps.
  classNone?: QsoPartyLabel
  /// The class selects' own labels — `Entry Class`, `Power`, and the rest.
  operator?: QsoPartyLabel
  power?: QsoPartyLabel
  station?: QsoPartyLabel
  mode?: QsoPartyLabel
  overlay?: QsoPartyLabel
  /// The information panel's headings. The engine appends the period, the
  /// status text and the date they describe.
  period?: QsoPartyLabel
  status?: QsoPartyLabel
  lastUpdated?: QsoPartyLabel
  /// The export sheet's two options — `ADIF for TXQP`. The party's short name
  /// is part of the label rather than appended, because where it belongs in the
  /// sentence is the translator's business.
  adifExport?: QsoPartyLabel
  cabrilloExport?: QsoPartyLabel
  /// What each class this party publishes is CALLED. Keyed by the class, so an
  /// event translates the ones its sponsor classifies by and leaves the rest;
  /// an untranslated class reads as the engine's English.
  operatorClasses?: Partial<Record<OperatorClass, QsoPartyLabel>>
  powerClasses?: Partial<Record<PowerClass, QsoPartyLabel>>
  stationClasses?: Partial<Record<StationClass, QsoPartyLabel>>
  modeClasses?: Partial<Record<ModeClass, QsoPartyLabel>>
  overlayClasses?: Partial<Record<OverlayClass, QsoPartyLabel>>
}

/// The bonuses won once for the whole log rather than per QSO. All zero unless
/// the sponsor names them.
export interface QsoPartyBonus {
  /// Points for each county we ACTIVATE — a rover's reward for driving.
  /// Default 0.
  perActivatedCounty?: number
  /// QSOs needed from a county before it counts as activated. Default 1.
  perActivatedCountyMinimumCount?: number
  /// Only mobile and rover entrants earn it. Default false.
  perActivatedCountyRoverOnly?: boolean
  /// Points for working every rare county (NC). Default 0.
  rareCountySweep?: number
  /// Rare counties needed for the sweep. Default 0, meaning every county in
  /// `rareCountyMultipliers`.
  rareCountySweepMinimumCount?: number
  /// Points for working every bonus station (ID). Default 0.
  bonusStationSweep?: number
  /// Bonus stations needed for the sweep. Default 0, meaning every station in
  /// `bonusStations`.
  bonusStationSweepMinimumCount?: number
}

/// Both sides' in/out-of-party standing, which several rules turn on. Passed
/// together because resolving one side needs the other's answer.
export interface QsoPartyStanding {
  weAreInParty: boolean
  theyAreInParty: boolean
}

/// A single resolved location — one side of a contact has two of these when it
/// is on a county line.
export interface QsoPartyLocation {
  /// The code as SCORED: a county abbreviation, a state, a province, or `DX`.
  code: string
  /// The key this location adds to the multiplier set, before the per-band or
  /// per-mode prefix. Usually the code itself; a state where a party counts
  /// states rather than counties, and `DX:<prefix>` where each DX entity
  /// multiplies separately.
  multCode: string
  /// What to call it in a notice or a summary — the county's full name, the
  /// state's, or the DX entity's prefix.
  name: string
  /// Whether this is one of the party's OWN counties. "In state" for a party
  /// spanning seven states or three provinces still means "inside the party".
  inParty: boolean
  /// What a submitted file writes for this location, which is not always what
  /// it scores as: under `dxLocationIsPrefix` a DX station is logged by its
  /// entity prefix while still scoring as the single `DX` multiplier.
  sent: string
}

/// What a contact is worth, for a party whose price no table can state.
export interface QsoPartyPointsArgs {
  qso: Record<string, JSONValue>
  band: string
  /// The super-mode — `CW`, `PHONE`, `DATA` — before `dataAndCWCountAsSameMode`
  /// folds digital into CW. Phone is `PHONE`; `SSB` is the Cabrillo header's
  /// spelling and appears nowhere a party's rules are read.
  superMode: string
  /// Our locations and theirs, already resolved. One contact is worth the price
  /// times `ours.length * theirs.length`, so answer the price of ONE pairing.
  ours: QsoPartyLocation[]
  theirs: QsoPartyLocation[]
  weAreInParty: boolean
  theyAreInParty: boolean
}

/// A party as ONE extension registers it: the party's data, and the key that
/// extension registers its hooks under.
///
/// The key belongs to the extension, not to the party, which is why a party's
/// data file cannot state it. It has no default because nothing else will do:
/// the kernel accepts no hook key but the extension's own, and the party's own
/// ADIF export reaches its `adifFields` hook by this key — naming the refType
/// there names no hook, and the export fails outright.
export interface QsoPartyExtensionParams extends QsoPartyParams {
  extensionKey: string
}

export interface QsoPartyParams {
  // ---------------------------------------------------------------- identity

  /// The ref type this extension owns, and the `type` of every ref it writes —
  /// `txqp`, the sponsor's own Cabrillo contest name lower-cased. Also the key
  /// the scoring hook is scoped to.
  refType: string
  /// References filed under a type this party does not publish, which it
  /// answers for anyway: `[{ type: 'qp', prefix: 'tx' }]` for the operations
  /// logged when fifty parties were one extension.
  ///
  /// The code is matched as a lower-cased PREFIX, and nothing is rewritten —
  /// a claim here is a promise to READ the old shape and to write back into
  /// it, not a licence to change an operator's log. The same claims appear in
  /// the extension's manifest as `ref:qp/tx` (which decides what the app
  /// offers) and on its control as `alsoHandles` (which decides what answers
  /// once it is on); all three are the same list, stated where each layer can
  /// read it.
  legacyRefs?: readonly { type: string; prefix: string }[]
  /// The party's full name, as the sponsor writes it: `Texas QSO Party`.
  name: string
  /// The sponsor's short name — `TXQP`, `7QP`, `Salmon Run` — used in labels,
  /// export filenames and the summary's headings.
  short: string
  /// The state or province this party's counties belong to when no other rule
  /// says — the fallback the SHORT county codes of a single-state party land
  /// in. Nothing in `ALB` says New York; `state` is where that answer comes
  /// from, and a party whose counties are coded that way needs it.
  ///
  /// A party spanning several has NO state. None of them outranks the others,
  /// so naming one would put every county that reaches the fallback in a state
  /// the sponsor never claimed. Such a party answers per county instead —
  /// through `stateOfCounty`, or through the state its own codes carry in their
  /// first two characters — and names what it spans in `states`.
  ///
  /// With no `state`, and neither earlier rule answering, a county has NO
  /// state: `stateForCounty` says so with `''` rather than inventing one.
  state?: string
  /// The states or provinces a multi-state party spans. Read for VERIFICATION
  /// and nothing else — no score, no exchange and no file consults it: every
  /// county's derived state has to be in this list, which is what catches a
  /// mistyped county code and a list carried over from another party's file.
  /// A single-state party does not declare it; its `state` says the same thing
  /// once.
  states?: string[]
  /// The `CONTEST:` line a submitted Cabrillo carries. Without one no Cabrillo
  /// is offered at all: inventing a name produces a file that looks
  /// submittable and is not.
  cabrilloName?: string
  /// The sponsor's rules page, shown in the setup panel and as the ref's link.
  url?: string
  /// What was verified about this party's data, and when — read by an operator
  /// deciding how far to trust the dates and the county list.
  status?: string
  lastUpdated?: string
  /// Every operating period the sponsor publishes, soonest first. Drives the
  /// activity search's ranking, the setup list's order and the information
  /// panel; an empty list reads as "no dates", never as 1970.
  periods: QsoPartyPeriod[]
  /// The icon and accent color the setup and exchange controls carry — the
  /// extension's own manifest values. Default: neither, which the core renders
  /// as a placeholder glyph with no accent.
  icon?: string
  accentColor?: string

  // ----------------------------------------------------------------- options

  /// Which country's vocabulary the party's own counties sit in. Default `K`.
  entity?: PartyEntity
  /// Stations may operate from two counties at once, so one QSO can count for
  /// both. Only affects what the exchange field ACCEPTS; the scorer multiplies
  /// whatever it is given. Default false.
  countyLine?: boolean
  /// DC is scored as Maryland. Rules saying "50 states" with no mention of DC
  /// mean true; rules naming DC explicitly mean false. Default false.
  dcCountsAsMaryland?: boolean
  /// A US or Canadian station outside the party sends its ARRL/RAC SECTION, not
  /// its state or province (PA). Strict: a state is valid only where a section
  /// shares its abbreviation, because the sponsor's checker reads the same list
  /// — so `dcCountsAsMaryland` and `alaskaAndHawaiiAreDX` have nothing to say
  /// under it (`MDC` and `PAC` are sections of their own). Default false.
  sectionsForOutOfState?: boolean
  /// An in-party station counts its OWN state as a multiplier as well as the
  /// county the contact came from (CO). Default false.
  stateCountsForInState?: boolean
  /// Counties are what an in-party station multiplies by, when working another
  /// in-party station. Default TRUE; the parties that set it false (NEQP,
  /// ACQP, CPQP, DEQP) multiply by STATE instead, and the county stays the
  /// county in the log, the checklist and the Cabrillo either way.
  ///
  /// One option where the bundled version has two — `countiesCountForInState`
  /// and `countiesAreMultForInState`, which its own notes describe identically
  /// and which it reads ANDed. Stated once, positively, so a party file cannot
  /// half-say it.
  countiesAreMultipliersInParty?: boolean
  /// Alaska and Hawaii count as DX rather than as US states. Default false.
  alaskaAndHawaiiAreDX?: boolean
  /// Our own county is a multiplier for us, without working anyone in it.
  /// Default false.
  selfCountsForCounty?: boolean
  /// As `selfCountsForCounty`, but only while operating mobile or rover (TN).
  /// Default false.
  selfMobileCountsForCounty?: boolean
  /// Every DX station together is worth ONE multiplier, `DX`. Default false.
  dxIsMultiplier?: boolean
  /// Each DX entity prefix is its own multiplier. Beats `dxIsMultiplier` where
  /// both are set. Default false.
  dxEntityIsMultiplier?: boolean
  /// Caps how many DX entities may be claimed (7QP, NH, WA: 10; IL: 5). The
  /// cap LIMITS the multiplier; it never erases it. Default undefined,
  /// meaning uncapped.
  dxEntityMultiplierMax?: number
  /// Caps the multipliers an in-party entrant's score counts (CA: 58 of the
  /// 63 it can work). Every one worked is still recorded and struck off.
  /// Default undefined, meaning uncapped.
  inStateMultiplierMax?: number
  /// A DX station's logged location is its entity prefix rather than the plain
  /// string `DX`. Default false.
  dxLocationIsPrefix?: boolean
  /// Multipliers count once per band and mode. Default false.
  multsPerBandMode?: boolean
  /// Multipliers count once per band. Default false.
  multsPerBand?: boolean
  /// Multipliers count once per mode. Default false.
  multsPerMode?: boolean
  /// Per-band multipliers for the in-party side only (HI). Default false.
  inStateMultsPerBand?: boolean
  /// Per-band multipliers for the out-of-party side only (NH). Default false.
  outOfStateMultsPerBand?: boolean
  /// A bonus station pays once per band and mode (SC, KY, WI, WV).
  /// Default false.
  bonusPerBandMode?: boolean
  /// A bonus station pays once per mode (the Salmon Run). Default false.
  bonusPerMode?: boolean
  /// Bonus points are added AFTER the multiplier rather than before it.
  /// Default false.
  bonusPostMultiplier?: boolean
  /// Scales a bonus station's points for an in-party entrant. Default 1; ID
  /// sets 0, which is how a party says "the bonus stations pay out-of-state
  /// entrants only".
  bonusStationInStateMult?: number
  /// Scales a bonus station's points for an out-of-party entrant. Default 1.
  bonusStationOutOfStateMult?: number
  /// In-party to out-of-party contacts are worth double (SC). Default false.
  inStateToOutOfStatePointsDouble?: boolean
  /// Digital and CW are one mode for per-mode multipliers, dupes and points.
  /// Default false.
  dataAndCWCountAsSameMode?: boolean
  /// Points for a contact with a station OUTSIDE the party, where the sponsor
  /// prices the two sides differently — Maine pays 2 for a contact with a
  /// Maine station and 1 for anyone else. Default undefined, where the mode
  /// alone sets the price.
  pointsWhenTheyAreOutOfParty?: number
  /// Rover suffixes are stripped from callsigns in the Cabrillo (ID).
  /// Default false.
  removeCountySuffixes?: boolean
  /// What this party calls its subdivisions — CPQP's are Districts. Defaults
  /// `Counties`.
  labelForCounties?: string
  /// The once-per-log bonuses. Every field defaults as documented on
  /// `QsoPartyBonus`; omitting the block pays none of them.
  bonus?: QsoPartyBonus

  // ------------------------------------------------------------------ tables

  /// County abbreviation → name, in the order the summary table prints them
  /// (the sponsor's own, which is alphabetical by name). A party with no
  /// counties has no exchange to check and no multiplier to award.
  counties: Record<string, string>
  /// The neighbouring parties' counties this party's entrants also work (7QP).
  /// Valid exchange values and offered in the picker, but never in-party and
  /// never part of the county sweep. Default `{}`.
  otherCounties?: Record<string, string>
  /// County code → the county ADIF's `CNTY` names it by, for a party whose own
  /// units are not counties (HI's districts). Default `{}`: every other party's
  /// county IS the county, by its own name.
  adifCounties?: Record<string, string>
  /// Super-mode (`CW`, `PHONE`, `DATA`) → points for one contact. Default `{}`,
  /// and an unlisted mode is worth 1: no sponsor lists every mode it allows,
  /// and zeroing a contact is a rules claim a missing entry does not make.
  pointsByMode?: Record<string, number>
  /// Callsign → the points working it pays, once per bonus slot. Default `{}`.
  bonusStations?: Record<string, number>
  /// County → the factor a QSO with it is multiplied by (NC). Default `{}`.
  rareCountyMultipliers?: Record<string, number>
  /// County → the ARRL section it lies in, where an in-party entrant earns that
  /// section as a multiplier on top of the county (PA's `EPA`/`WPA`, rule
  /// 12.d). Default `{}`.
  countySections?: Record<string, string>
  /// Power class → score multiplier for an entrant who declared it. Default
  /// `{}`, and an undeclared class multiplies by 1.
  powerMultipliers?: Partial<Record<PowerClass, number>>
  /// The classes this party publishes. Default: no axis is asked about.
  entryClasses?: QsoPartyEntryClasses
  /// What the entry row asks for besides the location. Default: neither.
  exchange?: QsoPartyExchangeFields

  // ------------------------------------------------------------------ labels

  /// What an operator reads on the setup form, the exchange row and the export
  /// sheet, where the words are the engine's rather than the sponsor's.
  /// Default: the English every key documents on `QsoPartyLabels`. An event
  /// that ships no translations declares nothing here and reads as it always
  /// has.
  labels?: QsoPartyLabels

  // --------------------------------------------------------------- overrides
  //
  // A callback answers where a table cannot. Each one returns `undefined` to
  // mean "no opinion", which falls back to the ordinary rule — so a party may
  // override one case and leave the rest alone.

  /// The state or province a county belongs to. Default: a county code longer
  /// than four characters carries its state in its first two (`ORDES` is
  /// Oregon's Deschutes), and anything shorter belongs to `state` — or to
  /// nothing at all, in a party that has none. The multi-state parties whose
  /// codes are too short to carry a state answer from their own table here.
  stateOfCounty?: (county: string) => string | undefined

  /// What ONE pairing of our location with theirs is worth, for a sponsor
  /// whose price depends on more than the mode. Default: `pointsByMode`, or
  /// `pointsWhenTheyAreOutOfParty` where that applies.
  pointsForContact?: (args: QsoPartyPointsArgs) => number | undefined

  /// The prefix that makes a multiplier key per-band, per-mode, both or
  /// neither — `'20m:'`, `'20m:CW:'`, `''`. Default: the `mults*` options
  /// above. A party whose multipliers split on something else answers here.
  multiplierKeyPrefix?: (
    args: { band: string; mode: string; weAreInParty: boolean },
  ) => string | undefined

  /// What a bonus station pays US. Default: `bonusStations`, scaled by
  /// `bonusStationInStateMult` / `bonusStationOutOfStateMult`. A party whose
  /// bonus depends on the band, the mode or the callsign's shape answers here.
  bonusForStation?: (args: { call: string; weAreInParty: boolean }) => number | undefined

  /// A whole exchange — one location, or a county line's two — resolved.
  /// Default: the shared resolution, which reads this party's counties, the
  /// states and provinces, and the callsign's entity. A party whose exchange
  /// is not a location at all answers here.
  ///
  /// Answering must be all or nothing for a given exchange: the value returned
  /// is what the scoreboard counts AND what the submitted file writes, and the
  /// two disagreeing is the failure this single seam exists to prevent.
  resolveLocation?: (
    args: { text: string; entityPrefix: string; standing: QsoPartyStanding },
  ) => QsoPartyLocation[] | undefined
}
