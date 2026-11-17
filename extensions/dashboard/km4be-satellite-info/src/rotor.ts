// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// Rotator tracking (extension API 23): pointing the station's antenna at the satellite as the pass goes.
// Before rise the rotator is turned to where the satellite will come up, on the horizon; during the pass
// it is told the satellite's azimuth, and its elevation on a rotator that has one, a step at a time; it is
// left where the satellite set. A rotator is slow and its commands are paced, so it is told again only once
// the satellite has moved a few degrees from where it was last sent, aimed a couple of seconds ahead.

import type { StationEquipment, StationEquipmentResult } from "@ham2k/extension-sdk"

import type { Satellite } from "./data.ts"
import { compass, lookAt, satrecFromOmm } from "./orbit.ts"
import type { Observer } from "./orbit.ts"
import type { SatRec } from "./vendor/satellite.js/index.js"

/// The calls rotator tracking makes, handed in so a test can stand in for the rotator.
export interface RotatorHost {
  listEquipment(): Promise<StationEquipment[]>
  setRotator(args: { id: string; azimuth: number; elevation?: number }): Promise<StationEquipmentResult>
}

/// How far the satellite moves, in degrees, before the rotator is told again: inside the beam of a satellite yagi,
/// and coarse enough that a rotator is not kept starting and stopping.
export const STEP_DEG = 4
/// How far ahead of the satellite the antenna is aimed, so that a rotator that takes a moment to get there arrives with it.
export const LEAD_MS = 2_000
const AFTER_SET_MS = 10_000

export interface RotatorPass {
  satellite: Satellite
  observer: Observer
  aos: number
  los: number
}

/// The angle between two azimuths, the short way round.
export const azDiff = (a: number, b: number): number => Math.abs((((a - b) % 360) + 540) % 360 - 180)

/// The station's rotators, for the dropdown: none first.
export function rotatorOptions(equipment: StationEquipment[]): { label: string; value: string }[] {
  return [{ label: "No rotator", value: "" }, ...equipment.filter((e) => e.kind === "rotator").map((e) => ({ label: e.name || e.id, value: e.id }))]
}

const REFUSED: Record<string, string> = {
  invalid: "the rotator would not take that",
  disconnected: "the rotator is not connected",
  failed: "the rotator's driver could not send it",
}

export class RotatorTracker {
  private pass: RotatorPass | null = null
  private satrec: SatRec | null = null
  private rotator = ""
  private sent: { azimuth: number; elevation?: number } | null = null
  private busy = false
  private line = ""
  private readonly host: RotatorHost
  private readonly clock: () => number

  constructor(host: RotatorHost, clock: () => number = Date.now) {
    this.host = host
    this.clock = clock
  }

  /// The rotator to point; kept from one pass to the next.
  setRotator(id: string | null): void {
    this.rotator = id ?? ""
    this.sent = null
  }

  get rotatorId(): string {
    return this.rotator
  }

  start(pass: RotatorPass): void {
    this.pass = pass
    this.satrec = pass.satellite.omm ? satrecFromOmm(pass.satellite.omm) : null
    this.sent = null
    this.line = "Rotator: starting…"
  }

  stop(why = ""): void {
    this.pass = null
    this.satrec = null
    this.line = why
  }

  get active(): boolean {
    return this.pass !== null
  }

  isTracking(name: string, los: number): boolean {
    return this.pass !== null && this.pass.satellite.name === name && Math.abs(this.pass.los - los) < 120_000
  }

  status(): { on: boolean; line: string } {
    return { on: this.pass !== null, line: this.line }
  }

  async tick(): Promise<void> {
    if (!this.pass || this.busy) return
    this.busy = true
    try {
      await this.step(this.pass)
    } finally {
      this.busy = false
    }
  }

  private async step(pass: RotatorPass): Promise<void> {
    const now = this.clock()
    if (now > pass.los + AFTER_SET_MS) {
      this.stop(`Rotator left where ${pass.satellite.name} set.`)
      return
    }
    if (!this.satrec) {
      this.stop(`The rotator cannot follow ${pass.satellite.name}: there is no orbit for it.`)
      return
    }
    if (!this.rotator) {
      this.line = "Rotator: choose one to point."
      return
    }
    const device = (await this.host.listEquipment()).find((e) => e.id === this.rotator && e.kind === "rotator")
    if (!device) {
      this.line = "Rotator: the one chosen is not set up any more."
      return
    }
    if (!device.connected) {
      this.line = `Rotator: ${device.name} is not connected.`
      return
    }
    // Before rise, where it will come up, on the horizon; during the pass, a little ahead of where it is.
    const look = lookAt(this.satrec, pass.observer, now < pass.aos ? pass.aos : Math.min(pass.los, now + LEAD_MS))
    if (!look) return
    const elevating = device.elevation !== undefined
    const want = { azimuth: Math.round(look.azimuth) % 360, ...(elevating ? { elevation: Math.max(0, Math.round(look.elevation)) } : {}) }
    const far =
      !this.sent || azDiff(this.sent.azimuth, want.azimuth) >= STEP_DEG || (elevating && Math.abs((this.sent.elevation ?? 0) - (want.elevation ?? 0)) >= STEP_DEG)
    let problem = ""
    if (far) {
      const result = await this.host.setRotator({ id: device.id, ...want })
      if (result.accepted) this.sent = want
      else if (result.reason && REFUSED[result.reason]) problem = REFUSED[result.reason]
    }
    const aim = this.sent ?? want
    const where = `${aim.azimuth}° ${compass(aim.azimuth)}${elevating ? `, El ${aim.elevation}°` : ""}`
    this.line = `Rotator ${now < pass.aos ? "ready for rise" : "tracking"}: ${device.name} to ${where}${problem ? ` (${problem})` : ""}`
  }
}
