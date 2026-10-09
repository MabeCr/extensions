// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// The radio mascot. It starts as a pocket handheld with a rubber-duck antenna and a little green screen for a
// face; at ten contacts it is a base-station rig with a bigger screen, a tuning dial, and a telescoping antenna.
// Its face is on its screen, and the screen is where it looks, blinks and smiles.

import { stampFace } from "./faces.ts"
import type { Face, FaceSpec } from "./faces.ts"
import { Canvas } from "./pixels.ts"
import type { Palette } from "./pixels.ts"

export const HANDHELD: Palette = {
  O: "#1b2740", // outline
  N: "#3b4f7a", // body
  n: "#5a73a3", // bezel
  L: "#bff2b0", // screen
  E: "#1d3a20", // what is on the screen
  W: "#f2ffe8", // shine on it
  M: "#1d3a20",
  T: "#e46b6b",
  K: "#d4d9e4", // knobs
  a: "#9aa4b8", // antenna
  Y: "#ff5d7a", // the light on its tip
  g: "#2c3b5e", // grille
  R: "#ff6b6b",
  Z: "#ffd84a",
  V: "#6ee7a8",
  h: "#5a73a3", // arms
}

export const RIG: Palette = { ...HANDHELD, N: "#44587f", n: "#6580b2", k: "#2c3b5e" }

const HANDHELD_FACE: FaceSpec = { lx: 4, rx: 8, ey: 8, eyeWidth: 1, mx: 6, my: 10, half: 1, eye: "E", shine: "W", mouth: "M", tongue: "T" }
const RIG_FACE: FaceSpec = { lx: 5, rx: 10, ey: 9, eyeWidth: 2, mx: 8, my: 12, half: 2, eye: "E", shine: "W", mouth: "M", tongue: "T" }

/// The handheld: 13 wide, 18 tall.
export function handheld(face: Face, cheer: boolean): Canvas {
  const c = new Canvas(13, 18)
  // antenna and the light on its tip
  c.rect(6, 1, 1, 3, "a").set(6, 0, "Y")
  c.rect(3, 3, 2, 2, "K").rect(8, 3, 2, 2, "K")
  // body, with its corners cut, a bezel and the screen
  c.rect(1, 5, 11, 12, "N").dots(".", [1, 5], [11, 5], [1, 16], [11, 16])
  c.rect(2, 6, 9, 6, "n").rect(3, 7, 7, 5, "L")
  // the speaker, and three buttons
  for (let x = 2; x <= 10; x++) if (x % 2 === 0) c.set(x, 13, "g").set(x, 14, "g")
  c.dots("R", [4, 15]).dots("Z", [6, 15]).dots("V", [8, 15])
  // arms, down or up
  if (cheer) c.dots("h", [0, 7], [0, 8], [0, 6], [12, 7], [12, 8], [12, 6])
  else c.dots("h", [0, 10], [0, 11], [12, 10], [12, 11])
  stampFace(c, face, HANDHELD_FACE)
  return c.outline("O")
}

/// The rig: 23 wide, 20 tall.
export function rig(face: Face, cheer: boolean): Canvas {
  const c = new Canvas(23, 20)
  // a telescoping antenna, and its light
  c.rect(17, 1, 1, 5, "a").rect(16, 3, 3, 1, "a").set(17, 0, "Y")
  // knobs on top
  c.rect(4, 4, 2, 2, "K").rect(8, 4, 2, 2, "K")
  // body, a bezel, the screen (the face) and, to the right of it, the tuning dial
  c.rect(1, 6, 21, 12, "N").dots(".", [1, 6], [21, 6], [1, 17], [21, 17])
  c.rect(2, 7, 19, 9, "n").rect(3, 8, 11, 7, "L")
  c.ellipse(18, 11.4, 2.8, 2.8, "K").dots("k", [18, 9], [18, 10])
  c.dots("R", [16, 14]).dots("Z", [18, 14]).dots("V", [20, 14])
  // the speaker along the bottom
  for (let x = 4; x <= 19; x++) if (x % 2 === 0) c.set(x, 16, "g").set(x, 17, "g")
  // feet
  c.rect(3, 18, 4, 2, "g").rect(16, 18, 4, 2, "g")
  if (cheer) c.dots("h", [0, 8], [0, 9], [0, 7], [0, 6], [22, 8], [22, 9], [22, 7], [22, 6])
  else c.dots("h", [0, 11], [0, 12], [0, 13], [22, 11], [22, 12], [22, 13])
  stampFace(c, face, RIG_FACE)
  return c.outline("O")
}
