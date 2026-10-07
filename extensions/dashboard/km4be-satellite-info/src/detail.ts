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
import { placeLabels } from "./labels.ts"
import type { Box, Disc } from "./labels.ts"
import { arrowSpot, compassLayers, DEFAULT_SKY_COLORS, DOT_RADIUS, nowSpot, SKY_SIZE, skySvg, skyTrack, skyXY } from "./sky.ts"
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
  sky: { svg: string; compass: ReturnType<typeof compassLayers>; labels: ReturnType<typeof placeLabels> }
}

/// The three labels on the plot, each beside its dot and clear of everything else drawn there:
/// the dots, the ring where the satellite is now, the arrowhead, the compass letters, and each
/// other. The rise and set go first, being the longer, and so have the most choice of place.
export function plotLabels(
  track: ReturnType<typeof skyTrack>,
  pass: Pass,
  texts: { rise: string; peak: string; set: string },
  theme: Theme,
  now: number | undefined,
  letters: ReturnType<typeof compassLayers>,
): ReturnType<typeof placeLabels> {
  const rise = skyXY(pass.aosAzimuth, 0)
  const set = skyXY(pass.losAzimuth, 0)
  const peak = skyXY(pass.maxAzimuth, pass.maxElevation)

  const discs: Disc[] = [
    { ...rise, r: DOT_RADIUS.end },
    { ...set, r: DOT_RADIUS.end },
    { ...peak, r: DOT_RADIUS.peak },
  ]
  const here = nowSpot(track, pass, now)
  if (here) discs.push({ ...here, r: DOT_RADIUS.now })
  const arrow = arrowSpot(track, pass)
  if (arrow) discs.push({ ...arrow.p, r: DOT_RADIUS.arrow })

  const boxes: Box[] = letters.map((l) => ({ x: l.x, y: l.y, width: l.width, height: l.height }))
  const placed = placeLabels(
    [
      { id: "riseAt", text: texts.rise, ...rise, r: DOT_RADIUS.end, color: theme.sky.rise },
      { id: "setAt", text: texts.set, ...set, r: DOT_RADIUS.end, color: theme.sky.set },
      { id: "peakAt", text: texts.peak, ...peak, r: DOT_RADIUS.peak, color: theme.text },
    ],
    discs,
    boxes,
    SKY_SIZE,
  )
  // Placed in order of choice, listed in the order of the pass: rise, peak, set.
  return ["riseAt", "peakAt", "setAt"].map((id) => placed.find((l) => l.id === id)!)
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
  const compassLetters = compassLayers(theme.text)

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
      compass: compassLetters,
      // Written on the plot, so the plot says the key times itself and the lines under it can be few.
      labels: plotLabels(track, pass, { rise: exact(pass.aos), peak: deg(pass.maxElevation), set: exact(pass.los) }, theme, now, compassLetters),
    },
  }
}
