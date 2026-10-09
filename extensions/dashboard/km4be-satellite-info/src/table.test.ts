// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { test } from "node:test"

import { ELEMENTS_URL, LIST_URL, statusUrl } from "./data.ts"
import { ELEMENTS, LIST, SUMMARY } from "./fixtures.ts"
import { table } from "./passes.ts"
import type { Cells } from "./passes.ts"
import { forgetAll } from "./memory.ts"
import { loadExtension } from "./sdkGapTesting.ts"
import { arrowHead, skySvg, skyXY } from "./sky.ts"
import type { SkyPoint } from "./sky.ts"
import { LEGEND } from "./status.ts"

// --- the table ---------------------------------------------------------------

const cells = (name: string, type: string, start: string, max: string, path: string, length: string, mark = ""): Cells => ({ name, type, start, max, path, length, mark })

test("the passes line up in columns under their titles", () => {
  const { columns, lines } = table([
    cells("AO-7", "SSB", "00:05Z", "46°", "S→NNW", "22m", "✔"),
    cells("BeliefSat-0", "Dig", "10-08 14:05Z", "9°", "NNE→SSW", "105m", "◐"),
    cells("SO-50", "FM", "now", "81°", "E→W", "8m"),
  ])
  assert.equal(columns, "Sat          Type  Start         Max  Path      Len  Rpt")
  assert.deepEqual(lines, [
    "AO-7         SSB   00:05Z        46°  S→NNW     22m  ✔",
    "BeliefSat-0  Dig   10-08 14:05Z   9°  NNE→SSW  105m  ◐",
    "SO-50        FM    now           81°  E→W        8m",
  ])
})

test("every column starts at the same place in every row, numbers end at the same place, and a row with no mark has no trailing space", () => {
  const rows = [cells("AO-7", "SSB", "00:05Z", "46°", "S→NNW", "22m", "✔"), cells("FO-29", "FM", "now", "5°", "NE→SE", "12m", "◐"), cells("RS-44", "SSB", "13:40Z", "100°", "W→E", "9m")]
  const { columns, lines } = table(rows)
  const typeAt = columns.indexOf("Type")
  const startAt = columns.indexOf("Start")
  const pathAt = columns.indexOf("Path")
  const maxEnd = columns.indexOf("Max") + 3
  const lenEnd = columns.indexOf("Len") + 3
  lines.forEach((line, i) => {
    assert.equal(line.indexOf(rows[i].type, 4), typeAt, line)
    assert.equal(line.indexOf(rows[i].start), startAt, line)
    assert.equal(line.indexOf(rows[i].path), pathAt, line)
    assert.equal(line.indexOf(rows[i].max) + rows[i].max.length, maxEnd, line)
    assert.equal(line.indexOf(rows[i].length, pathAt) + rows[i].length.length, lenEnd, line)
    assert.equal(line, line.trimEnd())
    if (rows[i].mark) assert.equal(line.indexOf(rows[i].mark), columns.indexOf("Rpt"), line)
  })
})

test("a page with nothing wide in it keeps its titles, and no rows is just the titles", () => {
  const narrow = table([cells("AO-7", "SSB", "now", "9°", "N→S", "5m")])
  assert.equal(narrow.columns, "Sat   Type  Start  Max  Path  Len  Rpt")
  assert.equal(narrow.lines[0], "AO-7  SSB   now     9°  N→S    5m")
  assert.equal(table([]).columns, "Sat  Type  Start  Max  Path  Len  Rpt")
  assert.deepEqual(table([]).lines, [])
})

// --- the arrow on the plot ---------------------------------------------------

/// A pass over the observer's head from `from` to `to` (azimuths), 90 points, peaking in the middle.
function overhead(from: number, to: number): { track: SkyPoint[]; pass: Parameters<typeof arrowHead>[1] } {
  const track: SkyPoint[] = Array.from({ length: 91 }, (_, i) => {
    const f = i / 90
    return { azimuth: f < 0.5 ? from : to, elevation: 90 * (1 - Math.abs(2 * f - 1)), at: i * 10_000 }
  })
  return { track, pass: { aos: 0, los: 900_000, maxElevation: 90, maxElevationAt: 450_000, aosAzimuth: from, maxAzimuth: from, losAzimuth: to, inProgress: false } }
}

/// The arrow's three corners from its path: the tip first.
function corners(svg: string): { x: number; y: number }[] {
  const nums = [...svg.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }))
  return nums.slice(0, 3)
}

test("the arrow sits on the path past the peak and points the way the satellite goes", () => {
  const eastward = overhead(270, 90) // west to east, through the zenith
  const east = arrowHead(eastward.track, eastward.pass, "#4aa3ff")
  assert.match(east, /^<path d="M[^"]+Z" fill="#4aa3ff"/)
  const [tip, a, b] = corners(east)
  const base = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  assert.ok(tip.x - base.x > 10, "points east")
  assert.ok(Math.abs(tip.y - base.y) < 1, "level")
  assert.ok(base.x > 180 && base.x < 230, "a little past the center, which is the peak")
  assert.ok(Math.abs(base.y - 180) < 1, "on the path")

  const westward = overhead(90, 270)
  const [wtip, wa, wb] = corners(arrowHead(westward.track, westward.pass, "#fff"))
  assert.ok(wtip.x < (wa.x + wb.x) / 2 - 10, "points west")
})

test("a pass that peaks at its end has the arrow before the peak, still pointing forward, and a track too short has none", () => {
  const track: SkyPoint[] = Array.from({ length: 30 }, (_, i) => ({ azimuth: 270, elevation: Math.min(60, i * 2), at: i * 10_000 }))
  const pass = { aos: 0, los: 290_000, maxElevation: 58, maxElevationAt: 290_000, aosAzimuth: 270, maxAzimuth: 270, losAzimuth: 270, inProgress: false }
  const [tip, a, b] = corners(arrowHead(track, pass, "#fff"))
  assert.ok(tip.x > (a.x + b.x) / 2, "points the way it is going: toward the center, from the west")
  assert.equal(arrowHead(track.slice(0, 2), pass, "#fff"), "")
  assert.equal(arrowHead([], pass, "#fff"), "")
})

test("the plot carries the arrow", () => {
  const { track, pass } = overhead(270, 90)
  const svg = skySvg(track, pass)
  assert.ok(svg.includes(arrowHead(track, pass, "#4aa3ff")))
  // The path's own corners are in the plot: the rim's west point and its east point.
  assert.deepEqual(skyXY(270, 0), { x: 30, y: 180 })
})

// --- through the panel -------------------------------------------------------

const ctx = { online: true }
const t0 = Date.parse("2026-10-07T00:00:00Z")
let panes = 0

async function panel(favorites: string[] = []) {
  forgetAll()
  const id = ++panes
  const ext = await loadExtension(() => import("./index.ts"), {
    hostCalls: {
      getLocation: () => null,
      kvGet: (params) => (params.key === "favorites" && favorites.length ? favorites : null),
      kvSet: () => undefined,
      fetch: (params) => {
        const url = String(params.url)
        return url === LIST_URL
          ? { status: 200, body: JSON.stringify(LIST) }
          : url === ELEMENTS_URL
            ? { status: 200, body: JSON.stringify(ELEMENTS) }
            : url === statusUrl(24)
              ? { status: 200, body: JSON.stringify(SUMMARY) }
              : { status: 404, body: "" }
      },
    },
  })
  return (config: Record<string, unknown>) =>
    ext.runHook(
      "panel",
      "render",
      { panelKey: "passes", instanceId: `table-${id}`, operation: {}, qsoCount: 0, reason: "", config, clock: { nowMillis: t0, realNowMillis: t0 } },
      { ctx },
    ) as Promise<{ scene: { strings: Record<string, string>; controls: { id: string }[]; layout: { column: Record<string, unknown>[] } } }>
}

test("the list has titles over its columns, which line up with every row, and its legend under the pager", async () => {
  const render = await panel()
  const { scene } = await render({ grid: "EL95vs", utc: true, minElevation: 0, listSeconds: true })
  const { columns, legend, hint } = scene.strings
  assert.match(columns, /^Sat +Type +Start +Max +Path +Len +Rpt$/)
  assert.equal(legend, LEGEND)
  assert.ok(!hint.includes("heard"), "the hint is not the legend")

  const rows = [0, 1, 2, 3, 4].map((i) => scene.strings[`row${i}`]).filter(Boolean)
  assert.equal(rows.length, 5)
  const lenEnd = columns.indexOf("Len") + 3
  for (const row of rows) assert.equal(row.replace(/ {2}[✔◐✘]$/, "").length, lenEnd, row)

  // In the layout the titles come before the rows, and the legend after the pager.
  const order = scene.layout.column.map((n) => (n as { control?: string; row?: { control: string }[] }).control ?? (n as { row?: { control: string }[] }).row?.map((c) => c.control)[0] ?? "")
  assert.ok(order.indexOf("columns") < order.findIndex((c) => c.startsWith("star:")))
  assert.equal(order[order.length - 1], "legend")
  assert.ok(order.indexOf("legend") > order.indexOf("prev"))
  assert.deepEqual((scene.layout.column[order.indexOf("columns")] as { padding?: number[] }).padding, [60, 0, 60, 0])
})

test("with no rows there are no titles and no legend to explain, though the controls stay", async () => {
  // Following only a satellite with no orbit data leaves nothing to list.
  const render = await panel(["SO-125"])
  const { scene } = await render({ grid: "EL95vs" })
  assert.match(scene.strings.hint, /No passes of 10° or more/)
  assert.equal(scene.strings.columns, "")
  assert.equal(scene.strings.legend, "")
  assert.ok(scene.controls.some((c) => c.id === "columns") && scene.controls.some((c) => c.id === "legend"))
})
