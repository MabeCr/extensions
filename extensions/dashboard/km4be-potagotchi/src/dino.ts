// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// The dinosaur. It hatches as a round little thing with a piece of its eggshell still on its head, looking
// straight at you; at ten contacts it is a plated dinosaur in profile, with a long tail, looking left.

import { stampFace } from "./faces.ts"
import type { Face, FaceSpec } from "./faces.ts"
import { Canvas } from "./pixels.ts"
import type { Palette } from "./pixels.ts"

export const HATCHLING: Palette = {
  O: "#1f5e4a", // outline
  G: "#5ec8a2", // body
  g: "#3ea883", // shade
  B: "#eafbe0", // belly
  S: "#fff6e0", // shell
  s: "#d8c690", // shell shade
  D: "#3c9a78", // feet
  E: "#1d2b25",
  W: "#ffffff",
  C: "#ff9fb0",
  M: "#2a1d1d",
  T: "#ff7d8e",
}

export const DINO: Palette = {
  O: "#2e5a2b",
  G: "#6bc16a",
  g: "#4fa04f",
  B: "#f4f0c8",
  P: "#f29f4a", // back plates
  D: "#3c7a3a",
  E: "#1d2b25",
  W: "#ffffff",
  C: "#ff9fb0",
  N: "#3a5a3a",
  M: "#2a1d1d",
  T: "#ff7d8e",
}

const HATCHLING_FACE: FaceSpec = { lx: 4, rx: 9, ey: 7, eyeWidth: 2, mx: 7, my: 10, half: 1, eye: "E", shine: "W", mouth: "M", tongue: "T" }

/// The hatchling: 15 wide, 16 tall.
export function hatchling(face: Face, cheer: boolean): Canvas {
  const c = new Canvas(15, 16)
  c.ellipse(7.5, 9.6, 6.3, 5.6, "G")
  c.ellipse(7.5, 12.2, 3.6, 2.6, "B")
  // arms, down or up, and a tail stub
  if (cheer) c.dots("G", [1, 8], [1, 9], [0, 8], [13, 8], [13, 9], [14, 8])
  else c.dots("G", [1, 12], [1, 13], [13, 12], [13, 13])
  c.dots("G", [13, 14], [14, 14], [14, 13])
  c.rect(3, 14, 3, 2, "D").rect(9, 14, 3, 2, "D")
  c.dots("g", [2, 7], [3, 6], [12, 7], [11, 6], [3, 11], [11, 11])
  // the piece of shell still worn as a cap, its lower edge in points
  c.ellipse(7.5, 3.3, 4.7, 2.5, "S")
  for (let x = 3; x <= 11; x++) c.set(x, 5, x % 2 === 0 ? "S" : "G")
  c.dots("s", [6, 2], [7, 3], [8, 2], [8, 3])
  c.dots("C", [2, 10], [3, 10], [11, 10], [12, 10])
  stampFace(c, face, HATCHLING_FACE)
  return c.outline("O")
}

/// A face in profile, facing left, on the dinosaur's head (its eye at x 5, y 4 and its mouth along y 8).
function profile(c: Canvas, face: Face): void {
  const eye = (x: number, y: number) => c.dots("E", [x, y], [x, y + 1])
  c.dots("N", [1, 6])
  c.dots("C", [7, 7], [8, 7])
  switch (face) {
    case "open":
      eye(5, 4)
      c.set(5, 4, "W").dots("M", [2, 8], [3, 9], [4, 9], [5, 8])
      break
    case "blink":
      c.dots("E", [4, 5], [5, 5], [6, 5]).dots("M", [2, 8], [3, 9], [4, 9], [5, 8])
      break
    case "happy":
      c.dots("E", [4, 5], [5, 4], [6, 5]).dots("M", [2, 8], [3, 9], [4, 9], [5, 9], [6, 8]).dots("T", [4, 9])
      break
    case "left":
      eye(4, 4)
      c.set(4, 4, "W").dots("M", [2, 8], [3, 9], [4, 9])
      break
    case "right":
      eye(6, 4)
      c.set(6, 4, "W").dots("M", [3, 9], [4, 9], [5, 9])
      break
    case "up":
      eye(5, 3)
      c.set(5, 3, "W").dots("M", [3, 8], [4, 8])
      break
    case "eat":
      eye(5, 4)
      c.set(5, 4, "W").rect(2, 8, 4, 2, "M").dots("T", [3, 9], [4, 9])
      break
    case "chomp":
      c.dots("E", [4, 5], [5, 5], [6, 5]).dots("M", [2, 8], [3, 9], [4, 9], [5, 9], [6, 8])
      break
    case "oh":
      eye(5, 4)
      c.set(5, 4, "W").rect(3, 8, 2, 2, "M")
      break
  }
}

/// The dinosaur: 24 wide, 20 tall, facing left.
export function dinosaur(face: Face, cheer: boolean): Canvas {
  const c = new Canvas(24, 20)
  // tail, raised at the end
  c.ellipse(20.2, 13.8, 3.6, 2.5, "G").ellipse(22.6, 12.6, 1.6, 1.3, "G").dots("G", [23, 11], [22, 11])
  // body, neck, head, snout
  c.ellipse(12.8, 12.6, 7.8, 5.4, "G")
  c.ellipse(8.8, 8.6, 3.7, 4.3, "G")
  c.ellipse(6, 5.7, 4.7, 3.8, "G")
  c.ellipse(3, 7.2, 3.2, 2.3, "G")
  c.ellipse(11.8, 15.2, 5.6, 2.5, "B")
  // plates along the back: found from the body's top edge, so they sit on it
  for (const x of [11, 14, 17, 20]) {
    let top = 0
    while (top < c.height && c.get(x, top) === ".") top += 1
    c.rect(x - 1, top - 1, 3, 1, "P").set(x, top - 2, "P")
  }
  // legs, feet, and an arm
  c.rect(8, 16, 3, 3, "g").rect(15, 16, 3, 3, "g").rect(7, 18, 4, 2, "D").rect(14, 18, 4, 2, "D")
  if (cheer) c.dots("g", [9, 10], [9, 9], [8, 8], [9, 8])
  else c.dots("g", [9, 13], [8, 14], [9, 14])
  profile(c, face)
  return c.outline("O")
}
