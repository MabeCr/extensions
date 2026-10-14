// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The exchange on its way in (what the entry row offers) and on its way out
// (what the sponsor receives). The Cabrillo cases are the ones that matter most:
// a file is submitted once, months after the contest, and nobody reads it before
// it goes.

import { test } from "node:test"
import assert from "node:assert/strict"

import type { JSONValue } from "@ham2k/extension-sdk"

import {
  cabrilloCall,
  cabrilloCategories,
  cabrilloFor,
  cabrilloRowsFor,
  claimableBand,
  exchangeInheritPrefix,
  exchangeOptionsFor,
  exchangeTransforms,
  loggedExchangeFor,
  pastExchangeHolds,
  ourLocationForQso,
  preferredCodesFor,
  resolvedExchanges,
  theirLocationForFile,
} from "./exchange.ts"
import { defaultTheirLocation } from "./location.ts"
import type { QsoPartyParams } from "./params.ts"
import { resolveParty } from "./party.ts"
import { ACQP, CA, ID, MD, MN, NY, PA, SEVEN_QP, WA, WI } from "./testFixtures.ts"

const ny = resolveParty(NY)

function operation(location: string, params: QsoPartyParams = NY): Record<string, JSONValue> {
  return { uuid: 'op', stationCall: 'N0DEV', refs: [{ type: params.refType, location }] }
}

function qso(
  { call = 'K1ABC', location, ourLocation, entityPrefix = 'K', state, mode = 'CW', params = NY, startAtMillis }: {
    call?: string
    location?: string
    /// A stamp an earlier build left on the ref. In the fixtures only to prove
    /// it is IGNORED.
    ourLocation?: string
    entityPrefix?: string
    state?: string
    mode?: string
    params?: QsoPartyParams
    startAtMillis?: number
  } = {},
): Record<string, JSONValue> {
  return {
    their: { call, ...(entityPrefix ? { entityPrefix } : {}), ...(state ? { state } : {}) },
    band: '20m',
    mode,
    ...(startAtMillis !== undefined ? { startAtMillis } : {}),
    refs: [{
      type: params.refType,
      ...(location !== undefined ? { location } : {}),
      ...(ourLocation ? { ourLocation } : {}),
    }],
  }
}

/// A log that changed county at 1000: [base] before, [later] from then on — the
/// payload the host sends as `ExportRequest.segments`.
function segmentsTo(later: string, base = 'ALB') {
  return [
    { fromMillis: -1, operation: operation(base) },
    { fromMillis: 1000, operation: operation(later) },
  ]
}

test('a county line submits one row per pairing', () => {
  // Each pairing is what the checker matches against the other station's log, so
  // a line-to-line contact is four lines, not one.
  const rows = cabrilloRowsFor(ny, qso({ location: 'ERI/CHA' }), operation('ALB/REN'), 'N0DEV')
  assert.equal(rows.length, 4)
  const pairs = rows.map((row) => [row[2].trim(), row[5].trim()])
  assert.deepEqual(pairs, [['ALB', 'ERI'], ['ALB', 'CHA'], ['REN', 'ERI'], ['REN', 'CHA']])
})

test('on a segmented log, the county WE were in is the segment′s, not anything on the contact', () => {
  // A rover's county changes mid-log; the host hands the export the same
  // resolved segments the scorer folds, so a contact made after the break is
  // filed under the county the break established — whatever an earlier build
  // stamped onto it when it was saved.
  const before = qso({ location: 'ERI', startAtMillis: 500, ourLocation: 'REN' })
  const after = qso({ location: 'ERI', startAtMillis: 1500, ourLocation: 'ALB' })
  assert.equal(ourLocationForQso(ny, before, operation('ALB'), segmentsTo('REN')), 'ALB')
  assert.equal(ourLocationForQso(ny, after, operation('ALB'), segmentsTo('REN')), 'REN')
  const rows = cabrilloRowsFor(ny, after, operation('ALB'), 'N0DEV', { segments: segmentsTo('REN') })
  assert.equal(rows[0][2].trim(), 'REN')
})

test('a county corrected in a segment reaches every contact of that stretch', () => {
  // The whole point of reading the segment rather than a stamp: six contacts
  // logged under a mistyped county and then corrected at the break are filed
  // under the correction, in the file as on the scoreboard. A stamp would have
  // kept the typo on all six.
  const stamped = qso({ location: 'ERI', startAtMillis: 1500, ourLocation: 'ALB' })
  assert.equal(ourLocationForQso(ny, stamped, operation('ALB'), segmentsTo('REN')), 'REN')
})

test('without segments, the operation′s county is true of the whole log', () => {
  // An operator who logs 30 contacts, notices the county is a typo and fixes it
  // in setup rescores the whole log — and the file has to follow rather than
  // submit the county that was typed by mistake.
  const stamped = qso({ location: 'ERI', ourLocation: 'ALB' })
  assert.equal(ourLocationForQso(ny, stamped, operation('ALL')), 'ALL')
  assert.equal(ourLocationForQso(ny, stamped, operation('ALL'), []), 'ALL')
  assert.equal(cabrilloRowsFor(ny, stamped, operation('ALL'), 'N0DEV')[0][2].trim(), 'ALL')
})


test('a serial and a name are columns only for the parties that exchange them', () => {
  // Every column shifts when one is added, so a party that does not trade serials
  // must not get an empty one.
  const plain = cabrilloRowsFor(ny, qso({ location: 'ERI' }), operation('ALB'), 'N0DEV')
  assert.equal(plain[0].length, 6)

  const ca = operation('ALAM', CA)
  const caQso = {
    their: { call: 'K1ABC', entityPrefix: 'K' },
    band: '20m',
    mode: 'CW',
    // `ourSerial` is a number because that is how the host allocates it;
    // typed text, `theirSerial` is a string. A reader that only takes strings
    // writes every sent serial as 0.
    refs: [{ type: CA.refType, location: 'BUTT', ourSerial: 12, theirSerial: '34' }],
  }
  // The serial is exchanged INSTEAD of a report, so there is no RST column —
  // a checker reading one column late takes the 599 for the serial.
  const rows = cabrilloRowsFor(resolveParty(CA), caQso, ca, 'N0DEV')
  assert.deepEqual(rows[0].map((cell) => cell.trim()), ['N0DEV', '12', 'ALAM', 'K1ABC', '34', 'BUTT'])

  // And the party that trades NAMES gets its own column, from the operation for
  // ours and the contact for theirs.
  const mn = { ...operation('AITK', MN), refs: [{ type: MN.refType, location: 'AITK', ourName: 'Sebastian' }] }
  const mnQso = {
    their: { call: 'K1ABC', entityPrefix: 'K' },
    band: '20m',
    mode: 'CW',
    refs: [{ type: MN.refType, location: 'ANOK', theirName: 'Steve' }],
  }
  const named = cabrilloRowsFor(resolveParty(MN), mnQso, mn, 'N0DEV')
  assert.equal(named[0][2].trim(), 'SEBASTIAN')
  assert.equal(named[0][6].trim(), 'STEVE')
})

test('a contact with nobody in the party is left out of the file', () => {
  // Two out-of-party stations working each other is not a contest QSO — the
  // scorer awards it nothing, and a file claiming it is an over-claim a checker
  // will strike.
  const outside = operation('NJ')
  assert.deepEqual(cabrilloRowsFor(ny, qso({ location: 'CT' }), outside, 'N0DEV'), [])
  // One end inside is a contest QSO, whichever end it is.
  assert.equal(cabrilloRowsFor(ny, qso({ location: 'ERI' }), outside, 'N0DEV').length, 1)
  assert.equal(cabrilloRowsFor(ny, qso({ location: 'CT' }), operation('ALB'), 'N0DEV').length, 1)
})

test('an exchange nobody typed falls back to what we know of where they are', () => {
  // The exchange is what they SENT, and this is the gap where nothing was
  // copied at all: rather than score the contact zero and file nothing, both
  // sides read the state the QSO carries — asserted on `their.state` by an
  // operator or an import, or the callsign lookup's own guess. The scorer and
  // the file read one function, so they cannot disagree about it.
  assert.equal(defaultTheirLocation(ny, qso({ state: 'NJ' })), 'NJ')
  const rows = cabrilloRowsFor(ny, qso({ state: 'NJ' }), operation('ALB'), 'N0DEV')
  assert.equal(rows.length, 1)
  assert.equal(rows[0][5].trim(), 'NJ')

  // Nothing known: still nothing claimed. A contact we cannot place is one the
  // scorer refuses (`missingExchange`), and a file may not claim what the
  // scoreboard declined.
  assert.equal(defaultTheirLocation(ny, qso()), '')
  assert.deepEqual(cabrilloRowsFor(ny, qso(), operation('ALB'), 'N0DEV'), [])

  // A state that means nothing to this party is not a state. `parseLocations`
  // would drop it anyway; refusing it HERE is what keeps the fallback from
  // reporting a location it cannot resolve.
  assert.equal(defaultTheirLocation(ny, qso({ state: 'ZZ' })), '')
  // A state NAME is not a state code. `normalizeLocation` would read
  // `MINNESOTA` as a five-plus-character county and take its first two letters
  // — `MI`, Michigan — so the log and the file would both claim the wrong
  // state with nothing looking wrong anywhere.
  assert.equal(defaultTheirLocation(ny, qso({ state: 'MINNESOTA' })), '')


  // Only consulted for a station in the party's own country. A DX lookup's
  // `state` is its own country's subdivision and the two-letter codes collide —
  // a German `NS` is not Nova Scotia.
  assert.equal(defaultTheirLocation(ny, qso({ entityPrefix: 'DL', state: 'NS' })), 'DX')
  // A DX station's exchange IS their entity — nobody asks them to send one, so
  // this is what they gave us, not a guess.
  assert.equal(defaultTheirLocation(ny, qso({ entityPrefix: 'DL' })), 'DX')
  // And where a party asks for the prefix instead of the word DX.
  assert.equal(defaultTheirLocation(resolveParty(WA), qso({ entityPrefix: 'DL' })), 'DL')
})

test('the file claims a contact only where the score does', () => {
  // Both sides ask the same question — is one END of this contact wholly inside
  // the party — so a row cannot appear for a contact worth zero. An out-of-party
  // entrant working a county line half outside the party is the case the two
  // readings disagree on.
  const outside = operation('CA')
  assert.deepEqual(cabrilloRowsFor(ny, qso({ location: 'ERI/NJ' }), outside, 'N0DEV'), [])
  // Wholly inside, and it counts.
  assert.equal(cabrilloRowsFor(ny, qso({ location: 'ERI/CHA' }), outside, 'N0DEV').length, 2)
})

test('the file says what the scoreboard claimed for an Alaskan contact', () => {
  // The scorer credits an Alaskan station as the state `AK`; a file writing `DX`
  // for the same contact would not support the multiplier already claimed.
  assert.equal(defaultTheirLocation(ny, qso({ entityPrefix: 'KL' })), 'AK')
  assert.equal(defaultTheirLocation(ny, qso({ entityPrefix: 'KH6' })), 'HI')
})

test('a rover suffix is stripped only where the sponsor asked for it', () => {
  assert.equal(cabrilloCall(resolveParty(ID), 'K7ABC/ADA'), 'K7ABC')
  assert.equal(cabrilloCall(ny, 'K2ABC/M'), 'K2ABC/M')
})

test('the entry row offers what the station being worked could possibly send', () => {
  // A US station may send a county or a state…
  const us = exchangeOptionsFor(ny, qso({ entityPrefix: 'K' })).map((option) => option.code)
  assert.ok(us.includes('ALB'))
  assert.ok(us.includes('NJ'))
  // …a Canadian station in a US party can only send a province…
  const ve = exchangeOptionsFor(ny, qso({ entityPrefix: 'VE' })).map((option) => option.code)
  assert.equal(ve.includes('ALB'), false)
  assert.ok(ve.includes('ON'))
  // …and a DX station sends their entity, which is not a list at all, so the
  // field accepts whatever the operator heard.
  assert.deepEqual(exchangeOptionsFor(ny, qso({ entityPrefix: 'DL' })), [])
  // A Canadian party is the mirror image.
  const acqp = resolveParty(ACQP)
  const acqpVe = exchangeOptionsFor(acqp, qso({ entityPrefix: 'VE' })).map((option) => option.code)
  assert.ok(acqpVe.some((code) => acqp.counties[code] !== undefined))
  assert.equal(
    exchangeOptionsFor(acqp, qso({ entityPrefix: 'K' })).some((option) => acqp.counties[option.code]),
    false,
  )
})

test('the county-line shorthand is declared, not rewritten', () => {
  // A rewrite cannot tell the shorthand from the same letters on the way to the
  // full code: after `IDADA/`, `IDA` is either Idaho county's shorthand or the
  // first three characters of `IDIDA`, and real counties have that shape. The
  // field matches and validates both readings and rewrites neither.
  assert.equal(exchangeInheritPrefix(resolveParty(SEVEN_QP)), 2)
  // A party whose codes are three letters has no shorthand at all…
  assert.equal(exchangeInheritPrefix(ny), 0)
  // …and the only live rewrite left is the comma or plus an operator may reach
  // for, written as the slash the field splits on. Applied the way the host
  // applies it, so a pattern that stops matching one of them fails here.
  const [rewrite] = exchangeTransforms(ny)
  assert.equal('ALB+ERI,ONE/OTS'.replace(new RegExp(rewrite.pattern, rewrite.flags), rewrite.replacement), 'ALB/ERI/ONE/OTS')
  assert.deepEqual(exchangeTransforms(resolveParty(WI)), [])
})

test('DC is offered, because stations send it', () => {
  // Whether DC is its own multiplier is a per-party rule, so it is not in the
  // states table — but it is still a value stations SEND, and left out of the
  // list the field tints a perfectly good exchange as unknown while the scorer
  // accepts it.
  for (const params of [NY, MD]) {
    const codes = exchangeOptionsFor(resolveParty(params), qso({ entityPrefix: 'K' })).map((o) => o.code)
    assert.ok(codes.includes('DC'), `${params.short} does not offer DC`)
  }
  // And it reads as whatever that party calls it.
  const offered = (params: QsoPartyParams) =>
    exchangeOptionsFor(resolveParty(params), qso({ entityPrefix: 'K' })).find((o) => o.code === 'DC')?.name
  assert.equal(offered(NY), 'Maryland & DC')
  assert.equal(offered(MD), 'District of Columbia')
})

test("a party offers its neighbours' counties, because its entrants work them", () => {
  const codes = exchangeOptionsFor(resolveParty(SEVEN_QP), qso({ entityPrefix: 'K' })).map((o) => o.code)
  assert.ok(codes.includes('ORDES'))
  // A neighbouring party's county — a valid exchange, and not one of this
  // party's own.
  assert.ok(codes.includes('CASCL'))
  assert.equal(resolveParty(SEVEN_QP).counties.CASCL, undefined)
})

test('the guessed state floats its counties up, and never fills a county in', () => {
  // A COUNTY is only ever ranked: no lookup guesses one, so writing one in
  // would be worse than useless. The state itself is the other half of the same
  // guess and IS written in where it is the whole exchange — see below.
  const preferred = preferredCodesFor(resolveParty(SEVEN_QP), 'OR')
  assert.ok(preferred.includes('ORDES'))
  assert.equal(preferred.some((code) => code.startsWith('WA')), false)
  // Oregon's own code is NOT floated up: `OR` is one of 7QP's states, so it is
  // not an exchange any station sends and the field does not offer it. A
  // suggestion the same field then tints red is worse than none.
  assert.equal(preferred.includes('OR'), false)
  // A state from outside the party is both offered and floated.
  assert.ok(preferredCodesFor(ny, 'NJ').includes('NJ'))
  assert.deepEqual(preferredCodesFor(ny, ''), [])
})

test('the party\'s own state is not an exchange anybody sends', () => {
  // In NYQP an in-state station sends a COUNTY, and nobody outside New York is
  // in New York — so `NY` is an exchange no station could have given. It
  // resolves cleanly to the state, which is exactly why the field has to refuse
  // it: accepted, it scores the contact under out-of-party rules and files a
  // state multiplier for a county nobody copied.
  const codes = exchangeOptionsFor(ny, qso({ entityPrefix: 'K' })).map((option) => option.code)
  assert.equal(codes.includes('NY'), false)
  assert.ok(codes.includes('NJ'), 'every other state is still an exchange')
  assert.ok(codes.includes('ALB'), 'and the counties are what an in-state station sends')

  // Every state a multi-state party covers, not just the one its key names.
  const sevenQp = exchangeOptionsFor(resolveParty(SEVEN_QP), qso({ entityPrefix: 'K', params: SEVEN_QP }))
    .map((option) => option.code)
  for (const state of ['OR', 'WA', 'ID', 'UT']) {
    assert.equal(sevenQp.includes(state), false, state)
  }
  assert.ok(sevenQp.includes('CA'))
})

test('what this station sent us earlier is offered before any guess', () => {
  // Not a guess at all: an exchange the operator already copied from this same
  // station, and the one the scorer and both exports would silently fall back
  // to for a blank second-band contact. Histories are NEWEST first, as
  // `getHistoryForCall` answers.
  const entry = (call: string, location: string, band = '20m', refType = NY.refType) =>
    ({ their: { call }, band, refs: [{ type: refType, location }] }) as Record<string, JSONValue>
  assert.equal(loggedExchangeFor(ny, [entry('K1ABC', 'ERI')], 'K1ABC'), 'ERI')
  assert.equal(loggedExchangeFor(ny, [entry('K1ABC', 'ERI')], 'k1abc'), 'ERI', 'the log is not case-sensitive')
  assert.equal(loggedExchangeFor(ny, [entry('K1ABC', 'ERI')], ''), '')

  // The LATEST county they gave: a rover who drove into the next county sends
  // the new one, and offering the old one would re-log a county they have left.
  assert.equal(loggedExchangeFor(ny, [entry('K1ABC', 'CHA', '40m'), entry('K1ABC', 'ERI')], 'K1ABC'), 'CHA')

  // A contact whose exchange was never copied teaches this nothing, and an
  // event marker is not a contact.
  const blanks = [entry('K1ABC', 'ZZZ', 'event'), entry('K1ABC', '', '15m'), entry('K1ABC', 'ERI')]
  assert.equal(loggedExchangeFor(ny, blanks, 'K1ABC'), 'ERI')

  // A host older than the history filters answers the station's latest
  // contacts of any kind. Another station's are not theirs, and another
  // party's county is not an exchange in this one — both are checked again
  // here, since the filter that should have left them out may not have run.
  assert.equal(loggedExchangeFor(ny, [entry('K2XYZ', 'ALB'), entry('K1ABC', 'ERI')], 'K1ABC'), 'ERI')
  assert.equal(loggedExchangeFor(ny, [entry('K1ABC', 'ORDES', '20m', 'seven-qp'), entry('K1ABC', 'ERI')], 'K1ABC'), 'ERI')
  assert.equal(loggedExchangeFor(ny, [entry('K1ABC', 'ORDES', '20m', 'seven-qp')], 'K1ABC'), '')
})

test('the hint is what the log will claim if nothing is typed', () => {
  // One function for the field's suggestion and the fallback, so the field
  // cannot offer one thing while the score records another. It goes in as a
  // value where it is an exchange (an out-of-party state, `DX`) and as a hint
  // where it is not (the party's own state).
  const hint = (q: Record<string, JSONValue>) => defaultTheirLocation(ny, q)

  // Out of the party the state IS what they will send…
  assert.equal(hint(qso({ entityPrefix: 'K', state: 'PA' })), 'PA')
  // …in the party it is not, and the hint says so anyway: it is how the
  // operator sees WHICH New York station this is while typing the county.
  assert.equal(hint(qso({ entityPrefix: 'K', state: 'NY' })), 'NY')
  // A DX station is never asked to type an exchange at all, so the hint is
  // what the file will write for them.
  assert.equal(hint(qso({ entityPrefix: 'DL' })), 'DX')
  assert.equal(defaultTheirLocation(resolveParty(WA), qso({ entityPrefix: 'DL' })), 'DL')
  assert.equal(hint(qso()), '')
  // No entity at all — no callsign yet, or one the country file cannot place
  // — is a QSO we cannot place, not a DX contact. Answered `DX`, it would be
  // the suggestion shown in every empty entry row.
  assert.equal(defaultTheirLocation(ny, {}), '')
  assert.equal(defaultTheirLocation(ny, { their: { call: 'Q0ZZZ' } } as Record<string, JSONValue>), '')
})

test('an exchange from an earlier running of the event is offered only while it still holds', () => {
  const us = exchangeOptionsFor(ny, qso({ entityPrefix: 'K' }))
  const holds = (location: string, guessedState = '') => pastExchangeHolds(ny, us, guessedState, location)

  // Their county from last year, and the lookup still puts them in New York.
  assert.equal(holds('ALB', 'NY'), true)
  assert.equal(holds('ALB'), true, 'nothing known about where they are now: the county is all there is')

  // They moved. The lookup says Pennsylvania now, so last year's New York
  // county is not what they will send — their state is.
  assert.equal(holds('ALB', 'PA'), false)
  assert.equal(holds('PA', 'PA'), true)
  assert.equal(holds('NJ', 'PA'), false, 'a state they left is no better than a county they left')

  // A code this event no longer offers, and the event's own state, which is
  // not an exchange here whatever it was there.
  assert.equal(holds('ZZZ'), false)
  assert.equal(holds('NY', 'NY'), false)

  // The check is what `loggedExchangeFor` is handed for past runnings: the
  // first exchange that still holds wins, newest first.
  const entry = (location: string) =>
    ({ their: { call: 'K2ABC' }, band: '20m', refs: [{ type: NY.refType, location }] }) as Record<string, JSONValue>
  assert.equal(loggedExchangeFor(ny, [entry('ALB')], 'K2ABC', (l) => pastExchangeHolds(ny, us, 'PA', l)), '')
  assert.equal(loggedExchangeFor(ny, [entry('ALB')], 'K2ABC', (l) => pastExchangeHolds(ny, us, 'NY', l)), 'ALB')
})

test('the declared entry classes become the Cabrillo CATEGORY lines', () => {
  // The reason the classes are captured at all: a submitted log declares its
  // entry in these lines, and a checker reads them rather than guessing.
  const lines = (ref: Record<string, JSONValue>) =>
    Object.fromEntries(
      cabrilloCategories(ny, { uuid: 'op', refs: [{ type: NY.refType, ...ref }] }).filter(([, v]) => v),
    )

  assert.deepEqual(lines({ operator: 'SINGLE-OP', power: 'LOW', station: 'MOBILE', mode: 'CW' }), {
    'CATEGORY-OPERATOR': 'SINGLE-OP',
    'CATEGORY-POWER': 'LOW',
    'CATEGORY-STATION': 'MOBILE',
    'CATEGORY-MODE': 'CW',
  })

  // Cabrillo keeps the transmitter count apart from the operator class, while
  // sponsors publish them as one ("Multi-Single"), so it splits on the way out.
  assert.deepEqual(lines({ operator: 'MULTI-ONE' }), {
    'CATEGORY-OPERATOR': 'MULTI-OP',
    'CATEGORY-TRANSMITTER': 'ONE',
  })
  assert.equal(lines({ operator: 'MULTI-UNLIMITED' })['CATEGORY-TRANSMITTER'], 'UNLIMITED')

  // Phone is SSB in a Cabrillo header, and digital is DIGI.
  assert.equal(lines({ mode: 'PHONE' })['CATEGORY-MODE'], 'SSB')
  assert.equal(lines({ mode: 'DIGITAL' })['CATEGORY-MODE'], 'DIGI')

  // An unanswered question emits NO line: an omitted category is "no claim",
  // while a guessed one is a claim the operator never made.
  assert.deepEqual(lines({}), {})

  // A class the party does not publish is refused rather than submitted — this
  // party has no EOC class, and a value left behind by another setup must not
  // reach a checker under it.
  assert.deepEqual(lines({ station: 'EOC' }), {})
})

test('the file and the scoreboard agree about a blank exchange, both ways', () => {
  // The scorer remembers what a station sent the first time, so a second contact
  // on another band scores under that county. An export reading the ref raw
  // writes NO row for it — a file claiming fewer contacts than the scoreboard.
  const lastLocation: Record<string, string> = {}
  const first = cabrilloRowsFor(ny, qso({ location: 'ERI' }), operation('ALB'), 'N0DEV', { lastLocation })
  assert.equal(first.length, 1)
  const second = cabrilloRowsFor(ny, qso({}), operation('ALB'), 'N0DEV', { lastLocation })
  assert.equal(second.length, 1, 'the remembered county carries the second contact')
  assert.equal(second[0][5].trim(), 'ERI')

  // And the other direction: an exchange that resolves to nothing scores zero
  // with `invalidExchange`, so no row may be written for it either.
  assert.deepEqual(cabrilloRowsFor(ny, qso({ location: 'XYZ' }), operation('ALB'), 'N0DEV'), [])
})

test('both files write what the station SENT, which is not always what it scores as', () => {
  // A party that logs a DX station by its entity prefix still scores it as the
  // single `DX` multiplier. Resolving the prefix to `DX` before the file is
  // written makes the Cabrillo say `DX` and the ADIF say `DL`, and the option
  // changes nothing at all.
  const wa = resolveParty(WA)
  const dx = qso({ location: '', entityPrefix: 'DL', call: 'DL1ABC', params: WA })
  assert.equal(theirLocationForFile(wa, dx, { weAreInParty: true }), 'DL')
  const rows = cabrilloRowsFor(wa, dx, operation('KING', WA), 'N0DEV')
  assert.equal(rows[0][5].trim(), 'DL', 'the Cabrillo says what the ADIF says')

  // A party that logs them as plain `DX` still gets `DX`.
  assert.equal(theirLocationForFile(ny, qso({ location: '', entityPrefix: 'DL', call: 'DL1ABC' }), {
    weAreInParty: true,
  }), 'DX')
})

test('the ADIF and the Cabrillo agree about a remembered exchange', () => {
  // `adifFields` sees one contact at a time and cannot know what a station sent
  // earlier — so the export resolves the whole log up front and hands the
  // answers over.
  const first = { ...qso({ location: 'ERI' }), uuid: 'q1' }
  const second = { ...qso({}), uuid: 'q2', band: '40m' }
  const resolved = resolvedExchanges(ny, operation('ALB'), [first, second])
  assert.equal(resolved.q1, 'ERI')
  assert.equal(resolved.q2, 'ERI', 'the second contact carries the county from the first')
  // Event rows and deleted contacts are not contacts.
  const withNoise = resolvedExchanges(ny, operation('ALB'),
    [first, { band: 'event', uuid: 'e1' }, { ...second, deleted: true }])
  assert.deepEqual(Object.keys(withNoise), ['q1'])
})

test('the file claims no contact the scoreboard refused, and learns nothing from one', () => {
  // A 30m contact scores `invalidBand` at zero. Written into the Cabrillo anyway
  // its exchange is also remembered, so the next blank exchange from that station
  // resolves to a county the scoresheet never recorded.
  assert.equal(claimableBand('20m'), true)
  assert.equal(claimableBand('30m'), false)
  assert.equal(claimableBand(''), false)

  const lastLocation: Record<string, string> = {}
  const warc = { ...qso({ location: 'ERI' }), band: '30m' }
  assert.deepEqual(cabrilloRowsFor(ny, warc, operation('ALB'), 'N0DEV', { lastLocation }), [])
  assert.deepEqual(lastLocation, {}, 'a refused contact teaches the file nothing')

  // And the same station on a legal band with a blank exchange is therefore
  // unclaimable too, exactly as the scorer sees it.
  assert.deepEqual(cabrilloRowsFor(ny, qso({}), operation('ALB'), 'N0DEV', { lastLocation }), [])
})

test('the whole file: a header a checker can read, and one line per contact', () => {
  const op = {
    uuid: 'op',
    stationCall: 'N0DEV',
    grid: 'FN32',
    refs: [{ type: NY.refType, location: 'ALB', operator: 'SINGLE-OP', power: 'LOW', email: 'sd@ham2k.com' }],
  }
  const file = cabrilloFor(ny, op, [
    { ...qso({ location: 'ERI' }), startAtMillis: Date.UTC(2026, 9, 17, 14, 30) },
    // A contact the scorer refuses is not in the file either.
    { ...qso({ location: 'ERI' }), band: '30m', startAtMillis: Date.UTC(2026, 9, 17, 14, 31) },
  ])

  const lines = file.split('\n')
  assert.ok(lines.includes('CONTEST: NY-QSO-PARTY'))
  assert.ok(lines.includes('CALLSIGN: N0DEV'))
  assert.ok(lines.includes('LOCATION: ALB'))
  assert.ok(lines.includes('CATEGORY-OPERATOR: SINGLE-OP'))
  assert.ok(lines.includes('CATEGORY-POWER: LOW'))
  assert.ok(lines.includes('EMAIL: sd@ham2k.com'))
  assert.ok(lines.includes('GRID-LOCATOR: FN32'))
  const qsos = lines.filter((line) => line.startsWith('QSO:'))
  assert.equal(qsos.length, 1)
  assert.match(qsos[0], /^QSO: 14000 CW 2026-10-17 1430 N0DEV\s+599\s+ALB\s+K1ABC\s+599\s+ERI\s*$/)
})

test('a party that exchanges sections offers, and files, sections', () => {
  const pa = resolveParty(PA)
  const us = exchangeOptionsFor(pa, qso({ params: PA, entityPrefix: 'K' })).map((option) => option.code)
  assert.ok(us.includes('ELK') && us.includes('EMA') && us.includes('MDC') && us.includes('CT'))
  for (const state of ['CA', 'NY', 'MD', 'DC']) assert.equal(us.includes(state), false, `${state} is offered`)
  // A section INSIDE Pennsylvania is as unsendable as the state is elsewhere:
  // its stations send a county. A plain `partyStates` comparison misses these,
  // because a section lies in a state without sharing its code.
  assert.equal(us.includes('EPA'), false)
  assert.equal(us.includes('WPA'), false)
  const ve = exchangeOptionsFor(pa, qso({ params: PA, entityPrefix: 'VE' })).map((option) => option.code)
  assert.ok(ve.includes('GH') && ve.includes('TER'))
  assert.equal(ve.includes('ON'), false)

  // The file says what the scoreboard scored: the section as sent, and nothing
  // for a state or for a section inside Pennsylvania.
  assert.ok(cabrilloRowsFor(pa, qso({ params: PA, location: 'ema' }), operation('ELK', PA), 'N0DEV')[0]
    .some((cell) => cell.trim() === 'EMA'))
  assert.deepEqual(cabrilloRowsFor(pa, qso({ params: PA, location: 'CA' }), operation('ELK', PA), 'N0DEV'), [])
  assert.deepEqual(cabrilloRowsFor(pa, qso({ params: PA, location: 'EPA' }), operation('ELK', PA), 'N0DEV'), [])
})

test('the guess floats SECTIONS where the exchange is a section', () => {
  // A lookup answers with a state and the field holds sections, so ranking by
  // the state ranks a code that is not in the list — the guess silently stops
  // floating anything, which is the failure `guessedStateOf` warns about.
  const pa = resolveParty(PA)
  assert.deepEqual(preferredCodesFor(pa, 'MA').sort(), ['EMA', 'WMA'])
  // All nine of California's, since no lookup can say which one they are in.
  // Nine and not ten: `PAC` sits in the sponsor's W6 column by call area, but
  // it is Hawaii and the Pacific islands, so it belongs to no state here.
  assert.deepEqual(preferredCodesFor(pa, 'CA').sort(), ['EB', 'LAX', 'ORG', 'SB', 'SCV', 'SDG', 'SF', 'SJV', 'SV'])
  assert.deepEqual(preferredCodesFor(pa, 'HI'), ['PAC'])
  // A guess of Pennsylvania itself floats the counties and never `EPA`/`WPA`.
  const home = preferredCodesFor(pa, 'PA')
  assert.ok(home.includes('ELK'))
  assert.deepEqual(home.some((code) => code === 'EPA' || code === 'WPA'), false)
})

test('an exchange from an earlier running still holds when the party speaks sections', () => {
  // What was stored is a SECTION and what the lookup answers is a STATE, so a
  // bare comparison never matches and the prefill is dead for every
  // out-of-state station — the great majority of a PAQP log.
  const pa = resolveParty(PA)
  const options = exchangeOptionsFor(pa, qso({ params: PA, entityPrefix: 'K' }))
  assert.equal(pastExchangeHolds(pa, options, 'MA', 'EMA'), true)
  assert.equal(pastExchangeHolds(pa, options, '', 'EMA'), true)
  // A station who has since moved is still refused: `EMA` is not in Ohio.
  assert.equal(pastExchangeHolds(pa, options, 'OH', 'EMA'), false)
  // And a code this party does not offer at all never holds.
  assert.equal(pastExchangeHolds(pa, options, 'MA', 'MA'), false)
})
