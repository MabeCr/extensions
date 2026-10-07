// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { test } from "node:test"

import { buildCatalog, parseElements, parseList } from "./data.ts"
import { buildDetail, plotLabels } from "./detail.ts"
import { DEFAULT_THEME } from "./detail.ts"
import { AO7, ELEMENTS, FO29, LIST } from "./fixtures.ts"
import { labelWidth, LABEL_HEIGHT, MARGIN, placeLabels } from "./labels.ts"
import type { Box, Disc } from "./labels.ts"
import { findPasses, satrecFromOmm } from "./orbit.ts"
import type { Observer, Omm } from "./orbit.ts"
import { arrowSpot, compassLayers, DOT_RADIUS, nowSpot, skyTrack, skyXY } from "./sky.ts"

// --- what a label must keep clear of, worked out here and not by the code under test -------

const nearest = (px: number, py: number, b: Box) => Math.hypot(Math.max(b.x - px, 0, px - (b.x + b.width)), Math.max(b.y - py, 0, py - (b.y + b.height)))
const boxesTouch = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

interface Problem {
  what: string
  label: string
}

/// Every way the labels of one pass touch something: a dot, the ring, the arrowhead, a compass letter, each other, or the edge.
function problems(pass: Parameters<typeof plotLabels>[1], track: ReturnType<typeof skyTrack>, labels: ReturnType<typeof plotLabels>, now: number | undefined): Problem[] {
  const found: Problem[] = []
  const discs: (Disc & { name: string })[] = [
    { name: "green dot", ...skyXY(pass.aosAzimuth, 0), r: DOT_RADIUS.end },
    { name: "red dot", ...skyXY(pass.losAzimuth, 0), r: DOT_RADIUS.end },
    { name: "white dot", ...skyXY(pass.maxAzimuth, pass.maxElevation), r: DOT_RADIUS.peak },
  ]
  const here = nowSpot(track, pass, now)
  if (here) discs.push({ name: "ring", ...here, r: DOT_RADIUS.now })
  const arrow = arrowSpot(track, pass)
  if (arrow) discs.push({ name: "arrow", ...arrow.p, r: DOT_RADIUS.arrow })
  const letters = compassLayers("#000").map((l) => ({ name: `letter ${l.text.literal}`, x: l.x, y: l.y, width: l.width, height: l.height }))

  labels.forEach((label, i) => {
    const box: Box = { x: label.x, y: label.y, width: label.width, height: label.height }
    if (box.x < 0 || box.y < 0 || box.x + box.width > 360 || box.y + box.height > 360) found.push({ what: "off the plot", label: label.id })
    for (const d of discs) if (nearest(d.x, d.y, box) < d.r + MARGIN) found.push({ what: d.name, label: label.id })
    for (const l of letters) if (boxesTouch(box, l)) found.push({ what: l.name, label: label.id })
    labels.slice(i + 1).forEach((other) => {
      if (boxesTouch(box, { x: other.x, y: other.y, width: other.width, height: other.height })) found.push({ what: `label ${other.id}`, label: label.id })
    })
  })
  return found
}

// --- the places a pass can have its ends -----------------------------------------------------

test("a label goes to the other side of its dot when there is no room on the side it would like", () => {
  // A dot on the east rim: nothing to its right but the edge of the plot.
  const east = skyXY(90, 0)
  const [label] = placeLabels([{ id: "a", text: "12:45:09Z", ...east, r: DOT_RADIUS.end, color: "#fff" }], [{ ...east, r: DOT_RADIUS.end }], [], 360)
  assert.ok(label.x + label.width < east.x - DOT_RADIUS.end, "left of the dot, and clear of it")
  assert.equal(label.text.align, "end")
  const west = skyXY(270, 0)
  const [w] = placeLabels([{ id: "b", text: "12:45:09Z", ...west, r: DOT_RADIUS.end, color: "#fff" }], [{ ...west, r: DOT_RADIUS.end }], [], 360)
  assert.ok(w.x > west.x + DOT_RADIUS.end)
  assert.equal(w.text.align, "start")
})

test("in the open a label is just beside its dot, on the side toward the rim", () => {
  const spot = { x: 120, y: 200 } // west of center
  const [left] = placeLabels([{ id: "a", text: "81°", ...spot, r: DOT_RADIUS.peak, color: "#fff" }], [{ ...spot, r: DOT_RADIUS.peak }], [], 360)
  assert.equal(left.text.align, "end", "the west half's labels go left, toward the nearer rim")
  const gap = spot.x - (left.x + left.width)
  assert.ok(gap >= DOT_RADIUS.peak + MARGIN && gap <= DOT_RADIUS.peak + 12, `${gap} px between the dot's center and the text`)
  assert.equal(left.height, LABEL_HEIGHT)
  assert.equal(left.width, labelWidth("81°"))
})

test("labels keep off each other: the second finds another place", () => {
  const spot = { x: 200, y: 200 }
  const specs = [
    { id: "a", text: "12:45:09Z", ...spot, r: 6, color: "#fff" },
    { id: "b", text: "12:46:00Z", ...spot, r: 6, color: "#fff" },
  ]
  const [a, b] = placeLabels(specs, [{ ...spot, r: 6 }], [], 360)
  assert.equal(boxesTouch(a, b), false)
})

// --- every pass of every kind -----------------------------------------------------------------

/// Orbits of many shapes, made by moving the real elements of AO-7 and FO-29: the inclinations of the ISS, SO-50, AO-7 and a
/// sun-synchronous bird, low and high, and every phase, so that passes end all round the rim and cross all over the sky.
function orbits(): Omm[] {
  const out: Omm[] = []
  for (const base of [AO7, FO29] as Omm[]) {
    for (const inclination of [51.6, 64.6, 98.5, 101.99]) {
      for (const motion of [12.5, 14.2, 15.5]) {
        for (const node of [0, 90, 180, 270]) {
          out.push({ ...base, INCLINATION: inclination, MEAN_MOTION: motion, RA_OF_ASC_NODE: node, MEAN_ANOMALY: (node * 2 + inclination) % 360 })
        }
      }
    }
  }
  return out
}

const OBSERVERS: Observer[] = [
  { lat: 25.76, lon: -80.19 }, // Miami
  { lat: 59.9, lon: 10.7 }, // Oslo
  { lat: -33.9, lon: 151.2 }, // Sydney
  { lat: -0.2, lon: -78.5 }, // Quito, on the equator
  { lat: 69.6, lon: 18.9 }, // Tromsø, far north
]

test("across thousands of passes, no label is ever on a dot, the ring, the arrow, a compass letter, another label, or off the plot", () => {
  const from = Date.parse("2026-10-07T00:00:00Z")
  let passes = 0
  let withRing = 0
  const bad: string[] = []
  const around = new Set<string>()
  let far = 0

  for (const omm of orbits()) {
    const satrec = satrecFromOmm({ ...omm, EPOCH: "2026-10-06T21:00:00.000000" })
    for (const observer of OBSERVERS) {
      for (const pass of findPasses(satrec, observer, from, 24, 0)) {
        const track = skyTrack(satrec, observer, pass)
        // Half the time the pass is under way, with a ring on it.
        for (const now of [pass.aos - 60_000, Math.round((pass.aos + pass.los) / 2)]) {
          const labels = plotLabels(track, pass, { rise: "12:45:09Z", peak: "81°", set: "12:57:41Z" }, DEFAULT_THEME, now, compassLayers("#000"))
          passes += 1
          if (now > pass.aos) withRing += 1
          const found = problems(pass, track, labels, now)
          if (found.length) bad.push(`${omm.INCLINATION}°/${omm.MEAN_MOTION} node ${omm.RA_OF_ASC_NODE} at ${observer.lat},${observer.lon}: ${found.map((f) => `${f.label} on ${f.what}`).join(", ")}`)
          // How natural: the label is still near its dot.
          const dots: Record<string, { x: number; y: number }> = { riseAt: skyXY(pass.aosAzimuth, 0), setAt: skyXY(pass.losAzimuth, 0), peakAt: skyXY(pass.maxAzimuth, pass.maxElevation) }
          for (const l of labels) {
            const d = dots[l.id]
            const away = nearest(d.x, d.y, { x: l.x, y: l.y, width: l.width, height: l.height })
            if (away > 20) far += 1
            around.add(l.text.align)
          }
        }
      }
    }
  }

  assert.ok(passes > 2000, `${passes} passes checked`)
  assert.ok(withRing > 1000)
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} of ${passes} passes have a label touching something`)
  assert.ok(around.has("start") && around.has("end"), "labels went both sides")
  // Placed further out only rarely, so they look beside their dots.
  assert.ok(far / (passes * 3) < 0.05, `${far} of ${passes * 3} labels are more than 20 units from their dot`)
})

test("the label for a pass that starts at the east rim, like SO-50's, is clear of the green dot", () => {
  const catalog = buildCatalog(parseList(LIST), parseElements(ELEMENTS), {})
  const satellite = catalog[0]
  const observer = { lat: 25.76, lon: -80.19 }
  const satrec = satrecFromOmm(satellite.omm!)
  const pass = findPasses(satrec, observer, Date.parse("2026-10-07T00:00:00Z"), 24, 5).find((p) => skyXY(p.aosAzimuth, 0).x > 270)
  assert.ok(pass, "a pass that rises in the east")
  const detail = buildDetail(satellite, observer, pass!, pass!.aos - 3_600_000, true, "sky")
  const rise = detail.sky.labels.find((l) => l.id === "riseAt")!
  const dot = skyXY(pass!.aosAzimuth, 0)
  assert.ok(nearest(dot.x, dot.y, rise) >= DOT_RADIUS.end + MARGIN, "not under the dot")
  assert.ok(rise.x + rise.width <= 360)
})
