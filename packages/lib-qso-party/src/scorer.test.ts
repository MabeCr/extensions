// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// QSO-party scoring. Two kinds of test here, and the second kind is the point:
//
//   * the ordinary business — points by mode, multipliers, duplicates;
//   * the rules that only ONE party has, which is where an engine silently
//     loses things. Every option a shipped party sets is exercised against the
//     party that sets it, so a change that stops reading one fails here rather
//     than quietly scoring nothing.
//
// The rover cases are the subject this engine exists for: our county comes from
// the ref handed to `scoreQso`, which the host resolves per segment, so "we
// moved" is modelled by scoring later QSOs against a different ref.

import { test } from "node:test"
import assert from "node:assert/strict"

import type { JSONValue, ScoreTally } from "@ham2k/extension-sdk"

import { registerEntityLookup } from "./dxcc.ts"
import { ourPowerClass } from "./entry.ts"
import type { QsoPartyScoresheet } from "./index.ts"
import type { QsoPartyParams } from "./params.ts"
import { resolveParty } from "./party.ts"
import { multiplierPrefix, qsoPartyScorer } from "./scorer.ts"
import { CANADIAN_PROVINCES, US_STATES } from './locations.ts'
import { ACQP, AZ, CA, CO, DE, ID, IL, MD, ME, NC, NEQP, NH, NV, NY, OH, PA, SC, SEVEN_QP, TN, WI, WV } from "./testFixtures.ts"

const ctx = { online: false } as never

interface QsoSpec {
  call?: string
  band?: string
  mode?: string
  /// What they sent us.
  location?: string
  entityPrefix?: string
  refType?: string
}

function qso(
  { call = 'K1ABC', band = '20m', mode = 'CW', location, entityPrefix = 'K', refType = NY.refType }: QsoSpec = {},
): Record<string, JSONValue> {
  return {
    their: { call, ...(entityPrefix ? { entityPrefix } : {}) },
    band,
    mode,
    ...(location !== undefined ? { refs: [{ type: refType, location }] } : {}),
  }
}

interface RunOptions {
  params?: QsoPartyParams
  /// Where WE are. A list models a rover: the nth QSO is scored against the nth
  /// location, the last one standing for the rest.
  ourLocation?: string | string[]
  mobile?: boolean
  power?: string
  station?: string
}

function run(
  qsos: Record<string, JSONValue>[],
  { params = NY, ourLocation = 'ALB', mobile, power, station }: RunOptions = {},
) {
  const scorer = qsoPartyScorer(params)
  const locations = Array.isArray(ourLocation) ? ourLocation : [ourLocation]
  const refFor = (index: number): Record<string, JSONValue> => ({
    type: params.refType,
    location: locations[Math.min(index, locations.length - 1)],
    ...(mobile ? { mobile } : {}),
    ...(power ? { power } : {}),
    ...(station ? { station } : {}),
  })
  const operation: Record<string, JSONValue> = { uuid: 'op', stationCall: 'N0DEV', refs: [refFor(0)] }

  let sheet: QsoPartyScoresheet = scorer.startScoresheet({ operation, ref: refFor(0) }, ctx)
  const scores = qsos.map((q, index) => {
    const ref = refFor(index)
    const result = scorer.scoreQso(
      { scoresheet: sheet, qso: q, operation: { ...operation, refs: [ref] }, ref, isNewDay: false },
      ctx,
    )
    sheet = result.scoresheet
    return result.score
  })
  const summary = (scope: 'operation' | 'day' = 'operation'): ScoreTally =>
    scorer.summarizeScore({ scoresheet: sheet, operation, ref: refFor(0), scope }, ctx)[params.refType]
  return { sheet, scores, summary }
}

const multsOf = (result: ReturnType<typeof run>) => Object.keys(result.sheet.mults).length

test('points come from the mode, per party', () => {
  assert.equal(run([qso({ mode: 'SSB', location: 'ERI' })]).scores[0].value, 1)
  assert.equal(run([qso({ mode: 'CW', location: 'ERI' })]).scores[0].value, 2)
  // A digital mode nobody lists by name still prices as the sponsor's data rate.
  assert.equal(run([qso({ mode: 'FT8', location: 'ERI' })]).scores[0].value, 3)
})

test('a county line is worth every pairing of counties', () => {
  // Both of us on a line: four contacts in one exchange, and four multipliers.
  const { scores, sheet } = run([qso({ location: 'ERI/CHA' })], { ourLocation: 'ALB/REN' })
  assert.equal(scores[0].value, 2 * 2 * 2)
  assert.deepEqual(Object.keys(sheet.mults).sort(), ['CHA', 'ERI', 'NY'])
})

test('a county line may run through more than two counties', () => {
  // Three-way county corners exist and CQP says to send them all. Each of our
  // counties pairs with each of theirs: 3×2 contacts.
  const { scores, sheet } = run([qso({ location: 'ERI/CHA' })], { ourLocation: 'ALB/REN/ALL' })
  assert.equal(scores[0].value, 3 * 2 * 2)
  assert.deepEqual(Object.keys(sheet.mults).sort(), ['CHA', 'ERI', 'NY'])
})

test('CA: an in-state contact multiplies as California, never as its county', () => {
  // CQP's in-state entrants chase states and provinces; a California county
  // is worth the CA multiplier and nothing more. Out of state, the counties
  // ARE the multipliers.
  const caQso = (spec: QsoSpec) => qso({ ...spec, refType: CA.refType })
  const inside = run([caQso({ location: 'LASS' }), caQso({ call: 'K6XYZ', location: 'BUTT' })], { params: CA, ourLocation: 'ALAM' })
  assert.deepEqual(Object.keys(inside.sheet.mults), ['CA'])
  const outside = run([caQso({ location: 'LASS' })], { params: CA, ourLocation: 'NY' })
  assert.deepEqual(Object.keys(outside.sheet.mults), ['LASS'])
})

test('CA: an in-state entrant′s score counts 58 multipliers, and every one worked is still struck', () => {
  // 63 are workable from inside California — the 50 states and 13 provinces
  // and territories — and the sponsor counts 58. Capping what is RECORDED
  // instead would leave the chase list showing worked ones as still needed.
  const codes = [...Object.keys(US_STATES), ...Object.keys(CANADIAN_PROVINCES)].filter((code) => code !== 'DC')
  assert.equal(codes.length, 63)
  // California itself is worked by working any county in it.
  const sent = (code: string) => (code === 'CA' ? 'LASS' : code)
  const qsos = codes.map((code, index) =>
    qso({ call: `K${index}ABC`, location: sent(code), entityPrefix: CANADIAN_PROVINCES[code] ? 'VE' : 'K', refType: CA.refType }))
  const { sheet, summary } = run(qsos, { params: CA, ourLocation: 'ALAM' })
  assert.equal(Object.keys(sheet.mults).length, 63)
  assert.equal(summary().mults, 58)
  assert.equal(summary().total, 63 * 3 * 58)
  for (const code of codes) assert.ok((summary().longSummary as string).includes(`~~${code}~~`), `${code} is struck`)
  // Out of state the cap does not apply: it is the in-state rule alone.
  assert.equal(run([qso({ location: 'LASS', refType: CA.refType })], { params: CA, ourLocation: 'NY' }).summary().mults, 1)
})

test('the WARC bands do not count, and neither does a QSO with no band', () => {
  assert.deepEqual(run([qso({ band: '30m', location: 'ERI' })]).scores[0].alerts, ['invalidBand'])
  assert.deepEqual(run([qso({ band: '', location: 'ERI' })]).scores[0].alerts, ['invalidBand'])
})

test('nothing scores until the operator says where WE are', () => {
  // Every contact is worth ours × theirs, so with no county of our own the whole
  // log is zero — and silently, unless it is said out loud.
  const { scores } = run([qso({ location: 'ERI' })], { ourLocation: '' })
  assert.equal(scores[0].value, 0)
  assert.deepEqual(scores[0].alerts, ['ourLocation'])
})

test('an exchange that was never sent, and one that means nothing', () => {
  assert.deepEqual(run([qso({ location: '' })]).scores[0].alerts, ['missingExchange'])
  assert.deepEqual(run([qso({ location: 'ZZZ', entityPrefix: '' })]).scores[0].alerts, ['invalidExchange'])
})

test('an exchange nobody typed is scored from what we know of where they are', () => {
  // Nothing was copied, so rather than refuse the contact both sides read the
  // state the QSO carries — `their.state` from an operator or an import, or the
  // lookup's own guess. Through `defaultTheirLocation`, the one function the
  // export reads too, so a contact cannot be scored under one location and
  // filed under another.
  const blank = (their: Record<string, JSONValue>): Record<string, JSONValue> => ({
    their: { call: 'K1ABC', entityPrefix: 'K', ...their },
    band: '20m',
    mode: 'CW',
    refs: [{ type: NY.refType, location: '' }],
  })

  const asserted = run([blank({ state: 'NJ' })])
  assert.ok((asserted.scores[0].value as number) > 0)
  assert.deepEqual(asserted.scores[0].alerts, undefined)
  assert.deepEqual(Object.keys(asserted.sheet.mults), ['NJ'])

  // The lookup's own guess reaches it too, which is what a live QSO carries
  // before the operator touches the State field.
  assert.deepEqual(Object.keys(run([blank({ guess: { state: 'CA' } })]).sheet.mults), ['CA'])

  // Their own state, in their own party. They send a COUNTY, so this is not
  // what they sent — but the alternative is refusing a contact that plainly
  // happened, and the operator can still type the county in.
  assert.deepEqual(Object.keys(run([blank({ state: 'NY' })]).sheet.mults), ['NY'])
})

test('a typo from a US station is a bad exchange, not a DX contact', () => {
  // `K` is an entity, so a resolution that ends in "any entity at all means DX"
  // scores a mistyped county — and claims a `DX:K` multiplier in every party
  // that counts entities separately.
  const { scores, sheet } = run([qso({ location: 'ALBA' })])
  assert.equal(scores[0].value, 0)
  assert.deepEqual(scores[0].alerts, ['invalidExchange'])
  assert.deepEqual(sheet.entities, {})
  // A station in a country that is genuinely DX still resolves to DX.
  assert.ok((run([qso({ location: 'ZZZ', entityPrefix: 'DL' })]).scores[0].value as number) > 0)
})

test('the state a county multiplies as is struck in the states table', () => {
  // A party that scores an in-party contact by STATE has to say so in the states
  // checklist, or the operator reads it as still needed while the score already
  // counts it.
  const { sheet } = run([qso({ location: 'MAWOR', refType: NEQP.refType })], {
    params: NEQP,
    ourLocation: 'MABAR',
  })
  assert.equal(sheet.states.MA, 1)
  // Same for a party whose in-party entrants claim their own state on top of the
  // county.
  assert.equal(run([qso({ location: 'ERI' })]).sheet.states.NY, 1)
  // And a Canadian party's provinces land in the provinces table, not the states
  // one.
  const acqp = run([qso({ location: 'NSANP', entityPrefix: 'VE', refType: ACQP.refType })], {
    params: ACQP,
    ourLocation: 'NSCOL',
  })
  assert.equal(acqp.sheet.provinces.NS, 1)
  assert.deepEqual(acqp.sheet.states, {})
})

test('two out-of-party stations working each other is not a contest QSO', () => {
  const { scores } = run([qso({ location: 'CT' })], { ourLocation: 'NJ' })
  assert.equal(scores[0].value, 0)
})

test('a station with no exchange is scored under the county they gave last time', () => {
  // The second contact is on a different band, so it counts — and it counts as
  // Erie.
  const { scores, sheet } = run([
    qso({ location: 'ERI' }),
    qso({ band: '40m' }),
  ])
  assert.equal(scores[1].value, 2)
  assert.equal(sheet.counties.ERI, 2)
})

test('a repeat on the same band, mode and county is a duplicate', () => {
  const { scores, sheet } = run([qso({ location: 'ERI' }), qso({ location: 'ERI' })])
  assert.equal(scores[1].value, 0)
  assert.equal(scores[1].dupe, true)
  assert.deepEqual(scores[1].alerts, ['duplicate'])
  assert.equal(sheet.dupes, 1)
})

test('a county line that overlaps an earlier contact on ANY pairing is a repeat', () => {
  // The safe reading of a rule the sponsors leave open. Requiring every pairing
  // to overlap claims a contact a log checker may strike, and an over-claim in a
  // submitted file is the worse of the two errors — so a station who moves onto
  // a line that still includes the county we just worked them from gets no
  // second contact.
  const { scores } = run([qso({ location: 'ERI' }), qso({ location: 'ERI/CHA' })])
  assert.equal(scores[1].dupe, true)
  // Neither county worked before, and it counts — both pairings.
  const fresh = run([qso({ location: 'ERI' }), qso({ location: 'ALB/CHA' })])
  assert.equal(fresh.scores[1].value, 2 * 2)
})

test('the same station on a new band or a new mode counts again, and says so', () => {
  const { scores } = run([
    qso({ location: 'ERI' }),
    qso({ location: 'ERI', band: '40m' }),
    qso({ location: 'ERI', mode: 'SSB' }),
  ])
  assert.ok(scores[1].notices?.includes('newBand'))
  assert.ok(scores[2].notices?.includes('newMode'))
  assert.equal(scores[1].value, 2)
})

test('a rover who moves may work the same station again, from the new county', () => {
  // Rolling location: the second contact is scored against the segment's ref, so
  // the pair (our county, theirs) is new.
  const { scores } = run([qso({ location: 'ERI' }), qso({ location: 'ERI' })], {
    ourLocation: ['ALB', 'REN'],
  })
  assert.equal(scores[1].value, 2)
  assert.equal(scores[1].dupe, undefined)
})

test('a rover activates each county they operate from', () => {
  const { sheet } = run([qso({ location: 'ERI' }), qso({ location: 'CHA' })], {
    ourLocation: ['ALB', 'REN'],
  })
  assert.deepEqual(sheet.activatedCounties, { ALB: 1, REN: 1 })
})

test('a multiplier is claimed once, and the first claim says so', () => {
  const { scores, sheet } = run([
    qso({ location: 'ERI' }),
    qso({ call: 'K2DEF', location: 'ERI' }),
  ])
  assert.ok(scores[0].notices?.includes('newMult'))
  assert.ok(!(scores[1].notices ?? []).includes('newMult'))
  assert.equal(Object.keys(sheet.mults).length, 2) // ERI and NY
})

test("an in-party station's own state multiplies alongside the county", () => {
  const { sheet } = run([qso({ location: 'ERI' })])
  assert.deepEqual(Object.keys(sheet.mults).sort(), ['ERI', 'NY'])
  // An out-of-party entrant gets the county alone.
  const outside = run([qso({ location: 'ERI' })], { ourLocation: 'NJ' })
  assert.deepEqual(Object.keys(outside.sheet.mults), ['ERI'])
})

test('multipliers per band, per mode, or once — whichever the party publishes', () => {
  const args = { band: '20m', mode: 'CW', weAreInParty: true }
  assert.equal(multiplierPrefix(resolveParty(NY), args), '')
  assert.equal(multiplierPrefix(resolveParty(OH), args), 'CW:')
  assert.equal(multiplierPrefix(resolveParty(TN), args), '20m:')
  assert.equal(multiplierPrefix(resolveParty(SC), args), '20m:CW:')
})

test('the side-specific per-band options apply to the side they name', () => {
  // Testing the in-party option in every branch makes a party that sets it
  // unable to reach the plain per-band rule, and applies it to the other side.
  const nh = resolveParty(NH)
  assert.equal(multiplierPrefix(nh, { band: '20m', mode: 'CW', weAreInParty: false }), '20m:')
  assert.equal(multiplierPrefix(nh, { band: '20m', mode: 'CW', weAreInParty: true }), '')
})

test('a party may answer the multiplier key for itself', () => {
  const { sheet } = run([qso({ location: 'ERI' })], {
    params: { ...NY, multiplierKeyPrefix: () => 'DAY1:' },
  })
  assert.deepEqual(Object.keys(sheet.mults).sort(), ['DAY1:ERI', 'DAY1:NY'])
})

test('an in-party pair multiplies by state, and the county is still logged', () => {
  const { sheet } = run([qso({ location: 'MAWOR', refType: NEQP.refType })], {
    params: NEQP,
    ourLocation: 'MABAR',
  })
  assert.deepEqual(Object.keys(sheet.mults), ['MA'])
  assert.equal(sheet.counties.MAWOR, 1)
})

test('the same rule in a Canadian party multiplies by province', () => {
  // The county is always what was sent; only what it multiplies changes.
  const { sheet } = run([qso({ location: 'NSANP', entityPrefix: 'VE', refType: ACQP.refType })], {
    params: ACQP,
    ourLocation: 'NSCOL',
  })
  assert.equal(sheet.counties.NSANP, 1)
  assert.equal(Object.keys(sheet.mults).some((key) => key.includes('NSANP')), false)
})

test('an in-state station working out of state scores double where a party says so', () => {
  const inside = run([qso({ location: 'NC', refType: SC.refType })], { params: SC, ourLocation: 'ABBE' })
  const outside = run([qso({ location: 'ABBE', refType: SC.refType })], { params: SC, ourLocation: 'NC' })
  assert.equal(inside.scores[0].value, 4)
  assert.equal(outside.scores[0].value, 2)
})

test('a rare county multiplies the contact, and the sweep pays once', () => {
  const rare = ['CAB', 'GRM', 'VAN', 'MAC', 'DAV']
  const one = run([qso({ location: 'CAB', refType: NC.refType })], { params: NC, ourLocation: 'WAK' })
  assert.equal(one.scores[0].value, 3 * 10)
  assert.ok(one.scores[0].notices?.includes('rareCounty'))

  const swept = run(
    rare.map((location, index) => qso({ call: `K${index}AAA`, location, refType: NC.refType })),
    { params: NC, ourLocation: 'WAK' },
  )
  // `bonusPostMultiplier`: the sweep is added AFTER the multiplier, so it is not
  // multiplied by the county count.
  assert.equal(swept.summary().total, swept.sheet.points * multsOf(swept) + 500)
})

test('the bonus stations pay out-of-state entrants only, and sweep', () => {
  // An in-state factor of 0 is how a party says "not for us".
  const stations = ['K7S', 'K7P', 'K7U', 'K7D']
  const outside = run(
    stations.map((call) => qso({ call, location: 'ADA', refType: ID.refType })),
    { params: ID, ourLocation: 'WA' },
  )
  assert.equal(Object.values(outside.sheet.bonusStations).reduce((a, b) => a + b, 0), 400)
  assert.ok(outside.scores[0].notices?.includes('bonusStation'))
  // 400 for the four stations, plus the 100 sweep for working all of them.
  assert.equal(outside.summary().total, (outside.sheet.points + 500) * multsOf(outside))

  const inside = run([qso({ call: 'K7S', location: 'ADA', refType: ID.refType })], {
    params: ID,
    ourLocation: 'BOI',
  })
  assert.deepEqual(inside.sheet.bonusStations, {})
})

test('a bonus station pays once, and again per band where the party says so', () => {
  const wv = run([
    qso({ call: 'W8WVA', location: 'KAN', refType: WV.refType }),
    qso({ call: 'W8WVA', location: 'KAN', band: '40m', refType: WV.refType }),
  ], { params: WV, ourLocation: 'OH' })
  assert.equal(Object.keys(wv.sheet.bonuses).length, 2)
  assert.equal(wv.sheet.bonusStations.W8WVA, 200)
  // A party with no bonus stations pays none.
  assert.deepEqual(run([qso({ call: 'W8WVA', location: 'ERI' })]).sheet.bonusStations, {})
})

test('a bonus written with a slashed zero still matches the logged callsign', () => {
  // Hams write `WØMA` by hand and a log carries the digit, so the two would never
  // meet and the bonus could not be claimed at all.
  const { sheet } = run([qso({ call: 'W0MA', location: 'ERI' })], {
    params: { ...NY, bonusStations: { 'WØMA': 100 } },
  })
  assert.equal(sheet.bonusStations.W0MA, 100)
})

test('a bonus station is recognized by its base call, so a rover still pays', () => {
  const roving: Record<string, JSONValue> = {
    their: { call: 'W8WVA/M', baseCall: 'W8WVA', entityPrefix: 'K' },
    band: '20m',
    mode: 'CW',
    refs: [{ type: WV.refType, location: 'KAN' }],
  }
  const { sheet } = run([roving], { params: WV, ourLocation: 'OH' })
  assert.equal(sheet.bonusStations.W8WVA, 100)
})

test('a party may answer what a bonus station pays', () => {
  const params: QsoPartyParams = {
    ...NY,
    bonusStations: { W2XYZ: 100 },
    bonusForStation: ({ call, weAreInParty }) => (call.startsWith('K7') ? (weAreInParty ? 25 : 50) : undefined),
  }
  // The override is asked first, and is told which side we are on…
  assert.equal(run([qso({ call: 'K7ABC', location: 'ERI' })], { params }).sheet.bonusStations.K7ABC, 25)
  assert.equal(
    run([qso({ call: 'K7ABC', location: 'ERI' })], { params, ourLocation: 'NJ' }).sheet.bonusStations.K7ABC,
    50,
  )
  // …and `undefined` is "no opinion", which falls back to the party's own table.
  assert.equal(run([qso({ call: 'W2XYZ', location: 'ERI' })], { params }).sheet.bonusStations.W2XYZ, 100)
})

test('the per-county bonus is for rovers, and only above the minimum', () => {
  const fifteen = (location: string) =>
    Array.from({ length: 15 }, (_, index) => qso({ call: `K${index}AAA`, location, refType: CO.refType }))
  const bonusOf = (result: ReturnType<typeof run>) =>
    result.summary().total - result.sheet.points * multsOf(result)

  const rover = run(fifteen('DEN'), { params: CO, ourLocation: 'ADA', mobile: true })
  assert.equal(bonusOf(rover), 500)

  const fixed = run(fifteen('DEN'), { params: CO, ourLocation: 'ADA' })
  assert.equal(bonusOf(fixed), 0)

  // One QSO short of the minimum earns nothing.
  const short = run(fifteen('DEN').slice(0, 14), { params: CO, ourLocation: 'ADA', mobile: true })
  assert.equal(bonusOf(short), 0)
})

test('"Mobile or Rover" is the station class, and the old flag still counts', () => {
  // Declaring Mobile or Rover is the same claim the checkbox made, and has to
  // earn the same bonus — while an operation logged before the classes existed,
  // or synced from app-polo, still carries the boolean.
  const fifteen = Array.from({ length: 15 }, (_, index) =>
    qso({ call: `K${index}AAA`, location: 'DEN', refType: CO.refType }))
  const bonusOf = (result: ReturnType<typeof run>) =>
    result.summary().total - result.sheet.points * multsOf(result)

  assert.equal(bonusOf(run(fifteen, { params: CO, ourLocation: 'ADA', station: 'MOBILE' })), 500)
  assert.equal(bonusOf(run(fifteen, { params: CO, ourLocation: 'ADA', mobile: true })), 500)
  assert.equal(bonusOf(run(fifteen, { params: CO, ourLocation: 'ADA', station: 'FIXED' })), 0)
})

test('our own county is a multiplier without working anyone in it', () => {
  const { sheet } = run([qso({ location: 'MD', refType: NC.refType })], { params: NC, ourLocation: 'WAK' })
  assert.ok(Object.keys(sheet.mults).includes('WAK'))
  // And only for the parties that say so.
  assert.equal(Object.keys(run([qso({ location: 'MD' })]).sheet.mults).includes('ALB'), false)
})

test('a rover claims its own county only while it is roving', () => {
  const roving = run([qso({ location: 'MD', refType: TN.refType })], {
    params: TN,
    ourLocation: 'ANDE',
    station: 'ROVER',
  })
  assert.ok(Object.keys(roving.sheet.mults).includes('20m:ANDE'))
  const fixed = run([qso({ location: 'MD', refType: TN.refType })], { params: TN, ourLocation: 'ANDE' })
  assert.equal(Object.keys(fixed.sheet.mults).includes('20m:ANDE'), false)
})

test('the DX entity cap limits the multipliers instead of erasing them', () => {
  const entities = ['DL', 'F', 'G', 'I', 'EA', 'PA']
  const { sheet } = run(entities.map((prefix, index) => qso({
    call: `${prefix}1AA${index}`,
    location: 'DX',
    entityPrefix: prefix,
    refType: IL.refType,
  })), { params: IL, ourLocation: 'COOK' })
  const dxMults = Object.keys(sheet.mults).filter((key) => key.includes('DX:'))
  // The cap is five: the sixth entity is a valid contact worth points, and not a
  // sixth multiplier.
  assert.equal(dxMults.length, 5)
  assert.equal(Object.keys(sheet.entities).length, 6)

  // And a SECOND station in the over-cap entity does not sneak past it. The
  // exemption that keeps an established multiplier claimable has to test what was
  // CREDITED, not what was worked — testing the latter lets the sixth entity in
  // on its second contact, one multiplier over a published cap.
  const twice = run([...entities, 'PA', 'PA'].map((prefix, index) => qso({
    call: `${prefix}1AA${index}`,
    location: 'DX',
    entityPrefix: prefix,
    refType: IL.refType,
  })), { params: IL, ourLocation: 'COOK' })
  assert.equal(Object.keys(twice.sheet.mults).filter((key) => key.includes('DX:')).length, 5)
})

test('a party credits each DX entity up to its published cap', () => {
  const entities = ['DL', 'F', 'G', 'I', 'EA', 'PA', 'ON', 'SM', 'LA', 'OZ', 'SP', 'HA']
  const { sheet } = run(entities.map((prefix, index) => qso({
    call: `${prefix}1AA${index}`,
    location: 'DX',
    entityPrefix: prefix,
    refType: NH.refType,
  })), { params: NH, ourLocation: 'BEL' })
  const dxMults = Object.keys(sheet.mults).filter((key) => key.includes('DX:'))
  assert.equal(dxMults.length, 10, 'ten credited, not one and not twelve')
  assert.equal(Object.keys(sheet.entities).length, 12, 'all twelve worked')
})

test('a declared power class multiplies the score, and no claim multiplies by one', () => {
  const qrp = run([qso({ location: 'NJ', refType: DE.refType })], {
    params: DE,
    ourLocation: 'NDE',
    power: 'QRP',
  })
  const undeclared = run([qso({ location: 'NJ', refType: DE.refType })], { params: DE, ourLocation: 'NDE' })
  assert.equal(qrp.summary().total, undeclared.summary().total * 3)
  // The factor is part of how the total came about, so the arithmetic that
  // explains the total has to show it; without a class it is noise.
  assert.match((qrp.summary().longSummary as string).split('\n')[0], /× 1 mult \(1 state\) × 3 power$/)
  assert.doesNotMatch((undeclared.summary().longSummary as string).split('\n')[0], /power/)
})

test('a power class the party does not publish is not submitted under it', () => {
  // A class left behind by an earlier setup must be refused, as it is on every
  // other axis: a party without power classes cannot inherit the answer.
  const ref = { type: WI.refType, power: 'QRP' }
  assert.equal(ourPowerClass(resolveParty(WI), undefined, ref), 'QRP')
  assert.equal(ourPowerClass(resolveParty(NV), undefined, ref), undefined)
})

test("a party prices a contact by which side the other station is on", () => {
  // "2 points per QSO with ME stations, 1 point per QSO with non-ME stations" —
  // the published rule no per-mode points table can express.
  const inParty = run([qso({ location: 'CBL', refType: ME.refType })], { params: ME, ourLocation: 'NH' })
  assert.equal(inParty.scores[0].value, 2)
  const outOfParty = run([qso({ location: 'NH', refType: ME.refType })], { params: ME, ourLocation: 'CBL' })
  assert.equal(outOfParty.scores[0].value, 1)
})

test('a party may price a contact for itself, one pairing at a time', () => {
  const params: QsoPartyParams = {
    ...NY,
    pointsForContact: ({ theirs }) => (theirs.some((location) => location.code === 'ERI') ? 10 : undefined),
  }
  // The price is per PAIRING, so a county line pays it twice.
  assert.equal(run([qso({ location: 'ERI' })], { params }).scores[0].value, 10)
  assert.equal(run([qso({ location: 'ERI/CHA' })], { params }).scores[0].value, 20)
  // `undefined` is "no opinion", and the mode table answers.
  assert.equal(run([qso({ location: 'CHA' })], { params }).scores[0].value, 2)
})

// A party is one period, however many UTC days it straddles: the sponsors
// publish one total, and a day's share of it is not a number they define.
test('a party is one period: it offers no per-day summary', () => {
  const { summary } = run([qso({ location: 'ERI' }), qso({ call: 'K2DEF', location: 'CHA' })])
  assert.equal(summary('day'), undefined)
})

// The label is the section's title in the information panel and the only
// place the total shows, since a tally with a `longSummary` hides its short
// `summary`; the arithmetic under it has to multiply out to that same total.
test('the summary is titled with the event and its total, and opens on the arithmetic', () => {
  const result = run([qso({ mode: 'CW', location: 'ERI' }), qso({ call: 'K2DEF', mode: 'CW', location: 'CHA' })])
  const tally = result.summary()
  assert.equal(tally.label, `${NY.short}: ${tally.total} points`)
  assert.equal(tally.total, 4 * 3)
  // An in-state NYQP entrant's own state multiplies too, on top of the two
  // counties worked.
  assert.equal((tally.longSummary as string).split('\n')[0], '2 QSOs, 4 pts × 3 mults (2 counties, 1 state)')
})

// Counties and states are different things to chase; the split says which the
// log is short of. A key alone cannot tell them apart, so a kind recorded
// wrongly, or not at all, shows here as a split that no longer adds up.
test('the arithmetic splits the multipliers by the kind of place', () => {
  const { summary } = run(
    [qso({ location: 'ERI' }), qso({ call: 'K2DEF', location: 'NJ' }), qso({ call: 'VE3ABC', location: 'ON', entityPrefix: 'VE' })],
  )
  assert.match((summary().longSummary as string).split('\n')[0], /× 4 mults \(1 county, 2 states, 1 province\)$/)
  // A Canadian party's county multiplies as its province, and is named as one.
  const acqp = run([qso({ location: 'NSANP', entityPrefix: 'VE', refType: ACQP.refType })], {
    params: ACQP,
    ourLocation: 'NSCOL',
  })
  assert.match((acqp.summary().longSummary as string).split('\n')[0], /× 1 mult \(1 province\)$/)
})

// A sponsor's own word for its counties reads in the split, or CPQP's
// entrants would be counting "counties" the rules never mention.
test('the split names counties in the party\'s own word', () => {
  const params: QsoPartyParams = { ...NY, labelForCounties: 'Districts' }
  const { summary } = run([qso({ location: 'ERI' }), qso({ call: 'K2DEF', location: 'CHA' })], { params })
  assert.match((summary().longSummary as string).split('\n')[0], /\(2 districts, 1 state\)$/)
})

// Under a cap the multiplier is less than the keys worked, and a split of the
// keys would add up to more than the figure it explains.
test('the split is left out where an in-state cap trims the multiplier', () => {
  const codes = [...Object.keys(US_STATES), ...Object.keys(CANADIAN_PROVINCES)].filter((code) => code !== 'DC')
  const sent = (code: string) => (code === 'CA' ? 'LASS' : code)
  const qsos = codes.map((code, index) =>
    qso({ call: `K${index}ABC`, location: sent(code), entityPrefix: CANADIAN_PROVINCES[code] ? 'VE' : 'K', refType: CA.refType }))
  const { summary } = run(qsos, { params: CA, ourLocation: 'ALAM' })
  assert.match((summary().longSummary as string).split('\n')[0], /× 58 mults$/)
})

// A scoresheet checkpointed before kinds were recorded still scores; naming
// the kinds of only the keys credited since would add up to less than the
// multiplier beside them.
test('a sheet with keys of no recorded kind names no split', () => {
  const scorer = qsoPartyScorer(NY)
  const operation: Record<string, JSONValue> = { uuid: 'op', refs: [{ type: NY.refType, location: 'ALB' }] }
  const ref = { type: NY.refType, location: 'ALB' }
  const sheet = scorer.startScoresheet({ operation, ref }, ctx)
  sheet.mults = { ERI: 1 }
  delete sheet.multKinds
  scorer.scoreQso({ scoresheet: sheet, qso: qso({ call: 'K2DEF', location: 'CHA' }), operation, ref, isNewDay: false }, ctx)
  const tally = scorer.summarizeScore({ scoresheet: sheet, operation, ref, scope: 'operation' }, ctx)[NY.refType]
  assert.match((tally.longSummary as string).split('\n')[0], /× 3 mults$/)
})

test('the summary lists what is still out there, not just what is done', () => {
  const { summary } = run([qso({ location: 'ERI' })])
  const detail = summary().longSummary as string
  // Worked counties are struck through; the rest are there to be chased.
  assert.match(detail, /\*\*~~ERI~~\*\*/)
  assert.match(detail, /\bALL\b/)
  assert.equal(summary().grid, true)
})

test('typing your STATE where your county belongs is said out loud', () => {
  // `NY` resolves cleanly to the state — no party's county codes collide with a
  // state code — so nothing else objects, and the whole log is quietly scored
  // under out-of-party rules: no own-state multiplier, no activated county, a
  // different multiplier key. The contact still counts; the operator is told.
  const typed = run([qso({ location: 'ERI' })], { ourLocation: 'NY' })
  assert.deepEqual(typed.scores[0].alerts, ['ourLocation'])
  assert.ok((typed.scores[0].value as number) > 0, 'the contact still counts for what it is worth')

  // A county is what it should be, and says nothing.
  assert.equal(run([qso({ location: 'ERI' })], { ourLocation: 'ALB' }).scores[0].alerts, undefined)
  // And a genuine out-of-party entrant is not nagged about their own state.
  assert.equal(run([qso({ location: 'ERI' })], { ourLocation: 'NJ' }).scores[0].alerts, undefined)
  // A multi-state party knows every one of its own states, and it has no
  // `state` field to have learnt them from: they come from the county codes.
  assert.deepEqual(
    run([qso({ location: 'ORDES', refType: SEVEN_QP.refType })], {
      params: SEVEN_QP,
      ourLocation: 'UT',
    }).scores[0].alerts,
    ['ourLocation'],
  )
})

test('a party may say which state a county belongs to', () => {
  // Codes that carry no state of their own: without an answer here every one of
  // them belongs to the party's lead state, and an entrant in the second state
  // is never told they typed a state for a county.
  const params: QsoPartyParams = {
    ...NY,
    state: 'OR',
    counties: { DES: 'Deschutes', ADA: 'Ada' },
    stateOfCounty: (county) => (county === 'ADA' ? 'ID' : undefined),
  }
  assert.deepEqual(
    run([qso({ location: 'DES' })], { params, ourLocation: 'ID' }).scores[0].alerts,
    ['ourLocation'],
  )
})

test('a DX station is resolved from the callsign when nothing else knows', () => {
  // An imported or synced QSO carries no lookup at all, so without the country
  // file the entity is unknown: the exchange resolves to nothing, the contact
  // scores `missingExchange`, and the DX multiplier the party publishes is never
  // claimed.
  registerEntityLookup((call) => (call?.toUpperCase().startsWith('DL') ? 'DL' : undefined))
  try {
    const imported = {
      their: { call: 'DL1ABC' },
      band: '20m',
      mode: 'CW',
      refs: [{ type: IL.refType, location: '' }],
    } as Record<string, JSONValue>
    const { scores, sheet } = run([imported], { params: IL, ourLocation: 'COOK' })
    assert.ok((scores[0].value as number) > 0)
    assert.deepEqual(Object.keys(sheet.entities), ['DL'])
  } finally {
    registerEntityLookup(() => undefined)
  }
})

test('the band table counts CW, phone and digital apart, per band and in total', () => {
  const { summary } = run([
    qso({ band: '40m', mode: 'CW', location: 'ERI' }),
    qso({ call: 'K2DEF', band: '40m', mode: 'SSB', location: 'CHA' }),
    qso({ call: 'K3GHI', band: '20m', mode: 'FT8', location: 'ALB' }),
    qso({ call: 'K4JKL', band: '160m', mode: 'CW', location: 'ALB' }),
  ])
  const lines = (summary().longSummary as string).split('\n')
  // Longest wavelength first, not alphabetical — which would file 160m
  // between 15m and 20m — and every mode named on every line, zeros included,
  // so an unworked mode reads as "0", not as an absence.
  assert.deepEqual(lines.filter((line) => /^\*\*(\d+m|All bands)\*\*/.test(line)), [
    '**160m**: 1 CW, 0 SSB, 0 Digital, **1 total**',
    '**40m**: 1 CW, 1 SSB, 0 Digital, **2 total**',
    '**20m**: 0 CW, 0 SSB, 1 Digital, **1 total**',
    '**All bands**: 2 CW, 1 SSB, 1 Digital, **4 total**',
  ])
})

test('the band table separates digital from CW even where the party scores them as one mode', () => {
  // DE folds data into CW for multipliers and dupes; the table still tells the
  // operator which of the two they worked.
  const { summary } = run([qso({ mode: 'FT8', location: 'NJ', refType: DE.refType })], { params: DE, ourLocation: 'NDE' })
  assert.match(summary().longSummary as string, /\*\*20m\*\*: 0 CW, 0 SSB, 1 Digital, \*\*1 total\*\*/)
})

test('Arizona multiplies by county per band and mode outside, by state per mode inside', () => {
  // Out of state: a county counts again on every band and every mode.
  const outside = run([
    qso({ location: 'MCP', refType: AZ.refType }),
    qso({ location: 'MCP', band: '40m', refType: AZ.refType }),
    qso({ location: 'MCP', band: '40m', mode: 'SSB', refType: AZ.refType }),
  ], { params: AZ, ourLocation: 'NY' })
  assert.deepEqual(Object.keys(outside.sheet.mults).sort(), ['20m:CW:MCP', '40m:CW:MCP', '40m:PHONE:MCP'])

  // In state: two Arizona counties on CW are one multiplier, Arizona itself —
  // and `stateCountsForInState` names the same one, not a second. A DX station
  // with no exchange is its entity, never a state that shares its prefix: `PA`
  // read as a location would be Pennsylvania.
  const inside = run([
    qso({ location: 'MCP', refType: AZ.refType }),
    qso({ call: 'K1ABD', location: 'YMA', refType: AZ.refType }),
    qso({ call: 'K1ABE', location: 'NY', refType: AZ.refType }),
    qso({ call: 'K1ABF', location: 'NY', band: '40m', refType: AZ.refType }),
    qso({ call: 'PA3XYZ', entityPrefix: 'PA', refType: AZ.refType }),
  ], { params: AZ, ourLocation: 'PMA' })
  assert.deepEqual(Object.keys(inside.sheet.mults).sort(), ['CW:AZ', 'CW:DX:PA', 'CW:NY'])
  assert.equal(inside.sheet.entities.PA, 1)
  assert.equal(inside.sheet.states.PA, undefined)

  // The county still identifies the station: the same one from the same county
  // is a repeat, and a mobile that has moved is a fresh contact worth points.
  const repeat = run([
    qso({ call: 'K7XX', location: 'MCP', refType: AZ.refType }),
    qso({ call: 'K7XX', location: 'MCP', refType: AZ.refType }),
  ], { params: AZ, ourLocation: 'PMA' })
  assert.equal(repeat.sheet.dupes, 1)
  const moved = run([
    qso({ call: 'K7XX', location: 'MCP', refType: AZ.refType }),
    qso({ call: 'K7XX', location: 'YMA', refType: AZ.refType }),
  ], { params: AZ, ourLocation: 'PMA' })
  assert.equal(moved.sheet.dupes, 0)
  assert.equal(moved.sheet.points, 4)

  // Total = (QSO points × multipliers) + bonus, with K7A worth 100 once.
  const bonus = run([
    qso({ call: 'K7A', location: 'MCP', refType: AZ.refType }),
    qso({ call: 'K7A', location: 'MCP', band: '40m', refType: AZ.refType }),
  ], { params: AZ, ourLocation: 'NY' })
  assert.equal(bonus.summary().total, 4 * 2 + 100)
})

test('Pennsylvania counts all DX as one multiplier, and its bonus station per band after the multiplier', () => {
  const dx = run(
    ['DL', 'F', 'G'].map((prefix, index) => qso({ call: `${prefix}1AA${index}`, entityPrefix: prefix, refType: PA.refType })),
    { params: PA, ourLocation: 'ELK' },
  )
  assert.deepEqual(Object.keys(dx.sheet.mults), ['DX'])

  // Each valid QSO with K3ZMC is worth 200, so a second band earns it again.
  const bonus = run([
    qso({ call: 'K3ZMC', location: 'MGY', refType: PA.refType }),
    qso({ call: 'K3ZMC', location: 'MGY', band: '40m', refType: PA.refType }),
  ], { params: PA, ourLocation: 'ELK' })
  assert.equal(bonus.sheet.bonusStations.K3ZMC, 400)
  // Two CW QSOs at 2 points, two multipliers (the county and its section),
  // then the bonus.
  assert.equal(bonus.sheet.points, 4)
  assert.equal(multsOf(bonus), 2)
  assert.equal(bonus.summary().total, 4 * 2 + 400)
  // Added after the product, so the arithmetic must not bracket it into the
  // points: that reads as (4 + 400) × 2.
  assert.equal((bonus.summary().longSummary as string).split('\n')[0], '2 QSOs, 4 pts × 2 mults (1 county, 1 section) + 400 bonus')
})

// Most parties fold a bonus into the points before multiplying; an arithmetic
// line that added it after would multiply out to a different total.
test('a bonus folded in before the multiplier is bracketed with the points', () => {
  const params: QsoPartyParams = { ...NY, bonusStations: { K2BON: 100 } }
  const { summary } = run([qso({ call: 'K2BON', location: 'ERI' })], { params })
  assert.equal(summary().total, (2 + 100) * 2)
  assert.equal((summary().longSummary as string).split('\n')[0], '1 QSO, (2 pts + 100 bonus) × 2 mults (1 county, 1 state)')
})

test('Pennsylvania: the summary lists the band/mode slots each bonus station has paid in', () => {
  // K3ZMC pays again on every band and mode, so a callsign struck after the
  // first contact reads as "done" while most of its 200s are still open.
  const { summary } = run([
    qso({ call: 'K3ZMC', location: 'MGY', band: '40m', mode: 'SSB', refType: PA.refType }),
    qso({ call: 'K3ZMC', location: 'MGY', band: '80m', refType: PA.refType }),
  ], { params: PA, ourLocation: 'ELK' })
  assert.match(summary().longSummary as string, /\*\*~~K3ZMC~~\*\* \(80m CW, 40m SSB\)/)

  // Where a bonus pays once, there are no slots to list.
  const az = run([qso({ call: 'K7A', location: 'MCP', refType: AZ.refType })], { params: AZ, ourLocation: 'NY' })
    .summary().longSummary as string
  assert.match(az, /\*\*~~K7A~~\*\*(?! \()/)
})

test('Pennsylvania: an in-state entrant earns each county\'s section, EPA or WPA, as well as the county', () => {
  // Rule 12.d: the sponsor adds EPA and WPA when rescoring. Missing them
  // under-reports every in-state score by up to two multipliers.
  const inside = run([
    qso({ call: 'K3AAA', location: 'MGY', refType: PA.refType }),
    qso({ call: 'K3BBB', location: 'BUX', refType: PA.refType }),
    qso({ call: 'K3CCC', location: 'ALL', refType: PA.refType }),
  ], { params: PA, ourLocation: 'ELK' })
  assert.deepEqual(Object.keys(inside.sheet.mults).sort(), ['ALL', 'BUX', 'EPA', 'MGY', 'WPA'])
  assert.match(inside.summary().longSummary as string, /\*\*~~EPA~~\*\*/)

  // Out of state the multipliers are the 67 counties alone (rule 10.b).
  const outside = run([qso({ location: 'MGY', refType: PA.refType })], { params: PA, ourLocation: 'EMA' })
  assert.deepEqual(Object.keys(outside.sheet.mults), ['MGY'])

  // Our own county earns nothing without working anyone: ELK sits in WPA, and
  // a log that only worked EPA must not claim it.
  const eastOnly = run([qso({ location: 'MGY', refType: PA.refType })], { params: PA, ourLocation: 'ELK' })
  assert.deepEqual(Object.keys(eastOnly.sheet.mults).sort(), ['EPA', 'MGY'])

  // A county line on the far side is two counties, and one section when both
  // lie in it.
  const line = run([qso({ location: 'CAR/LEH', refType: PA.refType })], { params: PA, ourLocation: 'ELK' })
  assert.deepEqual(Object.keys(line.sheet.mults).sort(), ['CAR', 'EPA', 'LEH'])
})

test('Pennsylvania: a station outside the state is worth its SECTION, and a state is not one', () => {
  // The sponsor's checker reads the ARRL/RAC list, so the score may only claim
  // what that list holds. The trap is a state table standing in for it: `CA`
  // and `NY` then score as one multiplier each where the rules have nine and
  // four, and `EMA` — a perfectly good exchange — scores zero as a typo.
  const worked = run(
    ['EMA', 'WMA', 'LAX', 'SF', 'MDC', 'GH', 'ONE', 'CT'].map((location, index) => qso({
      refType: PA.refType,
      call: `K1AA${index}`,
      location,
      entityPrefix: location === 'GH' || location === 'ONE' ? 'VE' : 'K',
    })),
    { params: PA, ourLocation: 'ELK' },
  )
  assert.deepEqual(worked.scores.map((score) => score.value), [2, 2, 2, 2, 2, 2, 2, 2])
  assert.deepEqual(Object.keys(worked.sheet.mults).sort(), ['CT', 'EMA', 'GH', 'LAX', 'MDC', 'ONE', 'SF', 'WMA'])

  // A state that is not also a section is a bad exchange — never a guess at
  // which of its sections was meant, and never the state multiplier.
  const states = run(
    ['CA', 'NY', 'MA', 'MD', 'DC', 'ON'].map((location, index) => qso({
      refType: PA.refType,
      call: `K2AA${index}`,
      location,
      entityPrefix: location === 'ON' ? 'VE' : 'K',
    })),
    { params: PA, ourLocation: 'ELK' },
  )
  for (const score of states.scores) assert.deepEqual(score.alerts, ['invalidExchange'])
  assert.deepEqual(states.sheet.mults, {})
})

test('Pennsylvania: an entrant outside the state enters from a section, and QRP doubles', () => {
  // `EMA` has to resolve as OUR location too, or a Massachusetts entrant can
  // only operate by typing a state the sponsor then rejects in every QSO line.
  const outside = run([qso({ refType: PA.refType, location: 'ELK' })], { params: PA, ourLocation: 'EMA' })
  assert.equal(outside.scores[0].value, 2)
  assert.deepEqual(Object.keys(outside.sheet.mults), ['ELK'])

  // Our own SECTION is the mistake this party makes easy: `EPA` resolves
  // cleanly, so nothing else objects, and the whole log would be scored under
  // out-of-state rules — no own-county multiplier, no activated-county bonus,
  // the wrong multiplier keys — with every Cabrillo line claiming an exchange
  // no Pennsylvania station may send. Caught only because the alert reads the
  // party's own GROUND; a plain state comparison has no `EPA` in it.
  const ownSection = run([qso({ refType: PA.refType, location: 'MGY' })], { params: PA, ourLocation: 'EPA' })
  assert.deepEqual(ownSection.scores[0].alerts, ['ourLocation'])
  assert.ok((ownSection.scores[0].value as number) > 0, 'the contact still counts for what it is worth')

  // Rule 10.d multiplies QSO POINTS, so the 200 K3ZMC pays stays 200. Folding
  // the power factor over the bonus as well would hand a QRP entrant 400.
  const qrp = run([qso({ refType: PA.refType, call: 'K3ZMC', location: 'MGY' })], { params: PA, ourLocation: 'ELK', power: 'QRP' })
  assert.equal(qrp.summary().total, 2 * 2 * 2 + 200)
  const low = run([qso({ refType: PA.refType, call: 'K3ZMC', location: 'MGY' })], { params: PA, ourLocation: 'ELK', power: 'LOW' })
  assert.equal(low.summary().total, 2 * 2 + 200)
})

test('the chase list leaves out multipliers the party itself puts out of reach', () => {
  // A Maryland station sends one of its counties and never `MD`, so `MD` is
  // an entry an operator could hunt forever. Only the party's OWN ground goes:
  // every other state is there to be chased, and so are the counties.
  const md = run([qso({ refType: MD.refType, location: 'ALLE' })], { params: MD, ourLocation: 'ANNE' })
    .summary().longSummary as string
  assert.doesNotMatch(md, /\bMD\b/)
  assert.match(md, /\bVA\b/)
  assert.match(md, /\bALLE\b/)

  // Nobody sends PA's `EPA` or `WPA` either, but working a county earns one
  // (`countySections`), so an in-state entrant chases them like any other.
  const pa = run([qso({ refType: PA.refType, location: 'MGY' })], { params: PA, ourLocation: 'ELK' })
    .summary().longSummary as string
  assert.match(pa, /\*\*~~EPA~~\*\*/)
  assert.match(pa, /\bWPA\b/)
  assert.doesNotMatch(pa, /~~WPA~~/)
  assert.match(pa, /\bEMA\b/)

  // But where the party's own ground IS a multiplier, it is exactly what the
  // list exists to show as still needed. NEQP scores an in-party contact by
  // STATE, so its six are the in-state multipliers — hiding them until they
  // are worked answers "what is done" when the question is "what is left".
  const neqp = run([qso({ refType: NEQP.refType, location: 'MAWOR' })], { params: NEQP, ourLocation: 'MABAR' })
    .summary().longSummary as string
  for (const code of ['CT', 'ME', 'NH', 'RI', 'VT']) assert.match(neqp, new RegExp(`\\b${code}\\b`), `NEQP hides ${code}`)
})

test('a code inside the party is refused as a copied exchange, and only as one', () => {
  // `EPA` is not something a Pennsylvania station can send — they send a county
  // — so taking it would claim a multiplier the sponsor's checker strikes and
  // write it into the submitted file.
  const sent = run([qso({ refType: PA.refType, call: 'K3ABC', location: 'EPA' })], { params: PA, ourLocation: 'ELK' })
  assert.equal(sent.scores[0].value, 0)
  assert.deepEqual(sent.scores[0].alerts, ['invalidExchange'])
  assert.deepEqual(sent.sheet.states, {})

  // A contact whose exchange was never copied is a different question, and
  // `defaultTheirLocation` has already answered it: refusing a contact that
  // plainly happened is the worse reading, so the state stands.
  const guessed = run([{
    their: { call: 'K3XYZ', entityPrefix: 'K', state: 'MD' },
    band: '20m',
    mode: 'CW',
    refs: [{ type: MD.refType, location: '' }],
  }], { params: MD, ourLocation: 'ANNE' })
  assert.ok((guessed.scores[0].value as number) > 0)
  assert.deepEqual(Object.keys(guessed.sheet.mults), ['MD'])
})

test('the chase list shows every code the scoresheet counted, reachable or not', () => {
  // The heading counts `sheet.states` while the list comes from the party's
  // table, so a code the sheet holds and the table hides prints "1 US States"
  // above a line with nothing struck in it. An in-party station's own state
  // reaches the sheet exactly that way, from an exchange never copied.
  const { sheet, summary } = run([qso({ refType: MD.refType, location: 'ALLE' })], { params: MD, ourLocation: 'ANNE' })
  sheet.states.MD = 1
  assert.match(summary().longSummary as string, /\*\*~~MD~~\*\*/)
})
