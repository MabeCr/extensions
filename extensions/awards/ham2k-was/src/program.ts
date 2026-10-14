// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// ARRL's Worked All States as a chasing program (the app's
// docs/design/claims.md): every contact with a US state claims it for Mixed,
// on its band, and in its mode, for the station call worked from one place.

import { parseCallsign } from "@ham2k/lib-callsigns"
import { fmtInteger } from "@ham2k/lib-format-tools"
import { locationToGrid4 } from "@ham2k/lib-geo-tools"
import { ADIF_MODES_AND_SUBMODES, superModeForMode } from "@ham2k/lib-operation-data"
import { entityForCall } from "@ham2k/extension-sdk"
import type { ChasingHook, ClaimSlot, ClaimsTally, HookContext, JSONValue, QsoClaim } from "@ham2k/extension-sdk"

import { tFor } from "./i18n.ts"

/// The credits key is the program's key, which is the extension's.
export const PROGRAM_KEY = "ham2k-was"

export const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky",
  LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
}

/// The DXCC entities a state is in: the lower 48, Alaska and Hawaii. The
/// last two are a state each, whatever a contact's `state` says.
const USA = 291
const STATE_FOR_ENTITY: Record<number, string> = { 6: "AK", 110: "HI" }

/// ARRL counts the District of Columbia for Maryland.
const STATE_ALIASES: Record<string, string> = { DC: "MD" }

/// WAS's mode awards: the three groups, and two endorsements of their own
/// that a contact claims beside its group. `superModeForMode` answers `DATA`
/// for anything it does not recognize, so a mode is checked against ADIF's
/// list before it is grouped at all.
const KNOWN_MODES = new Set(ADIF_MODES_AND_SUBMODES.map((mode) => mode.toUpperCase()))
const AWARD_MODES: Record<string, string> = { CW: "CW", PHONE: "PHONE", DATA: "DIGITAL" }
const ENDORSED_MODES = new Set(["FT8", "RTTY"])

function awardModesOf(mode: unknown): string[] {
  if (typeof mode !== "string" || !KNOWN_MODES.has(mode.toUpperCase())) return []
  const upper = mode.toUpperCase()
  const group = AWARD_MODES[superModeForMode(upper)]
  return [...(group ? [group] : []), ...(ENDORSED_MODES.has(upper) ? [upper] : [])]
}

function obj(value: JSONValue | undefined): Record<string, JSONValue> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {}
}

function str(value: JSONValue | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function num(value: JSONValue | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

/// The 4-character grid a side was in: its coordinate when it has one, which
/// outranks its grid (the app's docs/design/locations.md), else its grid.
/// A coordinate that makes no square (out of range) falls back to the grid.
function grid4Of(side: Record<string, JSONValue>): string | undefined {
  const lat = num(side.lat)
  const lon = num(side.lon)
  const square = (grid: string | undefined) => {
    const four = grid?.slice(0, 4).toUpperCase()
    return four && /^[A-R]{2}[0-9]{2}$/.test(four) ? four : undefined
  }
  return (lat != null && lon != null ? square(locationToGrid4(lat, lon)) : undefined) ?? square(str(side.grid))
}

/// ARRL counts contacts made within 50 miles of one place: a 4-character
/// grid stands in for that place. KI2D and KI2D/P share a checklist from
/// one square and keep their own from two; a side that says nothing about
/// where it was claims under the bare call.
function holderFor(side: Record<string, JSONValue>): string | undefined {
  const call = str(side.call)?.toUpperCase()
  if (!call) return undefined
  const base = parseCallsign(call).baseCall || call
  const grid = grid4Of(side)
  return grid ? `${base}@${grid}` : base
}

function storedCode(side: Record<string, JSONValue>): number | undefined {
  return typeof side.dxccCode === "number" ? side.dxccCode : undefined
}

/// The state a contact's station was in, and whether it is a guess. Its
/// entity comes first: the one the contact records, else the lookup's, else
/// the callsign's, and only the three US entities have states. Alaska and
/// Hawaii are their entity. In the lower 48 the contact's own `state`
/// outranks the lookup's guess, which is a guess: a station away from home
/// is wrong there.
function theirState(their: Record<string, JSONValue>, call: string): { state: string; guess?: boolean } | undefined {
  const guessed = obj(their.guess)
  const fromCall = entityForCall(call).dxccCode
  const stored = storedCode(their)
  const entity = stored ?? storedCode(guessed) ?? fromCall
  const entityGuessed = stored == null && entity !== fromCall
  if (entity != null && STATE_FOR_ENTITY[entity]) return { state: STATE_FOR_ENTITY[entity], ...(entityGuessed ? { guess: true } : {}) }
  if (entity != null && entity !== USA) return undefined

  const own = str(their.state)?.toUpperCase()
  const code = own ?? str(guessed.state)?.toUpperCase()
  if (!code) return undefined
  const state = STATE_ALIASES[code] ?? code
  if (!STATE_NAMES[state]) return undefined
  return own == null || entityGuessed ? { state, guess: true } : { state }
}

/// The ADIF award WAS credits each kind of slot under: Mixed, a band, a mode.
type SlotKind = "WAS" | "WAS_BAND" | "WAS_MODE"

/// WAS credit is verified; a LoTW or paper confirmation is confirmed, as ARRL
/// accepts both. A credit that lists its `awards` verifies only the slots it
/// names; one that lists none verifies all of them.
function levelOf(qso: Record<string, JSONValue>, kind: SlotKind): Pick<QsoClaim, "level" | "by"> {
  const credit = obj(obj(qso.credits)[PROGRAM_KEY])
  const awards = Array.isArray(credit.awards) ? credit.awards : undefined
  if (credit.level === "verified" && (awards == null || awards.includes(kind))) {
    return { level: "verified", ...(typeof credit.by === "string" ? { by: credit.by } : {}) }
  }
  const qsl = obj(qso.qsl)
  if (obj(qsl.lotw).received === true) return { level: "confirmed", by: "lotw" }
  if (obj(qsl.qsl).received === true) return { level: "confirmed", by: "qsl" }
  return { level: "worked" }
}

export function claimsForQso(qso: Record<string, JSONValue>): QsoClaim[] {
  // An event marker carries placeholder calls (`EVENT`, `START`) that resolve
  // to real entities.
  if (qso.band === "event" || qso.deleted === true) return []
  const their = obj(qso.their)
  const theirCall = str(their.call)
  const holder = holderFor(obj(qso.our))
  if (!theirCall || !holder) return []
  const found = theirState(their, theirCall.toUpperCase())
  if (!found) return []

  const base = { holder, ref: found.state, label: STATE_NAMES[found.state], ...(found.guess ? { guess: true } : {}) }
  const claims: QsoClaim[] = [{ ...base, band: null, mode: null, ...levelOf(qso, "WAS") }]
  const band = str(qso.band)
  if (band) claims.push({ ...base, band, mode: null, ...levelOf(qso, "WAS_BAND") })
  for (const mode of awardModesOf(qso.mode)) claims.push({ ...base, band: null, mode, ...levelOf(qso, "WAS_MODE") })
  return claims
}

function summarizeClaims({ slots }: { slots: ClaimSlot[] }, ctx: Pick<HookContext, "locale">): Record<string, ClaimsTally> {
  const t = tFor(ctx)
  const mixed = slots.filter((slot) => slot.band === null && slot.mode === null)
  const confirmed = mixed.filter((slot) => slot.level !== "worked").length
  const count = mixed.length
  return {
    states: {
      key: "states",
      icon: "map",
      label: count === 1 ? t("oneState") : t("manyStates", { formatted: fmtInteger(count) }),
      summary: t("confirmed", { formatted: fmtInteger(confirmed) }),
      total: count,
    },
  }
}

export const wasProgram: ChasingHook = {
  program: { label: "WAS", refLabel: "State", icon: "map", color: "#1f5fa8", version: 1, editions: "lifetime", supersedes: ["newState"] },
  // A contact without a uuid has no key to answer under, and is left out.
  claimsForQsos: ({ qsos }) =>
    Object.fromEntries(qsos.filter((qso) => typeof qso.uuid === "string" && qso.uuid).map((qso) => [qso.uuid as string, claimsForQso(qso)])),
  holdersFor: ({ station }) => {
    const holder = holderFor(station)
    return holder ? [holder] : []
  },
  summarizeClaims,
}
