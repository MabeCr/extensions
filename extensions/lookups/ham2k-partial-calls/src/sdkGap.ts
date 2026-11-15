// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Extension API 25, which the published SDK does not carry yet. Each type is
// a copy of the SDK's own (`types.ts`), and each call goes through the
// `hostCall` the app binds to this extension at activation, as the SDK's
// `host.draftSuggestions` and `host.dbLookupFindCalls` do. Delete this file
// the day `@ham2k/extension-sdk` 1.25 publishes, and import them from there.

import type { DataFileDefinition, HookContext, JSONValue } from "@ham2k/extension-sdk"

/// A copy of the SDK's `CallMatchKind`.
export type CallMatchKind = "exact" | "partial" | "oneEdit"

/// A copy of the SDK's `CallMatchOptions`.
export interface CallMatchOptions {
  match?: CallMatchKind | CallMatchKind[]
  limit?: number
}

/// A copy of the SDK's `FindCallsOptions`, with only the filters used here.
export interface FindCallsOptions extends CallMatchOptions {
  refType?: string | string[]
  operation?: string | string[]
  excludeOperation?: string | string[]
}

/// A copy of the SDK's `FoundCall`.
export interface FoundCall {
  call: string
  match: CallMatchKind
  count: number
  lastAtMillis: number | null
}

/// A copy of the SDK's `FoundLookupRow`.
export interface FoundLookupRow {
  key: string
  name?: string
  data?: Record<string, unknown>
  match: CallMatchKind
}

/// A copy of the SDK's `CandidateVerdict`.
export interface CandidateVerdict {
  notices: string[]
  alerts: string[]
  icons?: { icon: string; color?: string }[]
}

/// A copy of the SDK's `DraftSuggestion`.
export interface DraftSuggestion {
  qso: { their: { call: string } }
  notices?: string[]
  alerts?: string[]
}

/// The SDK's `HookContext` with its API 25 members, `findCalls` and
/// `scoreCandidates`.
export interface HookContext25 extends HookContext {
  findCalls?(call: string, options?: FindCallsOptions): Promise<FoundCall[]>
  scoreCandidates?(
    candidates: Record<string, Record<string, JSONValue>>,
    options?: { operationUuid?: string },
  ): Promise<Record<string, CandidateVerdict> | null>
}

/// The SDK's `DataFileDefinition` with its API 25 `sqlite` fetch type.
export type SqliteDataFileDefinition = Omit<DataFileDefinition, "fetchType"> & {
  fetchType: "sqlite"
  sqliteQuery: string
  fields: { key: string; name?: string }
}

type HostCall = (method: string, params: Record<string, unknown>) => Promise<unknown>

let hostCall: HostCall | null = null

/// Keeps the `hostCall` the app hands this extension at activation.
export function bindHostCall(call: unknown): void {
  if (typeof call === "function") hostCall = call as HostCall
}

function call(method: string, params: Record<string, unknown>): Promise<unknown> {
  if (!hostCall) throw new Error(`${method}: the host has not activated this extension`)
  return hostCall(method, params)
}

/// A copy of the SDK's `host.dbLookupFindCalls`.
export async function dbLookupFindCalls(category: string, callsign: string, options: CallMatchOptions = {}): Promise<FoundLookupRow[]> {
  return ((await call("dbLookupFindCalls", { category, call: callsign, ...options })) as FoundLookupRow[] | null) ?? []
}

/// A copy of the SDK's `host.draftSuggestions`.
export const draftSuggestions = {
  async post(params: { forCall: string; drafts: DraftSuggestion[]; operationUuid?: string }): Promise<{ accepted: boolean }> {
    return (await call("draftSuggestionsPost", params)) as { accepted: boolean }
  },
  async clear(options: { operationUuid?: string } = {}): Promise<void> {
    await call("draftSuggestionsClear", options)
  },
}
