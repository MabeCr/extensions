// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { test } from "node:test"

import { buildCatalog, ELEMENTS_URL, LIST_URL, parseElements, parseList, statusUrl } from "./data.ts"
import { buildDetail, completePass, themeOf } from "./detail.ts"
import { ELEMENTS, LIST, SUMMARY } from "./fixtures.ts"
import { findPasses, satrecFromOmm } from "./orbit.ts"
import { linksFor, radioLines, RADIO_LINES } from "./radio.ts"
import { forgetAll } from "./memory.ts"
import { loadExtension } from "./sdkGapTesting.ts"
import { passOfOpen, openId } from "./scene.ts"
import { compassLayers, skySvg, skyTrack, skyXY } from "./sky.ts"

// No corrections: these tests are about the maths and the page, not about what we know of each bird.
const catalog = buildCatalog(parseList(LIST), parseElements(ELEMENTS), {})
const ao7 = catalog.find((s) => s.name === "AO-7")!
const noOrbit = catalog.find((s) => s.name === "CAS-4A")!
const miami = { lat: 25.76, lon: -80.19 }
const t0 = Date.parse("2026-10-07T00:00:00Z")
const satrec = satrecFromOmm(ao7.omm!)
const passes = findPasses(satrec, miami, t0, 24, 10)
const best = passes.reduce((a, b) => (b.maxElevation > a.maxElevation ? b : a))

test("the sky plot puts the horizon at the rim, overhead at the center, north up", () => {
  assert.deepEqual(skyXY(0, 90), { x: 180, y: 180 })
  assert.deepEqual(skyXY(0, 0), { x: 180, y: 30 })
  assert.deepEqual(skyXY(90, 0), { x: 330, y: 180 })
  assert.deepEqual(skyXY(180, 0), { x: 180, y: 330 })
  assert.deepEqual(skyXY(270, 0), { x: 30, y: 180 })
  // Halfway up is halfway in, and nothing lands outside the rim.
  assert.deepEqual(skyXY(0, 45), { x: 180, y: 105 })
  assert.deepEqual(skyXY(0, -20), skyXY(0, 0))
})

test("a pass's track runs from rise to set inside the plot", () => {
  const track = skyTrack(satrec, miami, best)
  assert.ok(track.length > 30)
  assert.equal(track[0].at, best.aos)
  assert.equal(track[track.length - 1].at, best.los)
  assert.ok(track.every((p, i) => i === 0 || p.at > track[i - 1].at))
  assert.ok(Math.max(...track.map((p) => p.elevation)) > 0.99 * best.maxElevation)
  for (const p of track) {
    const { x, y } = skyXY(p.azimuth, p.elevation)
    assert.ok(Math.hypot(x - 180, y - 180) <= 150.5)
  }
})

test("the plot is a self-contained SVG with the path, its three dots, and a ring only while the pass is under way", () => {
  const track = skyTrack(satrec, miami, best)
  const before = skySvg(track, best, undefined, best.aos - 60_000)
  assert.match(before, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 360 360">/)
  assert.equal((before.match(/<circle/g) ?? []).length, 3 + 3, "three rings and three dots")
  assert.match(before, /<path d="M[^"]+" fill="none" stroke="#4aa3ff"/)
  const during = skySvg(track, best, undefined, Math.round((best.aos + best.los) / 2))
  assert.equal((during.match(/<circle/g) ?? []).length, 3 + 3 + 1, "and a ring for where it is now")
  assert.equal(compassLayers("#fff").map((l) => l.text.literal).join(""), "NSEW")
  assert.ok(!/<text/.test(before), "letters are text layers, not SVG text")
})

test("the plot takes the app's colors when it reports them", () => {
  const themed = themeOf({ onSurface: "#112233", onSurfaceVariant: "#445566", accent: "#778899", error: "#aa0000" })
  assert.equal(themed.text, "#112233")
  assert.equal(themed.sky.path, "#778899")
  assert.equal(themed.sky.set, "#aa0000")
  assert.equal(themeOf(undefined).sky.path, "#4aa3ff")
  assert.match(skySvg(skyTrack(satrec, miami, best), best, themed.sky), /stroke="#778899"/)
})

test("frequencies are corrected for Doppler the right way round for each direction", () => {
  const lines = radioLines(ao7, miami, best, best.aos - 3_600_000)
  assert.match(lines[0], /^Doppler-corrected: rise · peak · set$/)
  // AO-7: a 29.4–29.5 MHz downlink (center 29.45), a 145.85–145.95 uplink (center 145.9).
  assert.equal(lines[1], "↓ 29.400–29.500 linear")
  assert.equal(lines[3], "↑ 145.850–145.950 linear (send)")
  const down = lines[2].trim().split(" · ").map(Number)
  const up = lines[4].trim().split(" · ").map(Number)
  assert.equal(down.length, 3)
  // Approaching at the rise: heard high. Receding at the set: heard low. About the center at the peak.
  assert.ok(down[0] > 29.45 && down[2] < 29.45)
  assert.ok(Math.abs(down[1] - 29.45) < Math.abs(down[0] - 29.45))
  // The uplink is the other way round: to be heard on the center, transmit low on the way in and high on the way out.
  assert.ok(up[0] < 145.9 && up[2] > 145.9)
  assert.ok(Math.abs(down[0] - 29.45) * 1e6 < 2_000, "under 2 kHz on 10 meters")
  assert.ok(Math.abs(up[0] - 145.9) * 1e6 < 10_000, "under 10 kHz on 2 meters")
  assert.ok(lines.length <= RADIO_LINES)
})

test("a pass already under way is labeled 'now', a satellite without data says so, and without orbit it still lists its frequencies", () => {
  const mid = Math.round((best.aos + best.los) / 2)
  assert.match(radioLines(ao7, miami, { ...best, inProgress: true }, mid)[0], /now · peak · set/)
  assert.deepEqual(radioLines({ ...noOrbit, uplinks: [], downlinks: [] }, miami, best, t0), ["No frequencies known for this satellite."])
  const withLink = radioLines({ ...noOrbit, downlinks: [{ mode: "fm", lowerMHz: 437.5, upperMHz: 437.5 }] }, miami, best, t0)
  assert.equal(withLink[1], "↓ 437.500 fm")
  assert.match(withLink[2], /no orbit data/)
})

test("what else is known of a bird is listed, and AMSAT's status page is always one link", () => {
  const known = { ...ao7, info: { ctcssHz: 67, beaconMHz: 145.9, tips: "Keep it short.", links: [{ label: "Home", url: "https://example.org" }] } }
  const lines = radioLines(known, miami, best, t0)
  assert.ok(lines.includes("Access tone 67 Hz") && lines.includes("Beacon 145.900 MHz") && lines.includes("Keep it short."))
  assert.deepEqual(linksFor(known).map((l) => l.label), ["Home", "AMSAT status reports"])
  assert.deepEqual(linksFor(ao7).map((l) => l.label), ["AMSAT status reports"])
})

test("a detail names its pass and keeps the Radio page at a fixed length", () => {
  const d = buildDetail(ao7, miami, best, best.aos - 3_600_000, true, "sky")
  assert.match(d.title, /^AO-7 · \d\d:\d\dZ–\d\d:\d\dZ$/)
  assert.match(d.times[0], /^Rise {2}\d\d:\d\d:\d\dZ {2}[NESW]+ \d+°$/)
  assert.match(d.times[1], /^Peak {2}\d\d:\d\d:\d\dZ {2}\d+° toward [NESW]+$/)
  assert.match(d.times[2], /^Set {3}\d\d:\d\d:\d\dZ {2}[NESW]+ \d+°$/)
  assert.equal(d.radio.length, RADIO_LINES)
  assert.ok(d.radio.slice(5).every((l) => l === ""))
})

test("a pass already under way is traced back to where it really rose", () => {
  const mid = Math.round((best.aos + best.los) / 2)
  const clipped = findPasses(satrec, miami, mid, 3, 0)[0]
  assert.equal(clipped.aos, mid)
  const full = completePass(ao7, miami, clipped, mid)
  assert.ok(Math.abs(full.aos - best.aos) < 2_000)
  assert.ok(Math.abs(full.los - best.los) < 2_000)
  // A pass that has not begun is left as it is.
  assert.equal(completePass(ao7, miami, best, best.aos - 60_000), best)
})

test("open controls name their pass, whatever the satellite is called", () => {
  assert.deepEqual(passOfOpen(openId("AO-7", 1234, 2)), { name: "AO-7", los: 1234 })
  assert.deepEqual(passOfOpen(openId("X:Y", 99, 0)), { name: "X:Y", los: 99 })
  assert.equal(passOfOpen("star:AO-7:1"), null)
  assert.equal(passOfOpen(openId("", 0, 3)), null)
})

// --- through the panel -------------------------------------------------------

const ctx = { online: true }
let panes = 0
interface Control { id: string; opacity?: number }
interface SceneOf { controls: Control[]; layers: { id: string }[]; strings: Record<string, string>; values: Record<string, number> }

async function panel(shown: unknown[] = []) {
  forgetAll()
  const id = ++panes
  const ext = await loadExtension(() => import("./index.ts"), {
    hostCalls: {
      getLocation: () => null,
      kvGet: () => null,
      kvSet: () => undefined,
      showMessage: (params) => void shown.push(params),
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
  const cfg = { grid: "EL95vs" }
  const args = (at: number) => ({
    panelKey: "passes",
    instanceId: `detail-${id}`,
    operation: {},
    qsoCount: 0,
    reason: "",
    config: cfg,
    clock: { nowMillis: at, realNowMillis: at },
  })
  return {
    render: async (at: number) => ((await ext.runHook("panel", "render", args(at), { ctx })) as { scene: SceneOf }).scene,
    event: async (at: number, controlId: string, action: string, extra: { text?: string; value?: number } = {}) =>
      (await ext.runHook("panel", "onEvent", { ...args(at), event: { controlId, action, phase: "activate", sequence: 1, ...extra } }, { ctx })) as {
        values: Record<string, number>
        strings?: Record<string, string>
      },
  }
}

test("tapping a row opens its pass: the Sky page, then Radio, then back to the list", async () => {
  const shown: unknown[] = []
  const p = await panel(shown)
  const list = await p.render(t0)
  const open = list.controls.find((c) => c.id.startsWith("open:") && c.opacity !== 0)!
  assert.ok(open)

  // Opening answers with only the UTC switch, which both views have.
  const opened = await p.event(t0, open.id, "open")
  assert.deepEqual(opened, { values: { utc: 0 } })
  const sky = await p.render(t0)
  assert.deepEqual(sky.layers.map((l) => l.id), ["sky", "north", "south", "east", "west", "riseAt", "peakAt", "setAt"])
  assert.match(sky.strings.title, /^(AO-7|FO-29) · /)
  assert.equal(sky.strings.tab, "sky")
  assert.ok(sky.strings.time0.startsWith("Rise"))
  assert.equal(sky.controls.length, 4 + 3, "the Sky page keeps only the times under the plot")
  assert.equal(sky.strings.status0, undefined)
  assert.ok(sky.controls.length <= 64)

  assert.deepEqual(await p.event(t0, "tab", "tab", { text: "radio" }), { values: { utc: 0 } })
  const radio = await p.render(t0)
  assert.equal(radio.layers.length, 0)
  assert.equal(radio.strings.tab, "radio")
  assert.match(radio.strings.radio0, /^Doppler-corrected/)
  assert.match(radio.strings.status0, /^AMSAT, last 24 h: (heard|telemetry only) \(\d+ heard, \d+ telemetry, \d+ not heard\)$/)
  assert.match(radio.strings.status1, /^Latest report: (heard|telemetry only|not heard), (\d\d-\d\d )?\d\d:\d\dZ?$/)
  assert.ok(radio.controls.some((c) => c.id === "links"))

  // The UTC switch answers with this view's own lines, all of which are in this scene.
  const utc = await p.event(t0, "utc", "utc", { value: 1 })
  assert.equal(utc.values.utc, 1)
  const names = new Set([...Object.keys(radio.strings), ...Object.keys(radio.values)])
  for (const key of [...Object.keys(utc.strings ?? {}), ...Object.keys(utc.values)]) assert.ok(names.has(key), `${key} is not in the scene`)

  // Links open a dialog with a link to each page.
  await p.event(t0, "links", "links")
  assert.equal(shown.length, 1)
  const dialog = shown[0] as { presentation: string; actions: { type: string; url: string }[] }
  assert.equal(dialog.presentation, "dialog")
  assert.ok(dialog.actions.every((a) => a.type === "link" && a.url.startsWith("https://")))
  assert.ok(dialog.actions.some((a) => a.url === "https://www.amsat.org/status/"))

  assert.deepEqual(await p.event(t0, "back", "back"), { values: { utc: 1 } })
  assert.match((await p.render(t0)).strings.header, /^EL95vs · /)
})

test("a pass that has ended is not shown: the pane goes back to the list", async () => {
  const p = await panel()
  const list = await p.render(t0)
  const open = list.controls.find((c) => c.id.startsWith("open:") && c.opacity !== 0)!
  await p.event(t0, open.id, "open")
  assert.ok((await p.render(t0)).strings.title)
  // Three days later nothing of that pass is left.
  const later = await p.render(t0 + 3 * 24 * 3_600_000)
  assert.ok(later.strings.header, "back on the list")
  assert.equal(later.strings.title, undefined)
})

// --- what we know of each bird ------------------------------------------------

import curated from "./data/satellites.json" with { type: "json" }
import type { CuratedInfo, Satellite } from "./data.ts"
import { plausible } from "./radio.ts"

test("the curated file is well formed: known fields, https links, sane numbers", () => {
  const fields = new Set(["norad", "amsat", "uplinks", "downlinks", "ctcssHz", "beaconMHz", "tips", "links"])
  for (const [name, raw] of Object.entries(curated as Record<string, CuratedInfo>)) {
    for (const key of Object.keys(raw)) assert.ok(fields.has(key), `${name} has an unknown field ${key}`)
    if (raw.ctcssHz !== undefined) assert.ok(raw.ctcssHz > 60 && raw.ctcssHz < 260, `${name}'s tone`)
    if (raw.beaconMHz !== undefined) assert.ok(raw.beaconMHz > 1 && raw.beaconMHz < 12_000, `${name}'s beacon`)
    if (raw.tips !== undefined) assert.ok(raw.tips.length <= 60, `${name}'s tip is too long for a line`)
    for (const l of raw.links ?? []) assert.ok(l.label && /^https:\/\//.test(l.url), `${name}'s link ${l.label}`)
    for (const l of [...(raw.uplinks ?? []), ...(raw.downlinks ?? [])]) assert.ok(plausible(l), `${name} has an implausible frequency`)
  }
})

test("IO-86's list entry has a downlink that spans two bands; our correction replaces it", () => {
  const listed = [{ name: "IO-86", number: 40931, modulation: "fm", uplinks: [{ mode: "fm", lowerMHz: 145.825, upperMHz: 145.88 }], downlinks: [{ mode: "fm", lowerMHz: 145.825, upperMHz: 435.88 }] }]
  const [raw] = buildCatalog(parseList(listed), new Map(), {})
  assert.equal(plausible(raw.downlinks[0]), false)
  const [fixed] = buildCatalog(parseList(listed), new Map())
  assert.deepEqual(fixed.uplinks, [{ mode: "fm", lowerMHz: 145.88, upperMHz: 145.88 }])
  assert.deepEqual(fixed.downlinks, [{ mode: "fm", lowerMHz: 435.88, upperMHz: 435.88 }])
  assert.equal(fixed.info.ctcssHz, 88.5)
})

test("a frequency that cannot be a band is left out, and the page says so", () => {
  const bad: Satellite = { name: "X", modulation: "fm", info: {}, uplinks: [{ mode: "fm", lowerMHz: 145.9, upperMHz: 145.9 }], downlinks: [{ mode: "fm", lowerMHz: 145.825, upperMHz: 435.88 }] }
  const lines = radioLines(bad, miami, best, t0)
  assert.ok(!lines.some((l) => l.includes("435.88")), "the bad downlink is not shown")
  assert.ok(lines.includes("↑ 145.900 fm (send)"))
  assert.ok(lines.includes("Some frequencies look wrong and are left out."))
  assert.deepEqual(radioLines({ ...bad, uplinks: [] }, miami, best, t0), ["The list's frequencies for this satellite look wrong."])
  for (const l of [{ lowerMHz: 0, upperMHz: 1 }, { lowerMHz: 146, upperMHz: 145 }, { lowerMHz: 100, upperMHz: 160 }]) assert.equal(plausible({ mode: "x", ...l }), false)
  assert.equal(plausible({ mode: "x", lowerMHz: 145.9, upperMHz: 146 }), true)
})

test("what AMSAT says of SO-50 is on its Radio page: its tone, how to arm it, and where to read more", () => {
  const so50 = buildCatalog(parseList([{ name: "SO-50", number: 27607, modulation: "fm", uplinks: [{ mode: "fm", lowerMHz: 145.85, upperMHz: 145.85 }], downlinks: [{ mode: "fm", lowerMHz: 436.795, upperMHz: 436.795 }] }]), new Map())[0]
  const lines = radioLines(so50, miami, best, t0)
  assert.ok(lines.includes("Access tone 67 Hz"))
  assert.ok(lines.some((l) => l.includes("74.4 Hz")))
  assert.ok(linksFor(so50)[0].url.startsWith("https://www.amsat.org/two-way-satellites/so-50"))
})

test("AO-92 is not drawn on AO-91's orbit, which is what the list's number would have done", () => {
  // The Ham2K list gives AO-92 the number 43017, which is AO-91's.
  const listed = parseList([
    { name: "AO-91", number: 43017, modulation: "fm", uplinks: [], downlinks: [] },
    { name: "AO-92", number: 43017, modulation: "fm", uplinks: [], downlinks: [] },
  ])
  const elements = new Map([[43017, { ...ELEMENTS[0], NORAD_CAT_ID: 43017 } as never]])
  const [ao91, ao92Uncorrected] = buildCatalog(listed, elements, {})
  assert.ok(ao91.omm && ao92Uncorrected.omm, "without the correction, both get the same orbit")
  const [real91, real92] = buildCatalog(listed, elements)
  assert.ok(real91.omm, "AO-91 keeps its orbit")
  assert.equal(real92.omm, undefined)
  assert.equal(real92.norad, undefined)
})

test("ARISS is the ISS for AMSAT's status, and IO-117 is GreenCube's number", () => {
  const curatedInfo = curated as Record<string, CuratedInfo>
  assert.deepEqual(curatedInfo.ARISS.amsat, ["ISS"])
  assert.equal(curatedInfo["IO-117"].norad, 53109)
  assert.equal(curatedInfo["FO-29"].norad, 24278)
})
