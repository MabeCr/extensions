// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// What a spot says: the call it names and the comment it carries. Pure, so it
// tests without the kernel.

import { PARTY_IDENTITIES } from "@ham2k/qso-parties/identities"
import { locationsOf, partyOf } from "@ham2k/qso-parties/identity"

export type Json = Record<string, unknown>

/// How a reference reads in a spot: its short label (`POTA US-1234`), else
/// its label, else its program's type in capitals beside the code — a hunted
/// ref can arrive undecorated, and a bare `US-1234` names no program.
function refWord(ref: Json): string | undefined {
  const label = [ref.shortLabel, ref.label].find((value) => typeof value === "string" && value.trim())
  if (typeof label === "string") return label.trim()
  const code = typeof ref.ref === "string" ? ref.ref.trim() : ""
  if (!code) return undefined
  const type = typeof ref.type === "string" ? ref.type : ""
  return /^[a-z0-9]{2,6}$/i.test(type) ? `${type.toUpperCase()} ${code}` : code
}

/// What a record's references say, contests first: a reader's 80-column
/// `DX de` line shows only the first 30 characters of the comment, and a
/// contest is what changes how a hunter calls. A QSO party reads
/// `NYQP SUL/DEL`.
export function activityWords(record: Json): string[] {
  const refs = Array.isArray(record.refs) ? (record.refs as Json[]) : []
  const party = partyOf(record, PARTY_IDENTITIES)
  const contests: string[] = []
  const others: string[] = []
  if (party) contests.push([party.party.short, locationsOf(party.ref).join("/")].filter((word) => word).join(" "))
  for (const ref of refs) {
    if (!ref || typeof ref !== "object" || ref === party?.ref) continue
    const word = refWord(ref)
    if (word) (ref.program === "Contest" ? contests : others).push(word)
  }
  return [...new Set([...contests, ...others])]
}

/// The references, then the operator's own words — after `TESTING` for a
/// test operation's spot.
export function spotComment(record: Json, comment: string | undefined, testing = false): string {
  return [testing ? "TESTING" : "", ...activityWords(record), (comment ?? "").trim()].filter((word) => word).join(" - ")
}

/// The first of a comma-separated station call: the cluster takes one call
/// per spot.
export function firstCall(value: unknown): string {
  return String(value ?? "").split(",")[0].trim().toUpperCase()
}

/// The call a self-spot names: the operation's first call, less the
/// `/OP<n>` the app appends for this device's seat in a multi-station
/// operation. On a cluster that reads as a portable designator, so the node
/// lists the station under a call nobody can work.
export function selfSpotCall(operation: Json): string {
  const call = firstCall(operation.stationCall)
  const local = (operation.local ?? {}) as Json
  const seat = `/OP${Number.parseInt(String(local.multiIdentifier ?? ""), 10)}`
  return call.endsWith(seat) ? call.slice(0, -seat.length) : call
}

/// A test operation's call: `/T` as the operation carries it, `/TEST` as the
/// app rewrites it for a self-spot. Nothing on the cluster filters either,
/// so the spot reaches every node in the world — and says so first.
export function isTestCall(call: string): boolean {
  return /\/T(EST)?$/.test(call)
}
