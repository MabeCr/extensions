// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict"
import { test } from "node:test"

import { ACTIVATION, box, celebrationFor, frameAt, idle, mouth, reacting, scaleOf, STEPS, stageOf } from "./behavior.ts"
import type { Reaction, ReactionKind } from "./behavior.ts"
import { Canvas, fromRows, rects } from "./pixels.ts"
import { FOODS, drawFood, drawMeter, drawBurst, drawConfetti, drawBackground, SCENE_HEIGHT, SCENE_WIDTH, GROUND_Y } from "./props.ts"
import { drawSprite, FACES, PALETTES, SPRITE_SIZE, sprite } from "./sprites.ts"
import type { Stage } from "./sprites.ts"
import { nameFor, NAMES, words } from "./words.ts"

const at = (seconds: number) => seconds * 1000
const reaction = (kind: ReactionKind, extra: Partial<Reaction> = {}): Reaction => ({ kind, at: 0, ...extra })

// --- the pictures ---------------------------------------------------------------------------------------------

test("the pixel toolkit draws, outlines, turns over and writes out runs", () => {
  const c = new Canvas(5, 4).ellipse(2.5, 2, 1.6, 1.4, "A")
  assert.equal(c.get(2, 2), "A")
  assert.equal(c.get(0, 0), ".")
  assert.equal(c.get(-1, 0), ".", "off the canvas is clear")
  c.outline("O")
  assert.equal(c.get(0, 2), "O", "an edge around it")
  assert.equal(c.get(2, 2), "A", "and not over it")
  // Turned over twice it is itself again; a silhouette is one color in the same places.
  assert.deepEqual(c.mirrored().mirrored().cells, c.cells)
  const flat = c.silhouette("W")
  assert.ok(flat.cells.every((row, y) => row.every((k, x) => (k === ".") === (c.get(x, y) === "."))))
  assert.ok(flat.cells.flat().every((k) => k === "." || k === "W"))
  // A row of one color is one rect, not one for each pixel.
  const row = fromRows(["AAA.BB"])
  assert.equal(rects(row, { A: "#111111", B: "#222222" }, 2).match(/<rect/g)!.length, 2)
  assert.match(rects(row, { A: "#111111", B: "#222222" }, 2, 10, 20), /x="10" y="20" width="6" height="2" fill="#111111"/)
})

test("every pixel of every frame of the creature has a color, so nothing is drawn invisible", () => {
  for (const stage of [0, 1] as Stage[]) {
    for (const face of FACES) {
      for (const cheer of [false, true]) {
        const canvas = sprite(stage, face, cheer)
        assert.equal(canvas.width, SPRITE_SIZE[stage].width)
        assert.equal(canvas.height, SPRITE_SIZE[stage].height)
        const keys = new Set(canvas.cells.flat().filter((k) => k !== "."))
        for (const key of keys) assert.ok(PALETTES[stage][key], `stage ${stage} ${face}: '${key}' has no color`)
        assert.ok(keys.size >= 5, "more than a blob")
      }
    }
  }
})

test("each face is different from the others, and the critter's paws go up to cheer", () => {
  for (const stage of [0, 1] as Stage[]) {
    const drawings = FACES.map((f) => drawSprite(stage, f, 4, 0, 0))
    assert.equal(new Set(drawings).size, FACES.length, `stage ${stage}`)
  }
  assert.notEqual(drawSprite(1, "happy", 4, 0, 0, { cheer: true }), drawSprite(1, "happy", 4, 0, 0))
  assert.notEqual(drawSprite(1, "open", 4, 0, 0, { flip: true }), drawSprite(1, "open", 4, 0, 0))
  assert.match(drawSprite(0, "open", 4, 10, 10, { upsideDown: true }), /^<g transform="rotate\(180 /)
  assert.ok(!drawSprite(0, "open", 4, 0, 0, { color: "#ffffff" }).match(/fill="(?!#ffffff)/), "a flash is one color")
})

test("the foods, the meter, the effects and the park are drawn", () => {
  assert.equal(FOODS.length, 4)
  for (const food of FOODS) assert.match(drawFood(food, 3, 100, 100), /<rect/)
  // The meter: as many apples as contacts into this ten, and a star for each ten.
  const apples = (count: number) => (drawMeter(count).match(/fill="#e04848"/g) ?? []).length > 0
  assert.equal(apples(0), false)
  assert.equal(apples(1), true)
  const stars = (count: number) => (drawMeter(count).match(/fill="#ffd84a"/g) ?? []).length
  assert.equal(stars(9), 0)
  assert.ok(stars(10) > 0 && stars(30) > stars(10) && stars(30) > stars(20))
  // A burst is nothing before it goes off and nothing long after; confetti falls.
  assert.equal(drawBurst(100, 100, -1, 0), "")
  assert.equal(drawBurst(100, 100, 5, 0), "")
  assert.match(drawBurst(100, 100, 2, 1), /<rect/)
  assert.notEqual(drawConfetti(1), drawConfetti(3))
  assert.equal(drawConfetti(2), drawConfetti(2), "the same pieces in the same places")
  assert.notEqual(drawBackground("day"), drawBackground("night"))
  assert.ok(GROUND_Y < SCENE_HEIGHT && SCENE_WIDTH > 0)
})

// --- how it grows ---------------------------------------------------------------------------------------------

test("it is a sprout until ten contacts, an activation, and a critter after", () => {
  assert.equal(ACTIVATION, 10)
  assert.deepEqual([0, 1, 9, 10, 11, 99].map(stageOf), [0, 0, 0, 1, 1, 1])
})

test("it grows with every contact, and the critter is bigger than the sprout was", () => {
  const sizes = Array.from({ length: 10 }, (_, c) => scaleOf(0, c))
  assert.ok(sizes.every((s, i) => i === 0 || s > sizes[i - 1]), "each contact makes it a little bigger")
  assert.ok(scaleOf(1, 10) > scaleOf(0, 9) * 1.1)
  assert.ok(scaleOf(1, 60) > scaleOf(1, 10))
  assert.equal(scaleOf(1, 500), scaleOf(1, 90), "and then it stops")
  // It fits the picture, with room above it for a jump.
  for (const [stage, count] of [[0, 9], [1, 200]] as const) assert.ok(box(stage, scaleOf(stage, count)).y > 60)
})

test("each ten has its own celebration: an evolution first, and then fireworks, a flip, a dance, confetti, round again", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map(celebrationFor), ["evolve", "fireworks", "backflip", "dance", "confetti", "fireworks", "backflip", "dance", "confetti"])
})

// --- what it does -----------------------------------------------------------------------------------------------

test("with nothing happening it blinks, looks about, and is the same at the same moment every time", () => {
  assert.deepEqual(idle(5, 123_000), idle(5, 123_000))
  const faces = new Set(Array.from({ length: 60 }, (_, t) => idle(5, at(t)).face))
  for (const face of ["open", "blink", "left", "right"] as const) assert.ok(faces.has(face), face)
  // A hatchling with no contacts has not learned to look around.
  assert.deepEqual([...new Set(Array.from({ length: 60 }, (_, t) => idle(0, at(t)).face))].sort(), ["blink", "open"])
})

test("it does more as it has had more contacts", () => {
  const over = (count: number, f: (t: number) => number) => new Set(Array.from({ length: 120 }, (_, t) => f(t) + 0))
  void over
  const dys = (count: number) => Array.from({ length: 60 }, (_, t) => idle(count, at(t)).dy)
  const dxs = (count: number) => Array.from({ length: 60 }, (_, t) => idle(count, at(t)).dx)
  // hops from the third contact
  assert.ok(Math.min(...dys(2)) >= -2)
  assert.ok(Math.min(...dys(3)) <= -16)
  // walks about from the sixth
  assert.ok(dxs(5).every((x) => x === 0))
  assert.ok(Math.max(...dxs(6).map(Math.abs)) > 10 && Math.max(...dxs(6).map(Math.abs)) <= 18)
  // the critter walks further, and waves with its paws up
  assert.ok(Math.max(...dxs(12).map(Math.abs)) > 30 && Math.max(...dxs(12).map(Math.abs)) <= 44)
  assert.ok(Array.from({ length: 60 }, (_, t) => idle(12, at(t)).cheer).some(Boolean))
  assert.ok(Array.from({ length: 60 }, (_, t) => idle(5, at(t)).cheer).every((c) => !c), "the sprout has no paws to wave")
  // and from twenty it is sometimes caught gazing at the sky
  assert.ok(Array.from({ length: 60 }, (_, t) => idle(19, at(t)).face).every((f) => f !== "oh"))
  assert.ok(Array.from({ length: 60 }, (_, t) => idle(20, at(t)).face).includes("oh"))
  // turning to face the way it walks
  assert.ok(Array.from({ length: 60 }, (_, t) => idle(12, at(t)).flip).some(Boolean) && Array.from({ length: 60 }, (_, t) => idle(12, at(t)).flip).some((f) => !f))
})

test("a treat: the food falls, it is eaten, and the creature is pleased", () => {
  const r = reaction("treat", { food: "cookie" })
  const f = (s: number) => reacting(4, r, at(s) + 200)!
  assert.deepEqual([f(0).face, f(1).face, f(2).face, f(3).face], ["up", "eat", "chomp", "happy"])
  assert.deepEqual(f(0).food, { item: "cookie", y: -70, opacity: 1 })
  assert.deepEqual(f(1).food, { item: "cookie", y: 0, opacity: 1 })
  assert.equal(f(2).food!.opacity, 0, "gone, eaten")
  assert.equal(f(3).food, null)
  assert.ok(f(3).fx.some((e) => e.kind === "heart"))
  assert.equal(reacting(4, r, at(STEPS.treat)), null, "and then it is over")
  assert.equal(reacting(4, r, -1), null, "and it has not begun before it does")
  assert.deepEqual(frameAt(4, r, at(STEPS.treat) + 5), idle(4, at(STEPS.treat) + 5), "over, it is idle again")
  // The food comes down to its mouth.
  const where = mouth(0, scaleOf(0, 4))
  assert.ok(where.y > box(0, scaleOf(0, 4)).y && where.y < GROUND_Y)
})

test("the evolution: it flashes between what it was and what it will be, and then the new one jumps for joy", () => {
  const f = (s: number) => reacting(10, reaction("evolve"), at(s) + 200)!
  assert.deepEqual([0, 1, 2, 3].map((s) => f(s).stage), [0, 1, 0, 1])
  assert.ok([0, 1, 2, 3].every((s) => f(s).flash === "#ffffff"))
  assert.equal(f(4).stage, 1)
  assert.equal(f(4).flash, null)
  assert.equal(f(4).face, "oh")
  assert.ok(f(4).dy < -20, "a jump")
  assert.ok(f(5).cheer && f(5).fx.some((e) => e.kind === "heart") && f(5).fx.some((e) => e.kind === "sparkle"))
  assert.ok(f(1).scale > f(0).scale, "what it will be is bigger")
  assert.equal(reacting(10, reaction("evolve"), at(STEPS.evolve)), null)
})

test("fireworks go off one after another at night, with the creature looking up, gasping, and cheering", () => {
  const f = (s: number) => reacting(20, reaction("fireworks"), at(s) + 200)!
  assert.ok([0, 3, 6].every((s) => f(s).dark), "night falls")
  assert.deepEqual([f(0).face, f(2).face, f(3).face], ["up", "oh", "happy"])
  const bursts = (s: number) => f(s).fx.filter((e) => e.kind === "burst")
  assert.deepEqual([0, 1, 2, 3].map((s) => bursts(s).length), [1, 2, 3, 3])
  // They are the same bursts, older each second.
  assert.equal((f(1).fx.find((e) => e.kind === "burst") as { age: number }).age, 1)
  assert.ok(f(4).cheer && f(4).fx.some((e) => e.kind === "sparkle"), "sparks land on the creature")
  assert.equal(frameAt(20, reaction("fireworks"), at(STEPS.fireworks) + 200).dark, false)
})

test("a backflip: crouch, spring, upside down at the top, land, and bow among stars", () => {
  const f = (s: number) => reacting(30, reaction("backflip"), at(s) + 200)!
  assert.ok(f(0).dy > 0, "crouched")
  assert.ok(f(1).dy < f(0).dy, "sprung")
  assert.equal(f(2).upsideDown, true)
  assert.ok(f(2).dy < f(1).dy, "the top")
  assert.equal(f(3).upsideDown, false)
  assert.ok(f(4).cheer && f(4).fx.some((e) => e.kind === "sparkle"))
  assert.ok(box(1, scaleOf(1, 30)).y + f(2).dy > 40, "and not out of the picture")
})

test("a dance goes side to side, turning to face each way, to music; confetti falls on a cheering creature", () => {
  const d = (s: number) => reacting(40, reaction("dance"), at(s) + 200)!
  assert.deepEqual([0, 1, 2, 3].map((s) => d(s).dx), [-30, 30, -30, 30])
  assert.deepEqual([0, 1, 2, 3].map((s) => d(s).flip), [false, true, false, true])
  assert.ok([0, 1, 2, 3, 4, 5, 6, 7].every((s) => d(s).fx.some((e) => e.kind === "note")))
  const c = (s: number) => reacting(50, reaction("confetti"), at(s) + 200)!
  assert.ok([0, 3, 7].every((s) => c(s).fx.some((e) => e.kind === "confetti") && c(s).cheer))
  assert.equal(reacting(50, reaction("confetti"), at(STEPS.confetti)), null)
})

test("a pat gives a few hearts, more each second", () => {
  const p = (s: number) => reacting(5, reaction("pet"), at(s) + 200)!
  assert.deepEqual([0, 1, 2].map((s) => p(s).fx.length), [1, 2, 3])
  assert.ok([0, 1, 2].every((s) => p(s).face === "happy"))
  assert.equal(reacting(5, reaction("pet"), at(3)), null)
})

// --- what it is called ---------------------------------------------------------------------------------------------

test("each operation has a name for its creature, the same every time", () => {
  assert.equal(nameFor("abc-123"), nameFor("abc-123"))
  assert.ok(NAMES.includes(nameFor("abc-123")))
  assert.ok(new Set(Array.from({ length: 40 }, (_, i) => nameFor(`operation-${i}`))).size > 6, "not all one name")
  assert.ok(NAMES.includes(nameFor("")))
})

test("what is written says how far it has to go, and then when it next celebrates", () => {
  const name = nameFor("u")
  assert.equal(words("u", 0, ["K-1234 Some Park"]).header, `${name} · K-1234 Some Park`)
  assert.equal(words("u", 0, ["K-1", "K-2"]).header, `${name} · K-1 + K-2`)
  assert.match(words("u", 0, []).header, /no park set$/)
  assert.match(words("u", 0, ["K-1"]).status, /is hungry\. 10 more contacts to activate\.$/)
  assert.match(words("u", 2, ["K-1"]).status, /is nibbling\. 8 more contacts/)
  assert.match(words("u", 5, ["K-1"]).status, /is growing\. 5 more contacts/)
  assert.match(words("u", 9, ["K-1"]).status, /is almost there\. 1 more contact to activate\./)
  assert.match(words("u", 9, []).status, /add a POTA activation to the operation/)
  assert.match(words("u", 10, ["K-1"]).status, /^Activated! 10 contacts\. .* celebrates in 10 more contacts, at 20\.$/)
  assert.match(words("u", 19, ["K-1"]).status, /celebrates in 1 more contact, at 20\./)
  assert.match(words("u", 20, ["K-1"]).status, /celebrates in 10 more contacts, at 30\./)
})
