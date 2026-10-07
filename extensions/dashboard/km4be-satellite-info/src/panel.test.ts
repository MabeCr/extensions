// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { test } from "node:test"

import { ELEMENTS_URL, forgetFailures, LIST_URL, statusUrl } from "./data.ts"
import { ELEMENTS, LIST, SUMMARY } from "./fixtures.ts"
import { forgetPasses } from "./passes.ts"
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
async function panel(options: { device?: { latitude: number; longitude: number } | null; offline?: () => boolean } = {}) {
  forgetPasses()
  forgetFailures()
  const id = ++panes
  const storage = new Map<string, unknown>()
  const fetched: string[] = []
  const ext = await loadExtension(() => import("./index.ts"), {
    hostCalls: {
      getLocation: () => options.device ?? null,
      kvGet: (params) => storage.get(String(params.key)) ?? null,
      kvSet: (params) => void storage.set(String(params.key), params.value),
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

test("the panel is a scene of native controls, with its settings and a minute's tick", async () => {
  const p = await panel()
  const d = await p.descriptor()
  assert.deepEqual(d.on, ["tick:60"])
  assert.deepEqual(d.form.map((f) => f.key), ["minElevation", "grid", "statusHours", "utc"])
  const { kind, scene } = await p.render(cfg, t0)
  assert.equal(kind, "scene")
  assert.equal(scene.layers.length, 0, "no artwork")
  assert.ok(scene.controls.length <= 64)
  assert.ok(scene.controls.every((c) => c.kind.startsWith("native")))
})

test("with no place the panel says so, and fetches nothing", async () => {
  const p = await panel()
  const { scene } = await p.render({}, t0)
  assert.match(scene.strings.header, /No location/)
  assert.deepEqual(rowTexts(scene.strings), [])
  assert.equal(p.fetched.length, 0)
})

test("the device's location is used, rounded to its grid square", async () => {
  const p = await panel({ device: { latitude: 41.7, longitude: -72.7 } })
  const { scene } = await p.render(cfg, t0)
  assert.match(scene.strings.header, /^FN31[a-x]{2} · /)
})

test("with nobody followed, every satellite is shown and the hint says how to follow one", async () => {
  const p = await panel()
  const { scene } = await p.render({ ...cfg, utc: true }, t0)
  assert.match(scene.strings.header, /^EL95vs · min 10° · 2 of 4 satellites tracked$/)
  assert.match(scene.strings.hint, /No favorites yet/)
  assert.equal(scene.strings.mode, "favorites")
  assert.equal(scene.values.utc, 1, "the setting starts the pane in UTC")
  const rows = rowTexts(scene.strings)
  assert.equal(rows.length, 5)
  assert.match(rows[0], /^[✔◐✘ ] (AO-7|FO-29) · (now|\d\d:\d\dZ) · \d+° · [NESW]+ → [NESW]+ · \d+ min$/)
  assert.match(scene.strings.range, /^1–5 of \d+$/)
})

test("a star follows a satellite for good, and Favorites then shows only its passes", async () => {
  const p = await panel()
  const first = await p.render(cfg, t0)
  const star = first.scene.controls.find((c) => c.id.startsWith("star:") && c.opacity !== 0)!
  const name = star.id.split(":")[1]
  assert.equal(star.icon, "star-outline")

  const patch = await p.event(cfg, t0, star.id, "star")
  assert.deepEqual(p.storage.get("favorites"), [name])
  assert.ok(rowTexts(patch.strings).every((r) => r.slice(2).startsWith(`${name} ·`)))
  assert.match(patch.strings.hint, /^Orbits from CelesTrak/)

  const after = await p.render(cfg, t0)
  assert.ok(after.scene.controls.filter((c) => c.id.startsWith(`star:${name}:`)).every((c) => c.icon === "star"))
  assert.ok(rowTexts(after.scene.strings).every((r) => r.slice(2).startsWith(`${name} ·`)))

  // All shows every satellite again, the followed one's star filled.
  await p.event(cfg, t0, "mode", "mode", { text: "all" })
  const all = await p.render(cfg, t0)
  assert.equal(all.scene.strings.mode, "all")
  const others = new Set(rowTexts(all.scene.strings).map((r) => r.slice(2).split(" · ")[0]))
  assert.ok(others.size === 2, "both satellites appear")

  // Unfollowing removes it.
  const filled = all.scene.controls.find((c) => c.id.startsWith(`star:${name}:`))!
  await p.event(cfg, t0, filled.id, "star")
  assert.deepEqual(p.storage.get("favorites"), [])
})

test("paging moves through the passes and stops at the ends, and the buttons say so", async () => {
  const p = await panel()
  const config = { ...cfg, minElevation: 0 }
  const one = await p.render(config, t0)
  const total = Number(one.scene.strings.range.split(" of ")[1])
  assert.ok(total > 5, `${total} passes`)
  assert.equal(control(one.scene, "prev").disabled, true)
  assert.equal(control(one.scene, "next").disabled, false)

  const first = rowTexts(one.scene.strings)
  await p.event(config, t0, "next", "next")
  const two = await p.render(config, t0)
  assert.notDeepEqual(rowTexts(two.scene.strings), first)
  assert.match(two.scene.strings.range, /^6–/)
  assert.equal(control(two.scene, "prev").disabled, false)

  // Held at the last page, and at the first.
  for (let i = 0; i < 30; i++) await p.event(config, t0, "next", "next")
  const last = await p.render(config, t0)
  assert.equal(control(last.scene, "next").disabled, true)
  assert.match(last.scene.strings.range, new RegExp(`of ${total}$`))
  for (let i = 0; i < 30; i++) await p.event(config, t0, "prev", "prev")
  assert.deepEqual(rowTexts((await p.render(config, t0)).scene.strings), first)
})

test("the UTC switch changes how times read, and the names an event patches are always in the scene", async () => {
  const p = await panel()
  const local = await p.render(cfg, t0)
  const patch = await p.event(cfg, t0, "utc", "utc", { value: 1 })
  assert.equal(patch.values.utc, 1)
  assert.ok(rowTexts(patch.strings).every((r) => /(now|\d\d:\d\dZ)/.test(r)))
  const utc = await p.render(cfg, t0)
  assert.equal(utc.scene.values.utc, 1)

  const sceneNames = new Set([...Object.keys(local.scene.strings), ...Object.keys(local.scene.values)])
  for (const key of [...Object.keys(patch.strings), ...Object.keys(patch.values)]) assert.ok(sceneNames.has(key), `${key} is not in the scene`)
  assert.equal(local.scene.controls.length, utc.scene.controls.length)
  assert.deepEqual(Object.keys(local.scene.strings).sort(), Object.keys(utc.scene.strings).sort())
})

test("a short page keeps five slots, the unused ones hidden", async () => {
  const p = await panel()
  const { scene } = await p.render({ ...cfg, minElevation: 60 }, t0)
  const stars = scene.controls.filter((c) => c.id.startsWith("star:"))
  assert.equal(stars.length, 5)
  const hidden = stars.filter((c) => c.opacity === 0)
  assert.equal(hidden.length, 5 - rowTexts(scene.strings).length)
  assert.ok(hidden.every((c) => c.disabled === true && c.label === "No pass"))
  assert.equal(new Set(stars.map((c) => c.id)).size, 5, "ids stay unique")
})

test("feeds are cached, a failed one falls back to what is stored, and a tap does not refetch", async () => {
  let offline = false
  const p = await panel({ offline: () => offline })
  await p.render(cfg, t0)
  assert.equal(p.fetched.length, 3, "the list, the orbits and AMSAT's reports")
  await p.render(cfg, t0 + 60_000)
  await p.event(cfg, t0 + 61_000, "mode", "mode", { text: "all" })
  assert.equal(p.fetched.length, 3, "still inside the cache window")
  offline = true
  const later = await p.render(cfg, t0 + 30 * 3_600_000)
  assert.match(later.scene.strings.header, /2 of 4 satellites tracked/, "stale orbits are better than none")
})
