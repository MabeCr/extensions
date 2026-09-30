// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// ARRL Field Day through its HOOKS — the scoring, the exchange controls, the
// search, the ref's names and the two exports — the way the app calls them.
//
// `ham2k-wfd` is a deliberate copy of this extension (see `scorer.ts`), so
// nothing but tests notices when one drifts from the other on a rule they are
// supposed to share. The rules both contests share are asserted here AND in
// `ham2k-wfd/src/hooks.test.ts`; a fix applied to one and forgotten in the
// other fails the file that was forgotten.

import assert from "node:assert/strict"
import { describe, test } from "node:test"

import type { JSONValue } from "@ham2k/extension-sdk"

import { loadExtension } from "./sdkGapTesting.ts"

const fd = await loadExtension(() => import("./index.ts"))

type Score = { value: number; dupe?: boolean; notices?: string[]; alerts?: string[] }
type Tally = { total: number; summary?: string; longSummary?: string }
type ScoreResult = {
  qsoScores: Record<string, Score>
  daySections: { scores: Record<string, unknown> }[]
  operationSummary: Record<string, Tally>
}
type Control = { key: string; input: Record<string, unknown> }
type FormElement = { key?: string; value?: unknown }

/// A QSO carrying Field Day's exchange ref.
function contestQso(
  call: string,
  opts: { band: string; mode: string; uuid?: string; theirClass?: string; section?: string; day?: number },
): Record<string, JSONValue> {
  const ref: Record<string, JSONValue> = { type: 'fd' }
  if (opts.theirClass) ref.class = opts.theirClass
  if (opts.section) ref.location = opts.section
  return {
    uuid: opts.uuid ?? `${call}-${opts.band}-${opts.mode}`,
    their: { call },
    band: opts.band,
    mode: opts.mode,
    startAtMillis: Date.UTC(2026, 5, opts.day ?? 1, 18),
    refs: [ref],
  }
}

async function score(setup: Record<string, JSONValue>, qsos: Record<string, JSONValue>[]): Promise<ScoreResult> {
  const ref = { type: 'fd', ...setup }
  return (await fd.runHook('scoring', 'scoreQsos', {
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

/// The total for one 20m contact under [setup].
async function totalWith(setup: Record<string, JSONValue>, mode = 'SSB'): Promise<number> {
  return tally(await score(setup, [contestQso('K1AAA', { band: '20m', mode, uuid: 'a' })])).total
}

async function loggingControls(their?: Record<string, JSONValue>, refs: JSONValue[] = [{ type: 'fd' }]): Promise<Control[]> {
  return (await fd.runHook('activity', 'loggingControls', {
    operation: { refs },
    ...(their ? { qso: { their } } : {}),
  })) as Control[]
}

async function sectionControl(their: Record<string, JSONValue>): Promise<Control> {
  const control = (await loggingControls(their)).find((c) => c.key === 'fd/section')
  assert.ok(control, 'no fd/section control')
  return control
}

async function suggest(searchTerm?: string): Promise<Record<string, unknown>[]> {
  return (await fd.runHook('activity', 'suggest', searchTerm === undefined ? {} : { searchTerm })) as Record<string, unknown>[]
}

async function decorate(ref: Record<string, JSONValue>): Promise<Record<string, unknown>> {
  return (await fd.runHook('ref:fd', 'decorateRef', { ref: { type: 'fd', ...ref } })) as Record<string, unknown>
}

describe('the rules Field Day shares with Winter Field Day', () => {
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
    // The dupe rule is per band AND mode, which is what makes Field Day a
    // band-hopping contest. A key missing either half refuses real points; a
    // key with more than both awards the same contact twice.
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
    // Both Field Days exclude 12/17/30/60m. The contact is still logged; an
    // alert is what tells an operator who drifted there to move.
    const result = await score({}, [
      contestQso('K1AAA', { band: '30m', mode: 'CW', uuid: 'a' }),
      contestQso('K1BBB', { band: '20m', mode: 'CW', uuid: 'b' }),
    ])
    assert.equal(result.qsoScores.a.value, 0)
    assert.ok(result.qsoScores.a.alerts?.includes('invalidBand'))
    assert.equal(result.qsoScores.b.value, 2, '20m still counts')
  })
})

describe('the power multiplier', () => {
  // QRP off batteries (×5) is covered in scorer.test.ts; these are the other
  // rows of the table.
  test('QRP on a generator and 100W are ×2, high power ×1', async () => {
    // 2 QSO points (one CW contact), times the multiplier.
    assert.equal(await totalWith({ ourPower: '5W', ourPowerSource: 'GENERATOR' }, 'CW'), 4)
    assert.equal(await totalWith({ ourPower: '100W', ourPowerSource: 'GENERATOR' }, 'CW'), 4)
    assert.equal(await totalWith({ ourPower: '500W', ourPowerSource: 'GENERATOR' }, 'CW'), 2)
  })

  test('a setup that declares no power is ×1, never ×0', async () => {
    // An unfinished setup form must not zero a real log.
    assert.equal(await totalWith({}, 'CW'), 2)
  })
})

describe('the bonus checklist', () => {
  // One phone contact at ×1 throughout (500W), so everything past 1 is bonus.
  const highPower = { ourPower: '500W' }

  test('the per-transmitter bonus needs emergency power, and is paid once', async () => {
    // The rules grant 100 per transmitter only for running entirely on
    // emergency power. Paying it unconditionally rewards a mains-powered home
    // station; paying it again for the emergency power doubles it.
    assert.equal(await totalWith({ ...highPower, bonusTransmitters: 3 }), 1, 'transmitters alone earn nothing')
    assert.equal(await totalWith({ ...highPower, bonusTransmitters: 3, bonusEmergencyPower: true }), 1 + 300)
    // Capped at 20 transmitters, while a club may still record 25.
    assert.equal(await totalWith({ ...highPower, bonusTransmitters: 25, bonusEmergencyPower: true }), 1 + 2000)
  })

  test('the counted bonuses use their own rates and caps', async () => {
    assert.equal(await totalWith({ ...highPower, bonusNTSMessages: 4 }), 1 + 40, '10 each')
    assert.equal(await totalWith({ ...highPower, bonusNTSMessages: 40 }), 1 + 100, 'capped at 10 messages')
    assert.equal(await totalWith({ ...highPower, bonusGotaQsos: 30 }), 1 + 150, '5 each, uncapped')
    assert.equal(await totalWith({ ...highPower, bonusYouthParticipants: 2 }), 1 + 40, '20 each')
    assert.equal(await totalWith({ ...highPower, bonusYouthParticipants: 9 }), 1 + 100, 'capped at 100')
  })

  test('claimed bonuses are worth what the rules say, not a flat 100', async () => {
    // Web submission and site duties are 50; a flat 100 for every checkbox
    // over-claims both.
    assert.equal(await totalWith(highPower), 1, 'nothing claimed')
    assert.equal(await totalWith({ ...highPower, bonusMediaPublicity: true }), 101)
    assert.equal(await totalWith({ ...highPower, bonusWebSubmission: true }), 51)
    assert.equal(await totalWith({ ...highPower, bonusSiteResponsibilities: true }), 51)
    assert.equal(await totalWith({ ...highPower, bonusGotaCoach: true }), 101)
    assert.equal(await totalWith({ ...highPower, bonusMediaPublicity: false }), 1, 'unchecked is not a claim')
  })

  test('no day carries a score of its own, and the bonus is claimed once for the entry', async () => {
    // Field Day always spans two UTC days, so this reaches every operation. A
    // per-day tally that re-added the bonus would claim it once per day.
    const result = await score({ ...highPower, bonusTransmitters: 2, bonusEmergencyPower: true }, [
      contestQso('K1AAA', { band: '20m', mode: 'SSB', uuid: 'a', day: 27 }),
      contestQso('K1BBB', { band: '20m', mode: 'SSB', uuid: 'b', day: 28 }),
      contestQso('K1CCC', { band: '20m', mode: 'SSB', uuid: 'c', day: 28 }),
    ])
    assert.equal(result.daySections.length, 2)
    for (const day of result.daySections) assert.deepEqual(day.scores, {})
    assert.equal(tally(result).total, 3 + 200)
  })

  test('scores are rendered with thousands separators', async () => {
    const result = await score({ ...highPower, bonusTransmitters: 20, bonusEmergencyPower: true }, [
      contestQso('K1AAA', { band: '20m', mode: 'SSB', uuid: 'a' }),
    ])
    assert.match(tally(result).summary ?? '', /2,001/)
  })
})

describe('what the scorer notices', () => {
  test('a QSO with no mode scores as phone, not as data', async () => {
    // `superModeForMode('')` answers 'DATA', never nullish, so a `?? 'PHONE'`
    // fallback is dead code: the mode-less contact would score 2.
    const modeless = { ...contestQso('K1AAA', { band: '20m', mode: '', uuid: 'a', day: 27 }) }
    const result = await score({}, [modeless, contestQso('K1AAA', { band: '20m', mode: 'SSB', uuid: 'b', day: 27 })])
    assert.equal(result.qsoScores.a.value, 1, 'the phone rate, not the data rate')
    // It keeps a dupe bucket of its own: the mode is unknown, so filing it
    // under the later SSB contact's would invent a match.
    assert.equal(result.qsoScores.b.value, 1, 'the real SSB contact still scores')
  })

  test('the section notice is a key, and fires only on a new section', async () => {
    // A display name pushed through the notice channel reaches a Spanish
    // operator in English and lands in the score cache that way.
    const result = await score({}, [
      contestQso('K1AAA', { band: '20m', mode: 'SSB', section: 'ENY', uuid: 'a' }),
      contestQso('K1BBB', { band: '40m', mode: 'SSB', section: 'ENY', uuid: 'b' }),
    ])
    assert.ok(result.qsoScores.a.notices?.includes('newSection'))
    assert.ok(!result.qsoScores.a.notices?.includes('Eastern New York'))
    assert.ok(!(result.qsoScores.b.notices ?? []).includes('newSection'), 'the second ENY contact is not news')
  })
})

describe('what the log carries', () => {
  const operation = { refs: [{ type: 'fd', ourClass: '1D', ourSection: 'CT' }] }

  test('every QSO of a Field Day operation writes CONTEST_ID and the exchange', async () => {
    // Keyed off the OPERATION, not the QSO: every contact made during a Field
    // Day operation is a Field Day contact.
    const fields = (await fd.runHook('adifFields', 'fieldsForOneQSO', {
      qso: contestQso('K1AAA', { band: '20m', mode: 'SSB', theirClass: '2A', section: 'ENY' }),
      operation,
    })) as { name: string; value: string }[]
    assert.deepEqual(Object.fromEntries(fields.map((f) => [f.name, f.value])), {
      CONTEST_ID: 'ARRL-FIELD-DAY',
      CLASS: '2A',
      ARRL_SECT: 'ENY',
    })
  })

  test('an operation that is not Field Day gets no Field Day fields', async () => {
    // `adifFields` fans out to every enabled extension; answering for any
    // operation would stamp CONTEST_ID onto logs that are not this contest.
    const fields = await fd.runHook('adifFields', 'fieldsForOneQSO', {
      qso: contestQso('K1AAA', { band: '20m', mode: 'SSB', theirClass: '2A' }),
      operation: { refs: [] },
    })
    assert.deepEqual(fields, [])
  })

  test('the Cabrillo log names the contest as registered, and each line carries both stations', async () => {
    const result = (await fd.runHook('export', 'generateExport', {
      exportType: 'fd-cabrillo',
      operation: { stationCall: 'W1AW', ...operation },
      qsos: [contestQso('K1AAA', { band: '20m', mode: 'SSB', theirClass: '2A', section: 'ENY' })],
    })) as { content: string }
    const content = result.content
    // The registered CABRILLO name, not the ADIF CONTEST_ID — a checker does
    // not recognise 'ARRL-FIELD-DAY' in this header.
    assert.match(content, /CONTEST: ARRL-FD/)
    assert.match(content, /CALLSIGN: W1AW/)
    assert.match(content, /LOCATION: CT/)
    const qsoLine = content.split('\n').find((line) => line.startsWith('QSO:'))
    assert.ok(qsoLine, 'no QSO: line')
    // Ours (call, class, section), then theirs.
    assert.match(qsoLine, /W1AW\s+1D\s+CT\s+K1AAA\s+2A\s+ENY/)
  })

  test('the exchange is written onto the QSO for the log column', async () => {
    // The log's exchange column reads `their.exchange`; without it a Field Day
    // log shows nothing for what each station sent.
    const patch = (await fd.runHook('activity', 'processQsoBeforeSave', {
      qso: contestQso('K1AAA', { band: '20m', mode: 'SSB', theirClass: '2A', section: 'ENY' }),
      operation: { refs: [{ type: 'fd', ourClass: '1D' }] },
    })) as { their?: { exchange?: string } } | null
    assert.equal(patch?.their?.exchange, '2A ENY')
  })
})

describe('the exchange controls', () => {
  test("the section control offers every section, ranking the caller's own call area", async () => {
    // Ranking, never prefilling: a guess from a callsign is wrong often
    // enough to be annoying.
    const input = (await sectionControl({ call: 'W1XYZ' })).input
    assert.equal(input.kind, 'options')
    // 71 ARRL + 14 RAC. Yukon is RAC's own section, but Field Day still
    // counts it inside TER, so YT is not a valid exchange here.
    assert.equal((input.options as unknown[]).length, 85)
    const preferred = input.preferredCodes as string[]
    assert.ok(preferred.includes('EMA'), 'a W1 is in New England')
    assert.ok(!preferred.includes('SDG'), 'not San Diego')
    // MX and DX are legal to receive and are not in the list.
    assert.equal(input.allowFreeform, true)
  })

  test('a prefix that names its section outright wins over the call area', async () => {
    // KL7 is Alaska and nothing else; diluting it with all of call area 7
    // buries the one right answer.
    assert.deepEqual((await sectionControl({ call: 'KL7AA' })).input.preferredCodes, ['AK'])
  })

  test('a callsign outside the US is not offered US sections', async () => {
    // A bare digit is not a US call area: VE3 and G3 both contain a 3. Ontario
    // alone is four sections, so one US guess is worse than none.
    const preferredFor = async (call: string, entityPrefix: string) =>
      (await sectionControl({ call, entityPrefix })).input.preferredCodes as string[]
    assert.ok((await preferredFor('W1XYZ', 'K')).includes('EMA'))
    assert.deepEqual(await preferredFor('VE3ABC', 'VE'), [])
    assert.deepEqual(await preferredFor('G0ABC', 'G'), [])
    assert.deepEqual(await preferredFor('KL7AA', 'KL'), ['AK'], 'a prefix that names its section still wins')
  })

  test('the class control accepts a "please copy" prefix', async () => {
    // `PC1A` is a legal exchange — a station asking you to copy the bulletin.
    // A pattern that refused it would tint every one of them as an error.
    const control = (await loggingControls({ call: 'W1XYZ' })).find((c) => c.key === 'fd/class')
    assert.ok(control, 'no fd/class control')
    const pattern = new RegExp(control.input.pattern as string)
    assert.ok(pattern.test('1A'))
    assert.ok(pattern.test('14F'))
    assert.ok(pattern.test('PC2B'))
    assert.ok(!pattern.test('1Z'))
    assert.ok(!pattern.test('0A'))
  })

  test('off-contest the controls contribute nothing', async () => {
    assert.deepEqual(await loggingControls(undefined, []), [])
  })

  test('the setup form and the search give the ref the same identity', async () => {
    // The picker's duplicate guard compares type+ref. A form that wrote no
    // `ref` while `suggest` wrote the year would never match, and adding from
    // the search would REPLACE a configured setup — class, section, power and
    // every bonus lost.
    const controls = (await fd.runHook('activity', 'operationControls', { operation: { refs: [] } })) as Control[]
    const elements = (controls[0].input.form as { elements: FormElement[] }).elements
    const refField = elements.find((e) => e.key === 'ref')
    assert.ok(refField, 'the form must write `ref`')
    const [suggestion] = await suggest('field day')
    assert.equal(suggestion.ref, refField.value, 'the form and the search must agree on which running this is')
  })
})

describe('finding it in the activity search', () => {
  // The dates are a rule, not a data file, so these hold for any year the
  // suite runs in.
  test('an empty search offers it', async () => {
    // Nothing typed is the nearby-suggestions case: the operator opened the
    // picker, and a contest that runs next weekend is worth surfacing.
    assert.equal((await suggest()).length, 1)
    assert.equal((await suggest('')).length, 1)
  })

  test('it is found by its own names, including "field day"', async () => {
    // "field day" finds Winter Field Day too — which leads is left to the date
    // ranking, not to the spelling.
    for (const term of ['fd', 'FD', 'field day', 'FIELDDAY', 'arrl']) {
      assert.equal((await suggest(term)).length, 1, `"${term}" should find FD`)
    }
  })

  test('a search for something else finds nothing', async () => {
    // The picker fans out to every enabled extension, so a contest that
    // answered every query would push real hits down the list.
    for (const term of ['pota', 'US-0001', 'sota', 'zzz']) {
      assert.deepEqual(await suggest(term), [], `FD should ignore "${term}"`)
    }
  })

  test('the suggestion carries everything the operation row shows', async () => {
    // A suggestion is persisted VERBATIM and never runs through
    // `decorateRef`, so a missing field reads as a blank row.
    const [suggestion] = await suggest('field day')
    assert.equal(suggestion.type, 'fd')
    // The ref is the YEAR of the running — the duplicate guard's half.
    assert.match(String(suggestion.ref), /^20\d\d$/)
    // A contest row leads with `label`: the event and its year.
    assert.match(String(suggestion.label), /20\d\d/)
    // The same words `decorateRef` composes, or one operation reads two ways
    // depending on how it was added.
    assert.equal(suggestion.shortLabel, `FD ${suggestion.ref}`)
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
    assert.match(String(ref.label), /ARRL/)
    assert.match(String(ref.label), /2027/)
    assert.ok(!String(ref.label).includes('3A'), 'the exchange belongs on the second line only')
    assert.equal(ref.name, '3A ENY')
    assert.equal(ref.shortLabel, 'FD 2027')
  })

  test('an exchange replaces the not-configured line once it is set, and not before', async () => {
    // A `name` that kept the warning after configuration, or dropped it
    // before, makes the row lie in one direction or the other.
    const bare = await decorate({ ref: '2027' })
    assert.ok(bare.name)
    assert.notEqual(bare.name, '3A ENY')
    assert.ok(!String(bare.name).includes('3A'), 'an unconfigured entry invents no exchange')
    // Still names the event while unconfigured.
    assert.match(String(bare.label), /ARRL/)
    assert.match(String(bare.label), /2027/)
    assert.equal(bare.shortLabel, 'FD 2027')
  })

  test('decorateRef stamps program, so a QSO stays a contest QSO', async () => {
    // `program` is the signal that survives the extension being switched off.
    // The setup-form path never touches `suggest`, so this hook is the only
    // place those refs get one.
    assert.equal((await decorate(configured)).program, 'Contest')
  })
})
