// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT

import { defineExtension, host } from "@ham2k/extension-sdk"
import type { AnnotatedCallInfo, HookContext, JSONValue, LookupResult } from "@ham2k/extension-sdk"
import { lookupCallRecord } from "@ham2k/lib-ham2k-calls"

import manifest from "../manifest.json" with { type: "json" }

defineExtension({
  ...manifest,
  onActivation({ registerHook }) {
    // Below QRZ (99): a QRZ account, when configured, is the more complete
    // and up-to-date source, so this fills gaps QRZ leaves rather than
    // pre-empting it.
    registerHook('lookup', { hook: { lookupCall }, key: manifest.key, priority: 10 })
  },
})

async function fetchCall(call: string): Promise<Record<string, any> | null> {
  // A call containing indicators (e.g. "KI2D/P") 404s — none of that should
  // prevent the baseCall fallback below from still being tried.
  try {
    const response = await host.fetch(`https://services.ham2k.net/lookups/calls/${encodeURIComponent(call)}.json`)
    if (response.status !== 200) return null
    const data = JSON.parse(response.body)
    if (!data || typeof data !== 'object' || data.error) return null
    return data
  } catch (e) {
    host.log(`Ham2K Lookup Service lookup failed for ${call}: ${(e as Error).message ?? e}`)
    return null
  }
}

/** A non-empty string field (a resolved value, not a blank/absent one). */
const has = (v: unknown): boolean => typeof v === 'string' && v.trim() !== ''

async function lookupCall(
  { callInfo }: { callInfo: AnnotatedCallInfo; qso: Record<string, JSONValue>; operation: Record<string, JSONValue> },
  ctx: HookContext,
): Promise<LookupResult> {
  const call = (callInfo.call || '').trim().toUpperCase()
  if (call.length < 3 || !ctx.online) return [] // this source needs the network

  // The service answers a US or Canadian record with a grid (never a
  // lat/lon pair, and never a grid for a German one), so — unlike HamDB's
  // equivalent check — skipping the round-trip requires a grid already on
  // the guess as well as a name (+ city/portable scope): there is a grid
  // here worth fetching.
  const isPortable = callInfo.locationScope === 'portable'
  if (has(callInfo.name) && has(callInfo.grid) && (isPortable || has(callInfo.city))) return []

  const answer = await lookupCallRecord(callInfo, fetchCall, 'services.ham2k.net')
  // Every answer here took the network (the `!ctx.online` guard above is the
  // only other exit), read generically by the background lookup queue,
  // without knowing this source by name.
  return answer ? [{ ...answer, online: true }] : []
}
