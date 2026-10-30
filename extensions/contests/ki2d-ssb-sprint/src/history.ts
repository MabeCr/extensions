// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// N1MM Logger+'s call history file for the SSB Sprint: the name and location
// each station sent in earlier Sprints, as one contributor keeps it (VE2FK at
// the time of writing), found by the host from its stem
// (`n1mm-history:SPRINTSSB`) whatever it is renamed to next.
//
// "This is helping file, LOG what is sent", as its own header says, so what
// it holds is offered as a suggestion the operator overwrites, never as the
// exchange itself.
//
// Separate from index.ts so it can be unit-tested: index.ts calls
// `defineExtension` at import time.

import type { JSONValue } from "@ham2k/extension-sdk"
import { parseCallsign } from "@ham2k/lib-callsigns"

import { isValidLocation, normalizeLocation } from "./locations.ts"

/// What a station sent, by call: `[name, location]`, either of them '' when
/// the file has none that is valid. A tuple rather than an object: the host
/// caches this as JSON and replays it at every start.
export type HistoryIndex = Record<string, [string, string]>

export const HISTORY_STEM = 'SPRINTSSB'

/// A single name, upper-cased — the exchange sends one.
export function firstName(value: JSONValue | undefined): string {
  return (typeof value === 'string' ? value : '').trim().split(/\s+/)[0].toUpperCase()
}

/// Parses an N1MM call history file into a [HistoryIndex].
///
/// The `!!Order!!` line names the columns — `!!Order!!,Call,Name,State,UserText,`
/// in today's file — and is read rather than assumed, case aside, as N1MM
/// reads it. Lines starting `#` are comments, other `!!` lines are N1MM
/// import directives, and either separator, comma or semicolon, is accepted.
export function parseHistory(body: string): HistoryIndex {
  let columns = ['call', 'name', 'loc1', 'loc2', 'sect', 'state', 'ck']
  const index: HistoryIndex = {}
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const fields = line.split(/[,;]/).map((field) => field.trim())
    if (/^!!order!!$/i.test(fields[0])) {
      columns = fields.slice(1).map((name) => name.toLowerCase())
      continue
    }
    if (line.startsWith('!!')) continue

    const column = (name: string) => {
      const at = columns.indexOf(name)
      return at >= 0 ? fields[at] ?? '' : ''
    }
    const call = column('call').toUpperCase()
    const name = /^[A-Za-z]+$/.test(column('name')) ? firstName(column('name')) : ''
    const state = normalizeLocation(column('state'))
    const location = isValidLocation(state) ? state : ''
    if (call && (name || location)) index[call] = [name, location]
  }
  return index
}

let index: HistoryIndex | undefined

export function loadHistory(data: unknown): void {
  index = (data as HistoryIndex | null) ?? {}
}

export function removeHistory(): void {
  index = undefined
}

/// What [call] sent in an earlier Sprint.
///
/// A portable call the file does not list (`K2LE/4`) still finds its name
/// under the plain call — the operator goes wherever the call goes — but not
/// its location, which is wherever the station is today.
export function historyFor(call: string): { name: string; location: string } | undefined {
  const upper = call.trim().toUpperCase()
  if (!upper || !index) return undefined
  const entry = index[upper]
  if (entry) return { name: entry[0], location: entry[1] }
  const base = String(parseCallsign(upper).baseCall ?? '').toUpperCase()
  if (!base || base === upper) return undefined
  const baseEntry = index[base]
  return baseEntry?.[0] ? { name: baseEntry[0], location: '' } : undefined
}
