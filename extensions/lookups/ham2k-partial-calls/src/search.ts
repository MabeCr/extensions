// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The calls the typed text could be, asked of every source and ranked. The
// suggestion line and the panel wake for the same keystroke, so the one that
// asks second takes the first one's answer instead of asking again.

import { host } from "@ham2k/extension-sdk"
import type { FoundCall, FoundLookupRow, HookContext, JSONValue } from "@ham2k/extension-sdk"

import manifest from "../manifest.json" with { type: "json" }
import { isContestRef, rankCandidates } from "./rank.ts"
import type { Candidate } from "./rank.ts"

/// The lookup category SCP's rows fill.
const SCP_CATEGORY = manifest.key

/// Typing fewer characters matches too much of SCP to be worth offering.
const MIN_TYPED = 3

/// What `findCalls` and `dbLookupFindCalls` accept, and at most how long.
const CALL_TEXT = /^[A-Z0-9/?]+$/
const MAX_TYPED = 20

/// SCP rows asked for: as many as the panel shows, since the logs' calls
/// rank ahead of them.
const SCP_LIMIT = 30

/// How long one answer serves both callers, in real milliseconds: the two
/// hooks wake within moments of each other, and the log a later keystroke
/// searches may have gained a contact.
const SHARED_MILLIS = 2000

export interface Sources {
  searchLogs: boolean
  searchActivity: boolean
  useScp: boolean
}

export interface Search {
  ranked: Candidate[]
  /// Every source that failed, by name: its calls are missing from
  /// `ranked`.
  failures: { source: string; reason: unknown }[]
}

/// What [failures] are, as one error naming each source, for the app to
/// count: the first's own error as its cause when there is one.
export function searchError(failures: Search["failures"]): Error {
  const message = `Partial Calls: searching ${failures.map((failure) => failure.source).join(" and ")} failed`
  return failures.length === 1 ? new Error(message, { cause: failures[0].reason }) : new AggregateError(failures.map((failure) => failure.reason), message)
}

/// The text the call field holds, as the sources are asked about it, or
/// null when it is too short, too long or not a call's characters.
export function typedCall(qso: Record<string, JSONValue> | undefined): string | null {
  const their = qso?.their as Record<string, JSONValue> | undefined
  const typed = typeof their?.call === "string" ? their.call.trim().toUpperCase() : ""
  if (typed.length < MIN_TYPED || typed.length > MAX_TYPED || !CALL_TEXT.test(typed)) return null
  return typed
}

/// The ref types of [operation]'s contest refs (`cqww`).
export function contestRefTypes(operation: Record<string, JSONValue>): string[] {
  const refs = Array.isArray(operation.refs) ? operation.refs : []
  return refs.filter(isContestRef).map((ref) => (ref as { type: string }).type)
}

let shared: { key: string; atMillis: number; search: Promise<Search> } | null = null

/// Every call [typed] could be, in [operation], likeliest first; null where
/// the host has no `findCalls`.
export function searchCalls(
  ctx: HookContext,
  sources: Sources,
  args: { operation: Record<string, JSONValue>; typed: string; mode?: string; clock: { nowMillis: number; realNowMillis: number } },
): Promise<Search> | null {
  const findCalls = ctx.findCalls?.bind(ctx)
  if (!findCalls) return null
  const operationUuid = args.operation.uuid as string
  const refTypes = contestRefTypes(args.operation)
  const { typed, mode } = args
  const key = JSON.stringify([operationUuid, typed, mode ?? null, refTypes, sources.searchLogs, sources.searchActivity, sources.useScp])
  const now = args.clock.realNowMillis
  if (shared && shared.key === key && now >= shared.atMillis && now - shared.atMillis < SHARED_MILLIS) return shared.search

  const search = (async (): Promise<Search> => {
    const none = Promise.resolve([] as FoundCall[])
    // Each source on its own: one that fails leaves the others' calls.
    const [operationResult, contestResult, logsResult, scpResult] = await Promise.allSettled([
      sources.searchActivity ? findCalls(typed, { operation: operationUuid }) : none,
      sources.searchLogs && refTypes.length > 0 ? findCalls(typed, { refType: refTypes, excludeOperation: operationUuid }) : none,
      sources.searchLogs ? findCalls(typed, { excludeOperation: operationUuid }) : none,
      sources.useScp ? host.dbLookupFindCalls(SCP_CATEGORY, typed, { limit: SCP_LIMIT }) : Promise.resolve([] as FoundLookupRow[]),
    ])
    const found = <T,>(result: PromiseSettledResult<T[]>): T[] => (result.status === "fulfilled" ? result.value : [])
    const ranked = rankCandidates(
      { operation: found(operationResult), contest: found(contestResult), logs: found(logsResult), scp: found(scpResult) },
      { mode, contestRefTypes: refTypes, nowMillis: args.clock.nowMillis },
    )
    const named = [
      ["this activity", operationResult],
      ["this contest's earlier logs", contestResult],
      ["your logs", logsResult],
      ["Super Check Partial", scpResult],
    ] as const
    const failures = named.flatMap(([source, result]) => (result.status === "rejected" ? [{ source, reason: result.reason as unknown }] : []))
    return { ranked, failures }
  })()
  shared = { key, atMillis: now, search }
  return search
}
