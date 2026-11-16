// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// services.ham2k.net's callsign records as lookup answers, for the two ways
// an extension reaches them: `ham2k-lookup` asks the service for one call at
// a time, and the offline extensions keep one of its sets on the device and
// read it from there (`./offline.ts`, its own entry point so that
// `ham2k-lookup`'s bundle carries none of it). Both read the same record, so
// they answer alike.

import { cleanLocationParams } from "@ham2k/lib-geo-tools"
import type { AnnotatedCallInfo, CallInfoLookup } from "@ham2k/extension-sdk"

/// The service's ISO-3166 alpha-2 codes as the full names CallInfo.country
/// carries (QRZ and HamDB both report full names).
export const COUNTRY_NAMES: Record<string, string> = {
  US: "United States",
  CA: "Canada",
  DE: "Germany",
  NO: "Norway",
}

/// The service's class names, per country, as "<regulator key>:<level code>"
/// pairs from @ham2k/lib-operation-data's LICENSE_LEVELS. "Basic + Morse"
/// stands for both Morse qualifications, 5 and 12 wpm, which open the same
/// bands; B+5 is the level lib-operation-data has for them. Norway's records
/// carry no class.
export const LICENSE_LEVELS: Record<string, Record<string, string>> = {
  US: { Novice: "us:N", Technician: "us:T", General: "us:G", Advanced: "us:A", Extra: "us:E" },
  CA: { Basic: "ca:B", "Basic with Honours": "ca:B/H", "Basic + Morse": "ca:B+5", Advanced: "ca:B+A" },
  DE: { "Class N": "de:N", "Class E": "de:E", "Class A": "de:A" },
}

export type Ham2kCallLookup = CallInfoLookup & { online?: boolean; licenseLevel?: string }

/// One of the service's call records as a lookup answer about [call].
export function callRecordLookup(
  record: Record<string, unknown>,
  { call, source, locationScope }: { call: string; source: string; locationScope: CallInfoLookup["locationScope"] },
): Ham2kCallLookup {
  const real = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined)

  const city = real(record.city)
  const state = real(record.state)
  const countryCode = real(record.country)
  const [lat, lon] = cleanLocationParams(real(record.lat), real(record.lon))
  return {
    call: real(record.call) ?? call,
    source,
    scope: "general",
    locationScope,
    name: real(record.name),
    location: [city, state].filter(Boolean).join(", "),
    city,
    state,
    county: real(record.county),
    country: countryCode ? (COUNTRY_NAMES[countryCode] ?? countryCode) : undefined,
    grid: real(record.grid),
    lat,
    lon,
    licenseLevel: countryCode ? LICENSE_LEVELS[countryCode]?.[real(record.class) ?? ""] : undefined,
  }
}

/// The record for a call, or null when the source has none.
export type CallRecordSource = (call: string) => Promise<Record<string, unknown> | null>

/// The answer about [callInfo] from [records]: the call as given first, then
/// its base call. The service knows only plain registered calls, so a
/// "KI2D/P" is usually answered by "KI2D", and that answer is the operator's
/// home QTH whatever the call's own scope says.
export async function lookupCallRecord(callInfo: AnnotatedCallInfo, records: CallRecordSource, source: string): Promise<Ham2kCallLookup | null> {
  const call = (callInfo.call || "").trim().toUpperCase()
  if (call.length < 3) return null

  let record = await records(call)
  let locationScope: CallInfoLookup["locationScope"] = callInfo.locationScope ?? "qth"
  if (!record && callInfo.baseCall && callInfo.baseCall.toUpperCase() !== call) {
    record = await records(callInfo.baseCall.toUpperCase())
    locationScope = "qth"
  }
  return record ? callRecordLookup(record, { call, source, locationScope }) : null
}
