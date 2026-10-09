// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// What the creature is doing, as a function of how many contacts it has had, what has just happened,
// and the clock. Nothing here remembers anything: the same count, reaction and time give the same
// frame, which is what makes it testable, and what lets the panel be drawn from scratch every second.
//
// The panel is drawn once a second, so a frame is a step: a pose and a position, and the host glides
// the creature between positions as the values change. A reaction is a short run of steps starting when
// it began.

import { GROUND_Y, SCENE_WIDTH } from "./props.ts"
import type { Food } from "./props.ts"
import type { Face, Species, Stage } from "./sprites.ts"
import { kindOf } from "./sprites.ts"

export type ReactionKind = "treat" | "evolve" | "fireworks" | "backflip" | "dance" | "confetti" | "pet"

export interface Reaction {
  kind: ReactionKind
  /// When it began, in milliseconds.
  at: number
  /// What was eaten, for a treat.
  food?: Food
}

/// How many steps (seconds) each reaction lasts.
export const STEPS: Record<ReactionKind, number> = { treat: 4, evolve: 7, fireworks: 7, backflip: 6, dance: 8, confetti: 8, pet: 3 }

/// What the creature does for each ten contacts after the first, in turn. The first ten is the evolution.
export const CELEBRATIONS: ReactionKind[] = ["fireworks", "backflip", "dance", "confetti"]

/// The reaction for reaching the `tens`th ten contacts.
export const celebrationFor = (tens: number): ReactionKind => (tens <= 1 ? "evolve" : CELEBRATIONS[(tens - 2) % CELEBRATIONS.length])

/// Ten contacts is a POTA activation, and is when the sprout becomes the critter.
export const ACTIVATION = 10

export const stageOf = (count: number): Stage => (count >= ACTIVATION ? 1 : 0)

/// How big a pixel of the creature is, in scene units: it grows with every contact, a little, and the critter
/// starts at about twice the sprout's size and grows more slowly.
export function scaleOf(stage: Stage, count: number): number {
  return stage === 0 ? 3.6 + 0.2 * Math.min(count, 9) : 6.4 + 0.01 * Math.min(Math.max(count - ACTIVATION, 0), 80)
}

export type Fx =
  | { kind: "heart"; x: number; y: number }
  | { kind: "sparkle"; x: number; y: number }
  | { kind: "note"; x: number; y: number }
  | { kind: "burst"; x: number; y: number; age: number; color: number }
  | { kind: "confetti"; step: number }

export interface Frame {
  /// Which friend it is.
  species: Species
  /// The stage drawn, which is the creature's own except while it flashes from one to the other.
  stage: Stage
  scale: number
  face: Face
  /// Paws up (the critter's).
  cheer: boolean
  /// Facing the other way.
  flip: boolean
  upsideDown: boolean
  /// Drawn as a flat color, for the flash of an evolution.
  flash: string | null
  /// Where the creature is from where it stands, in scene units: right and down are positive.
  dx: number
  dy: number
  /// A food falling to its mouth: how far above it, and how visible.
  food: { item: Food; y: number; opacity: number } | null
  fx: Fx[]
  /// The park goes to night, for fireworks.
  dark: boolean
}

/// The sprite's size on the scene, and its top left when it stands in the middle at rest.
export function box(stage: Stage, scale: number, species: Species = "sprout"): { width: number; height: number; x: number; y: number } {
  const width = kindOf(species, stage).width * scale
  const height = kindOf(species, stage).height * scale
  return { width, height, x: SCENE_WIDTH / 2 - width / 2, y: GROUND_Y - height }
}

/// Where its mouth is, at rest.
export function mouth(stage: Stage, scale: number, species: Species = "sprout"): { x: number; y: number } {
  const b = box(stage, scale, species)
  const at = kindOf(species, stage).mouth
  return { x: b.x + b.width * at.x, y: b.y + b.height * at.y }
}

function base(count: number, species: Species): Frame {
  const stage = stageOf(count)
  return { species, stage, scale: scaleOf(stage, count), face: "open", cheer: false, flip: false, upsideDown: false, flash: null, dx: 0, dy: 0, food: null, fx: [], dark: false }
}

/// What it does when nothing is happening, which is more as it has had more contacts: it blinks and looks around
/// from the start, hops from the third contact, walks about from the sixth (the critter always does), and the critter
/// waves now and then. From twenty it is sometimes caught gazing at the sky.
export function idle(count: number, now: number, species: Species = "sprout"): Frame {
  const f = base(count, species)
  const t = Math.floor(now / 1000)
  if (t % 7 === 6) f.face = "blink"
  else if (count >= 1 && (t % 11 === 3 || t % 11 === 4)) f.face = "left"
  else if (count >= 1 && t % 11 === 8) f.face = "right"
  else if (count >= 20 && t % 17 === 12) f.face = "oh"

  f.dy = t % 2 === 0 ? 0 : -2
  if (count >= 3 && t % 9 === 0) f.dy = -16

  if (f.stage === 1 || count >= 6) {
    const range = f.stage === 1 ? 44 : 18
    f.dx = Math.round(range * Math.sin(t / 5))
    // The critter's tail is on its right, so it faces right with that side to the left: turned over, going right.
    f.flip = kindOf(species, f.stage).turns && Math.cos(t / 5) > 0
  }
  if (f.stage === 1 && t % 13 === 0) {
    f.cheer = true
    f.face = "happy"
  }
  return f
}

/// The hearts of a happy moment, `n` of them, rising from over the creature's head.
function hearts(f: Frame, n: number, step: number): Fx[] {
  const b = box(f.stage, f.scale, f.species)
  return Array.from({ length: n }, (_, i) => ({ kind: "heart" as const, x: SCENE_WIDTH / 2 + (i - (n - 1) / 2) * 26, y: b.y - 10 - step * 7 - (i % 2) * 12 }))
}

/// A few sparkles about the creature, which move with the step.
function sparkles(f: Frame, step: number): Fx[] {
  const b = box(f.stage, f.scale, f.species)
  const cx = SCENE_WIDTH / 2
  const spots = [
    [cx - b.width * 0.62, b.y + b.height * 0.25],
    [cx + b.width * 0.62, b.y + b.height * 0.3],
    [cx - b.width * 0.3, b.y - 14],
    [cx + b.width * 0.34, b.y - 8],
    [cx, b.y + b.height * 0.55],
  ]
  return spots.filter((_, i) => (i + step) % 2 === 0).map(([x, y]) => ({ kind: "sparkle" as const, x, y }))
}

/// The creature during a reaction, `step` seconds after it began, or null when it is over.
export function reacting(count: number, reaction: Reaction, now: number, species: Species = "sprout"): Frame | null {
  const step = Math.floor((now - reaction.at) / 1000)
  if (step < 0 || step >= STEPS[reaction.kind]) return null
  const f = base(count, species)

  switch (reaction.kind) {
    case "treat": {
      // A food comes down from above, it is eaten, and the creature is pleased.
      const item = reaction.food ?? "apple"
      if (step === 0) {
        f.face = "up"
        f.food = { item, y: -70, opacity: 1 }
      } else if (step === 1) {
        f.face = "eat"
        f.food = { item, y: 0, opacity: 1 }
      } else if (step === 2) {
        f.face = "chomp"
        f.food = { item, y: 0, opacity: 0 }
        f.dy = -4
      } else {
        f.face = "happy"
        f.cheer = true
        f.fx = hearts(f, 2, step - 3)
      }
      return f
    }

    case "pet": {
      f.face = "happy"
      f.cheer = step % 2 === 1
      f.dy = step % 2 === 1 ? -4 : 0
      f.fx = hearts(f, step + 1, step)
      return f
    }

    case "evolve": {
      // Flashing between what it was and what it will be, and then the new one jumps for joy.
      const flashing = step < 4
      if (flashing) {
        const shown: Stage = step % 2 === 0 ? 0 : 1
        f.stage = shown
        f.scale = shown === 0 ? scaleOf(0, ACTIVATION - 1) : scaleOf(1, ACTIVATION)
        f.flash = "#ffffff"
        f.dy = step % 2 === 0 ? -6 : 0
        f.fx = sparkles(f, step).slice(0, step + 1)
        return f
      }
      f.face = step === 4 ? "oh" : "happy"
      f.cheer = true
      f.dy = step === 4 ? -26 : step === 5 ? 0 : -8
      f.fx = [...sparkles(f, step), ...(step >= 5 ? hearts(f, 3, step - 5) : [])]
      return f
    }

    case "fireworks": {
      // Bursts go off one after another in the sky, and the creature watches, gasps, and cheers.
      const starts = [0, 1, 2, 4]
      const places = [[70, 78], [250, 66], [160, 46], [112, 104]]
      f.dark = true
      f.fx = places.map(([x, y], i) => ({ kind: "burst" as const, x, y, age: step - starts[i], color: i })).filter((b) => b.kind === "burst" && b.age >= 0 && b.age <= 4)
      if (step < 2) f.face = "up"
      else if (step === 2) {
        f.face = "oh"
        f.dy = -10
      } else {
        f.face = "happy"
        f.cheer = true
        f.dy = step % 2 === 0 ? -14 : 0
        f.fx = [...f.fx, ...sparkles(f, step)]
      }
      return f
    }

    case "backflip": {
      // Crouch, spring, turn over at the top, land, and take a bow in a shower of stars.
      if (step === 0) {
        f.face = "chomp"
        f.dy = 6
      } else if (step === 1) {
        f.face = "oh"
        f.dy = -28
      } else if (step === 2) {
        f.face = "oh"
        f.dy = -30
        f.upsideDown = true
      } else if (step === 3) {
        f.face = "oh"
        f.dy = -12
      } else {
        f.face = "happy"
        f.cheer = true
        f.fx = sparkles(f, step)
        if (step === 5) f.fx = [...f.fx, ...hearts(f, 2, 1)]
      }
      return f
    }

    case "dance": {
      // Side to side, turning to face each way, with music.
      const right = step % 2 === 1
      f.face = "happy"
      f.cheer = !right
      f.flip = right && kindOf(species, f.stage).turns
      f.dx = right ? 30 : -30
      f.dy = right ? -8 : 0
      const b = box(f.stage, f.scale, f.species)
      f.fx = [
        { kind: "note", x: SCENE_WIDTH / 2 + (right ? -b.width * 0.7 : b.width * 0.7), y: b.y + 10 - (step % 3) * 10 },
        { kind: "note", x: SCENE_WIDTH / 2 + (right ? b.width * 0.8 : -b.width * 0.8), y: b.y - 6 - ((step + 1) % 3) * 10 },
      ]
      return f
    }

    case "confetti": {
      f.face = "happy"
      f.cheer = true
      f.dy = step % 2 === 1 ? -16 : 0
      f.fx = [{ kind: "confetti", step }]
      return f
    }
  }
}

/// The frame to draw now.
export function frameAt(count: number, reaction: Reaction | undefined, now: number, species: Species = "sprout"): Frame {
  return (reaction && reacting(count, reaction, now, species)) || idle(count, now, species)
}

