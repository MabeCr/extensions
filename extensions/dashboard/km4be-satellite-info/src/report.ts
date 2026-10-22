// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// Telling AMSAT whether a satellite was heard: the report an operator would otherwise
// fill in at amsat.org/status. That page is a plain form that posts to submit.php, with
// no login, so the extension fills it in the same way: the satellite as AMSAT names it
// (`AO-7_[U/v]`), what was heard, the date and the quarter hour in UTC, a callsign, and
// a grid square if wanted.
//
// Nothing here sends anything; `sendReport` does, and only when the operator has said so.

import { host } from "@ham2k/extension-sdk"
import type { HookContext } from "@ham2k/extension-sdk"

import type { Satellite } from "./data.ts"
import { onForget } from "./memory.ts"
import { isOwnVariant } from "./status.ts"
import type { Kind } from "./status.ts"

export const FORM_URL = "https://www.amsat.org/status/"
export const SUBMIT_URL = "https://www.amsat.org/status/submit.php"

/// What the form's `SatReport` field says for each kind of report.
export const REPORT_VALUES: Record<Kind, string> = { heard: "Heard", telemetry: "Telemetry Only", notHeard: "Not Heard" }
/// What each kind is called on the button.
export const REPORT_LABELS: Record<Kind, string> = { heard: "Heard", telemetry: "Telemetry only", notHeard: "Not heard" }
export const REPORT_KINDS: Kind[] = ["heard", "telemetry", "notHeard"]

/// The satellites the form offers, as it names them: `AO-7_[U/v]`, `ISS_[FM]`, `AO-73_[U/v]`.
/// Read from the form itself, so a satellite AMSAT adds can be reported the day it appears.
export function parseSatNames(html: string): string[] {
  const start = html.search(/<select[^>]*name=["']?SatName["']?/i)
  if (start < 0) return []
  const end = html.indexOf("</select>", start)
  const block = html.slice(start, end < 0 ? undefined : end)
  const names: string[] = []
  for (const m of block.matchAll(/<option\s+value=["']?([^"'>]+)["']?\s*>/gi)) {
    const value = m[1].trim()
    if (value && !names.includes(value)) names.push(value)
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

export interface Moment {
  year: string
  month: string
  day: string
  hour: string
  /// 0 to 3: which quarter of the hour.
  period: string
}

const two = (n: number): string => String(n).padStart(2, "0")

/// The form's date and quarter hour, in UTC, for a time.
export function momentOf(millis: number): Moment {
  const d = new Date(millis)
  return { year: String(d.getUTCFullYear()), month: two(d.getUTCMonth() + 1), day: two(d.getUTCDate()), hour: two(d.getUTCHours()), period: String(Math.floor(d.getUTCMinutes() / 15)) }
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

const encode = (s: string): string => encodeURIComponent(s).replace(/%20/g, "+")

/// The form's fields, in the form's own order, as a form posts them.
export function bodyOf(r: Report): string {
  const m = momentOf(r.at)
  const fields: [string, string][] = [
    ["SatName", r.name],
    ["SatReport", REPORT_VALUES[r.kind]],
    ["SatYear", m.year],
    ["SatMonth", m.month],
    ["SatDay", m.day],
    ["SatHour", m.hour],
    ["SatPeriod", m.period],
    ["SatCall", cleanCall(r.call)],
    ["SatGridSquare", r.grid.trim() ? cleanGrid(r.grid) : ""],
    ["SatSubmit", "Submit Data"],
  ]
  return fields.map(([k, v]) => `${encode(k)}=${encode(v)}`).join("&")
}

// --- The form's satellites ----------------------------------------------------

const NAMES_MAX_AGE_MS = 6 * 3_600_000
let namesMemo: { at: number; names: string[] } | undefined
onForget(() => (namesMemo = undefined))

/// The satellites AMSAT's form offers, kept six hours; empty when the form cannot be read.
export async function loadSatNames(ctx: HookContext, now: number): Promise<string[]> {
  if (namesMemo && now >= namesMemo.at && now - namesMemo.at < NAMES_MAX_AGE_MS) return namesMemo.names
  if (!ctx.online) return namesMemo?.names ?? []
  try {
    const response = await host.fetch(FORM_URL)
    if (response.status !== 200) throw new Error(`HTTP ${response.status}`)
    const names = parseSatNames(response.body)
    if (names.length) namesMemo = { at: now, names }
    return names.length ? names : (namesMemo?.names ?? [])
  } catch (error) {
    host.log(`km4be-satellite-info: ${FORM_URL}: ${error instanceof Error ? error.message : String(error)}`)
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

/// Posts the report. AMSAT answers with a web page, not a status, so what is known is that it
/// accepted the request; a page that talks of an error is reported as one.
export async function sendReport(report: Report): Promise<Outcome> {
  try {
    const response = await host.fetch(SUBMIT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: bodyOf(report),
    })
    if (response.status < 200 || response.status >= 400) return { ok: false, message: `AMSAT did not take it (HTTP ${response.status}). Try again in a moment.` }
    const said = textOf(response.body)
    if (/\b(error|invalid|failed|not accepted|missing)\b/i.test(said)) return { ok: false, message: `AMSAT's page says: ${said.slice(0, 140)}` }
    return { ok: true, message: `Sent to AMSAT: ${summaryOf(report)}. It can take a few minutes to show up.` }
  } catch (error) {
    host.log(`km4be-satellite-info: ${SUBMIT_URL}: ${error instanceof Error ? error.message : String(error)}`)
    return { ok: false, message: "Could not reach AMSAT. Nothing was sent." }
  }
}

