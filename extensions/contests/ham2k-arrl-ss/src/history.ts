// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// N1MM Logger+'s call history files for Sweepstakes: what each station sent
// in earlier runnings, as one contributor keeps it (VE2FK at the time of
// writing). One file per weekend, `SSCW_new.txt` and `SSSSB_2025-009.txt`,
// each found by the host from its stem (`n1mm-history:SSCW`) whatever it is
// renamed to next.
//
// The file is "a helping file, LOG what you copy", as its own header says, so
// what it holds is offered as a suggestion the operator overwrites, never as
// the exchange itself.
//
// Separate from index.ts so it can be unit-tested: index.ts calls
// `defineExtension` at import time.

import type { JSONValue } from "@ham2k/extension-sdk"
import { parseCallsign } from "@ham2k/lib-callsigns"

import type { SSMode } from "./schedule.ts"
import { normalizeSection } from "./exchange.ts"

/// What a station sent, by call: `[section, check]`, either of them '' when
/// the file has none that is valid. A tuple rather than an object: the host
/// caches this as JSON and replays it at every start, and there are some
/// thirteen thousand of them.
export type HistoryIndex = Record<string, [string, string]>

/// The stems of the two files, by the weekend each was kept from.
export const HISTORY_STEMS: Record<SSMode, string> = { CW: 'SSCW', SSB: 'SSSSB' }

/// A check as the file writes it — a number, `8` for 08 — as the exchange
/// sends it, or '' for none. `-1` is the file's "unknown", and so is `0`
/// nearly always: it is several times as common as any real year, which is
/// what N1MM writes for an empty number. A station first licensed in 2000
/// loses the suggestion, not the contact.
function historyCheck(value: string): string {
  const digits = value.trim()
  if (!/^\d{1,2}$/.test(digits) || Number(digits) === 0) return ''
  return digits.padStart(2, '0')
}

/// Parses an N1MM call history file into a [HistoryIndex].
///
/// The `!!Order!!` line names the columns — `!!Order!!,Call,Sect,State,CK,UserText,`
/// in today's files — and is read rather than assumed, case aside, as N1MM
/// reads it. Without one the columns are N1MM's default order. Lines starting
/// `#` are comments, other `!!` lines are N1MM import directives, and either
/// separator, comma or semicolon, is accepted.
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
    const section = normalizeSection(column('sect'))
    const check = historyCheck(column('ck'))
    if (call && (section || check)) index[call] = [section, check]
  }
  return index
}

/// Each file's index once loaded, by the weekend it was kept from.
const indexes: Partial<Record<SSMode, HistoryIndex>> = {}

export function loadHistory(mode: SSMode, data: unknown): void {
  indexes[mode] = (data as HistoryIndex | null) ?? {}
}

export function removeHistory(mode: SSMode): void {
  delete indexes[mode]
}

/// What [call] sent in an earlier running, by the file of this weekend's
/// [mode] and else the other's: the same stations work both, and either is
/// better than nothing when only one has downloaded.
///
/// A portable call the file does not list (`K2LE/1`) still finds its check
/// under the plain call — the year licensed goes wherever the operator goes —
/// but not its section, which is wherever the station is today.
export function historyFor(call: string, mode: JSONValue | undefined): { section: string; check: string } | undefined {
  const upper = call.trim().toUpperCase()
  if (!upper) return undefined
  const order: SSMode[] = mode === 'SSB' ? ['SSB', 'CW'] : ['CW', 'SSB']
  const files = order.map((m) => indexes[m]).filter((index): index is HistoryIndex => !!index)

  for (const index of files) {
    const entry = index[upper]
    if (entry) return { section: entry[0], check: entry[1] }
  }
  const base = String(parseCallsign(upper).baseCall ?? '').toUpperCase()
  if (!base || base === upper) return undefined
  for (const index of files) {
    const entry = index[base]
    if (entry?.[1]) return { section: '', check: entry[1] }
  }
  return undefined
}
