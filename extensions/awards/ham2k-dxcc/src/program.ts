// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// ARRL's DXCC as a chasing program (the app's docs/design/claims.md): every
// contact with a resolvable entity claims it three ways — Mixed (any band,
// any mode), in its mode group, and on its band — for the station call
// worked FROM that entity. A missing Mixed slot is an all-time new one
// ("DXCC ATNO"), a missing mode slot a new mode ("DXCC in CW"), a missing
// band slot a new band ("DXCC in 80m"). The DXCC Challenge is no checklist
// of its own: it is the band slots, summed.
//
// Credit is read from `credits.dxcc`: that key is log data, written by the
// ADIF import from CREDIT_GRANTED, and never follows the program's key.

import { parseCallsign } from "@ham2k/lib-callsigns"
import { DXCC_BY_CODE } from "@ham2k/lib-dxcc-data"
import { fmtInteger } from "@ham2k/lib-format-tools"
import { ADIF_MODES_AND_SUBMODES, superModeForMode } from "@ham2k/lib-operation-data"
import { entityForCall } from "@ham2k/extension-sdk"
import type { ChasingHook, ClaimSlot, ClaimsTally, HookContext, JSONValue, QsoClaim } from "@ham2k/extension-sdk"

import { catalogs, tFor } from "./i18n.ts"
import type { ChaseNoticeLabels, ChasingProgramWithNotices } from "./sdkGap.ts"

/// The key DXCC credit is stored under on a contact (`qso.credits.dxcc`).
const CREDITS_KEY = "dxcc"

/// The three DXCC mode awards, by super mode. `superModeForMode` answers
/// `DATA` for anything it does not recognize — an empty mode, an imported
/// `OTHER` — so a mode is checked against ADIF's list before it is grouped.
const KNOWN_MODES = new Set(ADIF_MODES_AND_SUBMODES.map((mode) => mode.toUpperCase()))
const AWARD_MODES: Record<string, string> = { CW: "CW", PHONE: "PHONE", DATA: "DIGITAL" }

function awardModeOf(mode: unknown): string | undefined {
  if (typeof mode !== "string" || !KNOWN_MODES.has(mode.toUpperCase())) return undefined
  return AWARD_MODES[superModeForMode(mode.toUpperCase())]
}

/// The DXCC Challenge counts 160 through 6 meters, except 60. Every band
/// claims its slot; only these add to the Challenge.
export const CHALLENGE_BANDS = new Set(["160m", "80m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m"])

/// A deleted entity still claims — an old contact earned it — and counts
/// toward All, but not toward Current.
function isCurrent(ref: string): boolean {
  return DXCC_BY_CODE[Number(ref)]?.deleted !== true
}

function obj(value: JSONValue | undefined): Record<string, JSONValue> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {}
}

/// ADIF's DXCC code 0 is "no entity": maritime and aeronautical mobile.
const NO_ENTITY = 0

function storedCode(side: Record<string, JSONValue>): number | undefined {
  return typeof side.dxccCode === "number" ? side.dxccCode : undefined
}

/// A station at sea or in the air is in no entity, whatever its call's
/// prefix says: W1AW/MM resolves to the US. The suffix may carry an ITU
/// region (`/MM2`) or be followed by another (`/MM/R1`).
const MOBILE_IN_NO_ENTITY = /\/(MM|AM)\d?(\/|$)/i

/// Resolves a call's entity; a batch shares a cache of it, since its
/// contacts are nearly always made from one call, and a log repeats calls.
/// Callers rule out a side in no entity first (`inNoEntity`).
type EntityOf = (call: string) => number | undefined

function entityResolver(): EntityOf {
  const entities = new Map<string, number | undefined>()
  return (call) => {
    if (!entities.has(call)) entities.set(call, entityForCall(call).dxccCode)
    return entities.get(call)
  }
}

/// An award goes to a call, for contacts made from one entity: KI2D and
/// KI2D/P share a checklist, KI2D/VE2 has its own. A call whose entity does
/// not resolve still claims, under the bare call. The same holders as the
/// app's core `dxcc` program, so a station's checklist, rebuilt here from
/// its log, is the same one.
function holderFor(call: string, dxccCode: number | undefined): string {
  const trimmed = call.trim().toUpperCase()
  const base = parseCallsign(trimmed).baseCall || trimmed
  return dxccCode == null ? base : `${base}@${dxccCode}`
}

/// Whether a side was in no entity at all, so its contacts count for none.
function inNoEntity(side: Record<string, JSONValue>, call: string): boolean {
  return storedCode(side) === NO_ENTITY || MOBILE_IN_NO_ENTITY.test(call.trim())
}

/// The entity a contact records outranks the one its callsign resolves to:
/// an ADIF import writes `dxccCode` on both sides, and a log made from Hawaii
/// under a mainland call says 110 where the callsign says 291. A lookup's
/// guess comes next; the callsign is the fallback, and it settles an entity
/// outright, so a claim resolved from it is not a guess. One resolved from a
/// lookup is, unless the callsign says the same: nearly every lookup only
/// repeats it, and a guess there would read "probably new" on every call.
function theirEntity(their: Record<string, JSONValue>, call: string, entityOf: EntityOf): { dxccCode?: number; guess?: boolean } {
  if (inNoEntity(their, call)) return {}
  const stored = storedCode(their)
  const code = stored ?? storedCode(obj(their.guess))
  if (code == null || code === NO_ENTITY) return { dxccCode: entityOf(call) }
  return { dxccCode: code, ...(stored == null && code !== entityOf(call) ? { guess: true } : {}) }
}

/// The ADIF award DXCC credits each kind of slot under: Mixed, a band, a
/// mode. ADIF has no award of the Challenge's own; ARRL builds it from the
/// band credits.
type SlotKind = "DXCC" | "DXCC_BAND" | "DXCC_MODE"

/// DXCC credit is verified; a LoTW or paper confirmation is confirmed. eQSL,
/// QRZ and Club Log confirmations do not count for DXCC. A credit that lists
/// its `awards` verifies only the slots it names; one that lists none
/// verifies all of them.
function levelOf(qso: Record<string, JSONValue>, kind: SlotKind): Pick<QsoClaim, "level" | "by"> {
  const credit = obj(obj(qso.credits)[CREDITS_KEY])
  const awards = Array.isArray(credit.awards) ? credit.awards : undefined
  if (credit.level === "verified" && (awards == null || awards.includes(kind))) {
    return { level: "verified", ...(typeof credit.by === "string" ? { by: credit.by } : {}) }
  }
  const qsl = obj(qso.qsl)
  if (obj(qsl.lotw).received === true) return { level: "confirmed", by: "lotw" }
  if (obj(qsl.qsl).received === true) return { level: "confirmed", by: "qsl" }
  return { level: "worked" }
}

/// A contact on a satellite counts for Mixed and its mode, and for no band:
/// ARRL credits it to Satellite DXCC instead.
function viaSatellite(qso: Record<string, JSONValue>): boolean {
  return Array.isArray(qso.refs) && qso.refs.some((ref) => obj(ref).type === "satellite")
}

function claimsForQso(qso: Record<string, JSONValue>, entityOf: EntityOf): QsoClaim[] {
  // An event marker carries placeholder calls (`EVENT`, `START`) that resolve
  // to real entities.
  if (qso.band === "event" || qso.deleted === true) return []
  const their = obj(qso.their)
  const our = obj(qso.our)
  if (typeof their.call !== "string" || !their.call || typeof our.call !== "string" || !our.call) return []
  if (inNoEntity(our, our.call)) return []
  const { dxccCode, guess } = theirEntity(their, their.call, entityOf)
  if (dxccCode == null) return []

  // One name per entity, whichever way it was resolved, so a checklist line
  // reads the same from every contact that could hold it.
  const label = DXCC_BY_CODE[dxccCode]?.name
  const holder = holderFor(our.call, storedCode(our) ?? entityOf(our.call))
  const base = { holder, ref: String(dxccCode), ...(label ? { label } : {}), ...(guess ? { guess } : {}) }
  const claims: QsoClaim[] = [{ ...base, band: null, mode: null, ...levelOf(qso, "DXCC") }]
  const mode = awardModeOf(qso.mode)
  if (mode) claims.push({ ...base, band: null, mode, ...levelOf(qso, "DXCC_MODE") })
  // One slot per band however a log spelled it: an import may say `20M`.
  const band = typeof qso.band === "string" ? qso.band.trim().toLowerCase() : ""
  if (band && !viaSatellite(qso)) claims.push({ ...base, band, mode: null, ...levelOf(qso, "DXCC_BAND") })
  return claims
}

/// Contacts without a uuid have no key to answer under, and are left out.
function claimsForQsos({ qsos }: { qsos: Record<string, JSONValue>[] }): Record<string, QsoClaim[]> {
  const entityOf = entityResolver()
  return Object.fromEntries(qsos.filter((qso) => typeof qso.uuid === "string" && qso.uuid).map((qso) => [qso.uuid as string, claimsForQso(qso, entityOf)]))
}

/// One tally, as Current and All: ARRL's standings list both, the current
/// entities and every one ever credited, deleted entities too.
function tally(key: string, icon: string, counted: ClaimSlot[], t: ReturnType<typeof tFor>): ClaimsTally {
  const count = (slots: ClaimSlot[]) => fmtInteger(slots.length)
  const current = counted.filter((slot) => isCurrent(slot.ref))
  const confirmed = (slots: ClaimSlot[]) => slots.filter((slot) => slot.level !== "worked")
  return {
    key,
    icon,
    label: t(`${key}Totals`, { current: count(current), all: count(counted) }),
    summary: t("confirmedTotals", { current: count(confirmed(current)), all: count(confirmed(counted)) }),
    total: counted.length,
    current: current.length,
  }
}

/// Entities count once, from their Mixed slot: a mode or band slot is the
/// same entity again. The Challenge counts every band slot on its bands.
function summarizeClaims({ slots }: { slots: ClaimSlot[] }, ctx: Pick<HookContext, "locale">): Record<string, ClaimsTally> {
  const t = tFor(ctx)
  return {
    entities: tally("entities", "earth", slots.filter((slot) => slot.band === null && slot.mode === null), t),
    challenge: tally("challenge", "trophy", slots.filter((slot) => slot.band !== null && CHALLENGE_BANDS.has(slot.band)), t),
  }
}

/// A notice's words, from a locale's catalog (./i18n/<locale>.json), so a
/// translator finds them beside the extension's other strings.
function noticeLabels(catalog: Record<string, string>): ChaseNoticeLabels {
  return {
    notices: { newRef: catalog.noticeNewRef, newMode: catalog.noticeNewMode, newBand: catalog.noticeNewBand },
    modeLabels: Object.fromEntries(Object.values(AWARD_MODES).map((mode) => [mode, catalog[`mode${mode}`]])),
  }
}

const program: ChasingProgramWithNotices = {
  label: "DXCC",
  icon: "earth",
  color: "#2e7d32",
  version: 1,
  editions: "lifetime",
  // Core scoring's new-entity notice, which the verdicts stand in for.
  supersedes: ["newDXCC"],
  ...noticeLabels(catalogs.en),
  translations: Object.fromEntries(Object.entries(catalogs).flatMap(([locale, catalog]) => (locale === "en" ? [] : [[locale, noticeLabels(catalog)]]))),
}

export const dxccProgram: ChasingHook = {
  program,
  claimsForQsos,
  holdersFor: ({ station }) =>
    typeof station.call === "string" && station.call && !inNoEntity(station, station.call)
      ? [holderFor(station.call, storedCode(station) ?? entityForCall(station.call).dxccCode)]
      : [],
  summarizeClaims,
}
