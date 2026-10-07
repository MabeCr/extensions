// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { test } from "node:test"

import { buildCatalog, ELEMENTS_URL, LIST_URL, parseElements, parseList, statusUrl } from "./data.ts"
import { buildDetail } from "./detail.ts"
import { ELEMENTS, LIST, SUMMARY } from "./fixtures.ts"
import { forgetAll } from "./memory.ts"
import { downlinkDoppler, findPasses, lookAt, rangeRate, satrecFromOmm, uplinkDoppler } from "./orbit.ts"
import type { Pass } from "./orbit.ts"
import { liveDoppler, shiftText } from "./radio.ts"
import { loadExtension } from "./sdkGapTesting.ts"
import { DEFAULT_SKY_COLORS, liveSpot, satelliteIcon, skySvg, skyTrack, skyXY } from "./sky.ts"
import type { SkyPoint } from "./sky.ts"

const catalog = buildCatalog(parseList(LIST), parseElements(ELEMENTS), {})
const ao7 = catalog.find((s) => s.name === "AO-7")!
const noOrbit = catalog.find((s) => s.name === "CAS-4A")!
const satrec = satrecFromOmm(ao7.omm!)
const miami = { lat: 25.76, lon: -80.19 }
const t0 = Date.parse("2026-10-07T00:00:00Z")
const passes = findPasses(satrec, miami, t0, 24, 10)
const best = passes.reduce((a, b) => (b.maxElevation > a.maxElevation ? b : a))
const mid = Math.round((best.aos + best.los) / 2)
const before = Math.round(best.aos + (best.maxElevationAt - best.aos) / 2) // between the rise and the peak
const after = Math.round(best.maxElevationAt + (best.los - best.maxElevationAt) / 2) // between the peak and the set

// --- the satellite on the plot --------------------------------------------------------------

test("the satellite is a solid little illustration, turned across its heading, and not a ring", () => {
  const icon = satelliteIcon({ x: 100, y: 120, rotation: 33.333 }, DEFAULT_SKY_COLORS)
  assert.match(icon, /^<g transform="translate\(100 120\) rotate\(33\.3\)">/)
  assert.ok(icon.includes(`fill="${DEFAULT_SKY_COLORS.path}"`), "solar panels")
  assert.ok(icon.includes(`fill="${DEFAULT_SKY_COLORS.peak}"`), "a body")
  assert.equal((icon.match(/<rect/g) ?? []).length, 3, "two panels and a body")
  assert.ok(!/fill="none"/.test(icon), "all solid")
})

test("while the pass is under way it is drawn where the satellite is, to the instant, and not otherwise", () => {
  const track = skyTrack(satrec, miami, best)
  const here = lookAt(satrec, miami, mid)!
  const during = skySvg(track, best, DEFAULT_SKY_COLORS, mid, here)
  const at = skyXY(here.azimuth, here.elevation)
  assert.ok(during.includes(`<g transform="translate(${at.x} ${at.y}) rotate(`), "at its exact place")

  assert.ok(!skySvg(track, best, DEFAULT_SKY_COLORS, best.aos - 60_000).includes("<g transform"), "not yet up")
  assert.ok(!skySvg(track, best, DEFAULT_SKY_COLORS, best.los + 60_000, here).includes("<g transform"), "gone")
  assert.ok(!skySvg(track, best, DEFAULT_SKY_COLORS).includes("<g transform"), "no clock at all")
  // No ring: the circles are the grid's three and the dots' three.
  assert.equal((during.match(/<circle/g) ?? []).length, 3 + 3 + 1, "the icon's own dish is the one more")
})

test("the exact place is used when known, and the nearest sample when not", () => {
  const track = skyTrack(satrec, miami, best)
  const between = best.aos + 10_000 * 20 + 5_000 // halfway between two samples, which are ten seconds apart
  const exact = lookAt(satrec, miami, between)!
  const sampled = liveSpot(track, best, between)!
  const precise = liveSpot(track, best, between, exact)!
  const truth = skyXY(exact.azimuth, exact.elevation)
  assert.deepEqual([precise.x, precise.y], [truth.x, truth.y])
  assert.ok(Math.hypot(sampled.x - truth.x, sampled.y - truth.y) > 0.5, "the sample is somewhere else")
  assert.equal(liveSpot(track, best, best.aos - 1, exact), null)
})

test("it is turned so its panels are across the way it is going", () => {
  // West to east straight over the observer: heading east, panels north to south.
  const over: SkyPoint[] = Array.from({ length: 91 }, (_, i) => {
    const f = i / 90
    return { azimuth: f < 0.5 ? 270 : 90, elevation: 90 * (1 - Math.abs(2 * f - 1)), at: i * 10_000 }
  })
  const pass: Pass = { aos: 0, los: 900_000, maxElevation: 90, maxElevationAt: 450_000, aosAzimuth: 270, maxAzimuth: 270, losAzimuth: 90, inProgress: false }
  const east = liveSpot(over, pass, 200_000, { azimuth: 270, elevation: 40 })!
  assert.ok(Math.abs(((east.rotation % 180) + 180) % 180 - 90) < 1, `${east.rotation} for a satellite heading east`)
  const down = liveSpot(over, pass, 700_000, { azimuth: 90, elevation: 40 })!
  assert.ok(Math.abs(((down.rotation % 180) + 180) % 180 - 90) < 1, "and still across it going the other way")
  // Going north instead: the panels lie east to west.
  const north: SkyPoint[] = over.map((p, i) => ({ azimuth: i / 90 < 0.5 ? 180 : 0, elevation: p.elevation, at: p.at }))
  const heading = liveSpot(north, pass, 200_000, { azimuth: 180, elevation: 40 })!
  assert.ok(Math.abs(((heading.rotation % 180) + 180) % 180) < 1 || Math.abs(((heading.rotation % 180) + 180) % 180 - 180) < 1)
})

// --- the readouts on the plot -----------------------------------------------------------------

test("under way, the plot has the satellite's elevation beside it and the Doppler shift in its corners", () => {
  const detail = buildDetail(ao7, miami, best, mid, true, "sky")
  assert.equal(detail.underWay, true)
  const now = detail.sky.labels.find((l) => l.id === "nowAt")!
  assert.equal(now.text.literal, `${Math.round(lookAt(satrec, miami, mid)!.elevation)}°`)

  const rate = rangeRate(satrec, miami, mid)!
  const byId = Object.fromEntries(detail.sky.readout.map((l) => [l.id, l.text.literal]))
  // AO-7 is heard on 29.4-29.5 MHz (center 29.45) and sent to on 145.85-145.95 (center 145.9).
  assert.equal(byId.dnFreq, `↓ ${downlinkDoppler(29.45, rate).toFixed(4)}`)
  assert.equal(byId.upFreq, `↑ ${uplinkDoppler(145.9, rate).toFixed(4)}`)
  assert.equal(byId.dnShift, shiftText((downlinkDoppler(29.45, rate) - 29.45) * 1000))
  assert.equal(byId.upShift, shiftText((uplinkDoppler(145.9, rate) - 145.9) * 1000))
  // The downlink goes to the top left and the uplink to the top right, in the empty corners.
  const left = detail.sky.readout.find((l) => l.id === "dnFreq")!
  const right = detail.sky.readout.find((l) => l.id === "upFreq")!
  assert.ok(left.x < 10 && left.y < 10 && left.text.align === "start")
  assert.ok(right.x + right.width > 350 && right.y < 10 && right.text.align === "end")
})

test("none of it is there before the satellite rises or after it sets", () => {
  for (const at of [best.aos - 120_000, best.los + 120_000]) {
    const detail = buildDetail(ao7, miami, best, at, true, "sky")
    assert.equal(detail.underWay, false)
    assert.deepEqual(detail.sky.readout, [])
    assert.deepEqual(detail.sky.labels.map((l) => l.id), ["riseAt", "peakAt", "setAt"])
  }
})

test("at the peak the peak's own label gives way to the satellite's, which says the same", () => {
  const atPeak = buildDetail(ao7, miami, best, best.maxElevationAt, true, "sky")
  const ids = atPeak.sky.labels.map((l) => l.id)
  assert.ok(ids.includes("nowAt") && !ids.includes("peakAt"), ids.join())
  const early = buildDetail(ao7, miami, best, before, true, "sky")
  assert.ok(early.sky.labels.map((l) => l.id).includes("peakAt"), "away from the peak it keeps its label")
})

// --- the Doppler shift --------------------------------------------------------------------------

test("the shift is up while it comes toward the observer and down once it is going away, and is nothing at the closest", () => {
  const down = (at: number) => liveDoppler(ao7, miami, at)!.down!
  const up = (at: number) => liveDoppler(ao7, miami, at)!.up!
  assert.ok(down(before).kHz > 0 && down(after).kHz < 0, "heard high, then low")
  assert.ok(up(before).kHz < 0 && up(after).kHz > 0, "and to be heard on the center, sent low, then high")
  assert.ok(Math.abs(down(best.maxElevationAt).kHz) < Math.abs(down(before).kHz), "least at the peak")
  // The size of it: about a kilohertz on 10 meters for a bird at 1,450 km; ten times that on 2 meters.
  assert.ok(Math.abs(down(before).kHz) > 0.2 && Math.abs(down(before).kHz) < 3)
  assert.ok(Math.abs(up(before).kHz) > 1 && Math.abs(up(before).kHz) < 15)
  // A downlink's shift is in proportion to its frequency.
  const ratio = up(before).kHz / down(before).kHz
  assert.ok(Math.abs(Math.abs(ratio) - 145.9 / 29.45) < 0.05, `${ratio}`)
  assert.equal(liveDoppler(noOrbit, miami, mid), null)
  assert.equal(shiftText(12.34), "+12.3 kHz")
  assert.equal(shiftText(-0.04), "+0.0 kHz", "no minus on nothing")
  assert.equal(shiftText(-0.06), "−0.1 kHz")
})

// --- how often the page is drawn --------------------------------------------------------------

const ctx = { online: true }
let panes = 0

async function panel() {
  forgetAll()
  const id = ++panes
  const ext = await loadExtension(() => import("./index.ts"), {
    hostCalls: {
      getLocation: () => null,
      kvGet: () => null,
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
  const args = (config: Record<string, unknown>, at: number) => ({
    panelKey: "passes",
    instanceId: `live-${id}`,
    operation: {},
    qsoCount: 0,
    reason: "",
    config,
    clock: { nowMillis: at, realNowMillis: at },
  })
  return {
    render: async (config: Record<string, unknown>, at: number) =>
      (await ext.runHook("panel", "render", args(config, at), { ctx })) as { triggers?: string[]; scene: { controls: { id: string; opacity?: number }[]; layers: { id: string }[] } },
    event: async (config: Record<string, unknown>, at: number, controlId: string, action: string, extra: { text?: string } = {}) =>
      ext.runHook("panel", "onEvent", { ...args(config, at), event: { controlId, action, phase: "activate", sequence: 1, ...extra } }, { ctx }),
  }
}

test("the Sky page is redrawn every two seconds while the satellite is overhead, every second with the countdown, and not otherwise", async () => {
  const p = await panel()
  const config = { grid: "EL95vs", minElevation: 0 }
  const listAt = best.aos - 30 * 60_000
  const list = await p.render(config, listAt)
  const open = list.scene.controls.find((c) => c.id.startsWith("open:AO-7:") && c.opacity !== 0)
  assert.ok(open, "an AO-7 pass is on the list")
  // Open the best pass of the day, which is the one these times are for.
  const wanted = (await p.render({ ...config }, listAt)).scene.controls.filter((c) => c.id.startsWith("open:AO-7:")).find((c) => Math.abs(Number(c.id.split(":")[2]) - best.los) < 120_000)
  assert.ok(wanted, "the best pass is among the listed")
  await p.event(config, listAt, wanted!.id, "open")

  // Not yet up: the panel's own minute is enough.
  assert.deepEqual((await p.render(config, best.aos - 5 * 60_000)).triggers, [])
  const overhead = await p.render(config, mid)
  assert.deepEqual(overhead.triggers, ["tick:2"])
  assert.ok(overhead.scene.layers.some((l) => l.id === "nowAt") && overhead.scene.layers.some((l) => l.id === "dnFreq"))
  assert.deepEqual((await p.render({ ...config, countdown: true }, mid)).triggers, ["tick:1"])
  assert.deepEqual((await p.render(config, best.los + 5 * 60_000)).triggers, [], "set again")

  // The Radio page has nothing moving; nor does the list.
  await p.event(config, mid, "tab", "tab", { text: "radio" })
  assert.deepEqual((await p.render(config, mid)).triggers, [])
  await p.event(config, mid, "back", "back")
  assert.deepEqual((await p.render(config, mid)).triggers, [])
})

test("a pass shorter than ten seconds is not a pass", () => {
  // The satellite, moved so it only just clips the horizon, has passes of no length: none are listed.
  const all = findPasses(satrec, miami, t0, 24 * 7, 0)
  assert.ok(all.length > 5)
  assert.ok(all.every((q) => q.los - q.aos >= 10_000))
})
