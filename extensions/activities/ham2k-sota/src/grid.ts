// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// A copy of the app's extensions/core/adif/src/grid.ts — keep the two in
// step. The export there decides whether a coordinate is only a locator's own center,
// and SOTA's grid fields have to answer that question the same way or the two
// halves of one record disagree. See that file for why it is a port of
// the app's halo_core `gridCell` rather than @ham2k/lib-geo-tools' `gridToLocation`
// (which throws on an odd locator, and a throwing hook fails the export).
//
// The app's built-in keeps `sotaGrid` and `theirCoordinate` in its index.ts;
// here they sit beside the cell arithmetic so a unit test can reach them
// without loading the host libraries index.ts imports.

import { locationToGrid6 } from "@ham2k/lib-geo-tools"

export interface GridCell {
  lat: number
  lon: number
  latSize: number
  lonSize: number
}

/// A locator as the cell it names — center and dimensions — or undefined for
/// anything that does not decode. Never throws.
export function gridCell(grid: unknown): GridCell | undefined {
  if (typeof grid !== "string") return undefined
  const g = grid.trim().toUpperCase()
  if (g.length < 4) return undefined

  const lonField = g.charCodeAt(0) - 65
  const latField = g.charCodeAt(1) - 65
  if (lonField < 0 || lonField > 17 || latField < 0 || latField > 17) return undefined

  const lonSquare = digit(g[2])
  const latSquare = digit(g[3])
  if (lonSquare === undefined || latSquare === undefined) return undefined

  let latSize = 1
  let lonSize = 2
  let lat = latField * 10 - 90 + latSquare * latSize
  let lon = lonField * 20 - 180 + lonSquare * lonSize
  const cell = (): GridCell => ({ lat: lat + latSize / 2, lon: lon + lonSize / 2, latSize, lonSize })

  if (g.length >= 6) {
    const lonSub = g.charCodeAt(4) - 65
    const latSub = g.charCodeAt(5) - 65
    if (lonSub < 0 || lonSub >= 24 || latSub < 0 || latSub >= 24) return cell()
    lonSize /= 24
    latSize /= 24
    lon += lonSub * lonSize
    lat += latSub * latSize
  }

  if (g.length >= 8) {
    const lonExt = digit(g[6])
    const latExt = digit(g[7])
    if (lonExt === undefined || latExt === undefined) return cell()
    lonSize /= 10
    latSize /= 10
    lon += lonExt * lonSize
    lat += latExt * latSize
  }

  if (g.length >= 10) {
    const lonSubSub = g.charCodeAt(8) - 65
    const latSubSub = g.charCodeAt(9) - 65
    if (lonSubSub < 0 || lonSubSub >= 24 || latSubSub < 0 || latSubSub >= 24) return cell()
    lonSize /= 24
    latSize /= 24
    lon += lonSubSub * lonSize
    lat += latSubSub * latSize
  }

  return cell()
}

function digit(char: string | undefined): number | undefined {
  if (char === undefined || char < "0" || char > "9") return undefined
  return char.charCodeAt(0) - 48
}

/// A hundredth of the cell's own size — the same fraction halo_core uses, and
/// a fraction rather than a fixed number of degrees because the cells run
/// from 111 km of latitude to 19 m. See `_gridCenterTolerance` there for why
/// a tolerance is needed at all rather than exact equality.
const CENTER_TOLERANCE = 0.01

/// Whether the pair is only [grid]'s own center, and so says nothing the
/// locator did not.
///
/// The app stores that center beside every locator an operator STATES
/// (docs/design/locations.md), so a file must not restate it as a coordinate:
/// ADIF readers take `LAT`/`LON` over `GRIDSQUARE`, and the station would be
/// published standing at a point inside a square it was only placed in.
export function isGridCenter(lat: unknown, lon: unknown, grid: unknown): boolean {
  if (typeof lat !== "number" || typeof lon !== "number") return false
  const cell = gridCell(grid)
  if (!cell) return false
  return Math.abs(lat - cell.lat) <= cell.latSize * CENTER_TOLERANCE && Math.abs(lon - cell.lon) <= cell.lonSize * CENTER_TOLERANCE
}

/// The locator SOTA's files state for one end of a contact, by the rule the
/// app's core/adif `gridForExport` follows (its docs/design/locations.md): a
/// real coordinate outranks the stored grid, and is written as its
/// six-character square; a pair that is only the stored grid's own center
/// says nothing more, so the grid goes out as stored.
function sotaGrid(grid: unknown, lat: unknown, lon: unknown): string | undefined {
  if (typeof lat === "number" && typeof lon === "number" && !isGridCenter(lat, lon, grid)) return locationToGrid6(lat, lon)
  return typeof grid === "string" && grid ? grid : undefined
}

/// The other station's coordinate, in core/adif's precedence
/// (`theirCoordinate` there): an entered pair wins; an entered grid
/// suppresses a guessed pair, because the operator was correcting the lookup;
/// only then does the guess answer. A pair tagged `locSource: 'prefix'` is a
/// DXCC entity's centroid, not the station's position.
function theirCoordinate(their: Record<string, unknown>, theirGuess: Record<string, unknown>): [unknown, unknown] {
  if (their.locSource !== "prefix" && their.lat != null && their.lon != null && !isGridCenter(their.lat, their.lon, their.grid)) {
    return [their.lat, their.lon]
  }
  if (their.grid != null || theirGuess.locSource === "prefix") return [undefined, undefined]
  return [theirGuess.lat, theirGuess.lon]
}

/// GRIDSQUARE and MY_GRIDSQUARE for one contact of a SOTA file.
export function sotaGridFields(qso: Record<string, unknown>, operation: Record<string, unknown>): { name: string; value: string }[] {
  const our = (qso.our ?? {}) as Record<string, unknown>
  const their = (qso.their ?? {}) as Record<string, unknown>
  const theirGuess = (their.guess ?? {}) as Record<string, unknown>
  // One source for our location, as the core exporter reads it: a contact
  // that states any part of it replaces the operation's whole.
  const ourLocation = our.grid != null || our.lat != null || our.lon != null ? our : operation
  // Ours at six characters whatever the Grid Precision: an operation
  // adopted from a fix stores eight, and this file ships without the
  // private-data switch that would release them.
  const ourGrid = sotaGrid(ourLocation.grid, ourLocation.lat, ourLocation.lon)?.slice(0, 6)
  const theirGrid = sotaGrid(their.grid ?? theirGuess.grid, ...theirCoordinate(their, theirGuess))
  const fields: { name: string; value: string }[] = []
  if (theirGrid) fields.push({ name: "GRIDSQUARE", value: theirGrid })
  if (ourGrid) fields.push({ name: "MY_GRIDSQUARE", value: ourGrid })
  return fields
}
