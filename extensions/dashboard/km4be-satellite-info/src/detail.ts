// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// One pass in detail: when it rises, peaks and sets, where it goes across the
// sky, and what to tune to. Two tabs of a small screen, since a scene cannot
// scroll: the Sky (plot and times) and the Radio (frequencies and Doppler).

import type { Satellite } from "./data.ts"
import { compass, findPasses, satrecFromOmm } from "./orbit.ts"
import type { Observer, Pass } from "./orbit.ts"
import { clock, countdown } from "./passes.ts"
import { RADIO_LINES, radioLines } from "./radio.ts"
import { compassLayers, DEFAULT_SKY_COLORS, SKY_SIZE, skySvg, skyTrack, skyXY } from "./sky.ts"
import type { SkyColors } from "./sky.ts"

export type Tab = "sky" | "radio"

export interface DetailModel {
  title: string
  tab: Tab
  utc: boolean
  /// Rise, peak and set, a line each, to the second, with the time to or since each if asked for.
  times: string[]
  /// What AMSAT's status reports say of the satellite: the verdict, then the latest report.
  status: string[]
  /// The radio page, padded to `RADIO_LINES`.
  radio: string[]
  /// The sky plot, with the compass letters and the times of rise, peak and set written on it.
  sky: { svg: string; compass: ReturnType<typeof compassLayers>; labels: ReturnType<typeof pointLabel>[] }
}

const LABEL_HEIGHT = 16
const LABEL_SIZE = 12

/// A short text on the plot beside a point of the sky: to the right of it on the east half,
/// to the left on the west half, kept inside the plot.
export function pointLabel(id: string, text: string, azimuth: number, elevation: number, color: string) {
  const { x, y } = skyXY(azimuth, elevation)
  const width = Math.ceil(text.length * LABEL_SIZE * 0.62) + 6
  const east = x >= SKY_SIZE / 2
  const left = Math.min(Math.max(east ? x + 9 : x - 9 - width, 0), SKY_SIZE - width)
  const top = Math.min(Math.max(y - LABEL_HEIGHT / 2, 0), SKY_SIZE - LABEL_HEIGHT)
  return {
    id,
    x: left,
    y: top,
    width,
    height: LABEL_HEIGHT,
    text: { literal: text, size: LABEL_SIZE, color, align: east ? ("start" as const) : ("end" as const), fontWeight: 600 },
  }
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
  status: string[] = ["", ""],
  options: { countdown?: boolean } = {},
): DetailModel {
  const pass = completePass(satellite, observer, listed, now)
  const at = (t: number) => clock(t, pass.aos, utc)
  const exact = (t: number) => clock(t, pass.aos, utc, true)
  const since = (t: number) => (options.countdown ? `  ${countdown(t, now)}` : "")

  const track = satellite.omm ? skyTrack(satrecFromOmm(satellite.omm), observer, pass) : []
  const radio = radioLines(satellite, observer, pass, now)
  while (radio.length < RADIO_LINES) radio.push("")

  return {
    title: `${satellite.name} · ${at(pass.aos)}–${at(pass.los)}`,
    tab,
    utc,
    times: [
      `Rise  ${exact(pass.aos)}  ${compass(pass.aosAzimuth)} ${deg(pass.aosAzimuth)}${since(pass.aos)}`,
      `Peak  ${exact(pass.maxElevationAt)}  ${deg(pass.maxElevation)} toward ${compass(pass.maxAzimuth)}${since(pass.maxElevationAt)}`,
      `Set   ${exact(pass.los)}  ${compass(pass.losAzimuth)} ${deg(pass.losAzimuth)}${since(pass.los)}`,
    ],
    status,
    radio,
    sky: {
      svg: skySvg(track, pass, theme.sky, now),
      compass: compassLayers(theme.text),
      // Written on the plot, so the plot says the key times itself and the lines under it can be few.
      labels: [
        pointLabel("riseAt", exact(pass.aos), pass.aosAzimuth, 0, theme.sky.rise),
        pointLabel("peakAt", deg(pass.maxElevation), pass.maxAzimuth, pass.maxElevation, theme.text),
        pointLabel("setAt", exact(pass.los), pass.losAzimuth, 0, theme.sky.set),
      ],
    },
  }
}
