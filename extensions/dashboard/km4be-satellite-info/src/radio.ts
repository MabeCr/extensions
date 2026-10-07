// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// What to tune to: a satellite's frequencies, corrected for the Doppler shift at
// three moments of a pass, and what else is known about the bird.

import type { Link, Satellite } from "./data.ts"
import { downlinkDoppler, rangeRate, satrecFromOmm, uplinkDoppler } from "./orbit.ts"
import type { Observer, Pass } from "./orbit.ts"

/// Lines the radio page has room for: a header, two lines for each of up to three
/// links, and three more for what else is known of the bird.
export const RADIO_LINES = 10
const MAX_LINKS = 3

const mhz = (f: number): string => f.toFixed(4)
const center = (l: Link): number => (l.lowerMHz + l.upperMHz) / 2

/// "435.800–435.900", or one frequency when the band is a point.
export const band = (l: Link): string => (l.lowerMHz === l.upperMHz ? l.lowerMHz.toFixed(3) : `${l.lowerMHz.toFixed(3)}–${l.upperMHz.toFixed(3)}`)

/// Whether a link's range is a band a transponder could be: above zero, low to high, and
/// no wider than half again its own bottom. The Ham2K list is kept by hand and has had a
/// downlink of 145.825–435.88 MHz, whose center is a frequency nothing transmits on; a
/// figure like that is left out, not tuned to.
export const plausible = (l: Link): boolean => l.lowerMHz > 0 && l.upperMHz >= l.lowerMHz && l.upperMHz <= l.lowerMHz * 1.5

/// The links worth listing, downlinks first (that is what is tuned to first), a few
/// in all, and how many were left out as implausible.
function links(satellite: Satellite): { shown: { arrow: "↓" | "↑"; link: Link }[]; skipped: number } {
  const all = [
    ...satellite.downlinks.map((link) => ({ arrow: "↓" as const, link })),
    ...satellite.uplinks.map((link) => ({ arrow: "↑" as const, link })),
  ]
  const sane = all.filter(({ link }) => plausible(link))
  return { shown: sane.slice(0, MAX_LINKS), skipped: all.length - sane.length }
}

/// The radio page, one line each, at most `RADIO_LINES`:
///
///     Doppler-corrected: now · peak · set
///     ↓ 435.800–435.900 linear
///       435.8123 · 435.8000 · 435.7877
///     ↑ 145.850 linear (send)
///       145.8377 · 145.8500 · 145.8623
///
/// A downlink's figures are what the receiver should be tuned to; an uplink's are what the
/// transmitter should be set to for the satellite to hear the band's center.
export function radioLines(satellite: Satellite, observer: Observer, pass: Pass, now: number): string[] {
  const lines: string[] = []
  const { shown, skipped } = links(satellite)
  const satrec = satellite.omm ? satrecFromOmm(satellite.omm) : null

  if (!shown.length) lines.push(skipped ? "The list's frequencies for this satellite look wrong." : "No frequencies known for this satellite.")
  else {
    const moments = [pass.inProgress || pass.aos <= now ? now : pass.aos, pass.maxElevationAt, pass.los]
    lines.push(`Doppler-corrected: ${pass.aos <= now ? "now" : "rise"} · peak · set`)
    for (const { arrow, link } of shown) {
      lines.push(`${arrow} ${band(link)} ${link.mode}${arrow === "↑" ? " (send)" : ""}`.trim())
      const rates = satrec ? moments.map((t) => rangeRate(satrec, observer, t)) : []
      const f = center(link)
      lines.push(
        "  " +
          (rates.length && rates.every((r) => r !== null)
            ? rates.map((r) => mhz(arrow === "↓" ? downlinkDoppler(f, r as number) : uplinkDoppler(f, r as number))).join(" · ")
            : `${mhz(f)} (no Doppler: no orbit data)`),
      )
    }
  }

  if (shown.length && skipped) lines.push("Some frequencies look wrong and are left out.")

  const info = satellite.info
  if (info.ctcssHz) lines.push(`Access tone ${info.ctcssHz} Hz`)
  if (info.beaconMHz) lines.push(`Beacon ${info.beaconMHz.toFixed(3)} MHz`)
  if (info.tips) lines.push(info.tips)
  return lines.slice(0, RADIO_LINES)
}

export const AMSAT_STATUS_URL = "https://www.amsat.org/status/"

/// Where to read more: what we know of the bird, then AMSAT's status page.
export function linksFor(satellite: Satellite): { label: string; url: string }[] {
  return [...(satellite.info.links ?? []), { label: "AMSAT status reports", url: AMSAT_STATUS_URL }]
}
