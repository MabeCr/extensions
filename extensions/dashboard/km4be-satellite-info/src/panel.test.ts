// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { test } from "node:test"

import { ELEMENTS_URL, LIST_URL, statusUrl } from "./data.ts"
import { ELEMENTS, LIST, SUMMARY } from "./fixtures.ts"
import { forgetAll } from "./memory.ts"
import { datasetCalls } from "./datasetTesting.ts"
import { loadExtension } from "./sdkGapTesting.ts"

const ctx = { online: true }
let panes = 0

interface SceneControl {
  id: string
  kind: string
  label: string
  value?: string
  icon?: string
  disabled?: boolean
  opacity?: number
}
interface Scene {
  values: Record<string, number>
  strings: Record<string, string>
  controls: SceneControl[]
  layers: unknown[]
}

/// A fresh extension per test, so its panes and favorites start empty.
async function panel(options: { device?: { latitude: number; longitude: number } | null; offline?: () => boolean; settings?: Map<string, unknown> } = {}) {
  forgetAll()
  const id = ++panes
  const storage = new Map<string, unknown>()
  const settings = options.settings ?? new Map<string, unknown>()
  const fetched: string[] = []
  const ext = await loadExtension(() => import("./index.ts"), {
    hostCalls: {
      ...datasetCalls().hostCalls,
      getLocation: () => options.device ?? null,
      kvGet: (params) => storage.get(String(params.key)) ?? null,
      kvSet: (params) => void storage.set(String(params.key), params.value),
      getSettings: () => ({ extensions: { ["extension_km4be-satellite-info"]: Object.fromEntries(settings) } }),
      setSettings: (params) => {
        for (const [k, v] of Object.entries(params.values as Record<string, unknown>)) settings.set(k, v)
      },
      fetch: (params) => {
        const url = String(params.url)
        fetched.push(url)
        if (options.offline?.()) throw new Error("network down")
        if (url === LIST_URL) return { status: 200, body: JSON.stringify(LIST) }
        if (url === ELEMENTS_URL) return { status: 200, body: JSON.stringify(ELEMENTS) }
        if (url === statusUrl(24)) return { status: 200, body: JSON.stringify(SUMMARY) }
        return { status: 404, body: "" }
      },
    },
  })
  const args = (config: Record<string, unknown>, at: number) => ({
    panelKey: "passes",
    instanceId: `pane-${id}`,
    operation: {},
    qsoCount: 0,
    reason: "",
    config,
    clock: { nowMillis: at, realNowMillis: at },
  })
  return {
    storage,
    settings,
    fetched,
    render: async (config: Record<string, unknown>, at: number) =>
      (await ext.runHook("panel", "render", args(config, at), { ctx })) as { kind: string; scene: Scene },
    event: async (config: Record<string, unknown>, at: number, controlId: string, action: string, extra: { text?: string; value?: number } = {}) =>
      (await ext.runHook(
        "panel",
        "onEvent",
        { ...args(config, at), event: { controlId, action, phase: "commit", sequence: 1, ...extra } },
        { ctx },
      )) as { values: Record<string, number>; strings: Record<string, string> },
    descriptor: async () => ((await ext.runHook("panel", "getPanels", {}, { ctx })) as { on: string[]; form: { key: string }[] }[])[0],
  }
}

const t0 = Date.parse("2026-10-07T00:00:00Z")
const cfg = { grid: "EL95vs" }
const rowTexts = (strings: Record<string, string>) => [0, 1, 2, 3, 4].map((i) => strings[`row${i}`]).filter(Boolean)
const control = (scene: Scene, id: string) => scene.controls.find((c) => c.id === id)!

test("the panel is a scene of controls, with its settings and a minute's tick", async () => {
  const p = await panel()
  const d = await p.descriptor()
  assert.deepEqual(d.on, ["tick:60"])
  assert.deepEqual(d.form.map((f) => f.key), ["minElevation", "grid", "statusHours", "utc", "density", "listSeconds", "skySize", "countdown"])
  const { kind, scene } = await p.render(cfg, t0)
  assert.equal(kind, "scene")
  // The list is drawn as text in one monospaced face: the titles and the five rows, each with a hit area over it.
  const ids = (scene.layers as { id: string }[]).map((l) => l.id)
  const rowIds = ids.filter((id) => /^(columns|row\d+)$/.test(id))
  // The rows come first, and the header after them, so that it is drawn over the rows as they scroll under it.
  assert.ok(rowIds.length > 6 && rowIds[0] === "row0" && rowIds[1] === "row1" && rowIds[rowIds.length - 1] === "columns", rowIds.join(","))
  assert.ok(ids.indexOf("headBg") > ids.indexOf(rowIds[rowIds.length - 2]) && ids.indexOf("headBg") < ids.indexOf("columns"), "the header background is over the rows and under its text")
  // The marks of AMSAT's reports are icons, with a title over their column and a key under the rows.
  assert.ok(ids.includes("markTitle") && ids.includes("key-heard") && ids.includes("key-telemetry") && ids.includes("key-notHeard"))
  assert.ok(scene.controls.length <= 256 && scene.layers.length <= 512, "within what a scene holds")
  assert.deepEqual([...new Set(scene.controls.map((c) => c.kind))].sort(), ["button", "nativeButton", "nativeSegmented", "nativeSwitch", "nativeText"])
})

test("with no place the panel says so, and asks again in ten seconds, not every few", async () => {
  const p = await panel()
  const first = await p.render({}, t0)
  const { scene } = first
  assert.match(scene.strings.header, /No location/)
  assert.deepEqual(rowTexts(scene.strings), [])
  assert.equal(p.fetched.length, 1, "the reports are fetched once; the satellites are the app's datasets, read with the place, not after it")
  assert.deepEqual((first as unknown as { triggers: string[] }).triggers, ["tick:10"])
  await p.render({}, t0 + 10_000)
  assert.equal(p.fetched.length, 1, "and not again")
})

test("the device's location is used, rounded to its grid square", async () => {
  const p = await panel({ device: { latitude: 41.7, longitude: -72.7 } })
  const { scene } = await p.render(cfg, t0)
  assert.match(scene.strings.header, /^FN31[a-x]{2} · /)
})

test("a new install opens on All, and Favorites with nobody followed says how to follow one", async () => {
  const p = await panel()
  const { scene } = await p.render({ ...cfg, utc: true }, t0)
  assert.match(scene.strings.header, /^EL95vs · min 10° · 2 of 4 satellites tracked$/)
  assert.match(scene.strings.hint, /^(Next: \S+ in .+|\S+ up now, .+ left)/, "what is up and what is next")
  assert.equal(scene.strings.mode, "all")
  assert.deepEqual((scene.controls.find((c) => c.id === "mode") as unknown as { options: { value: string }[] }).options.map((o) => o.value), ["all", "favorites", "now"], "All on the left, and the sky of what is up now after the lists")
  assert.equal(scene.values.utc, 1, "the setting starts the pane in UTC")
  const rows = rowTexts(scene.strings)
  assert.equal(rows.length, 5)
  assert.match(rows[0], /^(AO-7|FO-29) +SSB +(now|\d\d:\d\dZ) +\d+° +[NESW]+→[NESW]+ +\d+m( +[✔◐✘])?$/)
})

test("a star follows a satellite without changing the list, and Favorites then shows only its passes", async () => {
  const p = await panel()
  const first = await p.render(cfg, t0)
  const star = first.scene.controls.find((c) => c.id.startsWith("star:") && c.opacity !== 0)!
  const name = star.id.split(":")[1]
  assert.equal(star.icon, "star-outline")
  const everyone = new Set(rowTexts(first.scene.strings).map((r) => r.split(/ +/)[0]))
  assert.ok(everyone.size === 2, "both satellites appear")

  // On All, so that the next satellite can be followed too: the list does not shrink to the one just followed.
  const patch = await p.event(cfg, t0, star.id, "star")
  assert.deepEqual(p.settings.get("favorites"), [name])
  assert.equal(patch.strings.mode, "all")
  const after = await p.render(cfg, t0)
  assert.equal(new Set(rowTexts(after.scene.strings).map((r) => r.split(/ +/)[0])).size, 2, "everything is still there")
  assert.ok(after.scene.controls.filter((c) => c.id.startsWith(`star:${name}:`)).every((c) => c.icon === "star"), "its star is filled")

  // Favorites shows only the followed satellite.
  const only = await p.event(cfg, t0, "mode", "mode", { text: "favorites" })
  const favorites = await p.render(cfg, t0)
  assert.ok(rowTexts(favorites.scene.strings).every((r) => r.startsWith(name)))
  assert.deepEqual(only, { values: { utc: 0 }, strings: { mode: "favorites" } }, "an answer names the switch and the UTC value, which every view has")
  assert.match(favorites.scene.strings.hint, /^(Next: \S+ in .+|\S+ up now, .+ left)/)

  // All shows every satellite again, the followed one's star filled.
  await p.event(cfg, t0, "mode", "mode", { text: "all" })
  const all = await p.render(cfg, t0)
  assert.equal(all.scene.strings.mode, "all")
  const others = new Set(rowTexts(all.scene.strings).map((r) => r.split(/ +/)[0]))
  assert.ok(others.size === 2, "both satellites appear")

  // Unfollowing removes it.
  const filled = all.scene.controls.find((c) => c.id.startsWith(`star:${name}:`))!
  await p.event(cfg, t0, filled.id, "star")
  assert.deepEqual(p.settings.get("favorites"), [])
})

test("every pass of the day is in the list for the pane to scroll through, and there is no pager", async () => {
  const p = await panel()
  const { scene } = await p.render({ ...cfg, minElevation: 0 }, t0)
  const rows = Object.keys(scene.strings).filter((k) => /^row\d+$/.test(k))
  assert.ok(rows.length > 5, `${rows.length} passes`)
  assert.ok(!scene.controls.some((c) => ["prev", "next", "range"].includes(c.id)), "no pager and no count of pages")
  // A star and a hit area for each row.
  assert.equal(scene.controls.filter((c) => c.id.startsWith("star:")).length, rows.length)
  assert.equal(scene.controls.filter((c) => /^open:.*:row\d+$/.test(c.id)).length, rows.length)
  assert.equal((scene as unknown as { layout?: unknown }).layout, undefined, "nothing is laid out: the scroll places every piece")
})

test("the UTC switch changes how times read, and the names an event patches are always in the scene", async () => {
  const p = await panel()
  const local = await p.render(cfg, t0)
  const patch = await p.event(cfg, t0, "utc", "utc", { value: 1 })
  assert.equal(patch.values.utc, 1)
  const utc = await p.render(cfg, t0)
  assert.ok(rowTexts(utc.scene.strings).every((r) => /(now|\d\d:\d\dZ)/.test(r)))
  assert.equal(utc.scene.values.utc, 1)

  const sceneNames = new Set([...Object.keys(local.scene.strings), ...Object.keys(local.scene.values)])
  for (const key of [...Object.keys(patch.strings), ...Object.keys(patch.values)]) assert.ok(sceneNames.has(key), `${key} is not in the scene`)
  assert.equal(local.scene.controls.length, utc.scene.controls.length)
  assert.deepEqual(Object.keys(local.scene.strings).sort(), Object.keys(utc.scene.strings).sort())
  // What an answer names is only what every list has, since the number of rows changes between All and Favorites.
  assert.deepEqual(Object.keys(patch.strings).sort(), ["columns", "header", "hint", "mode"])
})

test("a short list has just its rows: no blank ones hidden", async () => {
  const p = await panel()
  const { scene } = await p.render({ ...cfg, minElevation: 60 }, t0)
  const shown = rowTexts(scene.strings)
  const stars = scene.controls.filter((c) => c.id.startsWith("star:"))
  assert.equal(stars.length, shown.length)
  assert.ok(stars.every((c) => c.opacity !== 0 && c.disabled !== true && c.label !== "No pass"))
  assert.equal(new Set(stars.map((c) => c.id)).size, stars.length, "ids stay unique")
})

test("AMSAT's reports are cached, a failed one falls back to what is kept, and a tap does not refetch", async () => {
  let offline = false
  const p = await panel({ offline: () => offline })
  await p.render(cfg, t0)
  assert.equal(p.fetched.length, 1, "AMSAT's reports: the list and the orbits are the app's datasets")
  await p.render(cfg, t0 + 60_000)
  await p.event(cfg, t0 + 61_000, "mode", "mode", { text: "all" })
  assert.equal(p.fetched.length, 1, "still inside the cache window")
  offline = true
  const later = await p.render(cfg, t0 + 30 * 3_600_000)
  assert.match(later.scene.strings.header, /2 of 4 satellites tracked/, "stale orbits are better than none")
})

test("Favorites with nobody followed is an empty page that says how to fill it, not everything", async () => {
  const p = await panel()
  await p.render(cfg, t0)
  await p.event(cfg, t0, "mode", "mode", { text: "favorites" })
  const scene = (await p.render(cfg, t0)).scene
  assert.match(scene.strings.hint, /^Add some favorites to see them here: tap a star on the All page\.$/)
  assert.deepEqual(rowTexts(scene.strings), [])
  assert.equal(scene.strings.columns, "")
  const ids = (scene.layers as { id: string }[]).map((l) => l.id)
  assert.ok(!ids.includes("markTitle") && !ids.some((id) => id.startsWith("key-")), "no title over the marks and no key to them, with nothing listed")
  assert.ok(scene.controls.some((c) => c.id === "mode"), "the switch is still there to go back to All")

  // The compact pane has a shorter line.
  const tight = await p.render({ ...cfg, density: "compact" }, t0)
  assert.match(tight.scene.strings.hint, /^Add favorites on All, with a star, to see them here\.$/)

  await p.event(cfg, t0, "mode", "mode", { text: "all" })
  assert.equal(rowTexts((await p.render(cfg, t0)).scene.strings).length, 5)
})

test("the view chosen is remembered for the next time the app is opened, and a new pane starts on it", async () => {
  const p = await panel()
  assert.equal((await p.render(cfg, t0)).scene.strings.mode, "all")
  assert.equal(p.settings.get("mode"), undefined, "nothing is written for a default nobody chose")
  await p.event(cfg, t0, "mode", "mode", { text: "favorites" })
  assert.equal(p.settings.get("mode"), "favorites")
  await p.event(cfg, t0, "mode", "mode", { text: "all" })
  assert.equal(p.settings.get("mode"), "all")
  await p.event(cfg, t0, "mode", "mode", { text: "favorites" })

  // The app is opened again: nothing in memory, the settings kept. A pane of its own starts on Favorites.
  const again = await panel({ settings: p.settings })
  assert.equal((await again.render(cfg, t0)).scene.strings.mode, "favorites")
  // Anything else that was stored is read as All.
  for (const odd of ["everyone", 3, null]) {
    const q = await panel({ settings: new Map([["mode", odd]]) })
    assert.equal((await q.render(cfg, t0)).scene.strings.mode, "all", String(odd))
  }
})
