// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The parties this engine's own tests are written against.
//
// Each one is a real sponsor's rules with its county list cut down to the codes
// the tests name — the OPTIONS are verbatim, because they are what is being
// tested: every switch a shipped party sets is exercised here against the party
// that sets it, so a change that quietly stops reading one fails a test rather
// than silently scoring nothing.
//
// A trimmed county list is safe for every rule but one: `exchangeInheritPrefix`
// and the county-line shorthand turn on how LONG a code is, so the multi-state
// party below keeps its five-character codes.

import type { QsoPartyParams } from "./params.ts"

/// A weekend in the middle of the test clock's year. The exact dates matter to
/// nothing but the activity row, which tests them explicitly.
const PERIOD = { startMillis: Date.UTC(2026, 9, 17, 14), endMillis: Date.UTC(2026, 9, 18, 1, 59) }

type PartySpec =
  & Partial<QsoPartyParams>
  & Pick<QsoPartyParams, 'refType' | 'short' | 'counties'>

function party(spec: PartySpec): QsoPartyParams {
  return { name: `${spec.short} Test Party`, periods: [PERIOD], ...spec }
}

/// New York: counties and the state itself both multiply, DC folds into
/// Maryland, county lines are allowed, and the three modes are priced apart.
export const NY = party({
  refType: 'ny-qso-party',
  name: 'New York QSO Party',
  short: 'NYQP',
  state: 'NY',
  cabrilloName: 'NY-QSO-PARTY',
  url: 'https://nyqp.org/',
  countyLine: true,
  dcCountsAsMaryland: true,
  stateCountsForInState: true,
  pointsByMode: { PHONE: 1, CW: 2, DATA: 3 },
  counties: { ALB: 'Albany', ALL: 'Allegany', CHA: 'Chautauqua', ERI: 'Erie', REN: 'Rensselaer' },
  entryClasses: {
    operator: ['SINGLE-OP', 'MULTI-ONE', 'MULTI-UNLIMITED'],
    station: ['FIXED', 'MOBILE', 'PORTABLE', 'SCHOOL'],
    mode: ['CW', 'PHONE', 'DIGITAL', 'MIXED'],
    overlay: ['ROOKIE', 'YOUTH', 'YL'],
    power: ['QRP', 'LOW', 'HIGH'],
    powerLimits: { QRP: '5 watts', LOW: '100 watts', HIGH: '>100 watts' },
  },
})

/// Maryland-DC, the party that names DC in its own rules and so keeps it apart.
export const MD = party({
  refType: 'md-qso-party',
  short: 'MDQP',
  state: 'MD',
  counties: { ALLE: 'Allegany', ANNE: 'Anne Arundel' },
})

/// New England: six states in one party, where an in-party pair multiplies by
/// STATE and the county is only an exchange.
///
/// No `state`, like every multi-state party: each of its county codes carries
/// its own, so nothing here ever reaches that fallback — and a code that did
/// would resolve to no state rather than to whichever one was named lead.
/// `states` names what the TRIMMED county list below spans, not the sponsor's
/// six, because it is the counties here that it has to agree with.
export const NEQP = party({
  refType: 'neqp',
  short: 'NEQP',
  states: ['CT', 'MA', 'RI'],
  countyLine: true,
  dcCountsAsMaryland: true,
  stateCountsForInState: true,
  countiesAreMultipliersInParty: false,
  dxEntityIsMultiplier: true,
  dataAndCWCountAsSameMode: true,
  pointsByMode: { PHONE: 1, CW: 2 },
  counties: { MABAR: 'Barnstable', MAWOR: 'Worcester', CTCAP: 'Capitol', RIPRO: 'Providence' },
})

/// Atlantic Canada: the same rule in a Canadian party, whose out-of-area
/// vocabulary is the provinces.
export const ACQP = party({
  refType: 'acqp',
  short: 'ACQP',
  states: ['NB', 'NS'],
  entity: 'VE',
  countyLine: true,
  dcCountsAsMaryland: true,
  stateCountsForInState: true,
  countiesAreMultipliersInParty: false,
  multsPerBand: true,
  pointsByMode: { PHONE: 1, CW: 1 },
  counties: { NSANP: 'Annapolis', NSCOL: 'Colchester', NBSJN: 'Saint John' },
})

/// South Carolina: in-state to out-of-state doubles, and both the multipliers
/// and the bonus stations count once per band and mode.
export const SC = party({
  refType: 'sc-qso-party',
  short: 'SCQP',
  state: 'SC',
  countyLine: true,
  stateCountsForInState: true,
  inStateToOutOfStatePointsDouble: true,
  bonusPerBandMode: true,
  multsPerBandMode: true,
  pointsByMode: { PHONE: 2, CW: 2, DATA: 2 },
  counties: { ABBE: 'Abbeville', AIKE: 'Aiken' },
})

/// North Carolina: rare counties multiply the contact, the sweep pays once, our
/// own county counts without working anyone in it, and the bonus lands AFTER
/// the multiplier.
export const NC = party({
  refType: 'nc-qso-party',
  short: 'NCQP',
  state: 'NC',
  countyLine: true,
  selfCountsForCounty: true,
  dxIsMultiplier: true,
  bonusPostMultiplier: true,
  pointsByMode: { PHONE: 2, CW: 3, DATA: 5 },
  rareCountyMultipliers: { CAB: 10, GRM: 10, VAN: 10, MAC: 10, DAV: 10 },
  bonus: { rareCountySweep: 500, rareCountySweepMinimumCount: 5 },
  counties: {
    WAK: 'Wake', CAB: 'Cabarrus', GRM: 'Graham', VAN: 'Vance', MAC: 'Macon', DAV: 'Davie',
  },
})

/// Idaho: four bonus stations that pay out-of-state entrants only, a sweep for
/// working all four, and rover suffixes stripped from the file.
export const ID = party({
  refType: 'id-qso-party',
  short: 'IDQP',
  state: 'ID',
  countyLine: true,
  multsPerMode: true,
  stateCountsForInState: true,
  dxEntityIsMultiplier: true,
  dxLocationIsPrefix: true,
  removeCountySuffixes: true,
  bonusStationInStateMult: 0,
  pointsByMode: { PHONE: 1, CW: 2, DATA: 2 },
  bonusStations: { K7S: 100, K7P: 100, K7U: 100, K7D: 100 },
  bonus: { bonusStationSweep: 100 },
  counties: { ADA: 'Ada', BOI: 'Boise' },
})

/// Colorado: 500 points for each county a ROVER activates, and only above
/// fifteen contacts from it.
export const CO = party({
  refType: 'co-qso-party',
  short: 'COQP',
  state: 'CO',
  countyLine: true,
  stateCountsForInState: true,
  dxIsMultiplier: true,
  multsPerMode: true,
  bonusPostMultiplier: true,
  pointsByMode: { PHONE: 2, CW: 2 },
  bonus: { perActivatedCounty: 500, perActivatedCountyMinimumCount: 15, perActivatedCountyRoverOnly: true },
  counties: { ADA: 'Adams', DEN: 'Denver' },
  entryClasses: { station: ['FIXED', 'MOBILE', 'PORTABLE'], power: ['QRP', 'LOW', 'HIGH'] },
})

/// Delaware: a published power table, which multiplies the whole score.
export const DE = party({
  refType: 'de-qso-party',
  short: 'DEQP',
  state: 'DE',
  stateCountsForInState: true,
  dxEntityIsMultiplier: true,
  dataAndCWCountAsSameMode: true,
  countiesAreMultipliersInParty: false,
  pointsByMode: { PHONE: 1, CW: 2 },
  powerMultipliers: { QRP: 3, LOW: 2, HIGH: 1 },
  counties: { NDE: 'New Castle', KDE: 'Kent', SDE: 'Sussex' },
  entryClasses: { power: ['QRP', 'LOW', 'HIGH'], powerLimits: { QRP: '5 watts' } },
})

/// Maine: two points for a contact with a Maine station and one for anyone
/// else — the published rule no per-mode table can express.
export const ME = party({
  refType: 'me-qso-party',
  short: 'MEQP',
  state: 'ME',
  stateCountsForInState: true,
  dxEntityIsMultiplier: true,
  multsPerBandMode: true,
  pointsWhenTheyAreOutOfParty: 1,
  pointsByMode: { PHONE: 2, CW: 2 },
  counties: { CBL: 'Cumberland', AND: 'Androscoggin' },
})

/// Illinois: each DX entity multiplies, up to five of them.
export const IL = party({
  refType: 'il-qso-party',
  short: 'ILQP',
  state: 'IL',
  countyLine: true,
  dcCountsAsMaryland: true,
  dxEntityIsMultiplier: true,
  dxEntityMultiplierMax: 5,
  pointsByMode: { PHONE: 1, CW: 2, DATA: 2 },
  counties: { COOK: 'Cook', ADAM: 'Adams' },
})

/// New Hampshire: the out-of-state side counts multipliers per band, and up to
/// ten DX entities count.
export const NH = party({
  refType: 'nh-qso-party',
  short: 'NHQP',
  state: 'NH',
  dcCountsAsMaryland: true,
  dxIsMultiplier: true,
  dxEntityIsMultiplier: true,
  dxEntityMultiplierMax: 10,
  outOfStateMultsPerBand: true,
  pointsByMode: { PHONE: 1, CW: 2, DATA: 2 },
  counties: { BEL: 'Belknap', CAR: 'Carroll' },
})

/// West Virginia: its bonus station pays once per band and mode.
export const WV = party({
  refType: 'wv-qso-party',
  short: 'WVQP',
  state: 'WV',
  countyLine: true,
  dcCountsAsMaryland: true,
  stateCountsForInState: true,
  dxEntityIsMultiplier: true,
  bonusPerBandMode: true,
  bonusPostMultiplier: true,
  pointsByMode: { PHONE: 1, CW: 2, DATA: 2 },
  bonusStations: { W8WVA: 100 },
  counties: { KAN: 'Kanawha', BAR: 'Barbour' },
})

/// Tennessee: multipliers per band, and a rover's own county counts.
export const TN = party({
  refType: 'tn-qso-party',
  short: 'TNQP',
  state: 'TN',
  countyLine: true,
  multsPerBand: true,
  selfMobileCountsForCounty: true,
  dxEntityIsMultiplier: true,
  dxLocationIsPrefix: true,
  pointsByMode: { PHONE: 3, CW: 3, DATA: 3 },
  counties: { ANDE: 'Anderson', BEDF: 'Bedford' },
  entryClasses: { station: ['FIXED', 'MOBILE', 'ROVER'] },
})

/// Ohio: multipliers per mode.
export const OH = party({
  refType: 'oh-qso-party',
  short: 'OHQP',
  state: 'OH',
  multsPerMode: true,
  dxIsMultiplier: true,
  pointsByMode: { PHONE: 1, CW: 2 },
  counties: { ADAM: 'Adams', ALLE: 'Allen' },
})

/// The Salmon Run: a DX station is logged by its entity prefix while still
/// scoring as one multiplier per entity.
export const WA = party({
  refType: 'wa-salmon-run',
  short: 'WAQP',
  state: 'WA',
  cabrilloName: 'WA-SALMON-RUN',
  countyLine: true,
  dcCountsAsMaryland: true,
  dxLocationIsPrefix: true,
  dxEntityIsMultiplier: true,
  dxEntityMultiplierMax: 10,
  bonusPerMode: true,
  bonusPostMultiplier: true,
  pointsByMode: { PHONE: 2, CW: 3 },
  bonusStations: { W7DX: 500 },
  counties: { KING: 'King', ASO: 'Asotin' },
})

/// California: the party whose exchange carries a serial each way, and whose
/// rules forbid self-spotting.
export const CA = party({
  refType: 'ca-qso-party',
  short: 'CQP',
  state: 'CA',
  cabrilloName: 'CA-QSO-PARTY',
  countyLine: true,
  dcCountsAsMaryland: true,
  stateCountsForInState: true,
  countiesAreMultipliersInParty: false,
  inStateMultiplierMax: 58,
  selfSpotting: false,
  exchange: { number: true },
  pointsByMode: { PHONE: 3, CW: 3 },
  counties: { ALAM: 'Alameda', BUTT: 'Butte', LASS: 'Lassen' },
  entryClasses: {
    operator: ['SINGLE-OP', 'SINGLE-OP-ASSISTED', 'MULTI-ONE', 'MULTI-TWO', 'MULTI-UNLIMITED'],
    station: ['FIXED', 'MOBILE', 'EXPEDITION', 'COUNTY-LINE'],
    power: ['QRP', 'LOW', 'HIGH'],
  },
})

/// Minnesota, standing for the one party whose exchange is a NAME.
export const MN = party({
  refType: 'mn-qso-party',
  short: 'MNQP',
  state: 'MN',
  exchange: { name: true },
  pointsByMode: { PHONE: 1, CW: 2 },
  counties: { AITK: 'Aitkin', ANOK: 'Anoka' },
})

/// The 7th Call Area party: eight states, five-character codes, and the
/// neighbouring parties' counties its entrants also work. No `state`, and
/// `states` names what the trimmed county list below spans — see `NEQP`.
export const SEVEN_QP = party({
  refType: '7qp',
  short: '7QP',
  states: ['ID', 'OR', 'UT', 'WA'],
  countyLine: true,
  dcCountsAsMaryland: true,
  dxEntityIsMultiplier: true,
  dxEntityMultiplierMax: 10,
  pointsByMode: { PHONE: 1, CW: 2, DATA: 4 },
  counties: {
    ORDES: 'Deschutes',
    ORJEF: 'Jefferson',
    IDIDA: 'Idaho',
    UTUTA: 'Utah',
    WAWAH: 'Wahkiakum',
    WAWAL: 'Walla Walla',
  },
  otherCounties: { CASCL: 'Santa Clara' },
})

/// Wisconsin: a party with no county lines, whose exchange field therefore
/// rewrites nothing.
export const WI = party({
  refType: 'wi-qso-party',
  short: 'WIQP',
  state: 'WI',
  pointsByMode: { PHONE: 1, CW: 2 },
  counties: { ADAM: 'Adams', ASHL: 'Ashland' },
  entryClasses: { power: ['QRP', 'LOW', 'HIGH'] },
})

/// Nevada, standing for a party that publishes no power classes at all.
export const NV = party({
  refType: 'nv-qso-party',
  short: 'NVQP',
  state: 'NV',
  pointsByMode: { PHONE: 1, CW: 2 },
  counties: { CAR: 'Carson City', CHU: 'Churchill' },
})

/// Arizona: the two sides of the state line multiply differently. Out of
/// state, the counties again on every band and mode; in state, states,
/// provinces and entities once per mode and never a county — the county
/// multiplies as Arizona, which is also the own state `stateCountsForInState`
/// adds, so the two rules name ONE multiplier.
export const AZ = party({
  refType: 'az-qso-party',
  name: 'Arizona QSO Party',
  short: 'AZQP',
  state: 'AZ',
  countyLine: true,
  dcCountsAsMaryland: true,
  stateCountsForInState: true,
  dxEntityIsMultiplier: true,
  multsPerMode: true,
  outOfStateMultsPerBand: true,
  bonusPostMultiplier: true,
  countiesAreMultipliersInParty: false,
  pointsByMode: { PHONE: 1, CW: 2 },
  bonusStations: { K7A: 100 },
  counties: { MCP: 'Maricopa', PMA: 'Pima', YMA: 'Yuma' },
})

/// Pennsylvania: every DX station together is ONE multiplier, the bonus
/// station pays on each band and mode, after the multiplier, the exchange
/// carries a serial number, and each county worked from inside the state also
/// earns its section.
export const PA = party({
  refType: 'pa-qso-party',
  name: 'Pennsylvania QSO Party',
  short: 'PAQP',
  state: 'PA',
  countyLine: true,
  sectionsForOutOfState: true,
  dxIsMultiplier: true,
  bonusPerBandMode: true,
  bonusPostMultiplier: true,
  bonus: { perActivatedCounty: 500, perActivatedCountyMinimumCount: 10, perActivatedCountyRoverOnly: true },
  pointsByMode: { PHONE: 1, CW: 2 },
  bonusStations: { K3ZMC: 200 },
  powerMultipliers: { QRP: 2 },
  exchange: { number: true },
  entryClasses: { power: ['QRP', 'LOW', 'HIGH'] },
  counties: { ALL: 'Allegheny', BUX: 'Bucks', CAR: 'Carbon', ELK: 'Elk', LEH: 'Lehigh', MGY: 'Montgomery' },
  countySections: { ALL: 'WPA', BUX: 'EPA', CAR: 'EPA', ELK: 'WPA', LEH: 'EPA', MGY: 'EPA' },
})
