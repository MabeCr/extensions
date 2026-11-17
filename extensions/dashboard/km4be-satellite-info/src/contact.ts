// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// Filling in the contact (extension API 22): while it is switched on for a pass, every contact the operator
// starts gets the satellite as its own, the ref Ham2K's Satellites activity uses, so the logs and exports
// say which bird it went through (SAT_NAME, PROP_MODE) without typing SAT in the call field. It runs
// for the pass and a few minutes after, for the contacts logged just as the satellite sets.

import type { Satellite } from "./data.ts"
import { linksOf } from "./tracking.ts"

/// The ref type Ham2K's Satellites activity reads.
export const SATELLITE_REF = "satellite"
/// How long after set contacts still go through the satellite: the last ones are often logged a minute or two late.
export const FILL_AFTER_MS = 5 * 60_000

export interface Ref {
  type: string
  ref: string
  [key: string]: unknown
}

/// The activity's code for a transponder, `AO-7/145.85/linear`: the satellite, its uplink's bottom and its mode. The
/// uplink is the one tracking uses, the first the list has plausibly, else the first at all; null with none.
export function satelliteRef(satellite: Satellite): Ref | null {
  const up = linksOf(satellite).up ?? satellite.uplinks[0]
  return up ? { type: SATELLITE_REF, ref: `${satellite.name}/${up.lowerMHz}/${up.mode}` } : { type: SATELLITE_REF, ref: satellite.name }
}

/// The refs a contact should have: its own, with any other satellite's taken off and this one's on; null when it has this one already.
export function refsWith(current: unknown, ref: Ref): Ref[] | null {
  const refs = Array.isArray(current) ? (current as Ref[]).filter((r) => r && typeof r.type === "string") : []
  if (refs.some((r) => r.type === SATELLITE_REF && r.ref === ref.ref)) return null
  return [...refs.filter((r) => r.type !== SATELLITE_REF), ref]
}

/// Which pass contacts are being filled in for, if any.
export class ContactFiller {
  private pass: { name: string; los: number; ref: Ref } | null = null

  start(satellite: Satellite, los: number): void {
    const ref = satelliteRef(satellite)
    this.pass = ref ? { name: satellite.name, los, ref } : null
  }

  stop(): void {
    this.pass = null
  }

  isFilling(name: string, los: number): boolean {
    return this.pass !== null && this.pass.name === name && Math.abs(this.pass.los - los) < 120_000
  }

  /// The ref to put on the contact at `now`, or null when filling is off or its pass is long over (which also turns it off).
  refAt(now: number): Ref | null {
    if (this.pass && now > this.pass.los + FILL_AFTER_MS) this.pass = null
    return this.pass?.ref ?? null
  }

  get name(): string | undefined {
    return this.pass?.name
  }
}
