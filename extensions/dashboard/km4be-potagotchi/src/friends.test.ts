// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { test } from "node:test"

import { box, frameAt, mouth, reacting, scaleOf, STEPS } from "./behavior.ts"
import type { Frame, ReactionKind } from "./behavior.ts"
import { forgetCounts, forgetProgress } from "./progress.ts"
import { SCENE_WIDTH } from "./props.ts"
import { buildScene } from "./scene.ts"
import { loadExtension } from "./sdkGapTesting.ts"
import { SPECIES } from "./sprites.ts"
import type { Species } from "./sprites.ts"
import { nameFor, NAMES, speciesFor } from "./words.ts"

const KINDS: ReactionKind[] = ["treat", "evolve", "fireworks", "backflip", "dance", "confetti", "pet"]
const T0 = Date.parse("2026-10-07T18:00:00Z")

/// Every frame a friend can be in: at rest, for a minute, and through each reaction, at a few counts.
function everyFrame(species: Species): { frame: Frame; count: number }[] {
  const out: { frame: Frame; count: number }[] = []
  for (const count of [0, 5, 9, 10, 12, 25, 60, 100, 300]) {
    for (let t = 0; t < 60; t++) out.push({ frame: frameAt(count, undefined, t * 1000, species), count })
    for (const kind of KINDS) {
      for (let s = 0; s < STEPS[kind]; s++) {
        const f = reacting(count, { kind, at: 0, food: "apple" }, s * 1000 + 100, species)
        if (f) out.push({ frame: f, count })
      }
    }
  }
  return out
}

test("every friend stays in the picture, through everything it does, at every size", () => {
  for (const species of SPECIES) {
    for (const { frame, count } of everyFrame(species)) {
      const b = box(frame.stage, frame.scale, species)
      const where = `${species} at ${count}, ${frame.face}`
      assert.ok(b.x + frame.dx >= 0 && b.x + b.width + frame.dx <= SCENE_WIDTH, `${where}: off the sides (${b.x + frame.dx}..${b.x + b.width + frame.dx})`)
      // Room above for a jump, below the meter of apples (which sits at about 47) except at the top of a flip.
      assert.ok(b.y + frame.dy > 20, `${where}: out of the top (${b.y + frame.dy})`)
      assert.ok(b.y + b.height + frame.dy <= 215, `${where}: through the ground`)
    }
  }
})

test("a friend is no bigger at its biggest than the picture has room for, and a form is bigger than the one before", () => {
  for (const species of SPECIES) {
    const small = box(0, scaleOf(0, 9), species)
    const first = box(1, scaleOf(1, 10), species)
    const last = box(1, scaleOf(1, 500), species)
    assert.ok(first.width * first.height > small.width * small.height, `${species}: the second form is bigger`)
    assert.ok(last.y > 55, `${species}: ${last.y}`)
  }
})

test("food falls to each friend's mouth, which is on it, and a dinosaur in profile has it at its snout", () => {
  for (const species of SPECIES) {
    for (const stage of [0, 1] as const) {
      const scale = scaleOf(stage, stage === 0 ? 5 : 12)
      const b = box(stage, scale, species)
      const m = mouth(stage, scale, species)
      assert.ok(m.x > b.x && m.x < b.x + b.width && m.y > b.y && m.y < b.y + b.height, `${species} ${stage}`)
    }
  }
  const dino = mouth(1, scaleOf(1, 12), "dino")
  assert.ok(dino.x < SCENE_WIDTH / 2 - 20, "toward the left, where it is facing")
  assert.equal(Math.round(mouth(1, scaleOf(1, 12), "sprout").x), SCENE_WIDTH / 2)
})

test("a radio never turns around, in its walk or its dance; the others do", () => {
  const flips = (species: Species, kind?: ReactionKind) =>
    kind
      ? Array.from({ length: STEPS[kind] }, (_, s) => reacting(40, { kind, at: 0 }, s * 1000 + 100, species)!.flip)
      : Array.from({ length: 60 }, (_, t) => frameAt(15, undefined, t * 1000, species).flip)
  for (const species of ["sprout", "dino"] as Species[]) {
    assert.ok(flips(species).some(Boolean), `${species} walks both ways`)
    assert.ok(flips(species, "dance").some(Boolean))
  }
  assert.ok(flips("radio").every((f) => !f))
  assert.ok(flips("radio", "dance").every((f) => !f))
  // It still dances from side to side.
  assert.deepEqual([0, 1, 2, 3].map((s) => reacting(40, { kind: "dance", at: 0 }, s * 1000 + 100, "radio")!.dx), [-30, 30, -30, 30])
})

test("the scene is drawn in each friend's own colors, and the food and the sprite are of the same friend", () => {
  const colors: Record<Species, string> = { sprout: "#7bd88f", dino: "#5ec8a2", radio: "#3b4f7a" }
  for (const species of SPECIES) {
    const small = buildScene(frameAt(3, undefined, 1000, species), 3, "day", { header: "", status: "" })
    assert.ok(small.layers.find((l) => l.id === "creature")!.svg!.includes(colors[species]), species)
    const treat = buildScene(reacting(3, { kind: "treat", at: 0, food: "apple" }, 100, species)!, 3, "day", { header: "", status: "" })
    assert.ok(treat.layers.find((l) => l.id === "food")!.svg!.includes("#e04848"), `${species}: the food`)
  }
  // And the second forms are different from the first.
  assert.ok(buildScene(frameAt(12, undefined, 1000, "dino"), 12, "day", { header: "", status: "" }).layers.find((l) => l.id === "creature")!.svg!.includes("#6bc16a"))
  assert.ok(buildScene(frameAt(12, undefined, 1000, "radio"), 12, "day", { header: "", status: "" }).layers.find((l) => l.id === "creature")!.svg!.includes("#6580b2"))
})

// --- the setting ----------------------------------------------------------------------------------------

let operations = 0

async function panel() {
  forgetProgress()
  forgetCounts()
  const uuid = `friend-op-${++operations}`
  const ext = await loadExtension(() => import("./index.ts"), { hostCalls: { kvGet: () => null, kvSet: () => undefined } })
  const ctx = { online: true, getQsos: async () => [] as never }
  const args = (config: Record<string, unknown>) => ({
    panelKey: "friend",
    instanceId: uuid,
    operation: { uuid, refs: [] },
    qsoCount: 0,
    reason: "",
    config,
    clock: { nowMillis: T0, realNowMillis: T0 },
  })
  return {
    uuid,
    descriptor: async () => ((await ext.runHook("panel", "getPanels", {}, { ctx })) as { form: { key: string; fieldType: string; options: { label: string; value: string }[] }[] }[])[0],
    render: async (config: Record<string, unknown>) => ((await ext.runHook("panel", "render", args(config), { ctx })) as { scene: { strings: Record<string, string>; layers: { id: string; svg: string }[] } }).scene,
  }
}

test("the Friend setting offers each friend, and Surprise me", async () => {
  const p = await panel()
  const [field] = (await p.descriptor()).form
  assert.equal(field.key, "friend")
  assert.equal(field.fieldType, "select")
  assert.deepEqual(field.options.map((o) => o.value), ["random", "sprout", "dino", "radio"])
  assert.equal(field.options[0].label, "Surprise me")
})

test("a chosen friend is the one drawn, and has its own kind of name", async () => {
  const p = await panel()
  for (const species of SPECIES) {
    const scene = await p.render({ friend: species })
    const name = scene.strings.header.split(" · ")[0]
    assert.ok(NAMES[species].includes(name), `${species}: ${name}`)
    assert.equal(name, nameFor(p.uuid, species))
  }
  const radio = await p.render({ friend: "radio" })
  assert.ok(radio.layers.find((l) => l.id === "creature")!.svg!.includes("#3b4f7a"))
})

test("left to chance, an operation has the same friend every time, and it is one of the three", async () => {
  const p = await panel()
  const first = await p.render({})
  const again = await p.render({ friend: "random" })
  assert.equal(first.strings.header, again.strings.header)
  assert.equal(first.layers.find((l) => l.id === "creature")!.svg, again.layers.find((l) => l.id === "creature")!.svg)
  assert.ok(SPECIES.includes(speciesFor(p.uuid, undefined)))
  assert.ok(NAMES[speciesFor(p.uuid, undefined)].includes(first.strings.header.split(" · ")[0]))
})
