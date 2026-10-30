// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The fifty generated party modules, held to the fixtures they were generated
// from.
//
// The reference implementation below is a FROZEN, hand-made transcription of
// the normalizations the bundled version performs — three spellings of the
// power table over two class vocabularies, DIGI for DATA, two ANDed spellings
// of one county-multiplier rule, the slashed zero, unpadded and impossible
// dates, a URL with a space in it. It deliberately does NOT import
// `scripts/convert-parties.mjs`: sharing one implementation would make both
// sides of every comparison move together, and the comparison would then catch
// nothing — a normalization dropped from the generator would be dropped from
// the reference in the same edit, and all fifty parties would still pass.
//
// So: read a fixture twice, by two hands, and insist the answers agree.

import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"

import type { QsoPartyParams } from "@ham2k/lib-qso-party"

import { PARTIES } from "./index.ts"

// ------------------------------------------- the reference implementation

type RawParty = Record<string, unknown>

interface ReferenceParty {
  key: string
  name: string
  short: string
  url?: string
  cabrilloName?: string
  startMillis: number
  endMillis: number
  secondStartMillis?: number
  secondEndMillis?: number
  status?: string
  lastUpdated?: string
  counties: Record<string, string>
  otherCounties: Record<string, string>
  countyToState: Record<string, string>
  points: Record<string, number>
  bonusStations: Record<string, number>
  rareCountyMultipliers: Record<string, number>
  countySections: Record<string, string>
  powerMultipliers: Record<string, number>
  bonus: Record<string, number | boolean>
  options: Record<string, string | number | boolean | undefined>
  entryClasses: {
    operator: string[]
    power: string[]
    powerLimits: Record<string, string>
    station: string[]
    mode: string[]
    overlay: string[]
  }
  exchange: { number: boolean; name: boolean }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function bool(value: unknown): boolean {
  return value === true
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[ØÖ]/g, '0')
}

function mapOf(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [code, name] of Object.entries(value as Record<string, unknown>)) {
    const key = normalizeCode(code)
    out[key] = typeof name === 'string' && name ? name : key
  }
  return out
}

function numbersOf(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, number> = {}
  for (const [code, points] of Object.entries(value as Record<string, unknown>)) {
    const n = num(points)
    if (n !== undefined) out[normalizeCode(code)] = n
  }
  return out
}

function parsePartyTime(value: unknown): number {
  const text = str(value)
  if (!text) return 0
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*Z?$/i.exec(text)
  if (!match) return 0
  const [, year, month, day, hour, minute, second] = match
  const millis = Date.UTC(
    Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second ?? 0),
  )
  const at = new Date(millis)
  if (
    at.getUTCFullYear() !== Number(year)
    || at.getUTCMonth() !== Number(month) - 1
    || at.getUTCDate() !== Number(day)
  ) {
    return 0
  }
  return millis
}

function sanitizeUrl(value: unknown): string | undefined {
  const text = str(value)
  if (!text) return undefined
  const cleaned = text.replace(/\s+/g, '')
  return cleaned.startsWith('http') ? cleaned : undefined
}

function powerMultipliersOf(raw: RawParty): Record<string, number> {
  const table = numbersOf(raw.powerMultiplier ?? raw.powerMultipliers ?? raw.power)
  const out: Record<string, number> = {}
  const qrp = table.QRP
  const low = table.LOW ?? table.LP
  const high = table.HIGH ?? table.HP
  if (qrp !== undefined) out.QRP = qrp
  if (low !== undefined) out.LOW = low
  if (high !== undefined) out.HIGH = high
  return out
}

const POWER_CLASSES = ['QRP', 'LOW', 'HIGH']
const OPERATOR_CLASSES =
  ['SINGLE-OP', 'SINGLE-OP-ASSISTED', 'MULTI-ONE', 'MULTI-TWO', 'MULTI-UNLIMITED']
const STATION_CLASSES =
  ['FIXED', 'MOBILE', 'PORTABLE', 'ROVER', 'EXPEDITION', 'COUNTY-LINE', 'SCHOOL', 'CLUB', 'EOC']
const MODE_CLASSES = ['CW', 'PHONE', 'DIGITAL', 'MIXED']
const OVERLAY_CLASSES =
  ['ROOKIE', 'YOUTH', 'YL', 'NOVICE-TECH', 'NEW-CONTESTER', 'TB-WIRES', 'POTA']

function entryClassesOf(raw: RawParty): ReferenceParty['entryClasses'] {
  const block = (raw.entryClasses && typeof raw.entryClasses === 'object'
    ? raw.entryClasses
    : {}) as Record<string, unknown>

  const listOf = (value: unknown, known: string[]): string[] => {
    if (!Array.isArray(value)) return []
    const wanted = new Set(
      value.filter((v): v is string => typeof v === 'string').map((v) => v.toUpperCase()),
    )
    return known.filter((code) => wanted.has(code))
  }

  const limits: Record<string, string> = {}
  const rawLimits = (block.powerLimits && typeof block.powerLimits === 'object'
    ? block.powerLimits
    : {}) as Record<string, unknown>
  for (const power of POWER_CLASSES) {
    const limit = str(rawLimits[power])
    if (limit) limits[power] = limit
  }

  return {
    operator: listOf(block.operator, OPERATOR_CLASSES),
    power: listOf(block.power, POWER_CLASSES),
    powerLimits: limits,
    station: listOf(block.station, STATION_CLASSES),
    mode: listOf(block.mode, MODE_CLASSES),
    overlay: listOf(block.overlay, OVERLAY_CLASSES),
  }
}

function optionsOf(raw: RawParty): ReferenceParty['options'] {
  const o = (raw.options && typeof raw.options === 'object' ? raw.options : {}) as Record<string, unknown>
  return {
    entity: str(o.entity)?.toUpperCase() === 'VE' ? 'VE' : 'K',
    countyLine: bool(o.countyLine),
    dcCountsAsMaryland: bool(o.dcCountsAsMaryland),
    stateCountsForInState: bool(o.stateCountsForInState),
    countiesCountForInState: o.countiesCountForInState !== false,
    countiesAreMultForInState: o.countiesAreMultForInState !== false,
    alaskaAndHawaiiAreDX: bool(o.alaskaAndHawaiiAreDX),
    selfCountsForCounty: bool(o.selfCountsForCounty),
    selfMobileCountsForCounty: bool(o.selfMobileCountsForCounty),
    dxIsMultiplier: bool(o.dxIsMultiplier),
    dxEntityIsMultiplier: bool(o.dxEntityIsMultiplier),
    dxEntityMultiplierMax: num(o.dxEntityMultiplierMax),
    dxLocationIsPrefix: bool(o.dxLocationIsPrefix),
    multsPerBandMode: bool(o.multsPerBandMode),
    multsPerBand: bool(o.multsPerBand),
    multsPerMode: bool(o.multsPerMode),
    inStateMultsPerBand: bool(o.inStateMultsPerBand),
    outOfStateMultsPerBand: bool(o.outOfStateMultsPerBand),
    bonusPerBandMode: bool(o.bonusPerBandMode),
    bonusPerMode: bool(o.bonusPerMode),
    bonusPostMultiplier: bool(o.bonusPostMultiplier),
    bonusStationInStateMult: num(o.bonusStationInStateMult),
    bonusStationOutOfStateMult: num(o.bonusStationOutOfStateMult),
    inStateToOutOfStatePointsDouble: bool(o.inStateToOutOfStatePointsDouble),
    dataAndCWCountAsSameMode: bool(o.dataAndCWCountAsSameMode),
    pointsWhenTheyAreOutOfParty: num(o.pointsWhenTheyAreOutOfParty),
    removeCountySuffixes: bool(o.removeCountySuffixes),
    labelForCounties: str(o.labelForCounties) ?? 'Counties',
    // Allowed unless the file says `false`: most write `true`, and several
    // write nothing at all.
    selfSpotting: o.selfSpotting !== false,
  }
}

function bonusOf(raw: RawParty): ReferenceParty['bonus'] {
  const b = (raw.bonus && typeof raw.bonus === 'object' ? raw.bonus : {}) as Record<string, unknown>
  return {
    perActivatedCounty: num(b.perActivatedCounty) ?? 0,
    perActivatedCountyMinimumCount: num(b.perActivatedCountyMinimumCount) ?? 1,
    perActivatedCountyRoverOnly: bool(b.perActivatedCountyRoverOnly),
    rareCountySweep: num(b.rareCountySweep) ?? 0,
    rareCountySweepMinimumCount: num(b.rareCountySweepMinimumCount) ?? 0,
    bonusStationSweep: num(b.bonusStationSweep) ?? 0,
    bonusStationSweepMinimumCount: num(b.bonusStationSweepMinimumCount) ?? 0,
  }
}

function normalizeParty(raw: RawParty): ReferenceParty {
  const key = (str(raw.key) ?? '').toUpperCase()
  return {
    key,
    name: str(raw.name) ?? key,
    short: str(raw.short) ?? (key.endsWith('QP') ? key : `${key}QP`),
    url: sanitizeUrl(raw.url),
    cabrilloName: str(raw.cabrilloName),
    startMillis: parsePartyTime(raw.start),
    endMillis: parsePartyTime(raw.end),
    secondStartMillis: parsePartyTime(raw.secondStart) || undefined,
    secondEndMillis: parsePartyTime(raw.secondEnd) || undefined,
    status: str(raw.status),
    lastUpdated: str(raw.lastUpdated),
    counties: mapOf(raw.counties),
    otherCounties: mapOf(raw.otherQPCounties),
    countyToState: Object.fromEntries(
      Object.entries(mapOf(raw.countyToState)).map(([county, state]) => [county, state.toUpperCase()]),
    ),
    points: numbersOf(raw.points),
    bonusStations: numbersOf(raw.bonusStations),
    rareCountyMultipliers: numbersOf(raw.rareCountyQSOMultiplier),
    // Written section → counties, read county → section.
    countySections: Object.fromEntries(
      Object.entries((raw.countySections ?? {}) as Record<string, string[]>)
        .flatMap(([section, counties]) => counties.map((county) => [normalizeCode(county), normalizeCode(section)])),
    ),
    powerMultipliers: powerMultipliersOf(raw),
    bonus: bonusOf(raw),
    options: optionsOf(raw),
    entryClasses: entryClassesOf(raw),
    exchange: {
      number: (Array.isArray(raw.exchange) ? raw.exchange : []).includes('Number'),
      name: (Array.isArray(raw.exchange) ? raw.exchange : [])
        .some((field: unknown) => typeof field === 'string' && field.startsWith('Name')),
    },
  }
}

/// Points for a contact in [superMode], the bundled version's rule: `DIGI` is
/// `DATA` under another name, and an unlisted mode is worth one point rather
/// than none.
function pointsForMode(party: ReferenceParty, superMode: string): number {
  if (superMode === 'DATA') return party.points.DATA ?? party.points.DIGI ?? 1
  return party.points[superMode] ?? 1
}

/// The state a county belongs to: a multi-state party's own table, else the
/// first two characters of an abbreviation longer than four, else the party's
/// own key — which is the value the generated `state` field stands in for.
function referenceStateForCounty(party: ReferenceParty, county: string): string {
  const code = county.toUpperCase()
  return party.countyToState[code] ?? (code.length > 4 ? code.slice(0, 2) : party.key)
}

// --------------------------------------------- the generated side, resolved
//
// Every default the params contract documents, applied — so the comparison
// tests the DEFAULTS as well as the values, and an option the generator forgets
// to emit shows up as its default rather than as `undefined` on both sides.

function resolvedOptions(params: QsoPartyParams): ReferenceParty['options'] {
  return {
    entity: params.entity ?? 'K',
    countyLine: params.countyLine ?? false,
    dcCountsAsMaryland: params.dcCountsAsMaryland ?? false,
    stateCountsForInState: params.stateCountsForInState ?? false,
    countiesAreMultipliersInParty: params.countiesAreMultipliersInParty ?? true,
    alaskaAndHawaiiAreDX: params.alaskaAndHawaiiAreDX ?? false,
    selfCountsForCounty: params.selfCountsForCounty ?? false,
    selfMobileCountsForCounty: params.selfMobileCountsForCounty ?? false,
    dxIsMultiplier: params.dxIsMultiplier ?? false,
    dxEntityIsMultiplier: params.dxEntityIsMultiplier ?? false,
    dxEntityMultiplierMax: params.dxEntityMultiplierMax,
    dxLocationIsPrefix: params.dxLocationIsPrefix ?? false,
    multsPerBandMode: params.multsPerBandMode ?? false,
    multsPerBand: params.multsPerBand ?? false,
    multsPerMode: params.multsPerMode ?? false,
    inStateMultsPerBand: params.inStateMultsPerBand ?? false,
    outOfStateMultsPerBand: params.outOfStateMultsPerBand ?? false,
    bonusPerBandMode: params.bonusPerBandMode ?? false,
    bonusPerMode: params.bonusPerMode ?? false,
    bonusPostMultiplier: params.bonusPostMultiplier ?? false,
    bonusStationInStateMult: params.bonusStationInStateMult,
    bonusStationOutOfStateMult: params.bonusStationOutOfStateMult,
    inStateToOutOfStatePointsDouble: params.inStateToOutOfStatePointsDouble ?? false,
    dataAndCWCountAsSameMode: params.dataAndCWCountAsSameMode ?? false,
    pointsWhenTheyAreOutOfParty: params.pointsWhenTheyAreOutOfParty,
    removeCountySuffixes: params.removeCountySuffixes ?? false,
    labelForCounties: params.labelForCounties ?? 'Counties',
    selfSpotting: params.selfSpotting ?? true,
  }
}

function resolvedBonus(params: QsoPartyParams): ReferenceParty['bonus'] {
  const bonus = params.bonus ?? {}
  return {
    perActivatedCounty: bonus.perActivatedCounty ?? 0,
    perActivatedCountyMinimumCount: bonus.perActivatedCountyMinimumCount ?? 1,
    perActivatedCountyRoverOnly: bonus.perActivatedCountyRoverOnly ?? false,
    rareCountySweep: bonus.rareCountySweep ?? 0,
    rareCountySweepMinimumCount: bonus.rareCountySweepMinimumCount ?? 0,
    bonusStationSweep: bonus.bonusStationSweep ?? 0,
    bonusStationSweepMinimumCount: bonus.bonusStationSweepMinimumCount ?? 0,
  }
}

function resolvedEntryClasses(params: QsoPartyParams): ReferenceParty['entryClasses'] {
  const classes = params.entryClasses ?? {}
  return {
    operator: classes.operator ?? [],
    power: classes.power ?? [],
    powerLimits: classes.powerLimits ?? {},
    station: classes.station ?? [],
    mode: classes.mode ?? [],
    overlay: classes.overlay ?? [],
  }
}

/// The state a county belongs to, by the rule the params contract documents:
/// the party's own callback, else the first two characters of a long
/// abbreviation, else `state` — which a multi-state party does not have, so a
/// short code it forgets to table comes back with no state at all.
function stateOfCounty(params: QsoPartyParams, county: string): string | undefined {
  const code = county.toUpperCase()
  return params.stateOfCounty?.(code) ?? (code.length > 4 ? code.slice(0, 2) : params.state)
}

/// A party's periods as the bundled version's four date fields.
function referencePeriods(party: ReferenceParty): Array<{ startMillis: number; endMillis: number }> {
  const periods = [{ startMillis: party.startMillis, endMillis: party.endMillis }]
  if (party.secondStartMillis && party.secondEndMillis) {
    periods.push({ startMillis: party.secondStartMillis, endMillis: party.secondEndMillis })
  }
  return periods
}

// ------------------------------------------------------------------ fixtures

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures')

const REFERENCE: Record<string, ReferenceParty> = Object.fromEntries(
  readdirSync(FIXTURES_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const raw = JSON.parse(readFileSync(join(FIXTURES_DIR, file), 'utf8')) as RawParty
      const party = normalizeParty(raw)
      return [party.key, party]
    }),
)

function party(key: string): QsoPartyParams {
  const found = PARTIES[key]
  assert.ok(found, `no generated party ${key}`)
  return found
}

// --------------------------------------------------------------------- tests

test('every party file has a generated module, and every module a file', () => {
  // The two sets are joined on the bundled version's party code, which is also
  // the fixture's filename: a party added to `fixtures/` and never converted,
  // or a module left behind by a party the sponsor retired, is invisible until
  // someone tries to score with it.
  assert.deepEqual(Object.keys(PARTIES).sort(), Object.keys(REFERENCE).sort())
  assert.equal(Object.keys(PARTIES).length, 50)
})

for (const key of Object.keys(REFERENCE).sort()) {
  const reference = REFERENCE[key]!

  test(`${key} carries exactly what its party file says`, () => {
    const params = party(key)

    assert.equal(params.name, reference.name, 'name')
    assert.equal(params.short, reference.short, 'short')
    assert.equal(params.cabrilloName, reference.cabrilloName, 'cabrilloName')
    assert.equal(params.url, reference.url, 'url')
    assert.equal(params.status, reference.status, 'status')
    assert.equal(params.lastUpdated, reference.lastUpdated, 'lastUpdated')

    // `state` and `stateOfCounty` together have to answer what one function of
    // the party KEY answered before — the key is gone, and a county that comes
    // back with the wrong state silently scores under out-of-party rules.
    //
    // A multi-state party has no `state`, so its short codes have nothing to
    // fall back on: if one of those ever stopped being tabled, this compares
    // `undefined` against the reference's party key and says so here rather
    // than leaving a county with no state at all.
    for (const county of Object.keys(reference.counties)) {
      assert.equal(
        stateOfCounty(params, county),
        referenceStateForCounty(reference, county),
        `${county}'s state`,
      )
    }

    assert.deepEqual(params.periods, referencePeriods(reference), 'periods')

    // One rule under two names, which the bundled version reads ANDed: NEQP
    // writes one of them and ACQP, CPQP and DEQP the other, and honouring only
    // the spelling you happen to read gives four parties county multipliers
    // their sponsors do not award.
    const { countiesCountForInState, countiesAreMultForInState, ...otherOptions } = reference.options
    assert.deepEqual(
      resolvedOptions(params),
      {
        ...otherOptions,
        countiesAreMultipliersInParty:
          countiesCountForInState === true && countiesAreMultForInState === true,
      },
      'options',
    )
    assert.deepEqual(resolvedBonus(params), reference.bonus, 'bonus')

    assert.deepEqual(params.counties, reference.counties, 'counties')
    // The table's ORDER is the order the summary prints it in — the sponsor's
    // own, alphabetical by name, which a rebuilt object would quietly lose.
    assert.deepEqual(Object.keys(params.counties), Object.keys(reference.counties), 'county order')
    assert.deepEqual(params.otherCounties ?? {}, reference.otherCounties, 'otherCounties')
    assert.deepEqual(params.bonusStations ?? {}, reference.bonusStations, 'bonusStations')
    assert.deepEqual(
      params.rareCountyMultipliers ?? {}, reference.rareCountyMultipliers, 'rareCountyMultipliers',
    )
    assert.deepEqual(params.countySections ?? {}, reference.countySections, 'countySections')
    assert.deepEqual(params.powerMultipliers ?? {}, reference.powerMultipliers, 'powerMultipliers')
    assert.deepEqual(resolvedEntryClasses(params), reference.entryClasses, 'entryClasses')
    assert.deepEqual(
      { number: params.exchange?.number ?? false, name: params.exchange?.name ?? false },
      reference.exchange,
      'exchange',
    )

    // What a contact is actually worth, not what the table happens to spell:
    // six files write `DIGI` where a QSO's super-mode is `DATA`, and a table
    // copied across verbatim pays those six the fallback point instead.
    for (const superMode of ['CW', 'PHONE', 'DATA']) {
      assert.equal(
        params.pointsByMode?.[superMode] ?? 1,
        pointsForMode(reference, superMode),
        `${superMode} points`,
      )
    }
    // And every other rate the file publishes is still carried, so a rule that
    // learns to read one has it.
    const expectedPoints = { ...reference.points }
    if (expectedPoints.DIGI !== undefined) {
      expectedPoints.DATA ??= expectedPoints.DIGI
      delete expectedPoints.DIGI
    }
    assert.deepEqual(params.pointsByMode ?? {}, expectedPoints, 'pointsByMode')
  })
}

test('every party has dates that parse, in the order the sponsor runs them', () => {
  // A period the parser refused is dropped, so a file whose dates stopped
  // parsing arrives here as a party with no dates rather than as a plausible
  // wrong one in front of an operator.
  for (const [key, params] of Object.entries(PARTIES)) {
    assert.ok(params.periods.length > 0, `${key} has no operating period`)
    for (const period of params.periods) {
      assert.ok(period.startMillis > 0 && period.endMillis > 0, `${key} has a period with no date`)
      assert.ok(period.endMillis > period.startMillis, `${key} has a period that ends before it starts`)
    }
    for (let i = 1; i < params.periods.length; i++) {
      assert.ok(
        params.periods[i]!.startMillis >= params.periods[i - 1]!.endMillis,
        `${key}'s periods overlap`,
      )
    }
  }
})

test('every party is findable by its name, and its ref type is its Cabrillo name', () => {
  // An extension is reached by searching for what an operator calls the party,
  // so names have to be distinct for that to land on one extension. The ref
  // type — the identity a logged ref carries — is the sponsor's own Cabrillo
  // contest name lower-cased, which is the identifier the submitted log already
  // names in its `CONTEST:` line rather than one this project invented.
  //
  // Distinctness is the load-bearing half: two parties owning one ref type
  // would have each answering for the other's logged references.
  const byName = new Map<string, string>()
  const byRefType = new Map<string, string>()
  for (const [key, params] of Object.entries(PARTIES)) {
    assert.ok(params.name.length > 0, `${key} has no name`)
    assert.ok(params.short.length > 0, `${key} has no short name`)
    assert.equal(byName.get(params.name.toLowerCase()), undefined, `two parties named ${params.name}`)
    byName.set(params.name.toLowerCase(), key)
    assert.equal(byRefType.get(params.refType), undefined, `two parties own ${params.refType}`)
    byRefType.set(params.refType, key)
    // A party the sponsors never registered a Cabrillo name for falls back to
    // its short name, which is what the export already writes for it.
    const source = params.cabrilloName ?? params.short
    assert.equal(
      params.refType,
      source.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
      `${key}'s ref type is not its Cabrillo name`,
    )
  }
  assert.equal(byName.get('texas qso party'), 'TX')
  // Ohio's sponsor calls it MRRC-OHQP, which no slug of "Ohio QSO Party"
  // would ever produce — the case the derivation exists for.
  assert.equal(byRefType.get('mrrc-ohqp'), 'OH')
  assert.equal(byRefType.get('wa-salmon-run'), 'WA')
  // Nevada is on no Cabrillo list, so it is the fallback's own case.
  assert.equal(byRefType.get('nvqp'), 'NV')
})

test('a short name finds a party, but two parties publish NEQP', () => {
  // Nebraska and New England both call themselves NEQP. The bundled version
  // told them apart by their party code; nothing here may key on `short`, and
  // an extension that shows one has to show its full name beside it.
  const byShort = new Map<string, string[]>()
  for (const [key, params] of Object.entries(PARTIES)) {
    byShort.set(params.short, [...(byShort.get(params.short) ?? []), key])
  }
  assert.deepEqual(byShort.get('NEQP')?.sort(), ['NE', 'NEQP'])
  assert.deepEqual(byShort.get('NYQP'), ['NY'])
  assert.deepEqual(byShort.get('Salmon Run'), undefined, 'the Salmon Run publishes WAQP as its short name')
  assert.deepEqual(byShort.get('WAQP'), ['WA'])
  const collisions = [...byShort.values()].filter((keys) => keys.length > 1)
  assert.equal(collisions.length, 1, `short names collide beyond NEQP: ${JSON.stringify(collisions)}`)
})

test('no party′s claim on the old combined extension′s logs reaches another party′s', () => {
  // A party's engine matches its old `qp` claim as a prefix and never sees the
  // others', so nothing lets the longer claim win there. A claim that prefixes
  // another answers for that party's logs too — Nebraska's `ne` took every New
  // England `NEQP` log, which is why Nebraska makes none.
  const claims = Object.entries(PARTIES).flatMap(([key, params]) =>
    (params.legacyRefs ?? []).map((claim) => ({ key, code: `${claim.type}/${claim.prefix}` })))
  for (const a of claims) {
    for (const b of claims) {
      if (a !== b) assert.ok(!b.code.startsWith(a.code), `${a.key}'s ${a.code} also claims ${b.key}'s ${b.code}`)
    }
  }
  assert.equal(PARTIES.NE.legacyRefs, undefined)
})

// The named traps below are literal, not derived: the reference implementation
// above is a transcription of the same rules the generator implements, so a
// misreading shared by both would pass every comparison in this file. These
// state what the sponsor's own file means, in values.

test('a slashed zero is a zero, so Missouri\'s bonus stations can be worked', () => {
  // `mo.json` writes `WØMA` and `KØGQ` with U+00D8, the slashed zero hams write
  // by hand. A logged callsign carries a digit, so an unnormalized key can
  // never match and neither 100-point bonus can be claimed at all.
  assert.equal(party('MO').bonusStations?.W0MA, 100)
  assert.equal(party('MO').bonusStations?.K0GQ, 100)
})

test('a URL with a space in it is repaired, not passed through', () => {
  // qc.json carries `https: //quebecqsoparty.org/`, which reaches the
  // information panel as a link that cannot open.
  assert.equal(party('QC').url, 'https://quebecqsoparty.org/')
})

test('all three spellings of the power table, on both class vocabularies', () => {
  // `powerMultiplier` with LP/HP (DE), `powerMultipliers` with LOW/HIGH (KY),
  // and `power` (FL). Reading them apart leaves DE's low-power entrant
  // multiplying by 1 while KY's multiplies by 2, for no reason an operator
  // could see.
  assert.deepEqual(party('DE').powerMultipliers, { QRP: 3, LOW: 2, HIGH: 1 })
  assert.deepEqual(party('KY').powerMultipliers, { QRP: 3, LOW: 2, HIGH: 1 })
  assert.deepEqual(party('FL').powerMultipliers, { QRP: 3, LOW: 2, HIGH: 1 })
  assert.equal(party('NY').powerMultipliers, undefined)
})

test('DIGI is DATA: the mode a file writes is not the mode a QSO carries', () => {
  // 7QP publishes `DIGI: 4` and a digital QSO's super-mode is `DATA`.
  assert.equal(party('7QP').pointsByMode?.DATA, 4)
  assert.equal(party('7QP').pointsByMode?.DIGI, undefined)
  // A rate no super-mode names is still carried: Idaho's `_QRP_` is a rule
  // nothing implements yet and the file is the record of it.
  assert.equal(party('ID').pointsByMode?._QRP_, 5)
})

test('the option that defaults TRUE is stated only when a party says no', () => {
  // Counties being multipliers is the ordinary case; 45 parties say nothing at
  // all, and reading their silence as false takes every county multiplier away
  // from them. The four that mean no wrote it as either of two keys, ANDed.
  assert.equal(party('NY').countiesAreMultipliersInParty, undefined)
  assert.equal(party('NEQP').countiesAreMultipliersInParty, false)
  assert.equal(party('ACQP').countiesAreMultipliersInParty, false)
  assert.equal(party('CPQP').countiesAreMultipliersInParty, false)
  assert.equal(party('DE').countiesAreMultipliersInParty, false)
})

test('an option written as an explicit null means no', () => {
  // bc.json writes `bonusPerBandMode: null`, which a `?? false` at the call
  // site leaves as null and a truthiness test gets right only by luck.
  assert.equal(party('BC').bonusPerBandMode, undefined)
})

test('a zero-valued option is kept, because zero is what it says', () => {
  // Idaho scales its bonus stations by 0 for in-state entrants — its way of
  // saying they pay out-of-state entrants only. Dropped as falsy, they pay
  // everyone.
  assert.equal(party('ID').bonusStationInStateMult, 0)
})

test('a county knows its state, three different ways', () => {
  // A multi-state party carries a table, and CPQP's three-letter districts are
  // what needs one: nothing in `BRA` says Manitoba, and no rule could guess it.
  assert.equal(stateOfCounty(party('CPQP'), 'BRA'), 'MB')
  // The table answers a code however it is cased, because it is keyed the way
  // the county list is and a caller need not know that.
  assert.equal(party('CPQP').stateOfCounty?.('bra'), 'MB')
  // …a long abbreviation carries its state in its first two characters…
  assert.equal(stateOfCounty(party('7QP'), 'ORDES'), 'OR')
  // …and a short one belongs to the party's own state, which is the field that
  // replaced the bundled version's party key.
  assert.equal(stateOfCounty(party('NY'), 'ALB'), 'NY')
  assert.equal(party('NY').state, 'NY')
})

test('a party says where its counties are exactly one way', () => {
  // Neither is a party whose short county codes have no state at all. Both is
  // two answers that can disagree — and `state` is the one a score reads, so
  // the list would be the half nobody notices going stale.
  for (const key of Object.keys(PARTIES)) {
    const params = party(key)
    assert.equal(
      Boolean(params.state) !== Boolean(params.states),
      true,
      `${key} declares ${params.state ? 'a state and' : 'neither a state nor'} a state list`,
    )
  }
})

test('every county of a multi-state party is in a state that party spans', () => {
  // The list is derived from the county data, so it can only disagree with the
  // data if the DATA changed: a county code mistyped in a re-sync (`OSDES` for
  // `ORDES`) lands in a state the party does not span, and a list carried over
  // from another party's file keeps a state no county of this one is in. Both
  // directions, because each catches only its own.
  const multiState = Object.keys(PARTIES).filter((key) => party(key).states).sort()
  assert.deepEqual(multiState, ['7QP', 'ACQP', 'CPQP', 'NEQP'])

  for (const key of multiState) {
    const params = party(key)
    const declared = new Set(params.states)
    const derived = new Set<string>()
    for (const county of Object.keys(params.counties)) {
      const state = stateOfCounty(params, county)
      assert.ok(state, `${key}: ${county} names no state, and ${key} has none to fall back on`)
      assert.ok(declared.has(state), `${key}: ${county} is in ${state}, which ${key} does not span`)
      derived.add(state)
    }
    assert.deepEqual([...derived].sort(), [...declared].sort(), `${key} spans what its counties say`)
  }
})

test('the states each multi-state party spans', () => {
  // Spelled out, because the derivation above proves the list agrees with the
  // counties and NOT that either is right. These four are the sponsors' own:
  // the 7th call area's eight states, New England's six, Atlantic Canada's four
  // provinces and the three prairie ones. A re-sync that adds or drops a state
  // is a change to what the party IS, and lands here to be read.
  assert.deepEqual(party('7QP').states, ['AZ', 'ID', 'MT', 'NV', 'OR', 'UT', 'WA', 'WY'])
  assert.deepEqual(party('NEQP').states, ['CT', 'MA', 'ME', 'NH', 'RI', 'VT'])
  assert.deepEqual(party('ACQP').states, ['NB', 'NL', 'NS', 'PE'])
  assert.deepEqual(party('CPQP').states, ['AB', 'MB', 'SK'])
})

test('a date the calendar does not have is refused, not rolled forward', () => {
  // `sc.json` used to end on 2025-2-29, which 2025 does not have and `Date.UTC`
  // turns into 1 March — a period the sponsor never published. The dates below
  // are the sponsor's own, re-read in September 2026.
  assert.deepEqual(party('SC').periods, [
    { startMillis: Date.UTC(2026, 1, 28, 15, 0), endMillis: Date.UTC(2026, 2, 1, 1, 59) },
  ])
})

test('a party that runs two sessions publishes two periods', () => {
  // 14 files run a Saturday and a Sunday session with a break between. One
  // range spanning both claims the overnight hours the sponsor does not score.
  assert.deepEqual(party('FL').periods, [
    { startMillis: Date.UTC(2026, 3, 25, 16, 0), endMillis: Date.UTC(2026, 3, 26, 1, 59) },
    { startMillis: Date.UTC(2026, 3, 26, 12, 0), endMillis: Date.UTC(2026, 3, 26, 21, 59) },
  ])
  assert.equal(party('NY').periods.length, 1)
})

test('a party names its subdivisions whatever the sponsor calls them', () => {
  assert.equal(party('CPQP').labelForCounties, 'Districts')
  assert.equal(party('NY').labelForCounties, undefined)
})

test('the exchange is a location unless the file says otherwise', () => {
  assert.equal(party('NY').exchange, undefined)
  assert.deepEqual(party('CA').exchange, { number: true })
  assert.deepEqual(party('MN').exchange, { name: true })
})

test('a party carries its own county list, whatever another party calls the same county', () => {
  // Nothing is shared between parties: 316 county names carry more than one
  // code across the fifty, so a table lifted from a neighbour scores an
  // exchange the sponsor would reject.
  assert.equal(Object.keys(party('TX').counties).length, 254)
  assert.equal(party('TX').counties.ANDE, 'Anderson')
  // 7QP works its neighbours' counties as well, and they are NOT its own: they
  // are never in-party and never part of its county sweep.
  assert.equal(Object.keys(party('7QP').counties).length, 259)
  assert.equal(Object.keys(party('7QP').otherCounties ?? {}).length, 160)
  // And its own counties name their state, because seven states' counties sit
  // in one list and two of them have a Lincoln.
  assert.equal(party('7QP').counties.ORDES, 'Deschutes OR')
})

test("a party's county-to-section table places every one of its counties", () => {
  // Each county earns its section (PA's EPA/WPA, rule 12.d) and nothing else
  // says so: a county left out costs an in-state entrant a multiplier with no
  // symptom at all. The generator refuses a county listed twice or one the
  // party does not have; a county missing from every list is only caught here.
  for (const [key, params] of Object.entries(PARTIES)) {
    const sections = params.countySections ?? {}
    if (Object.keys(sections).length === 0) continue
    for (const county of Object.keys(params.counties)) assert.ok(sections[county], `${key} places ${county} in no section`)
  }
  assert.deepEqual(new Set(Object.values(party('PA').countySections ?? {})), new Set(['EPA', 'WPA']))
})
