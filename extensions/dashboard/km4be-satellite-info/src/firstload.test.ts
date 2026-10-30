// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// The first render after the app starts, which is when the device may not have a position yet, the connection may have only just come up,
// and a server may be slow: the list is there as soon as what it needs is, and does not need leaving and coming back to.

import assert from "node:assert/strict"
import { test } from "node:test"

import { buildCatalog, ELEMENTS_URL, FETCH_TIMEOUT_MS, LIST_URL, parseElements, parseList, statusUrl } from "./data.ts"
import { datasetCalls } from "./datasetTesting.ts"
import type { Downloaded } from "./datasetTesting.ts"
import { ELEMENTS, LIST, SUMMARY } from "./fixtures.ts"
import { forgetAll } from "./memory.ts"
import { findPlace } from "./location.ts"
import { loadExtension } from "./sdkGapTesting.ts"

void buildCatalog
void parseElements
void parseList

const t0 = Date.parse("2026-10-07T00:00:00Z")
const cfg = { minElevation: 0 }
let panes = 0

interface Script {
  /// What getLocation says, call by call: a position, or null.
  location?: ({ latitude: number; longitude: number } | null)[]
  /// Whether each feed's fetch fails (called in order).
  failing?: Set<string>
  /// What the app has downloaded of the two datasets so far: the default is both, and null is a file it has not got yet.
  files?: Downloaded
  /// Holds every answer of the position and the feeds until this many have been asked for: code that asks for one and waits for it before
  /// asking for the next never gets its answer.
  gate?: number
}

async function panel(script: Script = {}, online = true) {
  forgetAll()
  const id = ++panes
  const calls: string[] = []
  const fetchOptions: Record<string, unknown>[] = []
  let located = 0
  const waiters: (() => void)[] = []
  const held = <T,>(value: T): T | Promise<T> =>
    script.gate
      ? new Promise<T>((resolve) => {
          waiters.push(() => resolve(value))
          if (waiters.length >= script.gate!) waiters.splice(0).forEach((w) => w())
        })
      : value
  const datasets = datasetCalls(script.files)
  const ext = await loadExtension(() => import("./index.ts"), {
    hostCalls: {
      dbLookupSelectAll: (params) => {
        calls.push("lookup " + String(params.category))
        return held(datasets.hostCalls.dbLookupSelectAll(params))
      },
      dbLookupSelectOne: datasets.hostCalls.dbLookupSelectOne,
      getLocation: () => {
        calls.push("getLocation")
        const answer = script.location ? script.location[Math.min(located, script.location.length - 1)] : { latitude: 25.76, longitude: -80.19 }
        located++
        return held(answer)
      },
      kvGet: () => null,
      kvSet: () => undefined,
      getSettings: () => {
        calls.push("getSettings")
        return {}
      },
      setSettings: () => undefined,
      fetch: (params) => {
        const url = String(params.url)
        calls.push("fetch " + url)
        fetchOptions.push(params)
        if (script.failing?.has(url)) return held({ status: 503, body: "" })
        return held(
          url === LIST_URL
            ? { status: 200, body: JSON.stringify(LIST) }
            : url === ELEMENTS_URL
              ? { status: 200, body: JSON.stringify(ELEMENTS) }
              : url === statusUrl(24)
                ? { status: 200, body: JSON.stringify(SUMMARY) }
                : { status: 404, body: "" },
        )
      },
    },
  })
  const args = (config: Record<string, unknown>, at: number) => ({
    panelKey: "passes",
    instanceId: `first-${id}`,
    operation: {},
    qsoCount: 0,
    reason: "",
    config,
    clock: { nowMillis: at, realNowMillis: at },
    environment: { version: 1, width: 390, height: 700 },
  })
  return {
    calls,
    fetchOptions,
    render: async (config: Record<string, unknown>, at: number) =>
      (await ext.runHook("panel", "render", args(config, at), { ctx: { online } })) as { triggers?: string[]; scene: { strings: Record<string, string> } },
  }
}

const rows = (scene: { strings: Record<string, string> }) => Object.keys(scene.strings).filter((k) => /^row\d+$/.test(k)).length

test("the place, the satellites and AMSAT's reports are asked for together, not one after another", async () => {
  // The host answers none of the three until all three have been asked for. A render that asked for one and waited would never ask for the
  // next, and never be answered.
  const p = await panel({ gate: 3 })
  const outcome = await Promise.race([p.render(cfg, t0), new Promise<string>((resolve) => setTimeout(() => resolve("stuck"), 1500))])
  assert.notEqual(outcome, "stuck", "asked for one thing and waited for it before asking for the next")
  assert.ok(rows((outcome as { scene: { strings: Record<string, string> } }).scene) > 0)
  assert.deepEqual([...p.calls].filter((c) => c === "getLocation" || c.startsWith("fetch ") || c.startsWith("lookup ")).sort(), ["fetch " + statusUrl(24), "getLocation", "lookup km4be-satellite-list"].sort())
})

test("the satellites and their orbits are never fetched by the extension: they are the app's datasets, and a fetch it makes has a time limit", async () => {
  const p = await panel()
  await p.render(cfg, t0)
  assert.deepEqual(p.calls.filter((c) => c.startsWith("fetch ")), ["fetch " + statusUrl(24)])
  assert.equal(p.fetchOptions.length, 1)
  for (const o of p.fetchOptions) assert.equal(o.timeout, FETCH_TIMEOUT_MS)
  assert.ok(FETCH_TIMEOUT_MS >= 3_000 && FETCH_TIMEOUT_MS <= 10_000)
  assert.ok(!p.calls.includes("fetch " + LIST_URL) && !p.calls.includes("fetch " + ELEMENTS_URL))
})

test("with the app not yet through downloading the satellites, the list says so and reads again in three seconds, and is there when they come", async () => {
  const files: Downloaded = { list: null, orbits: null }
  const p = await panel({ files })
  const first = await p.render(cfg, t0)
  assert.match(first.scene.strings.header, /No satellite data yet/)
  assert.equal(rows(first.scene), 0)
  assert.deepEqual(first.triggers, ["tick:3"])
  // Too soon to read again: not at once. After a few seconds, with the files downloaded, there is a list.
  const reads = () => p.calls.filter((c) => c.startsWith("lookup ")).length
  const soon = reads()
  await p.render(cfg, t0 + 1_000)
  assert.equal(reads(), soon, "not hammered")
  files.list = LIST
  files.orbits = ELEMENTS
  const later = await p.render(cfg, t0 + 6_000)
  assert.ok(rows(later.scene) > 0, "the list is there")
  assert.notDeepEqual(later.triggers, ["tick:3"], "and no longer waiting")
})

test("the list is drawn from the app's datasets with the host saying it is offline: nothing is fetched for it", async () => {
  const p = await panel({}, false)
  const first = await p.render(cfg, t0)
  assert.ok(rows(first.scene) > 0)
  assert.ok(!p.calls.some((c) => c.startsWith("fetch ")), "not even AMSAT's reports, which wait until the host says it is online")
})

test("AMSAT's reports, which only add to the list, are not tried again every few seconds when they fail", async () => {
  const p = await panel({ failing: new Set([statusUrl(24)]) })
  await p.render(cfg, t0)
  const statusAsks = () => p.calls.filter((c) => c === "fetch " + statusUrl(24)).length
  assert.equal(statusAsks(), 1)
  await p.render(cfg, t0 + 6_000)
  assert.equal(statusAsks(), 1, "the list is there; the reports wait their usual pause")
})

test("a position that is not there yet is not remembered for a minute, and one that goes missing for a moment is the last one", async () => {
  const p = await panel({ location: [null, { latitude: 41.7, longitude: -72.7 }, null] })
  // The device says nothing the first time: nothing is known, and it is said so.
  const none = await p.render({}, t0)
  assert.match(none.scene.strings.header, /No location/)
  // A few seconds on it has a position: the list, at once, and not after a minute.
  const got = await p.render({}, t0 + 5_000)
  assert.match(got.scene.strings.header, /^FN31/)
  assert.ok(rows(got.scene) > 0)
  // And a minute after that it says nothing for a moment: the last position, not nowhere.
  const again = await p.render({}, t0 + 5_000 + 61_000)
  assert.match(again.scene.strings.header, /^FN31/)
})

test("findPlace remembers a place for a minute and no place for a few seconds", async () => {
  await panel({ location: [null, { latitude: 41.7, longitude: -72.7 }] })
  assert.equal(await findPlace({}, {}, t0), null)
  assert.equal(await findPlace({}, {}, t0 + 2_000), null, "the same moment")
  const got = await findPlace({}, {}, t0 + 5_000)
  assert.ok(got && got.source === "device")
  assert.equal((await findPlace({}, {}, t0 + 30_000))?.grid, got!.grid, "held for the minute")
})
