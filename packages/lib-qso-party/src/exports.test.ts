// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The files a log leaves as, and the hooks an extension registers.
//
// These are the only modules that reach for the SDK's RUNTIME — `contestScorer`,
// `adifForExport`, the export filenames — and the SDK's published bundle imports
// its own modules without a file extension, which node's ESM resolver refuses.
// So the SDK is stubbed here through node's module hooks, and everything under
// test is imported dynamically afterwards: a static import would be evaluated
// before the hook is registered, and the file would fail to load rather than
// fail an assertion.
//
// What is stubbed is only the seam. The Cabrillo below is the real writer's
// output, and the fields are the ones a checker reads.

import { test } from "node:test"
import assert from "node:assert/strict"
import { registerHooks } from "node:module"

import type { ExportRequest, HookContext } from "@ham2k/extension-sdk"

import type { QsoPartyParams } from "./params.ts"

// The real SDK, with the host boundary swapped: `hooks.invokeOne` is what
// reaches the core's ADIF generator, and here it echoes what it was handed
// back as the file — the per-QSO resolution is the generator's job and is
// tested with it. Everything else, `adifForExport` included, is the SDK's own,
// so a delegating export that dropped `segments` would fail HERE and not only
// on the host. The file NAME is fixed too: the SDK's reads the operation's
// date, and the clock when it has none, and neither is what these tests are
// about. A local name shadows the same name from `export *`.
const SDK_STUB = `
export * from "sdk:real"
export function exportFilename({ activity, extension }) { return activity + '.' + extension }
export function startMillisOf() { return 0 }
export const hooks = {
  async invokeOne(hook, key, method, { operation, segments, mainHandler, includePrivateData, includeLookupData, exportSettings, exportData, exportTitle }) {
    return [{ ok: true, key, value: { content: JSON.stringify({ mainHandler, refs: operation.refs, segments, includePrivateData, includeLookupData, exportSettings, exportData, exportTitle }) } }]
  },
}
`

registerHooks({
  resolve(specifier, context, next) {
    // Resolved from this file, not from the stub: `stub:sdk` is no place to
    // look a bare specifier up from.
    if (specifier === 'sdk:real') return next('@ham2k/extension-sdk', { ...context, parentURL: import.meta.url })
    if (specifier === '@ham2k/extension-sdk') return { url: 'stub:sdk', shortCircuit: true }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url === 'stub:sdk') return { format: 'module', source: SDK_STUB, shortCircuit: true }
    return next(url, context)
  },
})

const { defineQsoParty } = await import("./index.ts")
const { RESOLVED_MARKER } = await import("./exchange.ts")
const { adifCountyOf } = await import("./exports.ts")
const { resolveParty } = await import("./party.ts")
const { ACQP, CA, NEQP, NY, WI } = await import("./testFixtures.ts")

const ctx = {} as never

/// The key an extension registers its hooks under. Deliberately not any
/// party's refType: the kernel refuses a hook key other than the extension's
/// own, so in a real extension the two never coincide, and a test that let
/// them would pass an export that names the wrong one.
const KEY = 'ham2k-party'
const define = (params: QsoPartyParams) => defineQsoParty({ ...params, extensionKey: KEY })

const operation = (params = NY, location = 'ALB') => ({
  uuid: 'op',
  stationCall: 'N0DEV',
  refs: [{ type: params.refType, location }],
})

const contact = (location: string, params = NY, extra: Record<string, unknown> = {}) => ({
  uuid: 'q1',
  their: { call: 'K1ABC', entityPrefix: 'K' },
  band: '20m',
  mode: 'CW',
  startAtMillis: Date.UTC(2026, 9, 17, 14, 30),
  refs: [{ type: params.refType, location }],
  ...extra,
})

test('one party registers one of each hook, scoped to its own ref type', () => {
  const hooks = define(NY)
  assert.deepEqual(Object.keys(hooks).sort(), [
    'activity', 'adifFields', 'export', 'refHandler', 'refType', 'scoring',
  ])
  assert.equal(hooks.refType, NY.refType)
  // Scoped, so this scorer is asked about its own party's operations and no
  // others.
  assert.deepEqual((hooks.scoring as { scope?: unknown }).scope, { refTypes: [NY.refType] })
})

test('a Cabrillo is offered only by a party that names the contest', async () => {
  const withName = await define(NY).export.suggestExportOptions!(
    { operation: operation(), qsos: [] },
    ctx,
  )
  assert.deepEqual(withName.map((option) => option.exportType), [`${NY.refType}-adif`, `${NY.refType}-cabrillo`])
  assert.deepEqual(withName.map((option) => option.filename), ['NYQP.adi', 'NYQP.log'])

  // Without a `CONTEST:` line there is nothing to tell a checker which contest
  // the file is for, and inventing one produces a file that looks submittable
  // and is not.
  const unnamed = await define(WI).export.suggestExportOptions!(
    { operation: operation(WI, 'ADAM'), qsos: [] },
    ctx,
  )
  assert.deepEqual(unnamed.map((option) => option.exportType), [`${WI.refType}-adif`])

  // And nothing at all is offered for an operation that is not running this
  // party.
  assert.deepEqual(
    await define(NY).export.suggestExportOptions!({ operation: { uuid: 'op', refs: [] }, qsos: [] }, ctx),
    [],
  )
})

test('the export sheet names the two files in the party′s own words', async () => {
  // The labels an operator picks between are the ENGINE's words, not the
  // sponsor's, so they take the same translator seam the setup form does. The
  // short name is part of the label rather than appended to it, because where a
  // name belongs in a sentence is the translator's business and not this
  // module's.
  const es = { locale: 'es' } as never
  const translated = {
    ...NY,
    labels: {
      adifExport: (hookCtx: HookContext) => (hookCtx.locale === 'es' ? 'ADIF del NYQP' : 'ADIF for NYQP'),
      cabrilloExport: (hookCtx: HookContext) => (
        hookCtx.locale === 'es' ? 'Cabrillo del NYQP' : 'Cabrillo for NYQP'
      ),
    },
  }
  const spanish = await define(translated).export.suggestExportOptions!(
    { operation: operation(translated), qsos: [] },
    es,
  )
  assert.deepEqual(spanish.map((option) => option.label), ['ADIF del NYQP', 'Cabrillo del NYQP'])

  // A party that names neither reads as English in any locale: the seam costs
  // an event nothing until it uses it.
  const plain = await define(NY).export.suggestExportOptions!(
    { operation: operation(), qsos: [] },
    es,
  )
  assert.deepEqual(plain.map((option) => option.label), ['ADIF for NYQP', 'Cabrillo for NYQP'])
})

test('the Cabrillo is the sponsor′s file, headers and all', async () => {
  const result = await define(CA).export.generateExport({
    exportType: `${CA.refType}-cabrillo`,
    operation: {
      ...operation(CA, 'ALAM'),
      refs: [{ type: CA.refType, location: 'ALAM', operator: 'SINGLE-OP', power: 'LOW' }],
    },
    qsos: [contact('BUTT', CA, {
      refs: [{ type: CA.refType, location: 'BUTT', ourSerial: 1, theirSerial: '7' }],
    })],
  }, ctx)

  assert.equal(result.filename, 'CQP.log')
  const lines = result.content.split('\n')
  assert.ok(lines.includes('CONTEST: CA-QSO-PARTY'))
  assert.ok(lines.includes('CATEGORY-OPERATOR: SINGLE-OP'))
  assert.match(lines.find((line) => line.startsWith('QSO:'))!, /N0DEV\s+1\s+ALAM\s+K1ABC\s+7\s+BUTT\s*$/)
})

test('a log kept under the old combined extension files the serials and counties its contacts carry', async () => {
  // The old extension kept the party's code on the operation and wrote each
  // contact's exchange on a bare `{type: 'qp'}`. Read by code, those contacts
  // file with serials of 0 and -, and an in-state station's county is lost
  // with nothing to fall back on — so it drops out of the file altogether.
  const legacy = { ...CA, legacyRefs: [{ type: 'qp', prefix: 'ca' }] }
  const result = await define(legacy).export.generateExport({
    exportType: `${CA.refType}-cabrillo`,
    operation: { ...operation(CA, 'ALAM'), refs: [{ type: 'qp', ref: 'CA', location: 'ALAM' }] },
    qsos: [contact('', CA, {
      their: { call: 'W6ABC', entityPrefix: 'K', state: 'CA' },
      refs: [{ type: 'qp', location: 'BUTT', ourSerial: 1, theirSerial: '7' }],
    })],
  }, ctx)

  const lines = result.content.split('\n')
  assert.match(lines.find((line) => line.startsWith('QSO:'))!, /N0DEV\s+1\s+ALAM\s+W6ABC\s+7\s+BUTT\s*$/)
})

test('the Cabrillo is a whole file: framed, signed, and one line per contact with a county at each end', async () => {
  // A checker refuses a file without its START/END lines or a CALLSIGN before
  // it reads a single contact, and a QSO party's line needs the county sent
  // AND the county received — the fullest exchange the writer is handed.
  const result = await define(NY).export.generateExport({
    exportType: `${NY.refType}-cabrillo`,
    operation: { ...operation(NY, 'ALB'), grid: 'FN32' },
    qsos: [{
      uuid: 'q1',
      their: { call: 'W1AW' },
      band: '40m',
      mode: 'CW',
      freq: 7035,
      startAtMillis: Date.UTC(2026, 9, 17, 14, 5),
      refs: [{ type: NY.refType, location: 'ERI', ourSerial: '1', theirSerial: '7' }],
    }],
  }, ctx)

  const lines = result.content.split('\n').map((line) => line.trim()).filter((line) => line)
  assert.equal(lines[0], 'START-OF-LOG: 3.0')
  assert.equal(lines[lines.length - 1], 'END-OF-LOG:')
  assert.ok(lines.includes('CALLSIGN: N0DEV'))
  assert.ok(lines.some((line) => line.startsWith('CONTEST: ')))
  const qsoLines = lines.filter((line) => line.startsWith('QSO: '))
  assert.equal(qsoLines.length, 1)
  assert.match(qsoLines[0], /N0DEV.*ALB.*W1AW.*ERI/)
})

test('an exportType this hook never offered is refused', async () => {
  // A hook that answers for the plain ADIF makes the core's delegation recurse
  // into itself.
  const result = await define(NY).export.generateExport(
    { exportType: 'adif', operation: operation(), qsos: [contact('ERI')] },
    ctx,
  )
  assert.deepEqual(result, { filename: '', mimeType: '', content: '' })
})

test('the ADIF export tells the per-QSO hook what the Cabrillo already knows', async () => {
  // `adifFields` is asked one contact at a time and never sees the log, so it
  // cannot know what a station sent on an earlier band. The answer rides on a
  // COPY of the operation — and of every segment's, since the core generator
  // hands the hook the segment-effective one — along with the segments
  // themselves, forwarded so the generator can resolve it.
  const segments = [
    { fromMillis: -1, operation: operation() },
    { fromMillis: 1000, operation: operation(NY, 'REN') },
  ]
  const result = await define(NY).export.generateExport({
    exportType: `${NY.refType}-adif`,
    operation: operation(),
    segments,
    qsos: [contact('ERI'), { ...contact(''), uuid: 'q2', band: '40m' }],
  } as ExportRequest, ctx)

  const handed = JSON.parse(result.content) as {
    mainHandler: string
    refs: Record<string, unknown>[]
    segments: { fromMillis: number; operation: { refs: Record<string, unknown>[] } }[]
  }
  // The contest's log, so its own `adifFields` hook alone is asked — by the key
  // that hook is registered under. The refType names no hook, and the core
  // exporter refuses a file whose main handler answers nothing.
  assert.equal(handed.mainHandler, KEY)
  // The second contact typed no exchange and is resolved to what that station
  // sent the first time — the same fold the scorer and the Cabrillo make.
  assert.deepEqual(handed.refs[0][RESOLVED_MARKER], { q1: 'ERI', q2: 'ERI' })
  assert.equal(handed.segments.length, 2)
  assert.equal(handed.segments[1].operation.refs[0].location, 'REN')
  assert.deepEqual(handed.segments[1].operation.refs[0][RESOLVED_MARKER], { q1: 'ERI', q2: 'ERI' })
})

test('a log kept under the old combined extension is handed the resolved exchanges too', async () => {
  // `adifFields` reads whichever ref `partyRefIn` finds, the old `qp` one
  // included. Marking only refs of the party's own type leaves that one bare,
  // and the ADIF then resolves each contact alone — so the second contact's
  // SRX_STRING disagrees with the Cabrillo's for the same station. The
  // contacts' refs carry no code, as the old extension wrote them.
  const legacy = { ...NY, legacyRefs: [{ type: 'qp', prefix: 'ny' }] }
  const old = (location: string) => [{ type: 'qp', location }]
  const result = await define(legacy).export.generateExport({
    exportType: `${NY.refType}-adif`,
    operation: { uuid: 'op', stationCall: 'N0DEV', refs: [{ type: 'qp', ref: 'NY', location: 'ALB' }] },
    qsos: [contact('', legacy, { refs: old('ERI') }), { ...contact('', legacy, { refs: old('') }), uuid: 'q2', band: '40m' }],
  } as ExportRequest, ctx)

  const handed = JSON.parse(result.content) as { refs: Record<string, unknown>[] }
  assert.deepEqual(handed.refs[0][RESOLVED_MARKER], { q1: 'ERI', q2: 'ERI' })
})

test('one contact′s ADIF fields are the exchange as it was sent and received', async () => {
  const fields = await define(CA).adifFields.fieldsForOneQSO({
    qso: contact('BUTT', CA, {
      refs: [{ type: CA.refType, location: 'BUTT', ourSerial: 1, theirSerial: '7' }],
    }),
    operation: operation(CA, 'ALAM'),
  }, ctx)

  assert.deepEqual(fields, [
    { name: 'CONTEST_ID', value: 'CA-QSO-PARTY' },
    { name: 'STX_STRING', value: '1 ALAM' },
    { name: 'SRX_STRING', value: '7 BUTT' },
    { name: 'STX', value: '1' },
    { name: 'SRX', value: '7' },
  ])
})

test('a log that is not this party′s gets no ADIF fields from it', async () => {
  // The full ADIF export asks every installed extension about every contact.
  // A party that answers regardless stamps its CONTEST_ID — and an SRX_STRING
  // made up from the other station's state — onto every POTA or SOTA log.
  const fields = await define(CA).adifFields.fieldsForOneQSO({
    qso: contact('', CA, { refs: [], their: { call: 'W6ABC', state: 'CA', entityPrefix: 'K' } }),
    operation: { uuid: 'op', stationCall: 'N0DEV', refs: [{ type: 'potaActivation', ref: 'US-1234' }] },
  }, ctx)

  assert.deepEqual(fields, [])
})

test('a log kept under the old combined extension is still this party′s', async () => {
  // `{type: 'qp', ref: 'CA'}` is how every party was stored when fifty were one
  // extension. Checking for the party's own refType alone would read those
  // logs as someone else's and drop their contest fields. The code is on the
  // operation only: the contact's ref is a bare `{type: 'qp'}`, so reading it
  // by code loses what the station sent.
  const legacy = { ...CA, legacyRefs: [{ type: 'qp', prefix: 'ca' }] }
  const fields = await define(legacy).adifFields.fieldsForOneQSO({
    qso: contact('', CA, { refs: [{ type: 'qp', location: 'BUTT', ourSerial: 3, theirSerial: '17' }] }),
    operation: { uuid: 'op', stationCall: 'N0DEV', refs: [{ type: 'qp', ref: 'CA', location: 'ALAM' }] },
  }, ctx)

  assert.deepEqual(fields.find((field) => field.name === 'CONTEST_ID'), { name: 'CONTEST_ID', value: 'CA-QSO-PARTY' })
  assert.deepEqual(fields.find((field) => field.name === 'STX_STRING'), { name: 'STX_STRING', value: '3 ALAM' })
  assert.deepEqual(fields.find((field) => field.name === 'SRX_STRING'), { name: 'SRX_STRING', value: '17 BUTT' })
})

test('a legacy contact that carries the party′s code, or app-polo′s serial names, files its exchange', async () => {
  // Both shapes are in logs today: a contact ref with the code on it, and
  // app-polo's `ourNumber`/`theirNumber`. Reading only the bare shape, or only
  // this engine's serial names, files them with no exchange or no numbers.
  const legacy = { ...CA, legacyRefs: [{ type: 'qp', prefix: 'ca' }] }
  const fields = await define(legacy).adifFields.fieldsForOneQSO({
    qso: contact('', CA, { refs: [{ type: 'qp', ref: 'CA', location: 'BUTT', ourNumber: '3', theirNumber: '17' }] }),
    operation: { uuid: 'op', stationCall: 'N0DEV', refs: [{ type: 'qp', ref: 'CA', location: 'ALAM' }] },
  }, ctx)

  assert.deepEqual(fields.find((field) => field.name === 'STX_STRING'), { name: 'STX_STRING', value: '3 ALAM' })
  assert.deepEqual(fields.find((field) => field.name === 'SRX_STRING'), { name: 'SRX_STRING', value: '17 BUTT' })
})


test('a county line leaves one ADIF record per pairing, each naming its own two counties', async () => {
  const records = await define(NY).adifFields.fieldCombinationsForOneQSO({
    qso: contact('ERI/CHA'),
    operation: operation(NY, 'ALB/REN'),
  }, ctx)

  const pick = (record: { name: string; value: string }[], name: string) =>
    record.find((field) => field.name === name)?.value
  assert.deepEqual(records.map((record) => [
    pick(record, 'STX_STRING'), pick(record, 'MY_CNTY'), pick(record, 'SRX_STRING'), pick(record, 'CNTY'),
  ]), [
    ['ALB', 'NY,Albany', 'ERI', 'NY,Erie'],
    ['ALB', 'NY,Albany', 'CHA', 'NY,Chautauqua'],
    ['REN', 'NY,Rensselaer', 'ERI', 'NY,Erie'],
    ['REN', 'NY,Rensselaer', 'CHA', 'NY,Chautauqua'],
  ])
  // The state beside each county, so a lookup's home state cannot contradict it.
  assert.equal(pick(records[0], 'MY_STATE'), 'NY')
  assert.equal(pick(records[0], 'STATE'), 'NY')
  assert.ok(records.every((record) => pick(record, 'CONTEST_ID') === 'NY-QSO-PARTY'))
})

test('an end that is a state rather than a county writes no county', async () => {
  const records = await define(NY).adifFields.fieldCombinationsForOneQSO({
    qso: contact('PA'),
    operation: operation(NY, 'ALB'),
  }, ctx)

  assert.equal(records.length, 1)
  const names = records[0].map((field) => field.name)
  assert.ok(names.includes('MY_CNTY'))
  assert.ok(!names.includes('CNTY'))
  assert.ok(!names.includes('STATE'))
})

test('a log that is not this party′s gets no ADIF records from it', async () => {
  const records = await define(NY).adifFields.fieldCombinationsForOneQSO({
    qso: contact('', NY, { refs: [] }),
    operation: { uuid: 'op', stationCall: 'N0DEV', refs: [{ type: 'potaActivation', ref: 'US-1234' }] },
  }, ctx)

  assert.deepEqual(records, [])
})

test('an ADIF county is the state and the name, without County or Parish, St. and & spelled out', () => {
  const ny = resolveParty({ ...NY, counties: { DEL: 'Delaware County', STL: 'St. Lawrence' } })
  assert.deepEqual(adifCountyOf(ny, 'DEL'), { state: 'NY', county: 'Delaware' })
  assert.deepEqual(adifCountyOf(ny, 'STL'), { state: 'NY', county: 'Saint Lawrence' })
  const fl = resolveParty({ ...NY, state: 'FL', counties: { STJ: 'St Johns', STE: 'Stevens' } })
  assert.deepEqual(adifCountyOf(fl, 'STJ'), { state: 'FL', county: 'Saint Johns' })
  assert.deepEqual(adifCountyOf(fl, 'STE'), { state: 'FL', county: 'Stevens' })

  const la = resolveParty({ ...NY, state: 'LA', counties: { ORL: 'Orleans Parish' } })
  assert.deepEqual(adifCountyOf(la, 'ORL'), { state: 'LA', county: 'Orleans' })

  // A party spanning several states names the state after the county.
  const neqp = resolveParty({ ...NEQP, counties: { VTWAS: 'Washington County VT', MABAR: 'Barnstable' } })
  assert.deepEqual(adifCountyOf(neqp, 'VTWAS'), { state: 'VT', county: 'Washington' })
  assert.deepEqual(adifCountyOf(neqp, 'MABAR'), { state: 'MA', county: 'Barnstable' })
  const mt = resolveParty({ ...NEQP, counties: { MTLEW: 'Lewis & Clark MT' } })
  assert.deepEqual(adifCountyOf(mt, 'MTLEW'), { state: 'MT', county: 'Lewis and Clark' })

  // Virginia's independent cities keep the "City" that tells them from the
  // county of the same name.
  const va = resolveParty({ ...NY, state: 'VA', counties: { RIX: 'Richmond (City)', RIC: 'Richmond County' } })
  assert.deepEqual(adifCountyOf(va, 'RIX'), { state: 'VA', county: 'Richmond City' })
  assert.deepEqual(adifCountyOf(va, 'RIC'), { state: 'VA', county: 'Richmond' })

  // A party played in districts names the county each one lies in.
  const hi = resolveParty({ ...NY, state: 'HI', counties: { LHN: 'Leeward' }, adifCounties: { LHN: 'Honolulu' } })
  assert.deepEqual(adifCountyOf(hi, 'LHN'), { state: 'HI', county: 'Honolulu' })

  // Not a county of the party's state, and not a US county at all.
  const md = resolveParty({ ...NY, state: 'MD', counties: { WDC: 'Washington DC' } })
  assert.equal(adifCountyOf(md, 'WDC'), undefined)
  const acqp = resolveParty(ACQP)
  assert.equal(adifCountyOf(acqp, Object.keys(acqp.counties)[0]), undefined)
  assert.equal(adifCountyOf(ny, 'PA'), undefined)
})

test('party registrations keep settings separate and reflect available formats', async () => {
  const ny = await define(NY).export.getExportTypes!({}, ctx)
  const ca = await define(CA).export.getExportTypes!({}, ctx)
  const wi = await define(WI).export.getExportTypes!({}, ctx)
  assert.deepEqual(ny.map((type) => type.exportType), [`${NY.refType}-adif`, `${NY.refType}-cabrillo`])
  assert.equal(ca[0].exportType, `${CA.refType}-adif`)
  assert.notEqual(ny[0].exportType, ca[0].exportType)
  assert.deepEqual(wi.map((type) => type.format), ['adif'])
})

test('ADIF delegation preserves explicit privacy and template preferences', async () => {
  const exportSettings = { customTemplates: true, adifNotesTemplate: '', adifCommentTemplate: 'My comment' }
  const exportData = { activity: 'NYQP' }
  const result = await define(NY).export.generateExport({
    exportType: `${NY.refType}-adif`, operation: operation(), qsos: [contact('ERI')],
    includePrivateData: false, includeLookupData: false, exportSettings, exportData, exportTitle: 'My party log',
  }, ctx)
  const handed = JSON.parse(result.content)
  assert.equal(handed.includePrivateData, false)
  assert.equal(handed.includeLookupData, false)
  assert.deepEqual(handed.exportSettings, exportSettings)
  assert.deepEqual(handed.exportData, exportData)
  assert.equal(handed.exportTitle, 'My party log')
})
