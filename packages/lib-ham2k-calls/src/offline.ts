// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// A services.ham2k.net call set kept on the device as a `ham2k` data file
// (extension API 22), and the lookup that reads it with no network.

import { createCachedTranslator, host } from "@ham2k/extension-sdk"
import type { ActivationApi, AnnotatedCallInfo, DataFileDefinition, HookContext, JSONValue, LookupResult } from "@ham2k/extension-sdk"

import { lookupCallRecord } from "./index.ts"
import type { CallRecordSource } from "./index.ts"

import en from "./i18n/en.json" with { type: "json" }
import es from "./i18n/es.json" with { type: "json" }

const tFor = createCachedTranslator({ en: { translation: en }, es: { translation: es } })

/// A services.ham2k.net call set kept on the device: `all` is every public
/// callsign, `hf` those with HF privileges.
export type Ham2kCallSet = "all" | "hf"

/// Who answered, beside each field the operator sees. Not the online
/// source's own `services.ham2k.net`: the app counts a stored answer under
/// that name, without `online`, as one that took a network round trip, and
/// would never fetch the station's online record for a contact this answered.
export const OFFLINE_SOURCE = "services.ham2k.net (offline)"

/// Below `ham2k-lookup` (10), so that with a network the online record
/// answers first and is stored as one (`online: true`). Above it, this fills
/// the name, grid and town that source checks before fetching, it never
/// fetches, and the app keeps queueing the contact for the online answer it
/// never gets.
export const OFFLINE_PRIORITY = 9

const SERVICE = "https://services.ham2k.net/lookups/calls"

/// The `ham2k` data file holding [set], under the category [key].
export function offlineCallsDataFile(key: string, set: Ham2kCallSet): DataFileDefinition {
  return {
    key,
    name: (_args: Record<string, never>, ctx: HookContext) => tFor(ctx)(`${set}Name`),
    description: (_args: Record<string, never>, ctx: HookContext) => tFor(ctx)(`${set}Description`),
    url: `${SERVICE}/download?set=${set}`,
    deltaUrl: `${SERVICE}/delta?set=${set}&since={since}`,
    // The service publishes a new version of each set daily.
    maxAgeInDays: 1,
    fetchType: "ham2k",
    category: key,
    fields: { key: "call", name: "name", subCategory: "country" },
  }
}

/// Registers [set]'s data file and the lookup that reads it, both under [key].
export function registerOfflineCalls(registerHook: ActivationApi["registerHook"], { key, set }: { key: string; set: Ham2kCallSet }): void {
  // A `ham2k` row's `data` is the whole record as the service sent it.
  const records: CallRecordSource = async (call) => {
    const data = (await host.dbLookupSelectOne(key, call))?.data
    return data && typeof data === "object" && !Array.isArray(data) ? data : null
  }
  registerHook("dataFile", { hook: offlineCallsDataFile(key, set), key })
  registerHook("lookup", {
    hook: {
      async lookupCall({ callInfo }: { callInfo: AnnotatedCallInfo; qso: Record<string, JSONValue>; operation: Record<string, JSONValue> }): Promise<LookupResult> {
        const answer = await lookupCallRecord(callInfo, records, OFFLINE_SOURCE)
        return answer ? [answer] : []
      },
    },
    key,
    priority: OFFLINE_PRIORITY,
  })
}
