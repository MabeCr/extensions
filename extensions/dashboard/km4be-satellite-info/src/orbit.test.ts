// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { test } from "node:test"

import { compass, downlinkDoppler, findPasses, lookAt, rangeRate, satrecFromOmm, uplinkDoppler } from "./orbit.ts"
import type { Omm, Observer } from "./orbit.ts"

// AO-7 as CelesTrak served it on 2026-10-06 (the amateur group, JSON).
const AO7: Omm = {
  OBJECT_NAME: "OSCAR 7 (AO-7)",
  OBJECT_ID: "1974-089B",
  EPOCH: "2026-10-06T20:57:22.256064",
  MEAN_MOTION: 12.5369988,
  ECCENTRICITY: 0.00119476,
  INCLINATION: 101.991,
  RA_OF_ASC_NODE: 294.2846,
  ARG_OF_PERICENTER: 278.5192,
  MEAN_ANOMALY: 203.4257,
  EPHEMERIS_TYPE: 0,
  CLASSIFICATION_TYPE: "U",
  NORAD_CAT_ID: 7530,
  ELEMENT_SET_NO: 999,
  REV_AT_EPOCH: 37451,
  BSTAR: 9.5510357e-5,
  MEAN_MOTION_DOT: -3.1e-7,
  MEAN_MOTION_DDOT: 0,
}

const miami: Observer = { lat: 25.76, lon: -80.19 }
const from = Date.parse("2026-10-07T00:00:00Z")
const satrec = satrecFromOmm(AO7)
const passes = findPasses(satrec, miami, from, 24)

test("a day of AO-7 over Miami has a plausible set of passes", () => {
  // AO-7 is a 115-minute orbit: some 4 to 8 passes a day clear the horizon for a given spot.
  assert.ok(passes.length >= 3 && passes.length <= 12, `${passes.length} passes`)
  for (const p of passes) {
    assert.ok(p.los > p.aos)
    assert.ok(p.aos >= from)
    assert.ok(p.los - p.aos <= 25 * 60_000, "a low-orbit pass is under about 25 minutes")
    assert.ok(p.maxElevation > 0 && p.maxElevation <= 90)
    assert.ok(p.maxElevationAt >= p.aos && p.maxElevationAt <= p.los)
  }
  // Passes are in order and do not overlap.
  passes.slice(1).forEach((p, i) => assert.ok(p.aos > passes[i].los))
})

test("the edges sit on the horizon and the peak is the highest point", () => {
  for (const p of passes) {
    // Within a second of the horizon, so under a tenth of a degree either side of 0.
    assert.ok(Math.abs(lookAt(satrec, miami, p.aos)!.elevation) < 0.5, "AOS is at the horizon")
    assert.ok(Math.abs(lookAt(satrec, miami, p.los)!.elevation) < 0.5, "LOS is at the horizon")
    assert.ok(lookAt(satrec, miami, p.aos - 30_000)!.elevation < 0.1, "just before AOS it is below")
    assert.ok(lookAt(satrec, miami, p.los + 30_000)!.elevation < 0.1, "just after LOS it is below")
    for (const offset of [-60_000, 60_000]) {
      const t = p.maxElevationAt + offset
      if (t > p.aos && t < p.los) assert.ok(lookAt(satrec, miami, t)!.elevation <= p.maxElevation + 1e-6)
    }
  }
})

test("it approaches before the peak and recedes after, and Doppler follows", () => {
  const p = passes.reduce((best, x) => (x.maxElevation > best.maxElevation ? x : best))
  const early = rangeRate(satrec, miami, p.aos + 30_000)!
  const late = rangeRate(satrec, miami, p.los - 30_000)!
  assert.ok(early < 0, "approaching near AOS")
  assert.ok(late > 0, "receding near LOS")
  // A satellite coming in is heard high and one going away low, by a few kilohertz at 435 MHz.
  const high = downlinkDoppler(435, early)
  const low = downlinkDoppler(435, late)
  assert.ok(high > 435 && low < 435)
  assert.ok((high - 435) * 1000 < 15 && (435 - low) * 1000 < 15, "under 15 kHz at 435 MHz")
  // Transmitting to the satellite is corrected the other way.
  assert.ok(uplinkDoppler(145.9, early) < 145.9 && uplinkDoppler(145.9, late) > 145.9)
  // Shifts scale with frequency.
  assert.ok(Math.abs(downlinkDoppler(435, early) - 435) > Math.abs(downlinkDoppler(145, early) - 145))
})

test("a pass already under way at the start is marked so, and the minimum elevation filters", () => {
  const first = passes[0]
  const mid = Math.round((first.aos + first.los) / 2)
  const started = findPasses(satrec, miami, mid, 3)
  assert.equal(started[0].inProgress, true)
  assert.equal(started[0].aos, mid)
  assert.ok(Math.abs(started[0].los - first.los) < 2000)

  const high = findPasses(satrec, miami, from, 24, 30)
  assert.ok(high.length < passes.length)
  assert.ok(high.every((p) => p.maxElevation >= 30))
  assert.equal(findPasses(satrec, miami, from, 24, 91).length, 0)
})

test("compass points", () => {
  assert.deepEqual([0, 45, 90, 180, 270, 337.5, 360, -90].map(compass), ["N", "NE", "E", "S", "W", "NNW", "N", "W"])
})
