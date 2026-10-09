// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// The creature, in two sizes. Stage 0 is a sprout of a blob with a leaf on its head: a
// tiny thing that has just hatched in the park. Stage 1 is what it becomes at ten
// contacts, an activation's worth: a fox-like critter in a ranger-green scarf. Each has
// a handful of faces (open, blinking, happy, looking aside, mouth open to eat) and the
// critter has its paws up to cheer. They are drawn in code, from ellipses and dots, and
// a face is stamped onto a body, so every frame is the same creature.

import { dinosaur, DINO, hatchling, HATCHLING } from "./dino.ts"
import { FACES } from "./faces.ts"
import type { Face } from "./faces.ts"
import { Canvas, rects } from "./pixels.ts"
import type { Palette } from "./pixels.ts"
import { handheld, HANDHELD, rig, RIG } from "./radio.ts"

export type Stage = 0 | 1
export type { Face }

export { FACES }

/// What the sprite is drawn in. `E` is the eye, `C` a cheek, `M` the mouth, `T` its tongue.
const SPROUT: Palette = {
  O: "#2c6e49", // outline
  G: "#7bd88f", // body
  g: "#58b974", // shade
  B: "#d8f5c8", // belly
  H: "#c4f2c8", // shine
  E: "#1d2b25",
  W: "#ffffff",
  C: "#ff9fb0",
  M: "#2a1d1d",
  T: "#ff7d8e",
  S: "#3f8f53", // stem
  L: "#4cc26a", // leaf
  l: "#2f9a4f",
}

const CRITTER: Palette = {
  O: "#6b3a14",
  F: "#f2994a", // fur
  f: "#d9792a", // shade
  W: "#fff1d6", // cream
  I: "#ffb3a0", // inner ear
  E: "#2a1d14",
  e: "#ffffff",
  N: "#3a2418", // nose
  C: "#ff8a8a",
  M: "#3a2418",
  T: "#ff6f7f",
  R: "#2e8b57", // scarf
  r: "#1f6b42",
  P: "#f2994a",
  D: "#d9792a",
}


/// The body of the sprout with no face: 14 wide, 15 tall.
function sproutBody(): Canvas {
  const c = new Canvas(14, 15)
  c.ellipse(7, 9.5, 5.6, 4.6, "G")
  c.ellipse(7, 11.6, 3.2, 2.2, "B")
  c.rect(3, 12, 8, 2, "g").ellipse(7, 11.6, 3.2, 2.2, "B")
  c.dots("H", [4, 7], [5, 6], [4, 8])
  // the sprout: a stem and two leaves
  c.dots("S", [7, 4], [7, 3], [7, 2])
  c.dots("L", [8, 2], [9, 2], [10, 1], [9, 1], [8, 1]).dots("l", [10, 2], [8, 3])
  c.dots("L", [6, 2], [5, 2], [4, 1], [5, 1], [6, 1]).dots("l", [4, 2], [6, 3])
  // feet
  c.dots("g", [4, 14], [5, 14], [9, 14], [10, 14])
  return c.outline("O")
}

/// A face stamped on the sprout. The eyes sit at y 8 and 9, the mouth at y 11.
function sprout(face: Face): Canvas {
  const c = sproutBody()
  const eyes = (lx: number, rx: number) => c.dots("E", [lx, 8], [lx, 9], [rx, 8], [rx, 9])
  c.dots("C", [3, 10], [4, 10], [10, 10], [11, 10])
  switch (face) {
    case "open":
      eyes(5, 9).dots("W", [5, 8], [9, 8]).dots("M", [6, 11], [8, 11], [7, 12])
      break
    case "blink":
      c.dots("E", [4, 9], [5, 9], [9, 9], [10, 9]).dots("M", [6, 11], [8, 11], [7, 12])
      break
    case "happy":
      c.dots("E", [4, 9], [5, 8], [6, 9], [8, 9], [9, 8], [10, 9]).dots("M", [6, 11], [7, 12], [8, 11]).dots("T", [7, 11])
      break
    case "left":
      eyes(4, 8).dots("W", [4, 8], [8, 8]).dots("M", [6, 11], [7, 11])
      break
    case "right":
      eyes(6, 10).dots("W", [6, 8], [10, 8]).dots("M", [7, 11], [8, 11])
      break
    case "up":
      c.dots("E", [5, 7], [5, 8], [9, 7], [9, 8]).dots("W", [5, 7], [9, 7]).dots("M", [7, 11])
      break
    case "eat":
      eyes(5, 9).dots("W", [5, 8], [9, 8]).rect(6, 11, 3, 2, "M").dots("T", [7, 12])
      break
    case "chomp":
      c.dots("E", [4, 9], [5, 9], [9, 9], [10, 9]).dots("M", [6, 11], [7, 11], [8, 11], [7, 12])
      break
    case "oh":
      eyes(5, 9).dots("W", [5, 8], [9, 8]).rect(7, 11, 1, 2, "M")
      break
  }
  return c
}

/// The body of the critter with no face: 20 wide, 19 tall.
function critterBody(cheer: boolean): Canvas {
  const c = new Canvas(20, 19)
  // tail first, so the body is over it
  c.ellipse(17, 13, 2.6, 3.6, "F").dots("W", [17, 10], [18, 10], [18, 11], [17, 11])
  c.dots("f", [16, 15], [17, 16])
  // body and head
  c.ellipse(10, 13, 6.6, 5.3, "F")
  c.ellipse(10, 8, 7, 5.4, "F")
  // ears
  for (const [x0, dir] of [[3, 1], [16, -1]] as const) {
    for (let row = 0; row < 4; row++) for (let i = 0; i < 4 - row; i++) c.set(x0 + (dir > 0 ? i : -i) + row * 0, row + 1, "F")
  }
  c.dots("I", [4, 3], [4, 2], [5, 3], [15, 3], [15, 2], [14, 3])
  // cream: face, belly
  c.ellipse(10, 10, 4.8, 3.0, "W")
  c.ellipse(10, 14.4, 3.8, 3, "W")
  // scarf
  c.rect(5, 12, 10, 2, "R").dots("r", [5, 13], [6, 13], [14, 13], [13, 13])
  c.rect(8, 14, 2, 3, "R").dots("r", [8, 16], [9, 16])
  // paws and feet
  if (cheer) c.rect(2, 7, 2, 3, "P").rect(16, 7, 2, 3, "P").dots("D", [2, 7], [17, 7])
  else c.rect(3, 13, 2, 3, "P").rect(15, 13, 2, 3, "P").dots("D", [3, 15], [16, 15])
  c.rect(5, 17, 3, 1, "D").rect(12, 17, 3, 1, "D")
  return c.outline("O")
}

/// A face stamped on the critter. The eyes sit at y 7 and 8, the nose at y 9, the mouth at y 10.
function critter(face: Face, cheer = false): Canvas {
  const c = critterBody(cheer)
  c.dots("C", [4, 9], [5, 9], [14, 9], [15, 9])
  const eyes = (lx: number, rx: number) => c.dots("E", [lx, 7], [lx, 8], [rx, 7], [rx, 8])
  c.dots("N", [9, 9], [10, 9])
  switch (face) {
    case "open":
      eyes(6, 13).dots("e", [6, 7], [13, 7]).dots("M", [9, 10], [10, 10])
      break
    case "blink":
      c.dots("E", [5, 8], [6, 8], [13, 8], [14, 8]).dots("M", [9, 10], [10, 10])
      break
    case "happy":
      c.dots("E", [5, 8], [6, 7], [7, 8], [12, 8], [13, 7], [14, 8]).dots("M", [8, 10], [9, 11], [10, 11], [11, 10]).dots("T", [9, 10], [10, 10])
      break
    case "left":
      eyes(5, 12).dots("e", [5, 7], [12, 7]).dots("M", [9, 10])
      break
    case "right":
      eyes(7, 14).dots("e", [7, 7], [14, 7]).dots("M", [10, 10])
      break
    case "up":
      c.dots("E", [6, 6], [6, 7], [13, 6], [13, 7]).dots("e", [6, 6], [13, 6]).dots("M", [9, 10], [10, 10])
      break
    case "eat":
      eyes(6, 13).dots("e", [6, 7], [13, 7]).rect(8, 10, 4, 2, "M").dots("T", [9, 11], [10, 11])
      break
    case "chomp":
      c.dots("E", [5, 8], [6, 8], [13, 8], [14, 8]).dots("M", [8, 10], [9, 11], [10, 11], [11, 10])
      break
    case "oh":
      eyes(6, 13).dots("e", [6, 7], [13, 7]).rect(9, 10, 2, 2, "M")
      break
  }
  return c
}

/// The three friends it can be, each a small form and, from ten contacts, a larger.
export type Species = "sprout" | "dino" | "radio"
export const SPECIES: Species[] = ["sprout", "dino", "radio"]

/// What each is called in the settings.
export const SPECIES_LABEL: Record<Species, string> = { sprout: "Sprout, then fox", dino: "Dinosaur", radio: "Radio" }

interface Kind {
  palette: Palette
  width: number
  height: number
  /// Where its mouth is, as fractions of its width and height, for food to fall to.
  mouth: { x: number; y: number }
  /// Whether turning it over (to face the other way) makes sense: the radio's dial would end up on the wrong side.
  turns: boolean
  draw: (face: Face, cheer: boolean) => Canvas
}

const KINDS: Record<Species, Record<Stage, Kind>> = {
  sprout: {
    0: { palette: SPROUT, width: 14, height: 15, mouth: { x: 0.5, y: 11.5 / 15 }, turns: true, draw: (f) => sprout(f) },
    1: { palette: CRITTER, width: 20, height: 19, mouth: { x: 0.5, y: 10.5 / 19 }, turns: true, draw: (f, cheer) => critter(f, cheer) },
  },
  dino: {
    0: { palette: HATCHLING, width: 15, height: 16, mouth: { x: 0.5, y: 11 / 16 }, turns: true, draw: (f, cheer) => hatchling(f, cheer) },
    1: { palette: DINO, width: 24, height: 20, mouth: { x: 3.5 / 24, y: 9 / 20 }, turns: true, draw: (f, cheer) => dinosaur(f, cheer) },
  },
  radio: {
    0: { palette: HANDHELD, width: 13, height: 18, mouth: { x: 0.5, y: 11 / 18 }, turns: false, draw: (f, cheer) => handheld(f, cheer) },
    1: { palette: RIG, width: 23, height: 20, mouth: { x: 8.5 / 23, y: 13 / 20 }, turns: false, draw: (f, cheer) => rig(f, cheer) },
  },
}

export const kindOf = (species: Species, stage: Stage): Kind => KINDS[species][stage]

/// A frame of the creature: which friend, which stage, which face, and whether the paws are up.
export function sprite(species: Species, stage: Stage, face: Face, cheer = false): Canvas {
  return KINDS[species][stage].draw(face, cheer)
}

/// The sprite as SVG rects at `scale` with its top left at (`x`, `y`). `flip` turns it to face the other way,
/// `color` flashes it in one color, as at an evolution.
export function drawSprite(
  species: Species,
  stage: Stage,
  face: Face,
  scale: number,
  x: number,
  y: number,
  options: { cheer?: boolean; flip?: boolean; color?: string; upsideDown?: boolean } = {},
): string {
  const kind = KINDS[species][stage]
  let canvas = sprite(species, stage, face, options.cheer)
  if (options.flip && kind.turns) canvas = canvas.mirrored()
  const palette = options.color ? Object.fromEntries(Object.keys(kind.palette).map((k) => [k, options.color!])) : kind.palette
  const body = rects(canvas, palette, scale, x, y)
  if (!options.upsideDown) return body
  // Turned over about its own middle.
  return `<g transform="rotate(180 ${+(x + (canvas.width * scale) / 2).toFixed(2)} ${+(y + (canvas.height * scale) / 2).toFixed(2)})">${body}</g>`
}
