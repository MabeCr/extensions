// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// The next passes across the whole catalog, and how they are written down.

import type { Satellite } from "./data.ts"
import { onForget } from "./memory.ts"
import { compass, findPasses, satrecFromOmm } from "./orbit.ts"
import type { Observer, Pass } from "./orbit.ts"

export interface SatellitePass extends Pass {
  satellite: Satellite
}

export const LOOK_AHEAD_HOURS = 24
export const DEFAULT_MIN_ELEVATION = 10
export const MAX_MIN_ELEVATION = 60

/// The pane's minimum peak elevation from its settings: 0 to 60 degrees, and
/// the default for anything blank, negative or not a number.
export function minElevation(config: Record<string, unknown> | undefined): number {
  const v = config?.minElevation
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(MAX_MIN_ELEVATION, v) : DEFAULT_MIN_ELEVATION
}

/// Every pass in the next day, soonest first, for the satellites that have elements.
export function nextPasses(satellites: Satellite[], observer: Observer, now: number, minEl: number, hours = LOOK_AHEAD_HOURS): SatellitePass[] {
  return satellites
    .flatMap((satellite) =>
      satellite.omm ? findPasses(satrecFromOmm(satellite.omm), observer, now, hours, minEl).map((pass) => ({ ...pass, satellite })) : [],
    )
    .sort((a, b) => a.aos - b.aos || b.maxElevation - a.maxElevation)
}

const two = (n: number) => String(n).padStart(2, "0")

/// A clock time, with the date when it is not today. Local time, or UTC with a `Z`. With
/// `seconds`, to the nearest second (`14:05:12`); without, the minute it falls in (`14:05`).
export function clock(millis: number, now: number, utc: boolean, seconds = false): string {
  const d = new Date(seconds ? Math.round(millis / 1000) * 1000 : millis)
  const n = new Date(now)
  const [h, m, s, day, today, month] = utc
    ? [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCDate(), n.getUTCDate(), d.getUTCMonth() + 1]
    : [d.getHours(), d.getMinutes(), d.getSeconds(), d.getDate(), n.getDate(), d.getMonth() + 1]
  return `${day === today ? "" : `${two(month)}-${two(day)} `}${two(h)}:${two(m)}${seconds ? `:${two(s)}` : ""}${utc ? "Z" : ""}`
}

/// Time to or since an event: `−4:12` before it, `+2:05` after (`−1:04:12` over an hour), the
/// way a launch countdown reads. At the moment itself, `+0:00`.
export function countdown(target: number, now: number): string {
  const diff = Math.round((target - now) / 1000)
  const total = Math.abs(diff)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${diff > 0 ? "−" : "+"}${h ? `${h}:${two(m)}` : `${m}`}:${two(s)}`
}

export function duration(pass: Pass): string {
  const minutes = Math.round((pass.los - pass.aos) / 60_000)
  return `${minutes} min`
}

/// "NW → SE", the way round the sky the pass goes.
export const direction = (pass: Pass): string => `${compass(pass.aosAzimuth)} → ${compass(pass.losAzimuth)}`

/// Working out every pass of every satellite is the most work this extension does, so it is done
/// rarely: for a day and a quarter ahead, kept six hours (as long as the orbits themselves are,
/// which is when a new set of them forces it again anyway). A day is always still ahead of what
/// the list shows.
const MEMO_MAX_AGE_MS = 6 * 3_600_000
const MEMO_HOURS = LOOK_AHEAD_HOURS + 6
let memo: { key: string; at: number; passes: SatellitePass[] } | undefined
let computations = 0

/// For tests: how many times every pass has been worked out.
export const passesComputed = (): number => computations

/// For tests: forget the passes worked out so far.
export const forgetPasses = (): void => {
  memo = undefined
  computations = 0
}
onForget(forgetPasses)

/// The next day's passes, worked out at most every six hours however often the panel is drawn or
/// tapped, and with the ones already over dropped and any more than a day away left for later. A
/// pass that began since is still listed, as under way.
export function upcomingPasses(satellites: Satellite[], place: Observer & { grid: string }, now: number, minEl: number, elementsAt: number): SatellitePass[] {
  const key = `${place.grid}|${minEl}|${elementsAt}|${satellites.length}`
  if (!memo || memo.key !== key || now < memo.at || now - memo.at > MEMO_MAX_AGE_MS) {
    computations += 1
    memo = { key, at: now, passes: nextPasses(satellites, place, now, minEl, MEMO_HOURS) }
  }
  const horizon = now + LOOK_AHEAD_HOURS * 3_600_000
  return memo.passes.filter((p) => p.los > now && p.aos <= horizon)
}

/// One pass as the cells of a table row.
export interface Cells {
  name: string
  start: string
  max: string
  path: string
  length: string
  /// What AMSAT's reports say, as a mark, or a space.
  mark: string
}

/// The titles over the columns, in the order of the cells.
export const TITLES: Cells = { name: "Sat", start: "Start", max: "Max", path: "Path", length: "Len", mark: "Rpt" }

export function passCells(pass: SatellitePass, now: number, utc: boolean, seconds: boolean, mark: string): Cells {
  return {
    name: pass.satellite.name,
    start: pass.aos <= now ? "now" : clock(pass.aos, now, utc, seconds),
    max: `${Math.round(pass.maxElevation)}°`,
    path: `${compass(pass.aosAzimuth)}→${compass(pass.losAzimuth)}`,
    length: `${Math.round((pass.los - pass.aos) / 60_000)}m`,
    mark,
  }
}

const GAP = "  "

/// A page of passes as lines in columns, with the titles over them. The text is set in a
/// monospaced face, so padding is what lines the columns up: names, times and paths to the
/// left, the numbers to the right. Each column is as wide as its widest cell or its title.
export function table(rows: Cells[]): { columns: string; lines: string[] } {
  const width = (key: keyof Cells) => Math.max(TITLES[key].length, ...rows.map((r) => r[key].length))
  const w = { name: width("name"), start: width("start"), max: width("max"), path: width("path"), length: width("length") }
  const line = (c: Cells) =>
    [c.name.padEnd(w.name), c.start.padEnd(w.start), c.max.padStart(w.max), c.path.padEnd(w.path), c.length.padStart(w.length), c.mark].join(GAP).trimEnd()
  return { columns: line(TITLES), lines: rows.map(line) }
}
