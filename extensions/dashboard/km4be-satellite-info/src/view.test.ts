// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { test } from "node:test"

import { buildCatalog, ELEMENTS_URL, LIST_URL, parseElements, parseList, statusUrl } from "./data.ts"
import { ELEMENTS, LIST, SUMMARY } from "./fixtures.ts"
import { findPasses, lookAt, satrecFromOmm } from "./orbit.ts"
import { clock, countdown } from "./passes.ts"
import { forgetAll } from "./memory.ts"
import { loadExtension } from "./sdkGapTesting.ts"

const iso = (s: string) => Date.parse(s)

test("a time can be shown to the second, rounded to the nearest, with the date when it is not today", () => {
  const now = iso("2026-10-07T14:00:00Z")
  assert.equal(clock(iso("2026-10-07T14:05:12.400Z"), now, true, true), "14:05:12Z")
  assert.equal(clock(iso("2026-10-07T14:05:12.600Z"), now, true, true), "14:05:13Z")
  assert.equal(clock(iso("2026-10-07T14:05:59.700Z"), now, true, true), "14:06:00Z")
  assert.equal(clock(iso("2026-10-08T00:00:03Z"), now, true, true), "10-08 00:00:03Z")
  // Without seconds it is the minute the moment falls in, as before.
  assert.equal(clock(iso("2026-10-07T14:05:59.700Z"), now, true), "14:05Z")
  const local = clock(iso("2026-10-07T14:05:12Z"), iso("2026-10-07T14:00:00Z"), false, true)
  assert.match(local, /^(\d\d-\d\d )?\d\d:\d\d:12$/, "local time carries no Z")
})

test("a countdown is minus before the event and plus after it", () => {
  const event = iso("2026-10-07T14:05:12Z")
  assert.equal(countdown(event, event - 252_000), "−4:12")
  assert.equal(countdown(event, event + 125_000), "+2:05")
  assert.equal(countdown(event, event), "+0:00")
  assert.equal(countdown(event, event - 1_000), "−0:01")
  assert.equal(countdown(event, event - (3600 + 4 * 60 + 12) * 1000), "−1:04:12")
  assert.equal(countdown(event, event + 3_661_000), "+1:01:01")
  // Rounded to the nearest second, so it does not sit on a second it has already left.
  assert.equal(countdown(event, event - 4_600), "−0:05")
})

test("a pass's edges are found to a fifth of a second, so the seconds shown are real", () => {
  const catalog = buildCatalog(parseList(LIST), parseElements(ELEMENTS), {})
  const satrec = satrecFromOmm(catalog[0].omm!)
  const observer = { lat: 25.76, lon: -80.19 }
  const passes = findPasses(satrec, observer, iso("2026-10-07T00:00:00Z"), 24, 5)
  assert.ok(passes.length > 2)
  for (const p of passes) {
    const el = (t: number) => lookAt(satrec, observer, t)!.elevation
    // The first instant it is up, and the last: a quarter of a second outside, it is not.
    assert.ok(el(p.aos) > 0 && el(p.aos - 250) <= 0, "rise")
    assert.ok(el(p.los) > 0 && el(p.los + 250) <= 0, "set")
    // Nothing a second either side of the peak is higher.
    assert.ok(el(p.maxElevationAt - 1_000) <= p.maxElevation + 1e-9 && el(p.maxElevationAt + 1_000) <= p.maxElevation + 1e-9, "peak")
  }
})

// --- through the panel -------------------------------------------------------

const ctx = { online: true }
let panes = 0
const t0 = iso("2026-10-07T00:00:00Z")

interface Scene {
  controls: { id: string; opacity?: number }[]
  layers: { id: string; text?: { literal: string } }[]
  strings: Record<string, string>
  layout: { column: Record<string, unknown>[] }
}

async function panel(environment?: { width: number; height: number }) {
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
    instanceId: `view-${id}`,
    operation: {},
    qsoCount: 0,
    reason: "",
    config,
    clock: { nowMillis: at, realNowMillis: at },
    ...(environment ? { environment } : {}),
  })
  return {
    render: async (config: Record<string, unknown>, at: number) =>
      (await ext.runHook("panel", "render", args(config, at), { ctx })) as { scene: Scene; triggers?: string[] },
    event: async (config: Record<string, unknown>, at: number, controlId: string, action: string, extra: { text?: string; value?: number } = {}) =>
      ext.runHook("panel", "onEvent", { ...args(config, at), event: { controlId, action, phase: "activate", sequence: 1, ...extra } }, { ctx }),
  }
}

const cfg = { grid: "EL95vs", utc: true }
const rowTexts = (strings: Record<string, string>) => [0, 1, 2, 3, 4].map((i) => strings[`row${i}`]).filter(Boolean)

async function openFirst(p: Awaited<ReturnType<typeof panel>>, config: Record<string, unknown>, at: number) {
  const list = await p.render(config, at)
  const open = list.scene.controls.find((c) => c.id.startsWith("open:") && c.opacity !== 0)!
  await p.event(config, at, open.id, "open")
}

test("the list shows seconds only when asked", async () => {
  const p = await panel()
  const plain = rowTexts((await p.render({ ...cfg, minElevation: 0 }, t0)).scene.strings)
  assert.ok(plain.every((r) => / (now|\d\d:\d\dZ) /.test(r)), plain[0])
  const exact = rowTexts((await p.render({ ...cfg, minElevation: 0, listSeconds: true }, t0)).scene.strings)
  assert.ok(exact.every((r) => / (now|\d\d:\d\d:\d\dZ) /.test(r)), exact[0])
})

test("the pass's page gives its times to the second, and the plot carries them too", async () => {
  const p = await panel()
  await openFirst(p, cfg, t0)
  const { scene, triggers } = await p.render(cfg, t0)
  assert.match(scene.strings.time0, /^Rise {2}\d\d:\d\d:\d\dZ /)
  assert.ok(!/[−+]\d+:\d\d$/.test(scene.strings.time0), "no countdown unless asked")
  const labels = scene.layers.filter((l) => ["riseAt", "peakAt", "setAt"].includes(l.id))
  assert.equal(labels.length, 3)
  assert.match(labels[0].text!.literal, /^\d\d:\d\d:\d\dZ$/)
  assert.match(labels[1].text!.literal, /^\d+°$/)
  assert.deepEqual(triggers, [])
})

test("the plot keeps its size, and it is the text under it that gives way when the pane is short", async () => {
  type Node = { scene?: boolean; flex?: number; height?: number; width?: number }
  const plotOf = async (pane?: { width: number; height: number }, config: Record<string, unknown> = cfg) => {
    const p = await panel(pane)
    await openFirst(p, config, t0)
    const plots = (await p.render(config, t0)).scene.layout.column.filter((n) => (n as Node).scene === true) as Node[]
    assert.equal(plots.length, 1)
    return plots[0]
  }
  // A host that does not say how big the pane is leaves the plot what the text under it does not take.
  assert.equal((await plotOf()).flex, 1)

  // Otherwise it has a size of its own: the pane's width less its padding, in a pane tall enough for that...
  const tall = await plotOf({ width: 1000, height: 1400 }, { ...cfg, density: "comfortable" })
  assert.equal(tall.flex, undefined)
  assert.equal(tall.height, 1000 - 24)
  // ...and what is left under the back button and the tabs in one that is not, however much text is under it.
  const short = await plotOf({ width: 1000, height: 400 }, { ...cfg, density: "comfortable" })
  assert.ok(short.height! < 400 - 24 - 56 && short.height! > 150, String(short.height))
  const shorter = await plotOf({ width: 1000, height: 380 }, { ...cfg, density: "comfortable" })
  assert.ok(shorter.height! < short.height!, "it follows the pane")

  // The same pane gives the same plot whatever the page holds: the lines under it change, not the plot.
  const a = await plotOf({ width: 390, height: 500 })
  const b = await plotOf({ width: 390, height: 500 }, { ...cfg, countdown: true })
  assert.equal(a.height, b.height)
})

test("with the countdown on, each event shows its time to or since, and the page redraws every second", async () => {
  const p = await panel()
  const on = { ...cfg, countdown: true }
  await openFirst(p, on, t0)
  const { scene, triggers } = await p.render(on, t0)
  for (const line of [scene.strings.time0, scene.strings.time1, scene.strings.time2]) assert.match(line, /[−+]\d+:\d\d(:\d\d)?$/, line)
  assert.deepEqual(triggers, ["tick:1"])
  // The first event of the day's first pass is still ahead; the countdown has the minus sign.
  assert.ok(scene.strings.time0.includes("−") || scene.strings.time0.includes("+"))

  // A little later the same page has moved on: a countdown that has passed zero turns plus.
  const first = (await p.render(on, t0)).scene.strings.time0
  const risesAt = Number(first.match(/\d\d:\d\d:\d\d/)![0].replace(/(\d\d):(\d\d):(\d\d)/, (_, h, m, s) => String(+h * 3600 + +m * 60 + +s)))
  const later = (await p.render(on, t0 + (risesAt + 60) * 1000)).scene.strings.time0
  assert.match(later, /\+\d+:\d\d/, "a minute after the rise")

  // Only the Sky page ticks: the Radio page and the list do not.
  await p.event(on, t0, "tab", "tab", { text: "radio" })
  assert.deepEqual((await p.render(on, t0)).triggers, [])
  await p.event(on, t0, "back", "back")
  assert.deepEqual((await p.render(on, t0)).triggers, [])
})

test("the sky chart's size is a setting: a share of the most the pane allows, from 40 to 100", async () => {
  type Node = { scene?: boolean; height?: number }
  const plotHeight = async (config: Record<string, unknown>) => {
    const p = await panel({ width: 390, height: 700 })
    await openFirst(p, config, t0)
    return ((await p.render(config, t0)).scene.layout.column.find((n) => (n as Node).scene === true) as Node).height!
  }
  const full = await plotHeight(cfg)
  assert.equal(full, await plotHeight({ ...cfg, skySize: 100 }), "100 is what it always was")
  const half = await plotHeight({ ...cfg, skySize: 50 })
  assert.equal(half, Math.floor(full / 2))
  assert.ok(half < full)
  // Nothing smaller than 40 or larger than 100, and anything that is not a number is the full size.
  assert.equal(await plotHeight({ ...cfg, skySize: 5 }), await plotHeight({ ...cfg, skySize: 40 }))
  assert.equal(await plotHeight({ ...cfg, skySize: 400 }), full)
  for (const odd of ["big", null, NaN, undefined]) assert.equal(await plotHeight({ ...cfg, skySize: odd }), full, String(odd))
})

test("the back button and the tabs are drawn lower than they were, and the plot takes the room that frees", async () => {
  type Row = { row?: { control?: string; height?: number }[]; height?: number }
  const p = await panel({ width: 390, height: 700 })
  await openFirst(p, cfg, t0)
  const column = (await p.render(cfg, t0)).scene.layout.column as Row[]
  const rows = column.filter((n) => n.row)
  assert.equal(rows.length, 2)
  for (const row of rows) assert.ok(row.height! >= 28 && row.height! <= 36, String(row.height))
  // The tabs are chips at their own height, which keeps their text in the middle; only the rows are held to a height.
  assert.deepEqual(rows[1].row!.filter((c) => c.control).map((c) => [c.control, c.height]), [["tab_sky", undefined], ["tab_radio", undefined], ["tab_report", undefined], ["utc", undefined]])
})

test("tapping a tab's chip shows its page, and lights only that chip", async () => {
  const p = await panel({ width: 390, height: 700 })
  await openFirst(p, cfg, t0)
  assert.deepEqual(Object.keys(await p.event(cfg, t0, "tab_radio", "tab-radio", { value: 1 }) as object), ["values"], "answered with the UTC switch alone, as every change of page is")
  const radio = (await p.render(cfg, t0)).scene as unknown as { values: Record<string, number>; strings: Record<string, string> }
  assert.equal(radio.strings.tab, "radio")
  assert.deepEqual([radio.values.tab_sky, radio.values.tab_radio, radio.values.tab_report], [0, 1, 0])
  await p.event(cfg, t0, "tab_report", "tab-report", { value: 1 })
  const report = (await p.render(cfg, t0)).scene as unknown as { values: Record<string, number>; strings: Record<string, string> }
  assert.equal(report.strings.tab, "report")
  assert.deepEqual([report.values.tab_sky, report.values.tab_radio, report.values.tab_report], [0, 0, 1])
  // Tapping the lit chip again, which the host reads as turning it off, leaves the page where it is.
  await p.event(cfg, t0, "tab_report", "tab-report", { value: 0 })
  assert.equal(((await p.render(cfg, t0)).scene as unknown as { strings: Record<string, string> }).strings.tab, "report")
  await p.event(cfg, t0, "tab_sky", "tab-sky", { value: 1 })
  assert.equal(((await p.render(cfg, t0)).scene as unknown as { strings: Record<string, string> }).strings.tab, "sky")
})

test("a Reset button over the corner of the plot puts the scrubber back at rest, and is only there while it is used", async () => {
  type Ctl = { id: string; kind: string; label: string; event?: string; x: number; y: number; width: number; height: number; opacity?: { value: string; input: number[]; output: number[] } }
  const p = await panel({ width: 390, height: 700 })
  await openFirst(p, cfg, t0)
  const scene = (await p.render(cfg, t0)).scene as unknown as { controls: Ctl[]; values: Record<string, number> }
  const ids = scene.controls.map((c) => c.id)
  const slider = scene.controls.find((c) => c.id === "scrub")!
  const reset = scene.controls.find((c) => c.id === "scrubReset")!
  assert.ok(slider && reset)
  assert.ok(ids.indexOf("scrubReset") > ids.indexOf("scrub"), "above the slider, so that it takes the tap")
  assert.deepEqual([reset.kind, reset.label, reset.event], ["nativeButton", "Reset", "scrubReset"])
  // Wide enough for its word with the button's own padding, and with no icon beside it to push the word out of the room.
  assert.ok(reset.width >= 100 && !("icon" in reset), `${reset.width}`)
  // In the bottom right corner of the plot, outside the circle of the sky and clear of the time readout at the bottom left.
  assert.ok(reset.x >= 180 && reset.y >= 300 && reset.x + reset.width <= 360 && reset.y + reset.height <= 360)
  assert.ok(Math.hypot(reset.x - 180, reset.y - 180) > 150, "outside the sky's circle")
  // Gone at rest, which is where the slider starts, and there on any moment.
  const rest = scene.values.scrub
  assert.deepEqual([reset.opacity!.value, reset.opacity!.input, reset.opacity!.output], ["scrub", [rest - 1, rest], [1, 0]])

  // Tapping it answers with where the slider rests, and keeps the UTC switch and the lit tab, which every answer carries.
  const answer = (await p.event(cfg, t0, "scrubReset", "scrubReset")) as unknown as { values: Record<string, number> }
  assert.deepEqual(answer.values, { utc: 1, tab_sky: 1, tab_radio: 0, tab_report: 0, scrub: rest })
})

test("Reset does nothing when there is nothing to scrub", async () => {
  const p = await panel({ width: 390, height: 700 })
  // On the list, or on another page, there is no slider to put back.
  const onList = (await p.event(cfg, t0, "scrubReset", "scrubReset")) as unknown as { values: Record<string, number> }
  assert.equal(onList.values.scrub, undefined)
  await openFirst(p, cfg, t0)
  await p.event(cfg, t0, "tab_radio", "tab-radio", { value: 1 })
  const onRadio = (await p.event(cfg, t0, "scrubReset", "scrubReset")) as unknown as { values: Record<string, number> }
  assert.equal(onRadio.values.scrub, undefined)
})
