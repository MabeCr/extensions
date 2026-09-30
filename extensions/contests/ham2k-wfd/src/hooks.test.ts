// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Winter Field Day through its HOOKS — the scoring, the search and the ref's
// names — the way the app calls them.
//
// This extension is a deliberate copy of `ham2k-fd` (see `scorer.ts`), so
// nothing but tests notices when one drifts from the other on a rule they are
// supposed to share. The rules both contests share are asserted here AND in
// `ham2k-fd/src/hooks.test.ts`; a fix applied to one and forgotten in the
// other fails the file that was forgotten. What is Winter Field Day's own —
// weighted objectives, satellite contacts — is asserted only here.

import assert from "node:assert/strict"
import { describe, test } from "node:test"

import type { JSONValue } from "@ham2k/extension-sdk"

import { loadExtension } from "./sdkGapTesting.ts"

const wfd = await loadExtension(() => import("./index.ts"))

type Score = { value: number; dupe?: boolean; notices?: string[]; alerts?: string[] }
type Tally = { total: number; summary?: string; longSummary?: string }
type ScoreResult = { qsoScores: Record<string, Score>; operationSummary: Record<string, Tally> }

/// A QSO carrying Winter Field Day's exchange ref.
function contestQso(
  call: string,
  opts: { band: string; mode: string; uuid?: string; section?: string },
): Record<string, JSONValue> {
  const ref: Record<string, JSONValue> = { type: 'wfd' }
  if (opts.section) ref.location = opts.section
  return {
    uuid: opts.uuid ?? `${call}-${opts.band}-${opts.mode}`,
    their: { call },
    band: opts.band,
    mode: opts.mode,
    startAtMillis: Date.UTC(2026, 0, 24, 19),
    refs: [ref],
  }
}

async function score(setup: Record<string, JSONValue>, qsos: Record<string, JSONValue>[]): Promise<ScoreResult> {
  const ref = { type: 'wfd', ...setup }
  return (await wfd.runHook('scoring', 'scoreQsos', {
    operation: { uuid: 'op', stationCall: 'W1AW', refs: [ref] },
    qsos,
    ref,
  })) as ScoreResult
}

/// The contest's one operation tally, whatever the scorer keys it by.
function tally(result: ScoreResult): Tally {
  const tallies = Object.values(result.operationSummary)
  assert.equal(tallies.length, 1)
  return tallies[0]
}

async function suggest(searchTerm?: string): Promise<Record<string, unknown>[]> {
  return (await wfd.runHook('activity', 'suggest', searchTerm === undefined ? {} : { searchTerm })) as Record<string, unknown>[]
}

async function decorate(ref: Record<string, JSONValue>): Promise<Record<string, unknown>> {
  return (await wfd.runHook('ref:wfd', 'decorateRef', { ref: { type: 'wfd', ...ref } })) as Record<string, unknown>
}

describe('the rules Winter Field Day shares with ARRL Field Day', () => {
  test('data scores as CW does, not as phone', async () => {
    // scorer.test.ts totals one SSB and one CW contact; the data rate is the
    // third column of the points table and nothing else reaches it.
    const result = await score({}, [
      contestQso('K1AAA', { band: '20m', mode: 'SSB', uuid: 'a' }),
      contestQso('K1BBB', { band: '20m', mode: 'CW', uuid: 'b' }),
      contestQso('K1CCC', { band: '20m', mode: 'FT8', uuid: 'c' }),
    ])
    assert.equal(result.qsoScores.a.value, 1)
    assert.equal(result.qsoScores.b.value, 2)
    assert.equal(result.qsoScores.c.value, 2)
  })

  test('the same station counts again on a new band or mode, and only then', async () => {
    // The dupe rule is per band AND mode. A key missing either half refuses
    // real points; a key with more than both awards the same contact twice.
    const result = await score({}, [
      contestQso('K1AAA', { band: '20m', mode: 'SSB', uuid: 'a' }),
      contestQso('K1AAA', { band: '40m', mode: 'SSB', uuid: 'b' }),
      contestQso('K1AAA', { band: '20m', mode: 'CW', uuid: 'c' }),
      contestQso('K1AAA', { band: '20m', mode: 'SSB', uuid: 'd' }),
    ])
    const scores = result.qsoScores
    assert.equal(scores.b.value, 1, 'new band')
    assert.ok(scores.b.notices?.includes('newBand'))
    assert.equal(scores.c.value, 2, 'new mode')
    assert.ok(scores.c.notices?.includes('newMode'))
    assert.equal(scores.d.value, 0, 'same band and mode')
    assert.equal(scores.d.dupe, true)
  })

  test('ARRL, RAC and non-section locations all count toward the sections line', async () => {
    // Three tallies because the rules count them three ways; a summary that
    // read only the ARRL one would under-report a log that worked Canada or DX.
    const result = await score({}, [
      contestQso('K1AAA', { band: '20m', mode: 'SSB', section: 'ENY', uuid: 'a' }),
      contestQso('VE3BBB', { band: '20m', mode: 'SSB', section: 'ONS', uuid: 'b' }),
      contestQso('G0CCC', { band: '20m', mode: 'SSB', section: 'DX', uuid: 'c' }),
    ])
    assert.match(tally(result).longSummary ?? '', /3 sections/)
  })

  test('the WARC bands score nothing, and say so', async () => {
    // Winter Field Day excludes 12/17/30/60m exactly as ARRL Field Day does —
    // a copy that "corrected" one of them would score a band the rules refuse.
    const result = await score({}, [
      contestQso('K1AAA', { band: '30m', mode: 'CW', uuid: 'a' }),
      contestQso('K1BBB', { band: '20m', mode: 'CW', uuid: 'b' }),
    ])
    assert.equal(result.qsoScores.a.value, 0)
    assert.ok(result.qsoScores.a.alerts?.includes('invalidBand'))
    assert.equal(result.qsoScores.b.value, 2, '20m still counts')
  })
})

describe("Winter Field Day's own rules", () => {
  async function totalWith(setup: Record<string, JSONValue>): Promise<number> {
    return tally(await score(setup, [contestQso('K1AAA', { band: '20m', mode: 'SSB', uuid: 'a' })])).total
  }

  test('each objective adds its own weight to the multiplier, not one each', async () => {
    // The objectives are the whole multiplier. Counted flat, a well-equipped
    // station tops out at ×13 instead of the published ×33.
    assert.equal(await totalWith({}), 1, '×1 for taking part')
    assert.equal(await totalWith({ objectiveAltPower: true }), 2, '+1')
    assert.equal(await totalWith({ objectiveAwayFromHome: true }), 4, '+3')
    assert.equal(await totalWith({ objectiveSixBands: true }), 7, '+6')
    assert.equal(await totalWith({ objectiveQrp: true }), 5, '+4')
    const all = Object.fromEntries(
      [
        'objectiveAltPower',
        'objectiveAwayFromHome',
        'objectiveMultipleAntennas',
        'objectiveFmSatellite',
        'objectiveSsbCwSatellite',
        'objectiveWinlink',
        'objectiveSpecialBulletin',
        'objectiveSixBands',
        'objectiveTwelveBands',
        'objectiveMultipleModes',
        'objectiveQrp',
        'objectiveSixContinuousHours',
      ].map((key) => [key, true]),
    )
    assert.equal(await totalWith(all), 33, 'all twelve is the published maximum')
  })

  test('a satellite contact earns no QSO points', async () => {
    // Satellite contacts count toward the satellite objectives, never as
    // points; the `satellite` ref the satellites extension writes is the tell.
    const qso = contestQso('K1AAA', { band: '2m', mode: 'SSB', uuid: 'a' })
    qso.refs = [{ type: 'wfd' }, { type: 'satellite', ref: 'SO-50/145.85/fm' }]
    const result = await score({}, [qso])
    assert.equal(result.qsoScores.a.value, 0)
  })
})

describe('finding it in the activity search', () => {
  // The dates are a rule, not a data file, so these hold for any year the
  // suite runs in.
  test('an empty search offers it', async () => {
    // Nothing typed is the nearby-suggestions case: the operator opened the
    // picker, and a contest that runs next weekend is worth surfacing.
    assert.equal((await suggest()).length, 1)
  })

  test('it is found by its own names, and by "field day" and "fd" too', async () => {
    // It IS a field day, and "WFD" contains "FD": both searches find both
    // events, and which leads is left to the date ranking.
    for (const term of ['wfd', 'winter', 'Winter Field Day', 'winterfieldday', 'field day', 'fd']) {
      assert.equal((await suggest(term)).length, 1, `"${term}" should find WFD`)
    }
  })

  test('a search for something else finds nothing', async () => {
    // The picker fans out to every enabled extension, so a contest that
    // answered every query would push real hits down the list.
    for (const term of ['pota', 'US-0001', 'sota', 'zzz']) {
      assert.deepEqual(await suggest(term), [], `WFD should ignore "${term}"`)
    }
  })

  test('the suggestion carries everything the operation row shows', async () => {
    // A suggestion is persisted VERBATIM and never runs through
    // `decorateRef`, so a missing field reads as a blank row.
    const [suggestion] = await suggest('field day')
    assert.equal(suggestion.type, 'wfd')
    // The ref is the YEAR of the running — the duplicate guard's half.
    assert.match(String(suggestion.ref), /^20\d\d$/)
    // A contest row leads with `label`: the event and its year.
    assert.match(String(suggestion.label), /20\d\d/)
    // The same words `decorateRef` composes, or one operation reads two ways
    // depending on how it was added.
    assert.equal(suggestion.shortLabel, `WFD ${suggestion.ref}`)
    // The row's second line says what the event IS — not a not-configured
    // warning about something not yet added, and not the label again.
    assert.ok(suggestion.name)
    assert.ok(!String(suggestion.name).includes(String(suggestion.ref)))
    assert.notEqual(suggestion.name, suggestion.label)
    assert.equal(typeof suggestion.relevance, 'number')
  })
})

describe('how a configured entry names itself', () => {
  // `label` and `shortLabel` name the EVENT, `name` alone carries the
  // exchange. A shortLabel of "3A ENY" names no contest at all, and reads the
  // same for FD and WFD in the same season.
  const configured = { ref: '2027', ourClass: '3A', ourSection: 'ENY' }

  test('the event and its year lead, the exchange follows', async () => {
    const ref = await decorate(configured)
    assert.match(String(ref.label), /Winter/)
    assert.match(String(ref.label), /2027/)
    assert.ok(!String(ref.label).includes('3A'), 'the exchange belongs on the second line only')
    assert.equal(ref.name, '3A ENY')
    assert.equal(ref.shortLabel, 'WFD 2027')
  })

  test('an exchange replaces the not-configured line once it is set, and not before', async () => {
    // A `name` that kept the warning after configuration, or dropped it
    // before, makes the row lie in one direction or the other.
    const bare = await decorate({ ref: '2027' })
    assert.ok(bare.name)
    assert.notEqual(bare.name, '3A ENY')
    assert.ok(!String(bare.name).includes('3A'), 'an unconfigured entry invents no exchange')
    // Still names the event while unconfigured.
    assert.match(String(bare.label), /Winter/)
    assert.match(String(bare.label), /2027/)
    assert.equal(bare.shortLabel, 'WFD 2027')
  })

  test('decorateRef stamps program, so a QSO stays a contest QSO', async () => {
    // `program` is the signal that survives the extension being switched off.
    // The setup-form path never touches `suggest`, so this hook is the only
    // place those refs get one.
    assert.equal((await decorate(configured)).program, 'Contest')
  })
})
