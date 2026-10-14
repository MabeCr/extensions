// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// What an exchange means. Every case here is one an operator can type on the
// air.

import { test } from "node:test"
import assert from "node:assert/strict"

import { registerEntityLookup } from "./dxcc.ts"
import {
  allInParty,
  entityPrefixOf,
  nameForLocation,
  normalizeLocation,
  parseLocations,
  splitLocations,
  stateForEntity,
  theirLocations,
} from "./location.ts"
import { resolveParty } from "./party.ts"
import { ACQP, IL, MD, NEQP, NY, SEVEN_QP } from "./testFixtures.ts"

const ny = resolveParty(NY)
const codes = (params: typeof NY, text: string, opts?: Parameters<typeof parseLocations>[2]) =>
  parseLocations(resolveParty(params), text, opts).map((location) => location.code)

test('a county line is two values, however it was typed', () => {
  assert.deepEqual(splitLocations('ALB/ERI'), ['ALB', 'ERI'])
  // A comma, a plus or a period is accepted because an operator may well reach
  // for one.
  assert.deepEqual(splitLocations('alb,eri'), ['ALB', 'ERI'])
  assert.deepEqual(splitLocations('ALB+ERI'), ['ALB', 'ERI'])
  assert.deepEqual(splitLocations('ALB.ERI'), ['ALB', 'ERI'])
  assert.deepEqual(splitLocations('ALB+ERI,ONE.OTS/SCH'), ['ALB', 'ERI', 'ONE', 'OTS', 'SCH'])
  assert.deepEqual(splitLocations('ALB'), ['ALB'])
  assert.deepEqual(splitLocations(''), [])
})

test("the multi-state shorthand: a second county inherits the first one's state", () => {
  // The sponsors let an operator send `ORDES/JEF` for `ORDES/ORJEF`, and a short
  // code after a long one is the only place that is unambiguous.
  assert.deepEqual(splitLocations('ORDES/JEF'), ['ORDES', 'ORJEF'])
  // Two short codes are two short codes — no state to inherit.
  assert.deepEqual(splitLocations('ALB/ERI'), ['ALB', 'ERI'])
})

test('DC and Maryland MERGE where the party says so, rather than swapping', () => {
  // Mapping DC→MD and MD→DC swaps the two instead of merging them, and hands a
  // party that counts them as one two multipliers for what its rules call one.
  assert.equal(normalizeLocation(ny, 'DC'), 'MD')
  assert.equal(normalizeLocation(ny, 'MD'), 'MD')
  // A party that names DC explicitly keeps it apart.
  const md = resolveParty(MD)
  assert.equal(normalizeLocation(md, 'DC'), 'DC')
  assert.equal(normalizeLocation(md, 'MD'), 'MD')
})

test('an unknown location falls back to where the callsign says they are', () => {
  // A DX station's exchange is their entity, and no party asks them to type it.
  assert.equal(normalizeLocation(ny, 'ZZZ', { entityPrefix: 'DL' }), 'DX')
  assert.equal(normalizeLocation(ny, 'AK'), 'AK')
  // A callsign we could not place at all resolves to nothing rather than to
  // `DX`: an unlookup-able call is a QSO we cannot score, not a DX contact.
  assert.equal(normalizeLocation(ny, 'ZZZ'), '')
  // And a value we don't recognize from a station in the party's own country is
  // a typo, not a DX contact — answering `DX` there scores the QSO and claims a
  // `DX:K` multiplier in every party that counts entities separately.
  assert.equal(normalizeLocation(ny, 'ZZZ', { entityPrefix: 'K' }), '')
})

test('Alaska is KL in the country file, which is what a station sending NOTHING is read as', () => {
  // A lookup for `KL7` never matches what the country file answers, so an
  // Alaskan station who sent no exchange at all would be read as DX rather than
  // as the state multiplier they are. This is the ONE place a prefix still
  // answers for a location: a station who sent nothing, where it is the best
  // answer there is.
  assert.equal(stateForEntity(ny, 'KL'), 'AK')
  assert.equal(stateForEntity(ny, 'KH6'), 'HI')
  // What app-polo wrote stays readable, for a synced or imported log.
  assert.equal(stateForEntity(ny, 'KL7'), 'AK')
})

test('an unreadable exchange from a Hawaiian is a typo, not the state their prefix names', () => {
  // They send a county or a state like any other US station, and the entry row
  // now offers them that list and tints what is not on it — so a code nobody
  // can read is their mis-copy, and reading it as `HI` made a multiplier out of
  // a mis-hearing while the score went up and nothing was flagged.
  assert.equal(normalizeLocation(ny, 'ZZZ', { entityPrefix: 'KH6' }), '')
  assert.equal(normalizeLocation(ny, 'ZZZ', { entityPrefix: 'KL' }), '')
  assert.equal(normalizeLocation(ny, 'ZZZ', { entityPrefix: 'KL7' }), '')
  // Exactly as it is for a station signing `K`, which is the point.
  assert.equal(normalizeLocation(ny, 'ZZZ', { entityPrefix: 'K' }), '')
  // What they actually send still reads.
  assert.equal(normalizeLocation(ny, 'HI', { entityPrefix: 'KH6' }), 'HI')
  // A genuinely DX station is still DX.
  assert.equal(normalizeLocation(ny, 'ZZZ', { entityPrefix: 'DL' }), 'DX')
})

test("a long code that is nobody's county is read as its state", () => {
  // `ORDES` typed into the New York party is Oregon, not a New York county.
  assert.equal(normalizeLocation(ny, 'ORDES'), 'OR')
})

test('in-party is decided by the county list, not by a setting', () => {
  assert.equal(allInParty(parseLocations(ny, 'ALB')), true)
  assert.equal(allInParty(parseLocations(ny, 'NJ')), false)
  // A county line half in and half out is not fully in the party — the in-party
  // rules that turn on this are about where WE are, and half a county line
  // outside means half the log is out-of-party work.
  assert.equal(allInParty(parseLocations(ny, 'ALB/NJ')), false)
  // Nothing resolved is NOT in the party: the safe reading for the rules that
  // gate on it.
  assert.equal(allInParty(parseLocations(ny, '')), false)
})

test('inside a party that multiplies by state, a county multiplies as its STATE', () => {
  // The county is still what is sent and logged, and only what it multiplies
  // changes — converting the CODE would rewrite the log, the checklist and the
  // Cabrillo for a rule that is only about the multiplier.
  const neqp = resolveParty(NEQP)
  const [location] = parseLocations(neqp, 'MAWOR', {
    standing: { weAreInParty: true, theyAreInParty: true },
  })
  assert.equal(location.code, 'MAWOR')
  assert.equal(location.multCode, 'MA')
  // An out-of-party station working the same county multiplies by the county.
  const [outside] = parseLocations(neqp, 'MAWOR', {
    standing: { weAreInParty: false, theyAreInParty: true },
  })
  assert.equal(outside.multCode, 'MAWOR')
})

test('a county whose state nothing answers multiplies as ITSELF', () => {
  // A multi-state party has no `state` to fall back on, so a short code its own
  // table forgets has no state at all — and this is the party that multiplies an
  // in-party pair BY state. Keying that on the empty string makes every
  // forgotten county ONE multiplier: a log working two of them scores a single
  // mult, and nothing ever says which county went missing.
  const forgetful = resolveParty({
    ...ACQP,
    counties: { ...ACQP.counties, YOR: 'York', HFX: 'Halifax' },
  })
  const inParty = { weAreInParty: true, theyAreInParty: true }
  assert.equal(parseLocations(forgetful, 'YOR', { standing: inParty })[0].multCode, 'YOR')
  assert.equal(parseLocations(forgetful, 'HFX', { standing: inParty })[0].multCode, 'HFX')
  // The counties that DO name their state still multiply by it.
  assert.equal(parseLocations(forgetful, 'NSANP', { standing: inParty })[0].multCode, 'NS')
})

test('both sides resolve together, because theirs depends on ours', () => {
  // The first pass cannot know they are in the party either, so a party that
  // multiplies an in-party pair by state needs the second: without it an
  // in-party contact keeps the county key, and the two ends of the same contact
  // claim different multipliers.
  const neqp = resolveParty(NEQP)
  const inParty = theirLocations(neqp, 'MAWOR', { entityPrefix: 'K', weAreInParty: true })
  assert.equal(inParty.standing.theyAreInParty, true)
  assert.equal(inParty.locations[0].multCode, 'MA')
  const outside = theirLocations(neqp, 'NJ', { entityPrefix: 'K', weAreInParty: true })
  assert.equal(outside.standing.theyAreInParty, false)
  assert.equal(outside.locations[0].multCode, 'NJ')
})

test('each DX entity is its own multiplier where a party says so', () => {
  const [dx] = parseLocations(resolveParty(IL), 'DX', { entityPrefix: 'DL' })
  assert.equal(dx.multCode, 'DX:DL')
  // Where every DX station together is one multiplier, they share a key.
  const [single] = parseLocations(ny, 'DX', { entityPrefix: 'DL' })
  assert.equal(single.multCode, 'DX')
})

test('what a party LOGS a DX station as is not always what it scores as', () => {
  // A party that logs the entity prefix still scores the single `DX`
  // multiplier; without the distinction the option is inert, and the Cabrillo
  // and the ADIF disagree about the same contact.
  const [prefixed] = parseLocations(resolveParty(SEVEN_QP), 'DX', { entityPrefix: 'DL' })
  assert.equal(prefixed.code, 'DX')
  assert.equal(prefixed.sent, 'DX')
  const [wa] = parseLocations(resolveParty({ ...NY, dxLocationIsPrefix: true }), 'DX', { entityPrefix: 'DL' })
  assert.equal(wa.code, 'DX')
  assert.equal(wa.sent, 'DL')
})

test('the same location twice is one location', () => {
  // An operator correcting a county line can end up with `ALB/ALB`, which is one
  // county, not a doubled score.
  assert.deepEqual(codes(NY, 'ALB/ALB'), ['ALB'])
})

test('names are what an operator hears, not codes', () => {
  assert.equal(nameForLocation(ny, 'ALB'), 'Albany')
  assert.equal(nameForLocation(ny, 'NJ'), 'New Jersey')
  assert.equal(nameForLocation(ny, 'MD'), 'Maryland & DC')
  assert.equal(nameForLocation(resolveParty(MD), 'DC'), 'District of Columbia')
  assert.equal(nameForLocation(resolveParty(IL), 'DX', 'DL'), 'DX: DL')
})

test("a neighbouring party's county scores as its STATE", () => {
  // A multi-state party's entrants work the parties next door, so `CASCL` is a
  // value they will be sent — and California is what it is worth to them, since
  // a county outside the party multiplies nothing of its own. The code has to
  // resolve, or the exchange would read as a typo.
  const [neighbour] = parseLocations(resolveParty(SEVEN_QP), 'CASCL')
  assert.equal(neighbour.code, 'CA')
  assert.equal(neighbour.multCode, 'CA')
  assert.equal(neighbour.inParty, false)
})

test('the entity comes from the lookup when the operator has not typed one', () => {
  assert.equal(entityPrefixOf({ their: { entityPrefix: 'K' } }), 'K')
  assert.equal(entityPrefixOf({ their: { guess: { entityPrefix: 'VE' } } }), 'VE')
  assert.equal(entityPrefixOf({}), '')
  // An EMPTY string is the absence of an answer, not an answer: reading it as
  // one never consults the lookup's guess.
  assert.equal(entityPrefixOf({ their: { entityPrefix: '', guess: { entityPrefix: 'VE' } } }), 'VE')
})

test('a QSO with no lookup at all still reaches the country file', () => {
  // An imported or synced QSO carries no `guess`, so without the country file
  // the entity is unknown: the exchange resolves to nothing, the contact scores
  // `missingExchange`, and the DX multiplier the party publishes is never
  // claimed.
  assert.equal(entityPrefixOf({ their: { call: 'DL1ABC' } }), '')
  registerEntityLookup((call) => (call?.startsWith('DL') ? 'dl' : undefined))
  try {
    assert.equal(entityPrefixOf({ their: { call: 'DL1ABC' } }), 'DL')
    assert.equal(entityPrefixOf({ their: { call: 'K1ABC' } }), '')
  } finally {
    registerEntityLookup(() => undefined)
  }
})

test('a party may answer for its own exchange, and its answer is taken whole', () => {
  // The seam a party whose exchange is not a location at all resolves through:
  // what it returns is what the scoreboard counts AND what the file writes, so
  // nothing else may re-read the text behind its back.
  const sections = resolveParty({
    ...NY,
    resolveLocation: ({ text }) => (text === 'EMA'
      ? [{ code: 'EMA', multCode: 'EMA', name: 'Eastern Massachusetts', inParty: true, sent: 'EMA' }]
      : undefined),
  })
  const [section] = parseLocations(sections, 'EMA')
  assert.equal(section.name, 'Eastern Massachusetts')
  assert.equal(section.inParty, true)
  // `undefined` means "no opinion", and the ordinary resolution answers.
  assert.deepEqual(parseLocations(sections, 'ALB').map((location) => location.code), ['ALB'])
})
