// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// What a QSO party exchange MEANS: turning `ORDES/JEF`, `MD`, `DC` or an empty
// field into the locations a contact is scored and submitted under.
//
// One module, read by the scorer, the entry row, the ADIF and the Cabrillo,
// because the location SCORED has to be the location SUBMITTED — when a scorer
// and a Cabrillo writer resolve the same exchange separately they drift apart
// exactly where the rules are subtle.

import type { JSONValue } from "@ham2k/extension-sdk"

import { entityPrefixForCall } from "./dxcc.ts"
import type { QsoPartyLocation, QsoPartyStanding } from "./params.ts"
import { isInParty, normalizeCode, type Party, partyStates, stateForCounty } from "./party.ts"
import {
  CANADIAN_PROVINCES,
  CANADIAN_SECTIONS,
  DISTRICT_OF_COLUMBIA,
  MARYLAND_AND_DC,
  STATE_FOR_SECTION,
  US_SECTIONS,
  US_STATES,
} from "./locations.ts"

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/// The entities outside the lower 48 whose stations are still a US STATE, by
/// their COUNTRY-FILE prefix — which is not always what a ham would write.
/// Alaska is `KL`, so a lookup for `KL7` never matches and an Alaskan station
/// whose exchange we could not read would score as DX rather than as the state
/// multiplier it is. `KL7` is kept alongside it because a synced or imported
/// record may carry what app-polo wrote.
const STATE_ENTITIES: Record<string, string> = { KL: 'AK', KL7: 'AK', KH6: 'HI' }

/// The same question where the exchange is a SECTION: more entities answer it,
/// because Puerto Rico, the Virgin Islands and the Pacific possessions are ARRL
/// sections and no state at all. Without them a `KP4` whose exchange went
/// untyped claims the DX multiplier, for a station the sponsor scores as `PR`.
const SECTION_ENTITIES: Record<string, string> = {
  KL: 'AK', KL7: 'AK', KP4: 'PR', KP2: 'VI',
  KH0: 'PAC', KH1: 'PAC', KH2: 'PAC', KH3: 'PAC', KH4: 'PAC', KH5: 'PAC',
  KH6: 'PAC', KH7: 'PAC', KH8: 'PAC', KH9: 'PAC',
}

/// The two tables an out-of-party US or Canadian exchange is read against —
/// states and provinces, or sections where the party asks for those. Every
/// reader goes through this, so the field, the scorer, the summary and the
/// file cannot disagree about which vocabulary a party speaks.
export function outOfPartyTables(party: Party): { us: Record<string, string>; canada: Record<string, string> } {
  return party.sectionsForOutOfState
    ? { us: US_SECTIONS, canada: CANADIAN_SECTIONS }
    : { us: US_STATES, canada: CANADIAN_PROVINCES }
}

const OUR_OWN_CODES = new WeakMap<Party, Set<string>>()

/// Every code in the party's out-of-party vocabulary that lies INSIDE the
/// party. Nobody sends one: in the party the exchange is a county, and outside
/// it nobody is in those states to begin with.
///
/// `partyStates` alone answers this where the vocabulary is states — the set
/// `exchangeOptionsFor` has always filtered by — but a SECTION lies in a state
/// without sharing its code, so PAQP's own `EPA` and `WPA` slip through it.
/// Both are read here, and every reader asks this rather than `partyStates`.
///
/// Memoized: `normalizeLocation` asks on every location of every QSO, live on
/// each keystroke and again on a rescore, and the answer is a property of the
/// party.
export function ourOwnCodes(party: Party): Set<string> {
  const cached = OUR_OWN_CODES.get(party)
  if (cached) return cached
  const ours = partyStates(party)
  const tables = outOfPartyTables(party)
  const codes = new Set<string>()
  for (const code of [...Object.keys(tables.us), ...Object.keys(tables.canada)]) {
    if (ours.has(STATE_FOR_SECTION[code] ?? code)) codes.add(code)
  }
  OUR_OWN_CODES.set(party, codes)
  return codes
}

/// The separators a county line may be typed with. A comma is accepted because
/// the operator may well reach for one; the canonical form written back out is
/// the slash, which is what the sponsors' Cabrillo samples use.
const SEPARATORS = /[/,]/

export const COUNTY_LINE_SEPARATOR = '/'

/// Our own standing, at the moment our own exchange is being resolved: it is
/// what that resolution DECIDES, so it cannot also be an input to it.
const UNDECIDED: QsoPartyStanding = { weAreInParty: false, theyAreInParty: false }

/// `ORDES/ORJEF` → `['ORDES', 'ORJEF']`, and the multi-state shorthand
/// `ORDES/JEF` with it: where the first code carries a state prefix, a later
/// short code inherits it. Length-based rather than party-based, because only
/// the multi-state parties have codes long enough for the shorthand to be
/// unambiguous.
export function splitLocations(text: string | undefined): string[] {
  const codes = (text ?? '').split(SEPARATORS).map((code) => normalizeCode(code.trim())).filter((code) => code)
  if (codes.length > 1 && codes[0].length > 4) {
    const state = codes[0].slice(0, 2)
    return codes.map((code) => (code.length < 4 ? state + code : code))
  }
  return codes
}

/// Everything about the other station that a location depends on: the entity
/// they are in, which decides what a location we don't recognize resolves to.
export function entityPrefixOf(qso: Record<string, unknown> | undefined): string {
  const their = (qso?.their ?? {}) as Record<string, unknown>
  const guess = (their.guess ?? {}) as Record<string, unknown>
  // `||`, not `??`: the core writes an EMPTY STRING for a field that is present
  // and unanswered, and `??` would take that as an answer and never consult the
  // lookup's guess.
  const prefix = str(their.entityPrefix) || str(guess.entityPrefix)
  if (prefix) return prefix.toUpperCase()
  // Falls back to the country file. A QSO that came in through an ADIF import
  // or a sync carries no `guess` at all, and without this a DX station whose
  // exchange was never typed resolves to NOTHING — scored `missingExchange` at
  // zero, with no DX multiplier in the parties that count them, and an Alaskan
  // station never reaching `AK`.
  const call = str(their.call)
  return call ? entityPrefixForCall(call).toUpperCase() : ''
}

/// The state the other station is in, as looked up rather than sent — what the
/// suggestion line ranks by when the exchange has not been typed yet.
export function guessedStateOf(qso: Record<string, unknown> | undefined): string {
  const their = (qso?.their ?? {}) as Record<string, unknown>
  const guess = (their.guess ?? {}) as Record<string, unknown>
  // `||` for the reason `entityPrefixOf` gives: an empty `their.state` is the
  // absence of an answer, and taking it as one leaves the ranking with nothing
  // to rank by, silently.
  return (str(their.state) || str(guess.state)).trim().toUpperCase()
}

/// One code, resolved to what it is worth — or `''` when it is worth nothing,
/// which is how an unrecognizable exchange from a station in no known entity
/// stays out of the score.
///
/// Takes no `standing`: which side each end is on decides what a location
/// MULTIPLIES (`multCodeFor`), never what it resolves to — a county stays the
/// county that was sent, in the log, the checklist and the Cabrillo alike.
export function normalizeLocation(
  party: Party,
  code: string,
  { entityPrefix = '', received = false }: { entityPrefix?: string; received?: boolean } = {},
): string {
  let location = normalizeCode(code.trim())
  if (!location) return ''

  // A county is a county. Where a party does not count counties as in-party
  // multipliers it is the MULTIPLIER that becomes the state (`multCodeFor`);
  // the code stays what was sent, so the log, the county checklist and the
  // Cabrillo all still say which county it was.
  if (isInParty(party, location)) return location

  // A code we don't know that is long enough to be a county carries its state
  // in its first two characters — a neighbouring party's county, or a typo.
  if (location.length > 4) location = location.slice(0, 2)

  // A code inside the party is answered with a county and never with itself
  // (`ourOwnCodes`), so one arriving as an EXCHANGE is a mis-copy and resolves
  // to nothing — reported as a bad exchange, with the QSO still in front of the
  // operator to fix. Taking it would claim a multiplier the sponsor's own
  // checker strikes, and write it into the submitted file.
  //
  // Only what was COPIED: our own location is a setup field, and an entrant who
  // typed their state where their county belongs is answered by the scorer's
  // own `ourLocation` alert rather than by having every contact refused.
  if (received && ourOwnCodes(party).has(location)) return ''

  if (party.sectionsForOutOfState) {
    // Strict, and deliberately so: a state is accepted only where a section
    // shares its abbreviation. Guessing `CA` into one of nine sections would
    // write a multiplier into the file that nobody sent.
    if (US_SECTIONS[location] || CANADIAN_SECTIONS[location]) return location
  } else {
    if (location === 'DC' || location === 'MD') {
      // BOTH map to `MD` where a party folds them together. Mapping `DC` to
      // `MD` and `MD` to `DC` swaps the two instead of merging them, and hands
      // a party that counts them as one two multipliers for what its rules call
      // one.
      return party.dcCountsAsMaryland ? 'MD' : location
    }
    if (US_STATES[location]) {
      if (party.alaskaAndHawaiiAreDX && (location === 'AK' || location === 'HI')) return 'DX'
      return location
    }
    if (CANADIAN_PROVINCES[location]) return location
  }

  // Nothing we recognize. A station in the party's OWN country sends a county,
  // a state or a section, so an unrecognized value from one is a TYPO and
  // resolves to nothing — which the scorer reports as a bad exchange, with the
  // QSO still in front of the operator to fix. Answering `DX` here would score
  // the contact and claim a `DX:K` multiplier in every party that counts
  // entities separately, and a station with no entity at all resolves to
  // nothing rather than to `DX`: an unlookup-able callsign is a QSO we cannot
  // place, not a DX contact.
  //
  // Alaska, Hawaii and the Pacific possessions are in that country too, though
  // they do not sign `K`. What they send is read like anyone else's, and a code
  // that is not one of those is their typo — no more the state their PREFIX
  // names than `ZZZ` from a Californian is California. Answering with that
  // state would make a multiplier out of a mis-hearing, and silently: the
  // score rises and nothing is flagged. The entry row offers these stations
  // the same list as any other US station and tints what is not on it
  // (`exchangeOptionsFor`), so there is nothing for a guess to rescue. Where a
  // station SENT nothing at all, the prefix is still the best answer there is,
  // and `defaultTheirLocation` gives it.
  //
  // Unless the party counts them as DX, in which case they fall through to it.
  if (entityPrefix === 'K' || entityPrefix === 'VE') return ''
  if (!party.alaskaAndHawaiiAreDX && stateForEntity(party, entityPrefix)) return ''
  return entityPrefix ? 'DX' : ''
}

/// The multiplier key a resolved location contributes.
function multCodeFor(party: Party, code: string, entityPrefix: string, standing: QsoPartyStanding): string {
  // Inside the party, some sponsors multiply by STATE rather than by county.
  if (!party.countiesAreMultipliersInParty && standing.weAreInParty && standing.theyAreInParty
      && isInParty(party, code)) {
    // A county whose state nothing answers multiplies as ITSELF. The empty
    // string is one key: every stateless county in the party would collapse
    // into a single multiplier, and a party spanning three provinces would
    // score one where its sponsor awards three.
    return stateForCounty(party, code) || code
  }
  if (code === 'DX' && party.dxEntityIsMultiplier) return `DX:${entityPrefix}`
  return code
}

/// What to call a location out loud.
export function nameForLocation(party: Party, code: string, entityPrefix = ''): string {
  const location = normalizeCode(code)
  const county = party.counties[location] ?? party.otherCounties[location]
  if (county) return county
  if (party.sectionsForOutOfState) {
    const section = US_SECTIONS[location] ?? CANADIAN_SECTIONS[location]
    if (section) return section
  }
  if (location === 'DC') return party.dcCountsAsMaryland ? MARYLAND_AND_DC : DISTRICT_OF_COLUMBIA
  if (location === 'MD') return party.dcCountsAsMaryland ? MARYLAND_AND_DC : US_STATES.MD
  if (US_STATES[location]) return US_STATES[location]
  if (CANADIAN_PROVINCES[location]) return CANADIAN_PROVINCES[location]
  if (location === 'DX') return party.dxEntityIsMultiplier && entityPrefix ? `DX: ${entityPrefix}` : 'DX'
  return location
}

/// A whole exchange — one location, or a county line's two — resolved.
///
/// A party whose exchange is not a location at all answers for itself through
/// `resolveLocation`, and its answer is taken whole: it is what the scoreboard
/// counts AND what the submitted file writes, and the two disagreeing is the
/// failure this single seam exists to prevent.
export function parseLocations(
  party: Party,
  text: string | undefined,
  { entityPrefix = '', standing = UNDECIDED, received = false }: {
    entityPrefix?: string
    standing?: QsoPartyStanding
    received?: boolean
  } = {},
): QsoPartyLocation[] {
  const answered = party.resolveLocation?.({ text: text ?? '', entityPrefix, standing })
  if (answered) return answered

  const seen = new Set<string>()
  const locations: QsoPartyLocation[] = []
  for (const raw of splitLocations(text)) {
    const code = normalizeLocation(party, raw, { entityPrefix, received })
    if (!code || seen.has(code)) continue
    seen.add(code)
    locations.push({
      code,
      multCode: multCodeFor(party, code, entityPrefix, standing),
      name: nameForLocation(party, code, entityPrefix),
      inParty: isInParty(party, code),
      // What a submitted file writes, which is not always what it scores as: a
      // party that logs a DX station by its entity prefix still scores it as
      // the single `DX` multiplier.
      sent: code === 'DX' && party.dxLocationIsPrefix && entityPrefix ? entityPrefix : code,
    })
  }
  return locations
}

/// OUR location, from setup — `parseLocations`, plus `DX` whatever the party
/// counts. A station outside the US and Canada has no county, state or
/// province to give, and every party accepts entries from them; without this
/// `DX` resolves to nothing (we have no entity prefix of our own to hand
/// `normalizeLocation`), and the whole log scores zero under an `ourLocation`
/// alert.
export function parseOurLocations(party: Party, text: string | undefined): QsoPartyLocation[] {
  const locations = parseLocations(party, text)
  if (splitLocations(text).includes('DX') && !locations.some((location) => location.code === 'DX')) {
    locations.push({ code: 'DX', multCode: 'DX', name: nameForLocation(party, 'DX'), inParty: false, sent: 'DX' })
  }
  return locations
}

/// What a station who sent us no exchange is recorded as — the ONE answer the
/// scorer and both exports read, so a contact cannot be scored under one
/// location and filed under another.
///
/// In the party's own country, what the lookup says: `their.state` if the
/// operator or an import asserted one, else the callsign lookup's guess. It is
/// consulted only here, where the alternative is `missingExchange` and a
/// contact worth nothing — the entry row still asks the operator for the
/// exchange, and still ranks counties rather than inventing one, because a
/// county is the thing a lookup cannot know.
///
/// The guess is refused unless it RESOLVES against this party, and consulted
/// only for a K or VE station: a DX lookup's `state` is its own country's
/// subdivision, and two-letter codes collide — a German `NS` is not Nova
/// Scotia. Outside those two countries the exchange is the entity, which no
/// party asks a DX station to type.
export function defaultTheirLocation(party: Party, qso: Record<string, JSONValue>): string {
  const entityPrefix = entityPrefixOf(qso as Record<string, unknown>)
  // A station in no known entity — no callsign yet, or one the country file
  // cannot place — is a QSO we cannot place, not a DX contact
  // (`normalizeLocation` draws the same line). Answering `DX` here would slip
  // past the scorer, which normalizes it back to nothing without an entity,
  // and be offered as the suggestion in an empty entry row.
  if (!entityPrefix) return ''
  if (entityPrefix === 'K' || entityPrefix === 'VE') {
    const guessed = guessedStateOf(qso as Record<string, unknown>)
    // A state CODE, and only that. `normalizeLocation` reads anything longer
    // than four characters as a county carrying its state in its first two, so
    // a lookup that hands back a NAME would resolve `MINNESOTA` to `MI` —
    // Michigan — and both the score and the file would claim the wrong state
    // with nothing looking wrong anywhere. Every US state, DC and every
    // Canadian province is two characters; a longer answer has told us nothing
    // we can file.
    if (guessed.length !== 2 || !normalizeLocation(party, guessed, { entityPrefix })) return ''
    return guessed
  }
  // Alaska and Hawaii are US STATES that do not send `K`, and the scorer
  // credits them as such — so a file that wrote `DX` for one would not support
  // the multiplier the scoreboard already claimed.
  const state = stateForEntity(party, entityPrefix)
  if (state && !party.alaskaAndHawaiiAreDX) return state
  return party.dxLocationIsPrefix && entityPrefix ? entityPrefix : 'DX'
}

/// The state an entity's stations are in, for the two that are US states but do
/// not send `K` — read by the export so its fallback cannot disagree with the
/// scorer about an Alaskan or Hawaiian contact.
export function stateForEntity(party: Party, entityPrefix: string): string {
  const table = party.sectionsForOutOfState ? SECTION_ENTITIES : STATE_ENTITIES
  return table[entityPrefix] ?? ''
}

/// Whether every location given is inside the party — the test both sides'
/// standing is decided by. An empty list is NOT inside: a station whose
/// exchange we could not resolve is treated as out of the party, which is the
/// safe reading for the in-party-only rules that turn on this.
export function allInParty(locations: QsoPartyLocation[]): boolean {
  return locations.length > 0 && locations.every((location) => location.inParty)
}

/// Both sides' standing, resolved together: theirs depends on ours, and what
/// their county MULTIPLIES depends on both, so an exchange is resolved once to
/// learn their standing and again to price it.
export function theirLocations(
  party: Party,
  text: string | undefined,
  { entityPrefix, weAreInParty, received = false }: {
    entityPrefix: string
    weAreInParty: boolean
    /// Whether [text] is what the operator COPIED, rather than a fallback. Only
    /// a copied code is held to the party's own ground (`normalizeLocation`):
    /// `defaultTheirLocation` deliberately answers an in-party station's own
    /// state, because refusing a contact that plainly happened is the worse
    /// reading.
    received?: boolean
  },
): { locations: QsoPartyLocation[]; standing: QsoPartyStanding } {
  const standing: QsoPartyStanding = { weAreInParty, theyAreInParty: false }
  let locations = parseLocations(party, text, { entityPrefix, standing, received })
  standing.theyAreInParty = allInParty(locations)
  // Cheap, and the only way the two ends agree: a party where an in-party pair
  // multiplies by state cannot know that from the first pass.
  if (standing.theyAreInParty) locations = parseLocations(party, text, { entityPrefix, standing, received })
  return { locations, standing }
}
