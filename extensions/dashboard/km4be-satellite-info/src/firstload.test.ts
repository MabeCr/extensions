// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// The first render after the app starts, which is when the device may not have a position yet, the connection may have only just come up,
// and a server may be slow: the list is there as soon as what it needs is, and does not need leaving and coming back to.

import assert from "node:assert/strict"
import { test } from "node:test"

import { buildCatalog, ELEMENTS_URL, FETCH_TIMEOUT_MS, LIST_URL, parseElements, parseList, statusUrl } from "./data.ts"
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
  /// Feeds whose server says no, with a 403, as CelesTrak does to an address it has blocked.
  refusing?: Set<string>
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
  const ext = await loadExtension(() => import("./index.ts"), {
    hostCalls: {
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
        if (script.refusing?.has(url)) return held({ status: 403, body: "" })
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

test("the place, the satellites, the orbits and AMSAT's reports are asked for together, not one after another", async () => {
  // The host answers none of the four until all four have been asked for. A render that asked for one and waited would never ask for the
  // next, and never be answered.
  const p = await panel({ gate: 4 })
  const outcome = await Promise.race([p.render(cfg, t0), new Promise<string>((resolve) => setTimeout(() => resolve("stuck"), 1500))])
  assert.notEqual(outcome, "stuck", "asked for one thing and waited for it before asking for the next")
  assert.ok(rows((outcome as { scene: { strings: Record<string, string> } }).scene) > 0)
  assert.deepEqual([...p.calls].filter((c) => c === "getLocation" || c.startsWith("fetch ")).sort(), ["fetch " + ELEMENTS_URL, "fetch " + LIST_URL, "fetch " + statusUrl(24), "getLocation"].sort())
})

test("every fetch has a time limit, shorter than the host's own, so that a slow server cannot hold the first render", async () => {
  const p = await panel()
  await p.render(cfg, t0)
  assert.equal(p.fetchOptions.length, 3)
  for (const o of p.fetchOptions) assert.equal(o.timeout, FETCH_TIMEOUT_MS)
  assert.ok(FETCH_TIMEOUT_MS >= 3_000 && FETCH_TIMEOUT_MS <= 10_000)
})

test("with the satellites not yet come, the list says so and asks again in three seconds, and is there when they do", async () => {
  const failing = new Set([LIST_URL, ELEMENTS_URL])
  const p = await panel({ failing })
  const first = await p.render(cfg, t0)
  assert.match(first.scene.strings.header, /No satellite data yet/)
  assert.equal(rows(first.scene), 0)
  assert.deepEqual(first.triggers, ["tick:3"])
  // Too soon to ask again: not at once. After a few seconds, with the servers back, there is a list.
  const soon = p.fetchOptions.length
  await p.render(cfg, t0 + 1_000)
  assert.equal(p.fetchOptions.length, soon, "not hammered")
  failing.clear()
  const later = await p.render(cfg, t0 + 6_000)
  assert.ok(rows(later.scene) > 0, "the list is there")
  assert.notDeepEqual(later.triggers, ["tick:3"], "and no longer waiting")
})

test("with the host saying it is offline and nothing to show, the feeds are tried anyway; with something to show, they are not", async () => {
  const p = await panel({}, false)
  const first = await p.render(cfg, t0)
  assert.ok(rows(first.scene) > 0, "the connection had come up before the host knew")
  // Everything is held now, so a host that says it is offline asks nothing more.
  const asked = p.fetchOptions.length
  await p.render(cfg, t0 + 3 * 3_600_000)
  assert.equal(p.fetchOptions.length, asked)
})

test("a server that says no is not asked again for two hours, and one that is only down is asked again in an hour while there is a copy", async () => {
  const refusing = new Set([ELEMENTS_URL])
  const p = await panel({ refusing })
  const asks = () => p.calls.filter((c) => c === "fetch " + ELEMENTS_URL).length
  await p.render(cfg, t0)
  assert.equal(asks(), 1)
  // With nothing to show, a failure is tried again in seconds; a 403 is not, since asking again only prolongs the block.
  await p.render(cfg, t0 + 10_000)
  await p.render(cfg, t0 + 30 * 60_000)
  assert.equal(asks(), 1, "not within two hours")
  refusing.clear()
  await p.render(cfg, t0 + 2 * 3_600_000 + 1_000)
  assert.equal(asks(), 2, "and then it is")

  // With a copy that has gone out of date, a server that is down is tried again in an hour, not in minutes.
  const failing = new Set<string>()
  const q = await panel({ failing })
  const qasks = () => q.calls.filter((c) => c === "fetch " + ELEMENTS_URL).length
  await q.render(cfg, t0)
  failing.add(ELEMENTS_URL)
  const old = t0 + 3 * 24 * 3_600_000 + 1_000
  await q.render(cfg, old)
  assert.equal(qasks(), 2)
  await q.render(cfg, old + 10 * 60_000)
  assert.equal(qasks(), 2, "the copy is used meanwhile")
  await q.render(cfg, old + 61 * 60_000)
  assert.equal(qasks(), 3)
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
