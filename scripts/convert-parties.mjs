// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Turns the sponsors' hand-maintained party files into `QsoPartyParams`
// modules — `packages/qso-parties/fixtures/*.json` in, `src/parties/*.ts` and
// their county tables out.
//
// Usage:
//   node scripts/convert-parties.mjs               regenerate from the fixtures
//   node scripts/convert-parties.mjs <dir>         re-sync: copy <dir>/*.json
//                                                  over the fixtures first
//
// The fixtures are the input AND the test's reference input, so a re-sync is a
// copy, a re-run and one reviewable diff — of the county JSON, where the bulk
// of a change lands, and of the module, where a rule change lands.
//
// The normalizations below are the ones `partyFor()` performs in the bundled
// version: three spellings of the power table over two class vocabularies, DIGI
// for DATA, two ANDed spellings of one county-multiplier rule, the slashed zero
// hams write by hand, dates that are unpadded or impossible, and a URL with a
// space in it. `packages/qso-parties/src/parties.test.ts` holds a SECOND,
// independent transcription of the same rules and compares its answers to this
// script's output for all fifty parties; the two are deliberately not shared
// code, so a mistake here has to be made twice to survive.

import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"

const PACKAGE_DIR = resolve(import.meta.dirname, "..", "packages", "qso-parties")
const FIXTURES_DIR = join(PACKAGE_DIR, "fixtures")
const PARTIES_DIR = join(PACKAGE_DIR, "src", "parties")

const HEADER = [
  "// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>",
  "// SPDX-License-Identifier: MIT",
]

/// What each of these six parties carries that app-polo's copy of the same file
/// does not, so a re-sync cannot quietly take the older data back. Emitted into
/// the module rather than kept here alone: the warning has to sit where someone
/// pasting a new file will read it.
const DIVERGENCE_NOTES = {
  BC: [
    "DIVERGES from app-polo, deliberately. polo's copy still carries 2025",
    "dates; these were re-read from the sponsor's own rules in September 2026.",
    "Never take polo's file back over this one without re-reading the sponsor —",
    "its dates are OLDER than these, not newer.",
  ],
  NC: [
    "DIVERGES from app-polo, deliberately. polo's copy carries a 2025 end year",
    "against a 2026 start; these dates were re-read from the sponsor's own",
    "rules in September 2026, which advertise 28 Feb 2027 next. Never take",
    "polo's file back over this one without re-reading the sponsor.",
  ],
  NJ: [
    "DIVERGES from app-polo, deliberately. polo's copy still carries 2025 dates,",
    "no rules URL and no scoring table; dates, points and power multipliers",
    "were all re-read from the sponsor in September 2026. Never take polo's",
    "file back over this one without re-reading the sponsor.",
  ],
  NV: [
    "DIVERGES from app-polo, deliberately: polo's copy carries no rules URL. Both",
    "carry dates DERIVED from the sponsor's standing rule (the second weekend in",
    "October), because their own site still shows 2025 — so re-read them before",
    "the event rather than trusting them outright.",
  ],
  SC: [
    "DIVERGES from app-polo, deliberately. polo's copy ends on 2025-2-29, a date",
    "that year does not have, which a date parser rolls forward into a period",
    "the sponsor never published. These dates were re-read from the sponsor's",
    "own rules in September 2026. Never take polo's file back over this one.",
  ],
  SD: [
    "DIVERGES from app-polo, deliberately. polo's copy assumes `SD-QSO-PARTY` as the",
    "Cabrillo name because the sponsor names none; the Cabrillo registry at",
    "contestcalendar.com lists `SDQSOP`, which is also this party's ref type.",
    "Never take polo's file back over this one: it would rename the contest every",
    "submitted log declares, and the extension's own identity with it.",
  ],
  NS: [
    "The sponsor's contest page is gone (404) and app-polo marks this party",
    "`disabled`; its dates are still 2025 and nothing here re-derives them. The",
    "parameters are complete and the party is operable, but nothing has been",
    "verified against a sponsor — do not publish an extension from this file",
    "until someone has.",
  ],
}

/// The parties whose pages at qsopartyhub.com are not named after their short,
/// read off the hub's own index in October 2026. Kept here rather than in the
/// fixtures because a re-sync copies polo's files over them, and polo's
/// `qsoPartyHubName` names one page for both, which these six do not have: four
/// of them take a spot on a page named one way and list spots on a page named
/// another.
/// The county ADIF's `CNTY` names each code by, for a party whose own units
/// are not counties. polo's files have no such field, so it lives here: Hawaii
/// is played in fourteen districts across the state's five counties.
const ADIF_COUNTIES = {
  HI: {
    HIL: "Hawaii", KOH: "Hawaii", KON: "Hawaii", VOL: "Hawaii",
    HON: "Honolulu", LHN: "Honolulu", PRL: "Honolulu", WHN: "Honolulu",
    KAL: "Kalawao",
    KAU: "Kauai", NII: "Kauai",
    LNI: "Maui", MAU: "Maui", MOL: "Maui",
  },
}

const HUB_PAGES = {
  CA: { table: "caqp", spot: "cqp" },
  FL: { table: "flqp", spot: "fqp" },
  HI: { table: "hiqp", spot: "hqp" },
  MD: { table: "mdcqp", spot: "mdcqp" },
  NS: { table: "nsqp", spot: "nsqp" },
  WA: { table: "waqp", spot: "wasr" },
}

// ---------------------------------------------------------------- normalizing

function str(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function bool(value) {
  return value === true
}

function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

/// A code as everything else spells it. `Ø` is the slashed zero hams write by
/// hand, and Missouri's two bonus stations are keyed with it; a logged callsign
/// carries a digit zero, so an unnormalized key can never be matched.
function normalizeCode(code) {
  return code.toUpperCase().replace(/[ØÖ]/g, "0")
}

function mapOf(value) {
  if (!value || typeof value !== "object") return {}
  const out = {}
  for (const [code, name] of Object.entries(value)) {
    const key = normalizeCode(code)
    out[key] = typeof name === "string" && name ? name : key
  }
  return out
}

/// `{ EPA: ["ADA", …], WPA: […] }` → county → section: the file lists it the
/// way a sponsor's map reads, the engine looks a county up. A county listed
/// twice or naming no county of the party stops the run — either one scores a
/// contact under the wrong section, or none, with nothing to show for it.
function countySectionsOf(value, counties, key) {
  if (!value || typeof value !== "object") return {}
  const out = {}
  for (const [section, listed] of Object.entries(value)) {
    if (!Array.isArray(listed)) throw new Error(`${key}: countySections.${section} is not a list of counties`)
    for (const county of listed) {
      const code = normalizeCode(String(county))
      if (!counties[code]) throw new Error(`${key}: countySections.${section} names ${code}, which is not one of its counties`)
      if (out[code]) throw new Error(`${key}: countySections lists ${code} under both ${out[code]} and ${section}`)
      out[code] = normalizeCode(section)
    }
  }
  return out
}

function numbersOf(value) {
  if (!value || typeof value !== "object") return {}
  const out = {}
  for (const [code, points] of Object.entries(value)) {
    const n = num(points)
    if (n !== undefined) out[normalizeCode(code)] = n
  }
  return out
}

/// `2026-5-2 13:00Z` → millis. Months and days may be unpadded and the trailing
/// Z is sometimes lowercase. An unparseable or impossible date answers 0, which
/// this script refuses to emit a period from: `Date.UTC` rolls 29 February 2025
/// forward to 1 March rather than refusing it, and that is a period no sponsor
/// published.
function parsePartyTime(value) {
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

/// A URL with its internal whitespace removed. `qc.json` carries
/// `https: //quebecqsoparty.org/`, which is a link that cannot open.
function sanitizeUrl(value) {
  const text = str(value)
  if (!text) return undefined
  const cleaned = text.replace(/\s+/g, "")
  return cleaned.startsWith("http") ? cleaned : undefined
}

/// `NYQP` from `NY`, `7QP` and `NEQP` from themselves.
function shortFor(raw, key) {
  return str(raw.short) ?? (key.endsWith("QP") ? key : `${key}QP`)
}

/// The states or provinces a multi-state party spans, by the same two rules
/// `stateForCounty` reads in the same order: the party's own table, else the
/// state a code longer than four characters carries in its first two.
///
/// Derived from the county data rather than typed, so the list cannot claim a
/// state the counties are not in — which is the whole of what it is for. A
/// county that answers NEITHER rule throws: the party has no `state` to fall
/// back on, so that county would score with no state at all, silently.
function statesOf(counties, countyStates, key) {
  const states = new Set()
  for (const county of Object.keys(counties)) {
    const state = countyStates[county] ?? (county.length > 4 ? county.slice(0, 2) : undefined)
    if (!state) {
      throw new Error(
        `${key}: county ${county} names no state, and a party spanning several has none to fall back on`,
      )
    }
    states.add(state)
  }
  return [...states].sort()
}

/// The ref type an extension owns: the sponsor's own Cabrillo contest name,
/// lower-cased. `NY-QSO-PARTY` is `ny-qso-party`, `MRRC-OHQP` is `mrrc-ohqp`.
///
/// The Cabrillo name rather than the party's own, because it is the identifier
/// the sponsors publish and the log itself already carries — the same string
/// this party's submitted file names in its `CONTEST:` line — where a slug of
/// the display name is a name this project invented. Lower-cased because every
/// other ref type in the app is (`pota`, `cqww`), and a reference type is read
/// far more often than a Cabrillo header is written.
///
/// A party the sponsors never registered falls back to its short name, which
/// is what `exports.ts` already writes into `CONTEST_ID` for it — so nothing
/// here invents an identifier that a submitted log would then contradict.
/// `parties.test.ts` holds the result distinct across all fifty.
function refTypeFor(raw, short) {
  const source = str(raw.cabrilloName) || short
  return source.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}

/// The power table, from whichever of the three keys a file uses, on whichever
/// of the two class vocabularies it uses. `LP`/`HP` and `LOW`/`HIGH` are the
/// same two classes.
function powerMultipliersOf(raw) {
  const table = numbersOf(raw.powerMultiplier ?? raw.powerMultipliers ?? raw.power)
  const out = {}
  const qrp = table.QRP
  const low = table.LOW ?? table.LP
  const high = table.HIGH ?? table.HP
  if (qrp !== undefined) out.QRP = qrp
  if (low !== undefined) out.LOW = low
  if (high !== undefined) out.HIGH = high
  return out
}

/// Points per super-mode. `DIGI` is `DATA` under another name — six files write
/// one and twenty the other, and a digital QSO's super-mode is `DATA`, so an
/// unreconciled `DIGI` pays the fallback point instead of what the sponsor
/// publishes. The other keys a file carries (`SAT`, `_QRP_`, `_Rover_`) are
/// passed through: no super-mode matches them, so they price nothing, and
/// dropping them would lose a rule the files are the record of.
function pointsByModeOf(raw) {
  const table = numbersOf(raw.points)
  if (table.DIGI !== undefined) {
    if (table.DATA === undefined) table.DATA = table.DIGI
    delete table.DIGI
  }
  return table
}

/// The modes a QSO's own super-mode can be, and so the only keys in a points
/// table that ever price a contact.
const SUPER_MODES = ["CW", "PHONE", "DATA"]

const POWER_CLASSES = ["QRP", "LOW", "HIGH"]
const OPERATOR_CLASSES =
  ["SINGLE-OP", "SINGLE-OP-ASSISTED", "MULTI-ONE", "MULTI-TWO", "MULTI-UNLIMITED"]
const STATION_CLASSES =
  ["FIXED", "MOBILE", "PORTABLE", "ROVER", "EXPEDITION", "COUNTY-LINE", "SCHOOL", "CLUB", "EOC"]
const MODE_CLASSES = ["CW", "PHONE", "DIGITAL", "MIXED"]
const OVERLAY_CLASSES =
  ["ROOKIE", "YOUTH", "YL", "NOVICE-TECH", "NEW-CONTESTER", "TB-WIRES", "POTA"]

/// The entry classes, filtered to the vocabulary the engine knows and put in
/// its order, not the file's. A class this vocabulary has never heard of is
/// DROPPED: it would reach a submitted Cabrillo as a category no checker
/// recognizes.
function entryClassesOf(raw) {
  const block = raw.entryClasses && typeof raw.entryClasses === "object" ? raw.entryClasses : {}

  const listOf = (value, known) => {
    if (!Array.isArray(value)) return []
    const wanted = new Set(value.filter((v) => typeof v === "string").map((v) => v.toUpperCase()))
    return known.filter((code) => wanted.has(code))
  }

  const limits = {}
  const rawLimits = block.powerLimits && typeof block.powerLimits === "object" ? block.powerLimits : {}
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

/// What the entry row asks for besides the location. `inStateExchange` /
/// `outOfStateExchange` (NSARA) are NOT read: they name a one-way serial the
/// engine does not implement.
function exchangeOf(raw) {
  const fields = Array.isArray(raw.exchange) ? raw.exchange.filter((f) => typeof f === "string") : []
  return {
    number: fields.includes("Number"),
    name: fields.some((field) => field.startsWith("Name")),
  }
}

function optionsOf(raw) {
  const o = raw.options && typeof raw.options === "object" ? raw.options : {}
  // `countiesCountForInState` and `countiesAreMultForInState` are one rule
  // under two names, read ANDed, and both default TRUE — the ordinary case is
  // that counties are multipliers. Collapsed here so a party file states it
  // once and cannot half-say it.
  const countiesAreMultipliersInParty =
    o.countiesCountForInState !== false && o.countiesAreMultForInState !== false
  return {
    entity: str(o.entity)?.toUpperCase() === "VE" ? "VE" : "K",
    countyLine: bool(o.countyLine),
    dcCountsAsMaryland: bool(o.dcCountsAsMaryland),
    sectionsForOutOfState: bool(o.sectionsForOutOfState),
    stateCountsForInState: bool(o.stateCountsForInState),
    countiesAreMultipliersInParty,
    alaskaAndHawaiiAreDX: bool(o.alaskaAndHawaiiAreDX),
    selfCountsForCounty: bool(o.selfCountsForCounty),
    selfMobileCountsForCounty: bool(o.selfMobileCountsForCounty),
    dxIsMultiplier: bool(o.dxIsMultiplier),
    dxEntityIsMultiplier: bool(o.dxEntityIsMultiplier),
    dxEntityMultiplierMax: num(o.dxEntityMultiplierMax),
    inStateMultiplierMax: num(o.inStateMultiplierMax),
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
    // Only an explicit `false` forbids: a file that says nothing, or `true`,
    // leaves self-spotting to the operator.
    selfSpottingForbidden: o.selfSpotting === false,
    pointsWhenTheyAreOutOfParty: num(o.pointsWhenTheyAreOutOfParty),
    removeCountySuffixes: bool(o.removeCountySuffixes),
    labelForCounties: str(o.labelForCounties),
  }
}

function bonusOf(raw) {
  const b = raw.bonus && typeof raw.bonus === "object" ? raw.bonus : {}
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

/// The periods a sponsor publishes, soonest first. A party running Saturday and
/// Sunday sessions publishes two; one range spanning the gap would claim the
/// overnight hours nobody scores.
function periodsOf(raw) {
  const periods = []
  const push = (start, end) => {
    const startMillis = parsePartyTime(start)
    const endMillis = parsePartyTime(end)
    // Both ends or neither: a period with one date is a range with no length,
    // and the engine reads an empty list as "no dates" rather than as 1970.
    if (startMillis > 0 && endMillis > 0) {
      periods.push({ startMillis, endMillis, from: str(start), to: str(end) })
    }
  }
  push(raw.start, raw.end)
  push(raw.secondStart, raw.secondEnd)
  return periods
}

// ------------------------------------------------------------------- emitting

function jsonFile(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function quote(value) {
  return JSON.stringify(value)
}

/// An object literal, one entry per line, in the order given.
function objectLines(entries, indent) {
  const pad = " ".repeat(indent)
  return entries.map(([key, value]) => `${pad}${/^[A-Za-z_$][\w$]*$/.test(key) ? key : quote(key)}: ${value},`)
}

function emitParty(raw, key) {
  const name = str(raw.name) ?? key
  const short = shortFor(raw, key)
  const counties = mapOf(raw.counties)
  const otherCounties = mapOf(raw.otherQPCounties)
  const countyStates = Object.fromEntries(
    Object.entries(mapOf(raw.countyToState)).map(([county, state]) => [county, state.toUpperCase()]),
  )
  const options = optionsOf(raw)
  const bonus = bonusOf(raw)
  const periods = periodsOf(raw)
  const points = pointsByModeOf(raw)
  const bonusStations = numbersOf(raw.bonusStations)
  const rareCountyMultipliers = numbersOf(raw.rareCountyQSOMultiplier)
  const countySections = countySectionsOf(raw.countySections, counties, key)
  const powerMultipliers = powerMultipliersOf(raw)
  const entryClasses = entryClassesOf(raw)
  const exchange = exchangeOf(raw)

  if (Object.keys(counties).length === 0) {
    throw new Error(`${key}: no counties — a party with no county list has no exchange to check`)
  }
  if (periods.length === 0) throw new Error(`${key}: no operating period parses`)

  const slug = key.toLowerCase()
  const imports = [`import counties from "./${slug}.counties.json" with { type: "json" }`]
  jsonFile(join(PARTIES_DIR, `${slug}.counties.json`), counties)
  if (Object.keys(otherCounties).length > 0) {
    imports.push(`import otherCounties from "./${slug}.other-counties.json" with { type: "json" }`)
    jsonFile(join(PARTIES_DIR, `${slug}.other-counties.json`), otherCounties)
  }
  if (Object.keys(countyStates).length > 0) {
    imports.push(`import countyStates from "./${slug}.county-states.json" with { type: "json" }`)
    jsonFile(join(PARTIES_DIR, `${slug}.county-states.json`), countyStates)
  }
  if (Object.keys(countySections).length > 0) {
    imports.push(`import countySections from "./${slug}.county-sections.json" with { type: "json" }`)
    jsonFile(join(PARTIES_DIR, `${slug}.county-sections.json`), countySections)
  }

  const lines = []
  lines.push(...HEADER)
  lines.push("//")
  const note = DIVERGENCE_NOTES[key]
  if (note) {
    for (const line of note) lines.push(`// ${line}`)
    lines.push("//")
  }
  lines.push(`// GENERATED — \`node scripts/convert-parties.mjs\` writes this from`)
  lines.push(`// \`fixtures/${slug}.json\`. Edit the fixture and re-run; an edit here is lost`)
  lines.push(`// on the next re-sync.`)
  lines.push("")
  lines.push(`import type { QsoPartyParams } from "@ham2k/lib-qso-party"`)
  lines.push("")
  lines.push(...imports)
  lines.push("")
  if (Object.keys(countyStates).length > 0) {
    lines.push(`/// A county's own state, for a party spanning several: its codes carry no`)
    lines.push(`/// state prefix for the ordinary rule to read.`)
    lines.push(`const COUNTY_STATES: Record<string, string> = countyStates`)
    lines.push("")
  }
  lines.push(`export const PARTY: QsoPartyParams = {`)

  lines.push(...objectLines([
    ["refType", quote(refTypeFor(raw, short))],
    ["name", quote(name)],
    ["short", quote(short)],
  ], 2))

  // What this party answers for besides its own type. The bundled extension
  // filed every party under one `qp` type and told them apart by this party's
  // own KEY — `{type: 'qp', ref: 'NY'}` — and the operations logged then are
  // not migrated, so the party reaches back for them instead.
  //
  // The key is the code, lower-cased and matched as a prefix: Nebraska is `NE`
  // and New England `NEQP`, so `NEQP` matches both claims. The kernel lets the
  // longer one decide, but a party's own engine sees only its own claim
  // (`partyRefIn`), so Nebraska's would answer for every New England log — its
  // scorer, its exports and its ADIF fields. Nebraska therefore claims none:
  // its own old logs go unanswered, and New England's are the more numerous.
  if (key === "NE") {
    lines.push(`  // No \`legacyRefs\`: \`ne\` is a prefix of New England's \`neqp\` — see`)
    lines.push(`  // scripts/convert-parties.mjs.`)
  } else {
    lines.push(`  // The bundled extension's own pair for this party, which nothing rewrites.`)
    lines.push(`  legacyRefs: [{ type: "qp", prefix: ${quote(key.toLowerCase())} }],`)
  }

  // `state` answers what the bundled version's party KEY answered: the state a
  // county belongs to when its own abbreviation does not say. A party whose key
  // IS a state carries it; the four spanning several do NOT — none of their
  // states outranks the others, and naming one would put every county that
  // reached the fallback in a state the sponsor never claimed. They name what
  // they span instead, derived from their own counties.
  const identity = []
  const states = /^[A-Z]{2}$/.test(key) ? [key] : statesOf(counties, countyStates, key)
  if (/^[A-Z]{2}$/.test(key)) {
    identity.push(["state", quote(key)])
  } else {
    lines.push(`  // Several states, no one of them this party's own. Every county below names`)
    lines.push(`  // its state, in its abbreviation or in the table, and \`states\` is the list`)
    lines.push(`  // each of those has to fall in — a check on the county data, and nothing a`)
    lines.push(`  // score reads.`)
    identity.push(["states", `[${states.map(quote).join(", ")}]`])
  }
  const cabrilloName = str(raw.cabrilloName)
  if (cabrilloName) identity.push(["cabrilloName", quote(cabrilloName)])
  const url = sanitizeUrl(raw.url)
  if (url) identity.push(["url", quote(url)])
  const status = str(raw.status)
  if (status) identity.push(["status", quote(status)])
  const lastUpdated = str(raw.lastUpdated)
  if (lastUpdated) identity.push(["lastUpdated", quote(lastUpdated)])
  lines.push(...objectLines(identity, 2))

  lines.push(`  periods: [`)
  for (const period of periods) {
    lines.push(`    // ${period.from} — ${period.to}`)
    lines.push(`    { startMillis: ${period.startMillis}, endMillis: ${period.endMillis} },`)
  }
  lines.push(`  ],`)

  const rules = []
  if (options.entity !== "K") rules.push(["entity", quote(options.entity)])
  for (const flag of [
    "countyLine", "dcCountsAsMaryland", "sectionsForOutOfState", "stateCountsForInState", "alaskaAndHawaiiAreDX",
    "selfCountsForCounty", "selfMobileCountsForCounty", "dxIsMultiplier", "dxEntityIsMultiplier",
    "dxLocationIsPrefix", "multsPerBandMode", "multsPerBand", "multsPerMode", "inStateMultsPerBand",
    "outOfStateMultsPerBand", "bonusPerBandMode", "bonusPerMode", "bonusPostMultiplier",
    "inStateToOutOfStatePointsDouble", "dataAndCWCountAsSameMode", "removeCountySuffixes",
  ]) {
    if (options[flag]) rules.push([flag, "true"])
  }
  // Stated only when it is false, which is the whole of what it says: the
  // default is that counties multiply.
  if (!options.countiesAreMultipliersInParty) rules.push(["countiesAreMultipliersInParty", "false"])
  if (options.selfSpottingForbidden) rules.push(["selfSpotting", "false"])
  for (const value of [
    "dxEntityMultiplierMax", "inStateMultiplierMax", "bonusStationInStateMult", "bonusStationOutOfStateMult",
    "pointsWhenTheyAreOutOfParty",
  ]) {
    if (options[value] !== undefined) rules.push([value, String(options[value])])
  }
  if (options.labelForCounties !== undefined) rules.push(["labelForCounties", quote(options.labelForCounties)])
  lines.push(...objectLines(rules, 2))

  const defaultBonus = bonusOf({})
  const bonusEntries = Object.entries(bonus).filter(([field, value]) => value !== defaultBonus[field])
  if (bonusEntries.length > 0) {
    lines.push(`  bonus: {`)
    lines.push(...objectLines(bonusEntries.map(([f, v]) => [f, String(v)]), 4))
    lines.push(`  },`)
  }

  const tables = []
  if (Object.keys(points).length > 0) {
    // A rate the sponsor publishes that no super-mode names — `SAT`, `_QRP_`,
    // `_Rover_` — prices nothing: the engine looks a contact's own super-mode
    // up here. Carried anyway, so this file stays the whole of what the sponsor
    // says and a later rule has something to read.
    const exotic = Object.keys(points).filter((mode) => !SUPER_MODES.includes(mode))
    if (exotic.length > 0) {
      const names = exotic.map((mode) => "`" + mode + "`").join(" and ")
      const them = exotic.length > 1 ? "them" : "it"
      const name = exotic.length > 1 ? "name" : "names"
      lines.push(`  // ${names} ${name} no super-mode, so nothing prices a contact with`)
      lines.push(`  // ${them}; carried because the sponsor publishes ${them}.`)
    }
    tables.push(["pointsByMode", inlineNumbers(points)])
  }
  if (Object.keys(bonusStations).length > 0) tables.push(["bonusStations", inlineNumbers(bonusStations)])
  if (Object.keys(rareCountyMultipliers).length > 0) {
    tables.push(["rareCountyMultipliers", inlineNumbers(rareCountyMultipliers)])
  }
  if (Object.keys(powerMultipliers).length > 0) {
    tables.push(["powerMultipliers", inlineNumbers(powerMultipliers)])
  }
  if (exchange.number || exchange.name) {
    const fields = []
    if (exchange.number) fields.push("number: true")
    if (exchange.name) fields.push("name: true")
    tables.push(["exchange", `{ ${fields.join(", ")} }`])
  }
  lines.push(...objectLines(tables, 2))

  const classes = Object.entries(entryClasses)
    .filter(([, value]) => (Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0))
  if (classes.length > 0) {
    lines.push(`  entryClasses: {`)
    for (const [axis, value] of classes) {
      if (Array.isArray(value)) {
        lines.push(`    ${axis}: [${value.map(quote).join(", ")}],`)
      } else {
        lines.push(`    ${axis}: { ${Object.entries(value).map(([k, v]) => `${k}: ${quote(v)}`).join(", ")} },`)
      }
    }
    lines.push(`  },`)
  }

  lines.push(`  counties,`)
  if (Object.keys(otherCounties).length > 0) lines.push(`  otherCounties,`)
  if (Object.keys(countySections).length > 0) lines.push(`  countySections,`)
  if (ADIF_COUNTIES[key]) {
    lines.push(`  // From scripts/convert-parties.mjs, which polo's files do not carry.`)
    lines.push(`  adifCounties: {`)
    for (const [code, county] of Object.entries(ADIF_COUNTIES[key])) lines.push(`    ${code}: ${quote(county)},`)
    lines.push(`  },`)
  }
  if (Object.keys(countyStates).length > 0) {
    lines.push(`  stateOfCounty: (county) => COUNTY_STATES[county.toUpperCase()],`)
  }
  lines.push(`}`)
  lines.push("")

  writeFileSync(join(PARTIES_DIR, `${slug}.ts`), lines.join("\n"))
  return {
    key, slug, name, short, refType: refTypeFor(raw, short),
    identity: identityOf(raw, key, short, states, options, periods),
  }
}

/// What the spotting services know a party by — see `src/identity.ts`. The
/// APRS token is the sponsor's own where one is stated (`aprsShort`), because
/// two parties can share a short and the tracker files by this token; the
/// tracker's path is that same token for a party spanning states and the
/// state itself otherwise, and the tracker carries no Canadian party at all.
/// The hub pages are the party's short, lower-cased, unless the hub names them
/// otherwise (`HUB_PAGES`) or several parties share one weekend and one page
/// (`qsoPartyHubName`).
function identityOf(raw, key, short, states, options, periods) {
  const aprsShort = str(raw.aprsShort) ?? short
  return {
    refType: refTypeFor(raw, short),
    legacyPrefix: key.toLowerCase(),
    name: str(raw.name) ?? key,
    short,
    states,
    aprsShort,
    trackerCode: str(raw.aprsShort) ?? (options.entity === "K" ? key : undefined),
    hubTablePage: HUB_PAGES[key]?.table ?? str(raw.qsoPartyHubName) ?? short.toLowerCase(),
    hubSpotPage: HUB_PAGES[key]?.spot ?? str(raw.qsoPartyHubName) ?? short.toLowerCase(),
    periods: periods.map(({ startMillis, endMillis }) => ({ startMillis, endMillis })),
  }
}

function inlineNumbers(table) {
  const entries = Object.entries(table)
    .map(([code, value]) => `${/^[A-Za-z_$][\w$]*$/.test(code) ? code : quote(code)}: ${value}`)
  const oneLine = `{ ${entries.join(", ")} }`
  if (oneLine.length <= 80) return oneLine
  return `{\n${entries.map((entry) => `    ${entry},`).join("\n")}\n  }`
}

function emitIndex(parties) {
  const lines = [...HEADER]
  lines.push("//")
  lines.push("// Every party this package carries, keyed by the code the bundled version used")
  lines.push("// to name one — which is also the fixture's own name, and so the column a")
  lines.push("// re-sync joins on.")
  lines.push("//")
  lines.push("// An extension imports the one party it IS — `@ham2k/qso-parties/tx`. This map")
  lines.push("// is for the tools and tests that need all fifty, and pulls every county table")
  lines.push("// in with it.")
  lines.push("//")
  lines.push("// GENERATED — `node scripts/convert-parties.mjs` writes this file.")
  lines.push("")
  lines.push(`import type { QsoPartyParams } from "@ham2k/lib-qso-party"`)
  lines.push("")
  for (const party of parties) {
    lines.push(`import { PARTY as ${identifierFor(party.key)} } from "./parties/${party.slug}.ts"`)
  }
  lines.push("")
  lines.push(`export const PARTIES: Record<string, QsoPartyParams> = {`)
  for (const party of parties) {
    lines.push(`  ${quote(party.key)}: ${identifierFor(party.key)},`)
  }
  lines.push(`}`)
  lines.push("")
  writeFileSync(join(PACKAGE_DIR, "src", "index.ts"), lines.join("\n"))
}

function emitIdentities(parties) {
  const lines = [...HEADER]
  lines.push("//")
  lines.push("// Every party as the spotting services know it — see `identity.ts`. A few")
  lines.push("// kilobytes for all fifty, where `index.ts` carries every county table.")
  lines.push("//")
  lines.push("// GENERATED — `node scripts/convert-parties.mjs` writes this file.")
  lines.push("")
  lines.push(`import type { QsoPartyIdentity } from "./identity.ts"`)
  lines.push("")
  lines.push(`export const PARTY_IDENTITIES: QsoPartyIdentity[] = [`)
  for (const party of parties) {
    const { identity } = party
    const fields = [
      ["refType", quote(identity.refType)],
      ["legacyPrefix", quote(identity.legacyPrefix)],
      ["name", quote(identity.name)],
      ["short", quote(identity.short)],
      ["states", `[${identity.states.map(quote).join(", ")}]`],
      ["aprsShort", quote(identity.aprsShort)],
    ]
    if (identity.trackerCode) fields.push(["trackerCode", quote(identity.trackerCode)])
    fields.push(["hubTablePage", quote(identity.hubTablePage)])
    fields.push(["hubSpotPage", quote(identity.hubSpotPage)])
    const periods = identity.periods.map((p) => `{ startMillis: ${p.startMillis}, endMillis: ${p.endMillis} }`)
    fields.push(["periods", `[${periods.join(", ")}]`])
    lines.push(`  {`)
    lines.push(...objectLines(fields, 4))
    lines.push(`  },`)
  }
  lines.push(`]`)
  lines.push("")
  writeFileSync(join(PACKAGE_DIR, "src", "identities.ts"), lines.join("\n"))
}

/// A local name for a party's module. Prefixed, because `7QP` cannot start a
/// JavaScript identifier and `IN` is a reserved word.
function identifierFor(key) {
  return `PARTY_${key}`
}

// ---------------------------------------------------------------------- main

const from = process.argv[2]
if (from) {
  const source = resolve(from)
  const files = readdirSync(source).filter((file) => file.endsWith(".json"))
  if (files.length === 0) throw new Error(`${source}: no party files`)
  for (const file of files) copyFileSync(join(source, file), join(FIXTURES_DIR, file))
  console.log(`copied ${files.length} party files from ${source}`)
}

mkdirSync(PARTIES_DIR, { recursive: true })
const parties = []
for (const file of readdirSync(FIXTURES_DIR).filter((name) => name.endsWith(".json")).sort()) {
  const raw = JSON.parse(readFileSync(join(FIXTURES_DIR, file), "utf8"))
  const key = (str(raw.key) ?? "").toUpperCase()
  if (!key) throw new Error(`${file}: no key`)
  if (key.toLowerCase() !== basename(file, ".json")) {
    throw new Error(`${file}: names party ${key}, and the two have to match to be joined on`)
  }
  parties.push(emitParty(raw, key))
}

const refTypes = new Set(parties.map((party) => party.refType))
if (refTypes.size !== parties.length) throw new Error("two parties share a ref type")

// A party the sponsor retires leaves its module and county table behind, and
// the regenerated index stops naming them — so nothing, the tests included,
// ever looks at them again while they sit in the tree looking current.
const wanted = new Set(parties.flatMap((party) => [
  `${party.slug}.ts`,
  `${party.slug}.counties.json`,
  `${party.slug}.other-counties.json`,
  `${party.slug}.county-states.json`,
  `${party.slug}.county-sections.json`,
]))
for (const file of readdirSync(PARTIES_DIR)) {
  if (!wanted.has(file)) {
    rmSync(join(PARTIES_DIR, file))
    console.log(`removed ${file}, which no party file claims`)
  }
}

emitIndex(parties)
emitIdentities(parties)
console.log(`wrote ${parties.length} parties to ${PARTIES_DIR}`)
