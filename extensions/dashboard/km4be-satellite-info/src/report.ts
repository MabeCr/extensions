// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// Telling AMSAT whether a satellite was heard: the report an operator would otherwise
// fill in at amsat.org/status. AMSAT has a status API for it (amsat.org/status/api), with
// no login: a satellite as AMSAT names it (`AO-7_[U/v]`), what was heard, a time, a
// callsign, and a grid square if wanted, sent as JSON. It answers 201 when it has the
// report and a message when it has not, which the old web form's page did not.
//
// Nothing here sends anything; `sendReport` does, and only when the operator has said so.

import { host } from "@ham2k/extension-sdk"
import type { HookContext } from "@ham2k/extension-sdk"

import type { Satellite } from "./data.ts"
import { onForget } from "./memory.ts"
import { isOwnVariant } from "./status.ts"
import type { Kind } from "./status.ts"

export const CATALOG_URL = "https://www.amsat.org/status/api/v1/catalog.php"
export const REPORTS_URL = "https://www.amsat.org/status/api/v1/reports.php"

/// What the API's `report` field says for each kind of report.
export const REPORT_VALUES: Record<Kind, string> = { heard: "Heard", telemetry: "Telemetry Only", notHeard: "Not Heard" }
/// What each kind is called on the button.
export const REPORT_LABELS: Record<Kind, string> = { heard: "Heard", telemetry: "Telemetry only", notHeard: "Not heard" }
export const REPORT_KINDS: Kind[] = ["heard", "telemetry", "notHeard"]

/// The satellites AMSAT takes reports for, as it names them: `AO-7_[U/v]`, `ISS_[FM]`, `AO-73_[U/v]`. Read from its
/// catalog, so a satellite AMSAT adds can be reported the day it appears.
export function parseCatalog(raw: unknown): string[] {
  const data = (raw as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return []
  const names: string[] = []
  for (const row of data) {
    const name = typeof row?.name === "string" ? row.name.trim() : ""
    if (name && !names.includes(name)) names.push(name)
  }
  return names
}

/// `AO-7 [U/v]` for `AO-7_[U/v]`.
export const labelOf = (name: string): string => name.replace("_[", " [")

/// The satellite and its variant in a form name: `AO-7`, `U/v`.
function split(name: string): { satellite: string; variant: string } {
  const m = /^(.*?)_?\[(.*)\]$/.exec(name)
  return m ? { satellite: m[1].trim(), variant: m[2].trim() } : { satellite: name.trim(), variant: "" }
}

/// The form's names for one satellite, the variant that is its own kind of signal first: the FM
/// repeater of an FM satellite, the linear transponder of a linear one.
export function namesFor(all: string[], satellite: Pick<Satellite, "name" | "modulation" | "info">): string[] {
  const wanted = (satellite.info.amsat ?? [satellite.name]).map((n) => n.toLowerCase())
  const mine = all.filter((n) => wanted.includes(split(n).satellite.toLowerCase()))
  const own = mine.filter((n) => isOwnVariant(split(n).variant, satellite.modulation))
  return [...own, ...mine.filter((n) => !own.includes(n))]
}

const two = (n: number): string => String(n).padStart(2, "0")

/// The start of the quarter hour a time is in, as the API takes it: `2026-10-22T21:00:00Z`. AMSAT keeps a report by the
/// quarter hour, so a later one for the same satellite and callsign in it replaces the earlier.
export function reportedAt(millis: number): string {
  const d = new Date(Math.floor(millis / 900_000) * 900_000)
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}T${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:00Z`
}

/// `21:00–21:15Z`: what the quarter hour of a report is.
export function quarterText(millis: number): string {
  const d = new Date(millis)
  const start = Math.floor(d.getUTCMinutes() / 15) * 15
  const end = start + 15
  return `${two(d.getUTCHours())}:${two(start)}–${end === 60 ? two((d.getUTCHours() + 1) % 24) + ":00" : `${two(d.getUTCHours())}:${two(end)}`}Z`
}

export interface Report {
  /// The form's name for the satellite: `AO-7_[U/v]`.
  name: string
  kind: Kind
  at: number
  call: string
  grid: string
}

/// What a callsign is: letters and digits with a digit in them, and a suffix after a slash if there is one.
const CALL = /^(?:[A-Z0-9]{1,3}\/)?[A-Z0-9]{1,3}[0-9][A-Z0-9]{0,3}[A-Z](?:\/[A-Z0-9]{1,4})?$/

/// What the operator's callsign is, from the operation: the operator, or the station if there is none.
export function defaultCall(operation: Record<string, unknown> | undefined): string {
  const pick = (v: unknown): string => (typeof v === "string" ? v.trim().toUpperCase() : "")
  return pick(operation?.operatorCall) || pick(operation?.stationCall)
}

export const cleanCall = (text: string): string => text.trim().toUpperCase().replace(/\s+/g, "")
export const isCall = (text: string): boolean => CALL.test(cleanCall(text))

/// A grid square of four, six or eight characters: EL95, EL95vs. Capitals for the field, lower case for the square's letters.
export const cleanGrid = (text: string): string => {
  const t = text.trim().replace(/\s+/g, "")
  return t.length >= 2 ? t.slice(0, 2).toUpperCase() + t.slice(2, 4) + t.slice(4).toLowerCase() : t.toUpperCase()
}
export const isGrid = (text: string): boolean => /^[A-R]{2}[0-9]{2}([a-x]{2}([0-9]{2})?)?$/.test(cleanGrid(text))

/// Why a report cannot be sent yet, or an empty string when it can.
export function problemWith(r: { name: string; kind: Kind | ""; call: string; grid: string }): string {
  if (!r.name) return "Choose the satellite's transponder."
  if (!r.kind) return "Choose what you heard."
  if (!r.call.trim()) return "Enter your callsign."
  if (!isCall(r.call)) return `${cleanCall(r.call)} does not look like a callsign.`
  if (r.grid.trim() && !isGrid(r.grid)) return `${cleanGrid(r.grid)} is not a grid square. Leave it empty to send none.`
  return ""
}

/// What is about to be sent, in a line the operator can read before agreeing to it.
export function summaryOf(r: Report): string {
  return `${labelOf(r.name)}: ${REPORT_LABELS[r.kind].toLowerCase()}, ${quarterText(r.at)}, as ${cleanCall(r.call)}${r.grid.trim() ? `, ${cleanGrid(r.grid)}` : ", no grid"}`
}

/// What is sent: the API's own fields. The grid is left out when there is none, rather than sent empty.
export function payloadOf(r: Report): Record<string, string> {
  return {
    name: r.name,
    report: REPORT_VALUES[r.kind],
    callsign: cleanCall(r.call),
    ...(r.grid.trim() ? { grid_square: cleanGrid(r.grid) } : {}),
    reported_at: reportedAt(r.at),
  }
}

// --- AMSAT's satellites ---------------------------------------------------------

const NAMES_MAX_AGE_MS = 6 * 3_600_000
let namesMemo: { at: number; names: string[] } | undefined
onForget(() => (namesMemo = undefined))

/// The satellites AMSAT takes reports for, kept six hours; empty when its catalog cannot be read.
export async function loadSatNames(ctx: HookContext, now: number): Promise<string[]> {
  if (namesMemo && now >= namesMemo.at && now - namesMemo.at < NAMES_MAX_AGE_MS) return namesMemo.names
  if (!ctx.online) return namesMemo?.names ?? []
  try {
    const response = await host.fetch(CATALOG_URL, { headers: { Accept: "application/json" } })
    if (response.status !== 200) throw new Error(`HTTP ${response.status}`)
    const names = parseCatalog(JSON.parse(response.body))
    if (names.length) namesMemo = { at: now, names }
    return names.length ? names : (namesMemo?.names ?? [])
  } catch (error) {
    host.log(`km4be-satellite-info: ${CATALOG_URL}: ${error instanceof Error ? error.message : String(error)}`)
    return namesMemo?.names ?? []
  }
}

// --- Sending -----------------------------------------------------------------

export interface Outcome {
  ok: boolean
  message: string
}

/// The words of a page, without its tags, for showing a short part of what AMSAT said.
export const textOf = (html: string): string =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()

/// What AMSAT said in a reply that was not a success, in its own words when it gave them: its error envelope is
/// `{error: {code, message}}`, and a report it refuses for what is in it comes with a message saying what.
export function errorText(status: number, body: string): string {
  try {
    const said = JSON.parse(body) as { error?: { message?: unknown }; message?: unknown }
    const message = said?.error?.message ?? said?.message
    if (typeof message === "string" && message.trim()) return `AMSAT did not take it: ${message.trim().slice(0, 160)} (HTTP ${status})`
  } catch {
    // not JSON: a web page, a gateway's reply
  }
  const words = textOf(body).slice(0, 120)
  return `AMSAT did not take it (HTTP ${status})${words ? `: ${words}` : ""}.`
}

/// Sends the report to AMSAT's status API. A 201 is the report taken; anything else is said as AMSAT said it, so that a
/// report that did not land is not taken for one that did.
export async function sendReport(report: Report): Promise<Outcome> {
  try {
    const response = await host.fetch(REPORTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payloadOf(report)),
    })
    if (response.status !== 201) return { ok: false, message: errorText(response.status, response.body) }
    return { ok: true, message: `Sent to AMSAT: ${summaryOf(report)}. It is on their status page now.` }
  } catch (error) {
    host.log(`km4be-satellite-info: ${REPORTS_URL}: ${error instanceof Error ? error.message : String(error)}`)
    return { ok: false, message: "Could not reach AMSAT. Nothing was sent." }
  }
}
