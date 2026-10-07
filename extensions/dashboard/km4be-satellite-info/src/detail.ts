// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// One pass in detail: when it rises, peaks and sets, where it goes across the
// sky, and what to tune to. Two tabs of a small screen, since a scene cannot
// scroll: the Sky (plot and times) and the Radio (frequencies and Doppler).

import type { Satellite } from "./data.ts"
import { compass, findPasses, satrecFromOmm } from "./orbit.ts"
import type { Observer, Pass } from "./orbit.ts"
import { clock } from "./passes.ts"
import { RADIO_LINES, radioLines } from "./radio.ts"
import { compassLayers, DEFAULT_SKY_COLORS, skySvg, skyTrack } from "./sky.ts"
import type { SkyColors } from "./sky.ts"

export type Tab = "sky" | "radio"

export interface DetailModel {
  title: string
  tab: Tab
  utc: boolean
  /// Rise, peak and set, a line each.
  times: string[]
  /// The radio page, padded to `RADIO_LINES`.
  radio: string[]
  /// The sky plot, drawn with `colors`.
  sky: { svg: string; compass: ReturnType<typeof compassLayers> }
}

/// What the plot is drawn in: the host's own colors when it reports them, so the plot
/// follows the app's light and dark themes, and a neutral set when it does not.
export interface Theme {
  sky: SkyColors
  text: string
}

export const DEFAULT_THEME: Theme = { sky: DEFAULT_SKY_COLORS, text: "#8a8a8a" }

export function themeOf(colors: Record<string, string> | undefined): Theme {
  if (!colors) return DEFAULT_THEME
  return {
    text: colors.onSurface ?? DEFAULT_THEME.text,
    sky: {
      grid: colors.onSurfaceVariant ?? DEFAULT_SKY_COLORS.grid,
      path: colors.accent ?? colors.primary ?? DEFAULT_SKY_COLORS.path,
      rise: DEFAULT_SKY_COLORS.rise,
      peak: colors.onSurface ?? DEFAULT_SKY_COLORS.peak,
      set: colors.error ?? DEFAULT_SKY_COLORS.set,
    },
  }
}

/// A pass that was already under way when the list was worked out begins there, not where
/// the satellite really rose. Looking back a half hour finds the real edges.
export function completePass(satellite: Satellite, observer: Observer, pass: Pass, now: number): Pass {
  if (!satellite.omm || pass.aos > now) return pass
  const found = findPasses(satrecFromOmm(satellite.omm), observer, now - 30 * 60_000, 1, 0)
  return found.find((p) => Math.abs(p.los - pass.los) < 120_000) ?? pass
}

const deg = (n: number): string => `${Math.round(n)}°`

export function buildDetail(
  satellite: Satellite,
  observer: Observer,
  listed: Pass,
  now: number,
  utc: boolean,
  tab: Tab,
  theme: Theme = DEFAULT_THEME,
): DetailModel {
  const pass = completePass(satellite, observer, listed, now)
  const at = (t: number) => clock(t, pass.aos, utc)

  const track = satellite.omm ? skyTrack(satrecFromOmm(satellite.omm), observer, pass) : []
  const radio = radioLines(satellite, observer, pass, now)
  while (radio.length < RADIO_LINES) radio.push("")

  return {
    title: `${satellite.name} · ${at(pass.aos)}–${at(pass.los)}`,
    tab,
    utc,
    times: [
      `Rise  ${at(pass.aos)}  ${compass(pass.aosAzimuth)} ${deg(pass.aosAzimuth)}`,
      `Peak  ${at(pass.maxElevationAt)}  ${deg(pass.maxElevation)} toward ${compass(pass.maxAzimuth)}`,
      `Set   ${at(pass.los)}  ${compass(pass.losAzimuth)} ${deg(pass.losAzimuth)}`,
    ],
    radio,
    sky: { svg: skySvg(track, pass, theme.sky, now), compass: compassLayers(theme.text) },
  }
}
