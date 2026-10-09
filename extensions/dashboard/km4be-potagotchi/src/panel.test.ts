// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { test } from "node:test"

import { STEPS } from "./behavior.ts"
import { contactsIn, countContacts, forgetCounts, forgetProgress, observe, reactionTo } from "./progress.ts"
import { FOODS } from "./props.ts"
import { loadExtension } from "./sdkGapTesting.ts"
import { nameFor } from "./words.ts"

const T0 = Date.parse("2026-10-07T18:00:00Z")
let operations = 0

interface Scene {
  values: Record<string, number>
  strings: Record<string, string>
  layers: { id: string; svg: string; translateX?: unknown; transitionMs?: number }[]
  controls: { id: string; kind: string; event?: string }[]
}

/// A panel with a log in the device's storage and a log of contacts that tests add to.
async function panel(options: { storage?: Map<string, unknown>; refs?: Record<string, unknown>[] } = {}) {
  forgetProgress()
  forgetCounts()
  const storage = options.storage ?? new Map<string, unknown>()
  const uuid = `op-${++operations}`
  const log: Record<string, unknown>[] = []
  const reads = { getQsos: 0 }
  const ext = await loadExtension(() => import("./index.ts"), {
    hostCalls: {
      kvGet: (params) => storage.get(String(params.key)) ?? null,
      kvSet: (params) => void storage.set(String(params.key), params.value),
    },
  })
  const ctx = {
    online: true,
    getQsos: async () => {
      reads.getQsos += 1
      return log as never
    },
  }
  const args = (at: number, extra: Record<string, unknown> = {}) => ({
    panelKey: "friend",
    instanceId: uuid,
    operation: { uuid, refs: options.refs ?? [{ type: "potaActivation", ref: "K-1234", name: "Some Park" }] },
    qsoCount: log.length,
    reason: "",
    config: {},
    clock: { nowMillis: at, realNowMillis: at },
    ...extra,
  })
  return {
    uuid,
    storage,
    reads,
    log,
    /// Logs `n` contacts, the way an operator does: the log grows.
    contacts: (n: number) => {
      for (let i = 0; i < n; i++) log.push({ band: "20m", mode: "SSB", startAtMillis: T0 + log.length, their: { call: `K${log.length}ABC` } })
    },
    render: async (at: number, extra: Record<string, unknown> = {}) =>
      ((await ext.runHook("panel", "render", args(at, extra), { ctx })) as { kind: string; scene: Scene }).scene,
    event: async (at: number, action: string) =>
      (await ext.runHook("panel", "onEvent", { ...args(at), event: { controlId: action, action, phase: "activate", sequence: 1 } }, { ctx })) as { values: Record<string, number> },
    descriptor: async () => ((await ext.runHook("panel", "getPanels", {}, { ctx })) as { key: string; icon: string; on: string[] }[])[0],
  }
}

const sec = (n: number) => T0 + n * 1000

test("the panel is drawn every second and the moment a contact is logged, and asks for nothing", async () => {
  const p = await panel()
  const d = await p.descriptor()
  assert.equal(d.key, "friend")
  assert.deepEqual([...d.on].sort(), ["operation", "qsoLogged", "tick:1"])
  const manifest = (await import("../manifest.json", { with: { type: "json" } })).default as Record<string, unknown>
  assert.equal(manifest.requiresLocation, undefined)
  assert.equal(manifest.requiresRadioWrite, undefined)
  assert.equal(manifest.domains, undefined, "no network")
  assert.equal(manifest.category, "dashboard")
})

test("it is a scene: the park, the creature, the food, the effects and the meter, and a button to pat it", async () => {
  const p = await panel()
  const scene = await p.render(T0)
  assert.deepEqual(scene.layers.map((l) => l.id), ["park", "fireworks", "creature", "food", "effects", "meter"])
  assert.ok(scene.layers.every((l) => l.svg.startsWith("<svg ") && l.svg.endsWith("</svg>")))
  assert.deepEqual(Object.keys(scene.values).sort(), ["cx", "cy", "fo", "fy", "pat"])
  assert.deepEqual(scene.controls.map((c) => c.id), ["header", "status", "pet"])
  assert.equal(scene.controls[2].event, "pet")
  assert.ok(scene.controls.length <= 64)
  // The creature and the food are what move, and the host glides them between drawings.
  const creature = scene.layers.find((l) => l.id === "creature")!
  assert.ok(creature.translateX && creature.transitionMs && creature.transitionMs < 1000)
  assert.ok(!scene.layers.find((l) => l.id === "park")!.transitionMs)
})

test("the header names the creature and the park, and a two-fer names both", async () => {
  const p = await panel({
    refs: [
      { type: "potaActivation", ref: "K-1234", name: "Some Park" },
      { type: "potaActivation", ref: "K-5678" },
      { type: "pota", ref: "K-9999", name: "A Park Someone Else Is At" },
      { type: "sota", ref: "W4C/CM-001" },
    ],
  })
  const { strings } = await p.render(T0)
  assert.equal(strings.header, `${nameFor(p.uuid)} · K-1234 Some Park + K-5678`)
  const none = await panel({ refs: [] })
  assert.match((await none.render(T0)).strings.header, /no park set$/)
})

test("an operation with no uuid is still drawn", async () => {
  const p = await panel()
  const scene = await p.render(T0, { operation: { refs: [] }, qsoCount: 3 })
  assert.equal(scene.layers.length, 6)
})

// --- counting ----------------------------------------------------------------------------------------------------

test("the contacts are the log's, without the markers of events", async () => {
  assert.equal(contactsIn([{ band: "20m" }, { band: "event" }, { band: "40m" }, { band: "event" }]), 2)
  const p = await panel()
  p.contacts(4)
  p.log.push({ band: "event", note: "sunset" })
  // The host says five; four of them are contacts.
  const { strings } = await p.render(T0)
  assert.match(strings.status, /6 more contacts to activate/)
})

test("the log is read when the count changes, and not every second", async () => {
  const p = await panel()
  p.contacts(2)
  await p.render(sec(0))
  await p.render(sec(1))
  await p.render(sec(2))
  assert.equal(p.reads.getQsos, 1)
  p.contacts(1)
  await p.render(sec(3))
  await p.render(sec(4))
  assert.equal(p.reads.getQsos, 2)
  // A host with no way to read the log falls back on the count it gives.
  const stub = { online: true } as never
  assert.equal(await countContacts(stub, "u", 7), 7)
})

// --- reacting ----------------------------------------------------------------------------------------------------

test("a contact is fed to it: the food falls, is eaten, and it is pleased, and then it is idle", async () => {
  const p = await panel()
  p.contacts(3)
  await p.render(sec(0)) // meets the operation as it is
  p.contacts(1)

  const first = await p.render(sec(10))
  assert.deepEqual([first.values.fy, first.values.fo], [-70, 1], "the food above it")
  const second = await p.render(sec(11))
  assert.deepEqual([second.values.fy, second.values.fo], [0, 1], "at its mouth")
  assert.equal((await p.render(sec(12))).values.fo, 0, "eaten")
  const hearts = await p.render(sec(13))
  assert.ok(hearts.layers.find((l) => l.id === "effects")!.svg.includes("#ff5d7a"), "pleased, with hearts")
  const idle = await p.render(sec(10 + STEPS.treat))
  assert.equal(idle.values.fo, 0)
  assert.ok(!idle.layers.find((l) => l.id === "effects")!.svg.includes("#ff5d7a"))
})

test("it is a different food each time", async () => {
  const foods = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((after) => String(reactionTo(after - 1, after, 0).food)))
  assert.deepEqual([...foods].sort(), [...FOODS].sort())
})

test("the tenth contact, an activation, evolves it", async () => {
  const p = await panel()
  p.contacts(9)
  const before = await p.render(sec(0))
  assert.match(before.strings.status, /1 more contact to activate/)
  const small = before.layers.find((l) => l.id === "creature")!.svg

  p.contacts(1)
  const flash = await p.render(sec(20))
  const flashed = flash.layers.find((l) => l.id === "creature")!.svg
  assert.ok(!/fill="#(?!ffffff)/.test(flashed.replace("fill-opacity", "")), "a white flash")
  assert.ok((flashed.match(/<rect/g) ?? []).length > 0)
  assert.match(flash.strings.status, /^Activated! 10 contacts\./)
  // A few seconds on it has changed into something else, in its own colors, and bigger.
  const grown = (await p.render(sec(20 + 5))).layers.find((l) => l.id === "creature")!.svg
  assert.notEqual(grown, small)
  assert.ok(grown.includes("#f2994a"), "the critter's fur")
  assert.ok(!small.includes("#f2994a"))
})

test("each ten after that is something different: fireworks, a flip, a dance, confetti", async () => {
  const p = await panel()
  p.contacts(19)
  await p.render(sec(0))
  const at = (i: number) => sec(100 + i * 60)
  const park = (s: Scene) => s.layers.find((l) => l.id === "park")!.svg
  const effects = (s: Scene) => s.layers.find((l) => l.id === "effects")!.svg
  const day = park(await p.render(sec(1)))

  p.contacts(1) // twenty
  const fireworks = await p.render(at(0))
  assert.notEqual(park(fireworks), day, "night falls for fireworks")

  p.contacts(10) // thirty
  assert.equal(park(await p.render(at(1))), day, "by day again")

  p.contacts(10) // forty
  await p.render(at(2))
  const dance = await p.render(at(2) + 1000)
  assert.notEqual(dance.values.cx, 0, "dancing to one side")

  p.contacts(10) // fifty
  await p.render(at(3))
  assert.ok(effects(await p.render(at(3) + 2000)).includes("#ff9f43"), "confetti")
})

test("a contact logged while it was out of sight is still noticed, once, when it is next drawn", async () => {
  const p = await panel()
  p.contacts(5)
  await p.render(sec(0))
  p.contacts(1)
  // Not drawn for a minute, and then drawn: the food comes down as the panel is revealed.
  const back = await p.render(sec(60))
  assert.equal(back.values.fy, -70)
})

test("a deleted contact makes it smaller and nothing is celebrated", async () => {
  const p = await panel()
  p.contacts(10)
  const big = await p.render(sec(0))
  assert.match(big.strings.status, /^Activated!/)
  p.log.pop()
  const small = await p.render(sec(30))
  assert.match(small.strings.status, /1 more contact to activate/)
  assert.equal(small.values.fo, 0)
  // Logging it again is the tenth contact again, so it evolves again (a white flash), rather than being fed.
  p.contacts(1)
  const again = await p.render(sec(31))
  assert.equal(again.values.fy, 0)
  assert.ok(!/fill="#(?!ffffff)/.test(again.layers.find((l) => l.id === "creature")!.svg), "flashing white")
})

// --- remembering -------------------------------------------------------------------------------------------------

test("an operation already under way is not cheered for when it is first seen, nor when the app is opened again", async () => {
  const first = await panel()
  first.contacts(25)
  const met = await first.render(sec(0))
  assert.equal(met.values.fo, 0, "no food for contacts it never saw")
  assert.ok(!met.layers.find((l) => l.id === "effects")!.svg.includes("#ff5d7a"))
  assert.deepEqual(first.storage.get("progress"), { [first.uuid]: 25 })

  // The app is closed and opened: memory is gone, the device's storage is not.
  const again = await panel({ storage: first.storage })
  again.contacts(25)
  // The same operation: its uuid is the test's own, so put the stored count under it.
  again.storage.set("progress", { [again.uuid]: 25 })
  forgetProgress()
  const reopened = await again.render(sec(500))
  assert.equal(reopened.values.fo, 0)
  assert.equal(reopened.values.fy, 0)
  // And what was logged while it was closed is a treat, once.
  again.contacts(1)
  assert.equal((await again.render(sec(501))).values.fy, -70)
})

test("only the last thirty operations are remembered", async () => {
  const p = await panel()
  for (let i = 0; i < 35; i++) await observe(`old-${i}`, i + 1, sec(i))
  const kept = Object.keys(p.storage.get("progress") as Record<string, number>)
  assert.equal(kept.length, 30)
  assert.ok(kept.includes("old-34") && !kept.includes("old-0"))
})

// --- the pat -----------------------------------------------------------------------------------------------------

test("a pat is answered with something, and the creature is pleased", async () => {
  const p = await panel()
  p.contacts(5)
  await p.render(sec(0))
  const answer = await p.event(sec(100), "pet")
  assert.deepEqual(answer, { values: { pat: 1 } }, "an answer that names nothing counts as a failure")
  assert.ok(Object.keys(answer.values).every((k) => k === "pat"))
  const scene = await p.render(sec(100))
  assert.ok(scene.layers.find((l) => l.id === "effects")!.svg.includes("#ff5d7a"), "hearts")
})

test("a pat does not interrupt a treat or a celebration", async () => {
  const p = await panel()
  p.contacts(5)
  await p.render(sec(0))
  p.contacts(1)
  await p.render(sec(50)) // the treat begins
  await p.event(sec(51), "pet")
  assert.equal((await p.render(sec(51))).values.fo, 1, "still eating")
  // Once that is over, it may be patted.
  await p.render(sec(60))
  await p.event(sec(60), "pet")
  assert.ok((await p.render(sec(60))).layers.find((l) => l.id === "effects")!.svg.includes("#ff5d7a"))
})

test("at night, in the app's dark theme, the park is dark", async () => {
  const p = await panel()
  const day = (await p.render(T0)).layers.find((l) => l.id === "park")!.svg
  const night = (await p.render(T0, { environment: { brightness: "dark" } })).layers.find((l) => l.id === "park")!.svg
  assert.notEqual(day, night)
  assert.equal((await p.render(T0, { environment: { brightness: "light" } })).layers.find((l) => l.id === "park")!.svg, day)
})
