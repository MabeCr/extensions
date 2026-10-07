// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// What operators have been reporting to AMSAT's status page: whether each
// satellite was heard lately. The API's summary gives, per satellite variant
// (`AO-7 [U/v]`, `ISS [FM]`) and per kind of report, how many reports there were
// in the window and when the latest came.

import type { Satellite } from "./data.ts"
import { clock } from "./passes.ts"

export type Kind = "heard" | "telemetry" | "notHeard"

export interface StatusRow {
  /// The satellite without its variant: `AO-7`.
  satellite: string
  /// The variant: `U/v`, `FM`, `SSTV`; empty when there is none.
  variant: string
  kind: Kind
  count: number
  at: number
}

export interface Status {
  /// The kind most reports in the window were: what the satellite is mostly like. One operator's
  /// bad pass does not turn a satellite heard thirty times into one that is not heard.
  kind: Kind
  heard: number
  telemetry: number
  notHeard: number
  /// The latest report, which can say it has changed since.
  latestKind: Kind
  latestAt: number
}

export const GLYPH: Record<Kind, string> = { heard: "✔", telemetry: "◐", notHeard: "✘" }
/// Where a satellite without a status keeps the column of its row.
export const NO_GLYPH = " "

const KINDS: Record<string, Kind> = { Heard: "heard", "Crew Active": "heard", "Telemetry Only": "telemetry", "Not Heard": "notHeard" }
/// When two kinds are equally common or equally recent, the more hopeful one counts.
const RANK: Record<Kind, number> = { heard: 3, telemetry: 2, notHeard: 1 }

/// The summary's rows, each satellite name split into the satellite and its variant.
export function parseSummary(raw: unknown): StatusRow[] {
  const data = (raw as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return []
  return data.flatMap((r) => {
    const display = typeof r?.satellite_display_name === "string" ? r.satellite_display_name : ""
    const kind = KINDS[String(r?.report)]
    const count = typeof r?.report_count === "number" ? r.report_count : 0
    const at = Date.parse(String(r?.latest_reported_time))
    const match = /^(.*?)\s*(?:\[(.*)\])?\s*$/.exec(display)
    if (!display || !kind || !count || Number.isNaN(at) || !match) return []
    return [{ satellite: match[1].trim(), variant: (match[2] ?? "").trim(), kind, count, at }]
  })
}

/// Whether a variant is the one a satellite's own frequencies are for: an FM satellite's
/// FM transponder, a linear one's linear. `ISS [SSTV]` being heard says nothing about
/// whether the ISS FM repeater is on.
function relevant(variant: string, modulation: string): boolean {
  const v = variant.toLowerCase()
  if (modulation === "fm") return v === "fm"
  if (modulation === "linear") return /^[a-z]\/[a-z]$/.test(v) || v === "nb" || v === "wb"
  if (modulation === "digital") return /digi|tlm/.test(v)
  return true
}

/// The status of `satellite`, from reports made under any name AMSAT knows it by; null when
/// there are none in the window. Variants that are not its own kind of signal are set aside
/// unless that would leave nothing.
export function statusFor(rows: StatusRow[], satellite: Pick<Satellite, "name" | "modulation" | "info">): Status | null {
  const names = (satellite.info.amsat ?? [satellite.name]).map((n) => n.toLowerCase())
  const named = rows.filter((r) => names.includes(r.satellite.toLowerCase()))
  const own = named.filter((r) => relevant(r.variant, satellite.modulation))
  const used = own.length ? own : named
  if (!used.length) return null

  const total = (kind: Kind) => used.filter((r) => r.kind === kind).reduce((n, r) => n + r.count, 0)
  const latestOf = (kind: Kind) => Math.max(0, ...used.filter((r) => r.kind === kind).map((r) => r.at))
  const counts: Record<Kind, number> = { heard: total("heard"), telemetry: total("telemetry"), notHeard: total("notHeard") }

  // Most reports wins; a tie goes to the one reported most recently, then to the more hopeful.
  const kinds = (Object.keys(counts) as Kind[]).filter((k) => counts[k] > 0)
  const kind = kinds.reduce((best, k) =>
    counts[k] > counts[best] || (counts[k] === counts[best] && (latestOf(k) > latestOf(best) || (latestOf(k) === latestOf(best) && RANK[k] > RANK[best]))) ? k : best,
  )
  const latest = used.reduce((best, r) => (r.at > best.at || (r.at === best.at && RANK[r.kind] > RANK[best.kind]) ? r : best))
  return { kind, ...counts, latestKind: latest.kind, latestAt: latest.at }
}

const WORDS: Record<Kind, string> = { heard: "heard", telemetry: "telemetry only", notHeard: "not heard" }

/// The two lines for the detail:
///
///     AMSAT, last 24 h: heard (29 heard, 1 telemetry, 0 not heard)
///     Latest report: heard, 02:30Z
export function statusLines(status: Status | null, hours: number, now: number, utc: boolean): [string, string] {
  if (!status) return [`AMSAT, last ${hours} h: no reports.`, ""]
  return [
    `AMSAT, last ${hours} h: ${WORDS[status.kind]} (${status.heard} heard, ${status.telemetry} telemetry, ${status.notHeard} not heard)`,
    `Latest report: ${WORDS[status.latestKind]}, ${clock(status.latestAt, now, utc)}`,
  ]
}

export const DEFAULT_STATUS_HOURS = 24
export const MAX_STATUS_HOURS = 168

/// The pane's report window from its settings: 1 to 168 hours, and 24 for anything else.
export function statusHours(config: Record<string, unknown> | undefined): number {
  const v = config?.statusHours
  return typeof v === "number" && Number.isFinite(v) && v >= 1 ? Math.min(MAX_STATUS_HOURS, Math.floor(v)) : DEFAULT_STATUS_HOURS
}

/// Under the list, to say what the `Rpt` column's marks are.
export const LEGEND = `Rpt: ${GLYPH.heard} heard · ${GLYPH.telemetry} telemetry only · ${GLYPH.notHeard} not heard (AMSAT reports)`
