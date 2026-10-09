// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { test } from "node:test"

import { buildCatalog, ELEMENTS_URL, loadCatalog, LIST_URL, parseElements, parseList, statusUrl } from "./data.ts"
import { ELEMENTS, LIST, SUMMARY } from "./fixtures.ts"
import { forgetAll } from "./memory.ts"
import { passesComputed, upcomingPasses } from "./passes.ts"
import { loadExtension } from "./sdkGapTesting.ts"

const ctx = { online: true }
const t0 = Date.parse("2026-10-07T00:00:00Z")
const MINUTE = 60_000
const HOUR = 3_600_000
let panes = 0

type Counts = { getLocation: number; kvGet: number; kvSet: number; getSettings: number; setSettings: number; fetch: number; fetched: string[] }

/// A panel whose host counts what it is asked for: the point of this file is how seldom that is.
/// `storage` is what `kvSet` keeps, `settings` the extension's own settings group: pass them on to a
/// second panel to stand for a relaunch that keeps them.
async function panel(
  device: () => { latitude: number; longitude: number } | null = () => null,
  storage = new Map<string, unknown>(),
  settings = new Map<string, unknown>(),
) {
  forgetAll()
  const id = ++panes
  const counts: Counts = { getLocation: 0, kvGet: 0, kvSet: 0, getSettings: 0, setSettings: 0, fetch: 0, fetched: [] }
  const ext = await loadExtension(() => import("./index.ts"), {
    hostCalls: {
      getLocation: () => {
        counts.getLocation += 1
        return device()
      },
      kvGet: (params) => {
        counts.kvGet += 1
        return storage.get(String(params.key)) ?? null
      },
      kvSet: (params) => {
        counts.kvSet += 1
        storage.set(String(params.key), params.value)
      },
      getSettings: () => {
        counts.getSettings += 1
        return { extensions: { "extension_km4be-satellite-info": Object.fromEntries(settings) } }
      },
      setSettings: (params) => {
        counts.setSettings += 1
        for (const [k, v] of Object.entries(params.values as Record<string, unknown>)) settings.set(k, v)
      },
      fetch: (params) => {
        counts.fetch += 1
        const url = String(params.url)
        counts.fetched.push(url)
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
    instanceId: `cache-${id}`,
    operation: {},
    qsoCount: 0,
    reason: "",
    config,
    clock: { nowMillis: at, realNowMillis: at },
  })
  const reset = () => {
    counts.getLocation = counts.kvGet = counts.kvSet = counts.getSettings = counts.setSettings = counts.fetch = 0
    counts.fetched.length = 0
  }
  return {
    counts,
    storage,
    settings,
    reset,
    render: async (config: Record<string, unknown>, at: number) =>
      (await ext.runHook("panel", "render", args(config, at), { ctx })) as { scene: { strings: Record<string, string>; controls: { id: string; opacity?: number }[] } },
    event: async (config: Record<string, unknown>, at: number, controlId: string, action: string, extra: { text?: string; value?: number } = {}) =>
      ext.runHook("panel", "onEvent", { ...args(config, at), event: { controlId, action, phase: "activate", sequence: 1, ...extra } }, { ctx }),
  }
}

const cfg = { grid: "EL95vs" }
const quiet = (c: Counts) => ({ getLocation: c.getLocation, kvGet: c.kvGet, kvSet: c.kvSet, getSettings: c.getSettings, setSettings: c.setSettings, fetch: c.fetch })

test("a redraw within the time things are good for asks the host for nothing at all", async () => {
  const p = await panel()
  await p.render(cfg, t0)
  assert.ok(p.counts.fetch === 3 && p.counts.kvSet === 3, "the first draw fetches and stores the three feeds")
  p.reset()

  await p.render(cfg, t0 + 20_000)
  await p.render(cfg, t0 + 40_000)
  assert.deepEqual(quiet(p.counts), { getLocation: 0, kvGet: 0, kvSet: 0, getSettings: 0, setSettings: 0, fetch: 0 })
})

test("going from the Sky page back to the list is free", async () => {
  const p = await panel()
  const list = await p.render(cfg, t0)
  const open = list.scene.controls.find((c) => c.id.startsWith("open:") && c.opacity !== 0)!
  p.reset()

  await p.event(cfg, t0 + 5_000, open.id, "open")
  await p.render(cfg, t0 + 5_000)
  await p.event(cfg, t0 + 9_000, "tab", "tab", { text: "radio" })
  await p.render(cfg, t0 + 9_000)
  await p.event(cfg, t0 + 12_000, "back", "back")
  const back = await p.render(cfg, t0 + 12_000)
  assert.match(back.scene.strings.header, /^EL95vs /)
  assert.deepEqual(quiet(p.counts), { getLocation: 0, kvGet: 0, kvSet: 0, getSettings: 0, setSettings: 0, fetch: 0 })
})

test("each thing is asked for again when it is out of date, and only that thing", async () => {
  const p = await panel(() => ({ latitude: 25.76, longitude: -80.19 }))
  await p.render(cfg, t0)
  p.reset()

  // A minute on: the device is asked where it is, nothing else.
  await p.render(cfg, t0 + MINUTE + 1)
  assert.deepEqual(quiet(p.counts), { getLocation: 1, kvGet: 0, kvSet: 0, getSettings: 0, setSettings: 0, fetch: 0 })
  p.reset()

  // Ten minutes: AMSAT's reports.
  await p.render(cfg, t0 + 10 * MINUTE + 1)
  assert.deepEqual(p.counts.fetched, [statusUrl(24)])
  p.reset()

  // Six hours: the orbits as well, which are fetched once, and the passes are worked out again for them.
  await p.render(cfg, t0 + 6 * HOUR + 1)
  assert.ok(p.counts.fetched.includes(ELEMENTS_URL))
  assert.ok(!p.counts.fetched.includes(LIST_URL))
  p.reset()

  // A day: the list of satellites.
  await p.render(cfg, t0 + 25 * HOUR)
  assert.ok(p.counts.fetched.includes(LIST_URL))
})

test("what is stored on the device is read once, when the panel starts, and not again", async () => {
  const first = await panel()
  await first.render(cfg, t0)
  const { storage, settings } = first

  // A restart: memory is gone, the device's storage is not.
  const second = await panel(() => null, storage, settings)
  await second.render(cfg, t0 + HOUR)
  assert.equal(second.counts.fetch, 1, "only the reports, which are an hour old and good for ten minutes")
  assert.deepEqual(second.counts.fetched, [statusUrl(24)])
  assert.equal(second.counts.kvGet, 3, "the list, the orbits and the reports, once each")
  assert.equal(second.counts.getSettings, 1, "and the favorites, once")
  second.reset()
  await second.render(cfg, t0 + HOUR + 20_000)
  assert.deepEqual(quiet(second.counts), { getLocation: 0, kvGet: 0, kvSet: 0, getSettings: 0, setSettings: 0, fetch: 0 })
})

test("favorites are written once when they change and never read again", async () => {
  const p = await panel()
  const first = await p.render(cfg, t0)
  const star = first.scene.controls.find((c) => c.id.startsWith("star:") && c.opacity !== 0)!
  p.reset()

  await p.event(cfg, t0 + 1_000, star.id, "star")
  assert.equal(p.counts.setSettings, 1)
  assert.equal(p.counts.getSettings, 0)
  const after = await p.render(cfg, t0 + 2_000)
  assert.equal(p.counts.getSettings, 0, "the new list is already known")
  const name = star.id.split(":")[1]
  assert.ok([0, 1, 2, 3, 4].map((i) => after.scene.strings[`row${i}`]).filter(Boolean).every((r) => r.startsWith(name)))
  assert.deepEqual(p.settings.get("favorites"), [name])
})

test("favorites outlast a relaunch, which empties what kvSet kept", async () => {
  const p = await panel()
  const first = await p.render(cfg, t0)
  const star = first.scene.controls.find((c) => c.id.startsWith("star:") && c.opacity !== 0)!
  await p.event(cfg, t0 + 1_000, star.id, "star")
  const name = star.id.split(":")[1]

  // The app's kv store is in memory, so a relaunch starts it empty; the settings are kept.
  const relaunched = await panel(() => null, new Map(), p.settings)
  const after = await relaunched.render(cfg, t0 + 2_000)
  assert.equal(after.scene.strings.mode, "favorites")
  assert.ok(after.scene.controls.filter((c) => c.id.startsWith(`star:${name}:`)).length > 0)
  assert.ok([0, 1, 2, 3, 4].map((i) => after.scene.strings[`row${i}`]).filter(Boolean).every((r) => r.startsWith(name)), "Favorites shows only the followed satellite")
})

test("the device's position is remembered for a minute, and a move is noticed after it", async () => {
  let at = { latitude: 25.76, longitude: -80.19 } // Miami
  const p = await panel(() => at)
  const home = await p.render({}, t0)
  assert.match(home.scene.strings.header, /^EL95/)
  at = { latitude: 41.7, longitude: -72.7 } // Connecticut

  assert.match((await p.render({}, t0 + 30_000)).scene.strings.header, /^EL95/, "not yet asked again")
  assert.match((await p.render({}, t0 + 61_000)).scene.strings.header, /^FN31/, "asked again, and it has moved")
})

test("the passes are worked out once in six hours, not at every draw, and the list still shows only a day", async () => {
  const p = await panel()
  await p.render(cfg, t0)
  await p.render(cfg, t0 + 10 * MINUTE)
  await p.render(cfg, t0 + 3 * HOUR)
  assert.equal(passesComputed(), 1)

  await p.render(cfg, t0 + 7 * HOUR)
  assert.equal(passesComputed(), 2, "the orbits and the passes both a few hours old")
  await p.render({ ...cfg, minElevation: 30 }, t0 + 7 * HOUR + MINUTE)
  assert.equal(passesComputed(), 3, "a different minimum is a different list")

  // Worked out at t0 for 30 hours; at t0 + 5 h the list shows to t0 + 29 h, and no further than a day from then.
  forgetAll()
  const catalog = buildCatalog(parseList(LIST), parseElements(ELEMENTS), {})
  const place = { lat: 25.76, lon: -80.19, grid: "EL95vs" }
  const early = upcomingPasses(catalog, place, t0, 10, 1)
  const later = upcomingPasses(catalog, place, t0 + 5 * HOUR, 10, 1)
  assert.equal(passesComputed(), 1, "the second call reused the first")
  assert.ok(early.every((q) => q.aos <= t0 + 24 * HOUR))
  assert.ok(later.every((q) => q.aos <= t0 + 29 * HOUR && q.los > t0 + 5 * HOUR))
  assert.ok(later.some((q) => q.aos > t0 + 24 * HOUR), "it reaches past what the first call listed")
})

test("the parsed catalog is built once and handed out again until a feed changes", async () => {
  const p = await panel()
  await p.render(cfg, t0)
  const stub = { online: true } as never
  // Through the same memory the panel used: nothing is asked of the host, and the same object comes back.
  const a = await loadCatalog(stub, t0 + MINUTE)
  const b = await loadCatalog(stub, t0 + 2 * MINUTE)
  assert.equal(a, b)
  const afterSixHours = await loadCatalog(stub, t0 + 6 * HOUR + 1)
  assert.notEqual(afterSixHours, a, "the orbits were fetched again, so the catalog is rebuilt")
})
