// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// The satellites on the Band Scope (extension API 20): while a satellite is up, or about to rise, its downlink is
// marked on the band where you will hear it, Doppler-corrected, "AO-7 ↓" over the stretch of a linear transponder
// or at an FM satellite's frequency, and its uplink where to send, "AO-7 ↑", a step less prominent. The marks
// follow the shift as the pass goes, and are gone when it sets.

import type { BandAnnotation } from "@ham2k/extension-sdk"

import type { Link } from "./data.ts"
import { downlinkDoppler, rangeRate, satrecFromOmm, uplinkDoppler } from "./orbit.ts"
import type { Observer } from "./orbit.ts"
import type { SatellitePass } from "./passes.ts"
import { linksOf } from "./tracking.ts"

/// How far a mark moves, in Hz, before it is put again: a few pixels of a scope, so a satellite does not
/// send one every few seconds near the top of its pass for a change no one can see.
export const MOVE_HZ = 500
/// The most satellites marked at once.
export const MAX_LABELED = 6
const AFTER_SET_MS = 60_000

export interface LabelSettings {
  labels: boolean
  favoritesOnly: boolean
  leadMin: number
}

const hz = (mhz: number): number => Math.round(mhz * 1_000_000)

function mark(key: string, label: string, link: Link, shift: (mhz: number) => number, importance: BandAnnotation["importance"], expiresAt: number): BandAnnotation {
  const from = hz(shift(link.lowerMHz))
  const to = hz(shift(link.upperMHz))
  return {
    type: "known",
    key,
    label,
    fromHz: Math.min(from, to),
    ...(link.upperMHz > link.lowerMHz ? { toHz: Math.max(from, to) } : {}),
    importance,
    icon: "satellite-variant",
    expiresAt,
  }
}

/// The marks to show at `now`: the downlink and uplink of each satellite up or rising within the lead time, soonest first.
export function bandLabels(passes: SatellitePass[], favorites: string[], settings: LabelSettings, observer: Observer, now: number): BandAnnotation[] {
  if (!settings.labels) return []
  const lead = settings.leadMin * 60_000
  const wanted = passes.filter((p) => (!settings.favoritesOnly || favorites.includes(p.satellite.name)) && p.los > now && p.aos - now <= lead && p.satellite.omm)
  const marks: BandAnnotation[] = []
  for (const p of wanted.slice(0, MAX_LABELED)) {
    const satrec = satrecFromOmm(p.satellite.omm!)
    // Before rise, the shift it will have when it comes up.
    const rate = rangeRate(satrec, observer, Math.max(now, p.aos))
    if (rate === null) continue
    const { down, up } = linksOf(p.satellite)
    const name = p.satellite.name
    const expiresAt = p.los + AFTER_SET_MS
    if (down) marks.push(mark(`sat-${name}-down`, `${name} ↓`, down, (f) => downlinkDoppler(f, rate), "primary", expiresAt))
    if (up) marks.push(mark(`sat-${name}-up`, `${name} ↑`, up, (f) => uplinkDoppler(f, rate), "secondary", expiresAt))
  }
  return marks
}

/// The Band Scope calls, handed in so a test can stand in for the app.
export interface BandHost {
  put(annotations: BandAnnotation[]): Promise<void>
  remove(keys?: string[]): Promise<void>
}

/// What is on the scope, so that a mark is put again only once it has moved, and taken off when its pass is over.
export class BandMarks {
  private shown = new Map<string, number>()
  private readonly band: BandHost

  constructor(band: BandHost) {
    this.band = band
  }

  async show(marks: BandAnnotation[]): Promise<void> {
    const keys = new Set(marks.map((m) => m.key!))
    const gone = [...this.shown.keys()].filter((k) => !keys.has(k))
    if (gone.length) {
      for (const k of gone) this.shown.delete(k)
      await this.band.remove(gone)
    }
    const moved = marks.filter((m) => {
      const was = this.shown.get(m.key!)
      return was === undefined || Math.abs(was - m.fromHz) >= MOVE_HZ
    })
    if (!moved.length) return
    for (const m of moved) this.shown.set(m.key!, m.fromHz)
    await this.band.put(moved)
  }

  async clearAll(): Promise<void> {
    await this.show([])
  }
}
