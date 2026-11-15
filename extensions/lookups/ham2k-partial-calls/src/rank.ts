// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Which of the calls the typed text could be is likeliest. The sources, from
// the strongest evidence to the weakest: the call was worked in this
// operation, in this contest in past years, anywhere in the logs, or is on
// Super Check Partial's list of calls active in contests. How closely it
// matches the text adds to that, and SCP's own counts order the calls only
// it knows.

import type { CallMatchKind, FoundCall, FoundLookupRow } from "@ham2k/extension-sdk"

export interface Sources {
  /// This operation's log.
  operation: FoundCall[]
  /// The operations of this operation's contest before it.
  contest: FoundCall[]
  /// Every log but this operation's.
  logs: FoundCall[]
  /// Super Check Partial's rows.
  scp: FoundLookupRow[]
}

export interface RankContext {
  /// The draft's mode, as the app spells it (`CW`, `SSB`, `FT8`).
  mode?: string
  /// The operation's contest ref types (`cqww`).
  contestRefTypes: string[]
  nowMillis: number
}

/// Where a call was found: how often in this operation and in this
/// contest's earlier ones, how often and when last in every other log, and
/// whether SCP lists it.
export interface FoundIn {
  operation?: number
  contest?: number
  logs?: { count: number; lastAtMillis: number | null }
  scp?: boolean
}

export interface Candidate {
  call: string
  match: CallMatchKind
  score: number
  foundIn: FoundIn
}

/// Closest first. A whole call typed, `K1AB` for `K1AB`, is the call meant
/// far more often than one it appears inside or one a typo away from it.
const MATCH_WEIGHT: Record<CallMatchKind, number> = { exact: 400, partial: 150, oneEdit: 0 }

/// Each source's floor. A call's sources add up, so one found in the contest
/// before, in the logs and in SCP can pass one worked only in this
/// operation; but no call only SCP knows ever passes one in any log.
const IN_OPERATION = 1000
const IN_CONTEST = 500
const IN_LOGS = 200

const YEAR_MILLIS = 365 * 24 * 3600 * 1000

/// SCP's `modes` bits.
const SCP_MODE_BITS: Record<string, number> = { CW: 1, SSB: 2, USB: 2, LSB: 2, AM: 2, PHONE: 2, FM: 4, RTTY: 8 }
const SCP_DIGITAL = 16

/// SCP's `contests` bits for the contests its file documents, by the ref
/// type their extensions write.
const SCP_CONTEST_BITS: Record<string, number> = { cqww: 1, cqwpx: 2, "arrl-dx": 8, "arrl-ss": 16, naqp: 1024 }

export function scpModeBit(mode: string | undefined): number | null {
  if (!mode) return null
  return SCP_MODE_BITS[mode.toUpperCase()] ?? SCP_DIGITAL
}

const closer = (a: CallMatchKind, b: CallMatchKind) => (MATCH_WEIGHT[a] >= MATCH_WEIGHT[b] ? a : b)

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0)

/// Every call any source found, likeliest first.
export function rankCandidates(sources: Sources, context: RankContext): Candidate[] {
  const byCall = new Map<string, { match: CallMatchKind; score: number; foundIn: FoundIn }>()
  const add = (call: string, match: CallMatchKind, score: number, foundIn: FoundIn) => {
    const held = byCall.get(call)
    byCall.set(call, held ? { match: closer(held.match, match), score: held.score + score, foundIn: { ...held.foundIn, ...foundIn } } : { match, score, foundIn })
  }

  for (const found of sources.operation) add(found.call, found.match, IN_OPERATION, { operation: found.count })
  for (const found of sources.contest) add(found.call, found.match, IN_CONTEST + 10 * Math.min(found.count, 10), { contest: found.count })
  for (const found of sources.logs) {
    const recent = found.lastAtMillis !== null && context.nowMillis - found.lastAtMillis < YEAR_MILLIS ? 50 : 0
    add(found.call, found.match, IN_LOGS + 25 * Math.log2(1 + found.count) + recent, { logs: { count: found.count, lastAtMillis: found.lastAtMillis } })
  }

  const modeBit = scpModeBit(context.mode)
  const contestBits = context.contestRefTypes.reduce((bits, type) => bits | (SCP_CONTEST_BITS[type] ?? 0), 0)
  for (const row of sources.scp) {
    const data = row.data ?? {}
    let score = 40 * Math.log10(1 + num(data.rate))
    if (modeBit !== null && (num(data.modes) & modeBit) !== 0) score += 30
    if (contestBits !== 0 && (num(data.contests) & contestBits) !== 0) score += 30
    add(row.key, row.match, score, { scp: true })
  }

  return [...byCall.entries()]
    .map(([call, { match, score, foundIn }]) => ({ call, match, score: score + MATCH_WEIGHT[match], foundIn }))
    .sort((a, b) => b.score - a.score || a.call.localeCompare(b.call))
}

/// Whether [ref] is a contest's: the app marks one (`contest: true`); a host
/// that does not is guessed at, as anything an operation holds that is not an
/// activation (`potaActivation`).
export function isContestRef(ref: unknown): boolean {
  if (!ref || typeof ref !== "object") return false
  const { type, contest } = ref as { type?: unknown; contest?: unknown }
  if (contest === true) return true
  return typeof type === "string" && type !== "" && !type.endsWith("Activation")
}
