// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// What the HRWBOTA tracker publishes for anyone, read and shaped for the app:
// the host list (`GET /api/hosts`), the event's hours (`GET /api/event`) and
// the hosts on the air (`GET /api/v1/spots`). The spotting API a host posts to
// is in uploader.ts; both follow the tracker's docs/spotting-api.md.

import type { JSONValue, Spot } from "@ham2k/extension-sdk"

import { baseCall, modeGroupFor } from "./rules.ts"
import type { ModeGroup, PowerClass } from "./rules.ts"

export const TRACKER = "https://tracker.hrwbota.com"
export const API_BASE = `${TRACKER}/api`

/// The spot source, as the Spots Panel's filter and each spot name it. Log
/// data: never renamed.
export const SPOT_SOURCE = "hrwbota"

export interface HostEntry {
  id: string
  call: string
  name: string
  kind: "host" | "wildcard"
  powerClass: PowerClass
  pointsOverride: number | null
}

export interface EventHours {
  name: string
  startMillis: number
  endMillis: number
}

/// The tracker's own allowance for a clock off by a few minutes: contacts this
/// close outside the hours still count.
export const WINDOW_SLACK_MS = 5 * 60 * 1000

export function inEvent(event: EventHours | undefined, millis: number): boolean {
  if (!event) return true
  return millis >= event.startMillis - WINDOW_SLACK_MS && millis <= event.endMillis + WINDOW_SLACK_MS
}

function object(value: unknown): Record<string, JSONValue> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, JSONValue>) : undefined
}

export function parseJson(body: string): Record<string, JSONValue> | undefined {
  try {
    return object(JSON.parse(body))
  } catch {
    return undefined
  }
}

const POWER_CLASSES: PowerClass[] = ["qro", "100w", "qrp"]

/// The active hosts, as `GET /api/hosts` lists them. An entry missing a call
/// or a power class is left out rather than guessed at.
export function parseHosts(body: string): HostEntry[] {
  const list = parseJson(body)?.hosts
  if (!Array.isArray(list)) throw new Error("the tracker's host list is not a list")
  const hosts: HostEntry[] = []
  for (const item of list) {
    const h = object(item)
    if (!h || typeof h.id !== "string" || typeof h.call !== "string") continue
    const powerClass = POWER_CLASSES.find((p) => p === h.powerClass)
    if (!powerClass) continue
    hosts.push({
      id: h.id,
      call: h.call.toUpperCase(),
      name: typeof h.name === "string" ? h.name : "",
      kind: h.kind === "wildcard" ? "wildcard" : "host",
      powerClass,
      pointsOverride: typeof h.pointsOverride === "number" ? h.pointsOverride : null,
    })
  }
  return hosts
}

export function parseEvent(body: string): EventHours | undefined {
  const event = object(parseJson(body)?.event)
  if (!event) return undefined
  const startMillis = Date.parse(String(event.startsAt ?? ""))
  const endMillis = Date.parse(String(event.endsAt ?? ""))
  if (!Number.isFinite(startMillis) || !Number.isFinite(endMillis)) return undefined
  return { name: typeof event.name === "string" ? event.name : "HRWBOTA", startMillis, endMillis }
}

/// Hosts by base call, the way a contact's call is matched to one.
export class HostTable {
  readonly hosts: HostEntry[]
  private readonly byCall: Map<string, HostEntry>

  constructor(hosts: HostEntry[]) {
    this.hosts = hosts
    this.byCall = new Map(hosts.map((h) => [baseCall(h.call) ?? h.call, h]))
  }

  forCall(call: string | undefined): HostEntry | undefined {
    if (!call) return undefined
    const base = baseCall(call)
    return base ? this.byCall.get(base) : undefined
  }

  get size(): number {
    return this.hosts.length
  }
}

const MODE_LABELS: Record<ModeGroup, string> = { cw: "CW", phone: "SSB", digital: "DIGI", dmr: "DMR" }

/// "8 pts CW", or "4 pts SSB · 4 pts DIGI", or "6.52 pts" for a wildcard.
export function pointsLabel(points: Partial<Record<ModeGroup, number>>, mode: string | undefined): string {
  const group = mode ? modeGroupFor(mode) : undefined
  if (group && typeof points[group] === "number") return `${points[group]} pts ${MODE_LABELS[group]}`
  const values = new Set(Object.values(points))
  if (values.size === 1) return `${[...values][0]} pts`
  return (Object.keys(MODE_LABELS) as ModeGroup[])
    .filter((g) => typeof points[g] === "number")
    .map((g) => `${points[g]} ${MODE_LABELS[g]}`)
    .join(" · ")
}

/// The hosts on the air, as spots. The feed already leaves out hosts that are
/// not on the air or have not been heard from in 30 minutes. A host with no
/// frequency (DMR, AllStar) has nothing to tune to, and is not a spot.
export function parseSpots(body: string, label: string): Spot[] {
  const list = parseJson(body)?.spots
  if (!Array.isArray(list)) throw new Error("the tracker's spots feed is not a list")
  const spots: Spot[] = []
  for (const item of list) {
    const s = object(item)
    if (!s || typeof s.call !== "string" || typeof s.frequencyKhz !== "number") continue
    const updatedAt = Date.parse(String(s.updatedAt ?? ""))
    if (!Number.isFinite(updatedAt)) continue
    const mode = typeof s.mode === "string" && s.mode ? s.mode : undefined
    const points = (object(s.points) ?? {}) as Partial<Record<ModeGroup, number>>
    const refs = Array.isArray(s.refs)
      ? s.refs.flatMap((r) => {
          const ref = object(r)
          return ref && typeof ref.type === "string" && typeof ref.ref === "string" ? [{ type: ref.type, ref: ref.ref }] : []
        })
      : []
    const note = typeof s.note === "string" && s.note ? ` · ${s.note}` : ""
    spots.push({
      their: { call: s.call.toUpperCase() },
      freq: s.frequencyKhz,
      ...(typeof s.band === "string" ? { band: s.band } : {}),
      ...(mode ? { mode } : {}),
      refs,
      key: String(s.hostId ?? s.call),
      spot: {
        timeInMillis: updatedAt,
        source: SPOT_SOURCE,
        label: `${label} ${pointsLabel(points, mode)}${note}`,
        sourceInfo: { hostId: String(s.hostId ?? ""), kind: s.kind === "wildcard" ? "wildcard" : "host" },
      },
    })
  }
  return spots
}
