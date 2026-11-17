// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// Doppler tracking: keeping the radio on a satellite's signal as the pass goes. Once a second the
// logging radio is tuned to where the downlink is heard right now, and, when the operator names a
// second receiver for it, that one to where the uplink has to be sent for the satellite to hear it.
//
// What is tracked is the frequency at the satellite, not one on the dial. It starts at the middle of
// the transponder; when the operator turns the dial, the frequency at the satellite they have moved to
// is worked back out from the dial and the shift, and kept from then on. So tuning across a linear
// transponder works as it does on the air: the station heard stays put while the shift moves under it.
// The uplink follows the downlink through the transponder: the same distance in from the band's
// bottom, or, on an inverting transponder, the same distance in from the other end.
//
// Before the satellite rises the radio is set to where the downlink will be at rise, and left there.

import type { PanelRadioResult, PanelRadioSet, PanelRadioState } from "@ham2k/extension-sdk"

import type { Link, Satellite } from "./data.ts"
import { downlinkDoppler, rangeRate, satrecFromOmm, uplinkDoppler } from "./orbit.ts"
import type { Observer } from "./orbit.ts"
import { plausible } from "./radio.ts"
import type { SatRec } from "./vendor/satellite.js/index.js"

/// The radio calls tracking makes, handed in so a test can stand in for the radio.
export interface RadioHost {
  readRadio(id?: string): Promise<PanelRadioState | null>
  setRadio(args: PanelRadioSet): Promise<PanelRadioResult>
}

/// How far the dial has to be from where tracking last put it before that is taken as the operator
/// tuning, and not as the radio rounding or still getting there.
export const RETUNE_HZ = 60
/// How far off the right frequency a radio is let drift before it is told again: well under what an
/// SSB ear notices, and few enough commands that a CAT link is never kept busy.
export const RESEND_HZ = 15
/// How long after the satellite sets tracking keeps going, so that the last of the signal is followed.
const AFTER_SET_MS = 10_000

export interface TrackedPass {
  satellite: Satellite
  observer: Observer
  aos: number
  los: number
}

/// What tracking is doing, for the pane to say.
export interface TrackingStatus {
  /// Whether tracking is on for this satellite and pass.
  on: boolean
  name?: string
  los?: number
  /// One line for the pane: where the radio is being kept, or why it is not.
  line: string
}

const hz = (mhz: number): number => Math.round(mhz * 1_000_000)
const mhzText = (h: number): string => (h / 1_000_000).toFixed(5)
const middle = (l: Link): number => (l.lowerMHz + l.upperMHz) / 2

/// Whether the list says a linear transponder inverts: only when it says so outright, not of one of several modes.
export const inverting = (satellite: Satellite): boolean => satellite.modulation === "linear" && /^\s*inverting\b/i.test(satellite.info.inversion ?? "")

/// The downlink and uplink tracking uses: the first of each that the list has plausibly.
export function linksOf(satellite: Satellite): { down?: Link; up?: Link } {
  return { down: satellite.downlinks.find(plausible), up: satellite.uplinks.find(plausible) }
}

/// Where to send, at the satellite, for it to be heard on `downMHz` at the satellite. On a linear transponder that is
/// the same place in the uplink's band, counted from the bottom or, inverting, from the top; elsewhere the uplink's middle.
export function uplinkFor(satellite: Satellite, down: Link, up: Link, downMHz: number): number {
  if (satellite.modulation !== "linear" || up.lowerMHz === up.upperMHz || down.lowerMHz === down.upperMHz) return middle(up)
  const along = inverting(satellite) ? down.upperMHz - downMHz : downMHz - down.lowerMHz
  return Math.min(up.upperMHz, Math.max(up.lowerMHz, up.lowerMHz + along))
}

/// The mode to put the downlink receiver in when tracking starts, if the radio has it: FM for an FM
/// satellite, USB for a linear one (CW is the operator's choice, and left alone), nothing for the rest.
export function startMode(satellite: Satellite, modes: string[] | undefined): string | undefined {
  const want = satellite.modulation === "fm" ? "FM" : satellite.modulation === "linear" ? "USB" : undefined
  return want && (modes ?? []).includes(want) ? want : undefined
}

/// Words for a radio's refusal, for the status line.
const REFUSED: Record<string, string> = {
  disconnected: "the radio is not connected",
  transmitting: "waiting while you transmit",
  invalid: "the radio would not take that frequency",
  unsupported: "the radio cannot be tuned from here",
  changed: "the logging radio changed",
}

export class DopplerTracker {
  private pass: TrackedPass | null = null
  private satrec: SatRec | null = null
  private uplinkRadio: string | null = null
  /// The frequency at the satellite being followed, in MHz; set at the first tick.
  private downAtSatellite: number | null = null
  /// Where tracking last put each radio, to tell the operator's tuning from its own.
  private sentDown: number | null = null
  private moded = false
  private busy = false
  private line = ""

  private readonly radio: RadioHost
  private readonly clock: () => number

  constructor(radio: RadioHost, clock: () => number = Date.now) {
    this.radio = radio
    this.clock = clock
  }

  /// Starts following `pass`, the downlink on the logging radio and, with `uplinkRadio`, the uplink on that one.
  start(pass: TrackedPass, uplinkRadio: string | null = null): void {
    this.pass = pass
    this.satrec = pass.satellite.omm ? satrecFromOmm(pass.satellite.omm) : null
    this.uplinkRadio = uplinkRadio || null
    this.downAtSatellite = null
    this.sentDown = null
    this.moded = false
    this.line = "Doppler tracking: starting…"
  }

  /// Names the receiver the uplink goes to, or none, without starting over.
  setUplinkRadio(id: string | null): void {
    this.uplinkRadio = id || null
  }

  stop(why = ""): void {
    this.pass = null
    this.satrec = null
    this.line = why
  }

  /// Whether tracking is on for this satellite's pass ending at `los` (within two minutes, as passes are matched elsewhere).
  isTracking(name: string, los: number): boolean {
    return this.pass !== null && this.pass.satellite.name === name && Math.abs(this.pass.los - los) < 120_000
  }

  get active(): boolean {
    return this.pass !== null
  }

  get uplink(): string | null {
    return this.uplinkRadio
  }

  status(): TrackingStatus {
    return this.pass ? { on: true, name: this.pass.satellite.name, los: this.pass.los, line: this.line } : { on: false, line: this.line }
  }

  /// One step: where the radios should be now, and telling them if they are not there. Never two at once.
  async tick(): Promise<void> {
    if (!this.pass || this.busy) return
    this.busy = true
    try {
      await this.step(this.pass)
    } finally {
      this.busy = false
    }
  }

  private async step(pass: TrackedPass): Promise<void> {
    const now = this.clock()
    if (now > pass.los + AFTER_SET_MS) {
      this.stop(`Doppler tracking stopped: ${pass.satellite.name} has set.`)
      return
    }
    const { down, up } = linksOf(pass.satellite)
    if (!this.satrec || !down) {
      this.stop(`Doppler tracking is not possible: ${this.satrec ? "no downlink frequency is known" : "there is no orbit"} for ${pass.satellite.name}.`)
      return
    }
    // Before rise, the shift at rise: the radio waits where the satellite will first be heard.
    const rate = rangeRate(this.satrec, pass.observer, Math.max(now, pass.aos))
    if (rate === null) return
    const radio = await this.radio.readRadio()
    if (!radio?.id || radio.status !== "connected") {
      this.line = "Doppler tracking: no radio connected."
      return
    }

    // The operator has turned the dial: follow the frequency at the satellite they moved to.
    const dial = radio.frequencyHz
    if (this.downAtSatellite === null) this.downAtSatellite = middle(down)
    else if (this.sentDown !== null && dial !== null && Math.abs(dial - this.sentDown) > RETUNE_HZ) {
      this.downAtSatellite = dial / 1_000_000 / downlinkDoppler(1, rate)
    }

    const downHz = hz(downlinkDoppler(this.downAtSatellite, rate))
    const problems: string[] = []
    if (dial === null || Math.abs(dial - downHz) >= RESEND_HZ || (!this.moded && startMode(pass.satellite, radio.modes))) {
      const mode = this.moded ? undefined : startMode(pass.satellite, radio.modes)
      const result = await this.radio.setRadio({ id: radio.id, frequencyHz: downHz, ...(mode && mode !== radio.mode ? { mode } : {}) })
      if (result.accepted) {
        this.sentDown = downHz
        this.moded = true
      } else if (result.reason && REFUSED[result.reason]) problems.push(REFUSED[result.reason])
    } else this.sentDown = dial

    let upHz: number | null = null
    let upName = ""
    if (this.uplinkRadio && up) {
      upHz = hz(uplinkDoppler(uplinkFor(pass.satellite, down, up, this.downAtSatellite), rate))
      const other = await this.radio.readRadio(this.uplinkRadio)
      upName = other?.channel?.label ?? other?.name ?? "the uplink radio"
      if (!other?.id || other.status !== "connected") problems.push(`${upName} is not connected`)
      else if (other.frequencyHz === null || Math.abs(other.frequencyHz - upHz) >= RESEND_HZ) {
        const result = await this.radio.setRadio({ id: other.id, selection: other.id, frequencyHz: upHz })
        if (!result.accepted && result.reason && REFUSED[result.reason]) problems.push(`${upName}: ${REFUSED[result.reason]}`)
      }
    }

    const where = `↓ ${mhzText(downHz)}${upHz !== null ? ` · ↑ ${mhzText(upHz)}` : ""}`
    const when = now < pass.aos ? "ready for rise" : "tracking"
    this.line = `Doppler ${when}: ${where}${problems.length ? ` (${problems.join("; ")})` : ""}`
  }
}

/// What a pass's page shows of tracking: whether it is on for this pass, what it is doing, and the
/// receivers the uplink can go to (none first).
export interface TrackingView {
  on: boolean
  line: string
  uplink: string
  uplinkOptions: { label: string; value: string }[]
  /// The rotator, pointed at this pass or not, and which.
  rotorOn?: boolean
  rotorLine?: string
  rotator?: string
  rotatorOptions?: { label: string; value: string }[]
  /// The satellite put on the contacts of this pass, or not.
  fillOn?: boolean
  fillLine?: string
}

/// The receivers the uplink can be sent on: every radio the app has other than the logging one, each by its name and,
/// on a radio with two, which receiver it is.
export function uplinkOptions(radios: PanelRadioState[], logging: string | null): { label: string; value: string }[] {
  const others = radios.filter((r) => r.id && r.id !== logging)
  return [
    { label: "No uplink radio", value: "" },
    ...others.map((r) => ({ label: [r.name, r.channel?.label].filter(Boolean).join(" ") || String(r.id), value: String(r.id) })),
  ]
}
