// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// Faces for creatures that look straight at you. A creature says where its eyes and mouth go, as a small
// spec, and every expression is stamped from that, so the same nine faces work on a dinosaur hatchling and on
// a radio's little screen without being drawn nine times each.

import type { Canvas } from "./pixels.ts"

export type Face = "open" | "blink" | "happy" | "left" | "right" | "up" | "eat" | "chomp" | "oh"

export const FACES: Face[] = ["open", "blink", "happy", "left", "right", "up", "eat", "chomp", "oh"]

export interface FaceSpec {
  /// The left column of the left eye and of the right, which are `eyeWidth` wide and two tall; `ey` is the top row.
  lx: number
  rx: number
  ey: number
  eyeWidth: number
  /// The middle column and the row of the mouth, and how far its corners are from the middle.
  mx: number
  my: number
  half: number
  /// The color keys: the eye, its shine, the mouth, and the tongue.
  eye: string
  shine: string
  mouth: string
  tongue: string
}

/// `face` stamped onto `c` as `spec` says.
export function stampFace(c: Canvas, face: Face, spec: FaceSpec): Canvas {
  const { lx, rx, ey, eyeWidth: w, mx, my, half } = spec
  const cols = (x0: number) => Array.from({ length: w }, (_, i) => x0 + i)

  /// Both eyes, open, shifted along and up.
  const eyes = (dx: number, dy = 0) => {
    for (const x0 of [lx + dx, rx + dx]) {
      for (const x of cols(x0)) c.set(x, ey + dy, spec.eye).set(x, ey + dy + 1, spec.eye)
      c.set(x0, ey + dy, spec.shine)
    }
  }
  /// Both eyes shut, a line each.
  const shut = () => {
    for (const x0 of [lx, rx]) for (const x of cols(x0)) c.set(x, ey + 1, spec.eye)
  }
  /// Eyes closed in a smile: an arch each.
  const arches = () => {
    for (const x0 of [lx, rx]) {
      c.set(x0 - 1, ey + 1, spec.eye)
      for (const x of cols(x0)) c.set(x, ey, spec.eye)
      c.set(x0 + w, ey + 1, spec.eye)
    }
  }
  /// A smile: the corners up, and the middle a row down.
  const smile = () => {
    c.set(mx - half, my, spec.mouth).set(mx + half, my, spec.mouth)
    for (let x = mx - half + 1; x <= mx + half - 1; x++) c.set(x, my + 1, spec.mouth)
  }

  switch (face) {
    case "open":
      eyes(0)
      smile()
      break
    case "blink":
      shut()
      smile()
      break
    case "happy":
      arches()
      smile()
      c.set(mx, my + 1, spec.tongue)
      break
    case "left":
      eyes(-1)
      c.set(mx - 1, my, spec.mouth).set(mx, my, spec.mouth)
      break
    case "right":
      eyes(1)
      c.set(mx, my, spec.mouth).set(mx + 1, my, spec.mouth)
      break
    case "up":
      eyes(0, -1)
      c.set(mx, my, spec.mouth)
      break
    case "eat":
      eyes(0)
      for (let x = mx - half; x <= mx + half; x++) c.set(x, my, spec.mouth).set(x, my + 1, spec.mouth)
      c.set(mx, my + 1, spec.tongue)
      break
    case "chomp":
      shut()
      c.set(mx - half, my, spec.mouth).set(mx + half, my, spec.mouth)
      for (let x = mx - half + 1; x <= mx + half - 1; x++) c.set(x, my + 1, spec.mouth)
      c.set(mx, my + 2, spec.mouth)
      break
    case "oh":
      eyes(0)
      c.rect(mx, my, 1, 2, spec.mouth)
      break
  }
  return c
}
