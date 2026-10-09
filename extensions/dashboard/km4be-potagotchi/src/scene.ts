// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// A frame of the creature as a panel scene: the park, the creature, the food, the effects and the meter
// as layers; where the creature stands, as values the host moves its layer by (and glides between, from
// one drawing to the next); and a line or two of words under it.

import type { PanelScene, PanelSceneLayer } from "@ham2k/extension-sdk"

import { box, mouth } from "./behavior.ts"
import type { Frame, Fx } from "./behavior.ts"
import { drawBackground, drawBurst, drawConfetti, drawFood, drawHeart, drawMeter, drawNote, drawSparkle, SCENE_HEIGHT, SCENE_WIDTH } from "./props.ts"
import type { Weather } from "./props.ts"
import { drawSprite } from "./sprites.ts"

/// How long the host takes to glide a layer from where it was to where it is now: a little under the second
/// between drawings, so it is always arriving.
const GLIDE_MS = 900

const svg = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SCENE_WIDTH} ${SCENE_HEIGHT}" shape-rendering="crispEdges">${inner}</svg>`
const layer = (id: string, inner: string, extra: Partial<PanelSceneLayer> = {}): PanelSceneLayer => ({ id, x: 0, y: 0, width: SCENE_WIDTH, height: SCENE_HEIGHT, svg: svg(inner), ...extra })

/// A binding that passes a value straight through, within `range`.
const through = (value: string, range: number) => ({ value, input: [-range, range] as [number, number], output: [-range, range] as [number, number] })

function drawFx(fx: Fx[]): { behind: string; front: string } {
  let behind = ""
  let front = ""
  for (const e of fx) {
    if (e.kind === "burst") behind += drawBurst(e.x, e.y, e.age, e.color)
    else if (e.kind === "heart") front += drawHeart(3, e.x, e.y)
    else if (e.kind === "sparkle") front += drawSparkle(3, e.x, e.y)
    else if (e.kind === "note") front += drawNote(4, e.x, e.y)
    else if (e.kind === "confetti") front += drawConfetti(e.step)
  }
  return { behind, front }
}

export interface Words {
  /// The creature and the park.
  header: string
  /// How it is doing, and how far from the next thing.
  status: string
}

/// The scene for a frame, `count` contacts in, with the words under it.
export function buildScene(frame: Frame, count: number, weather: Weather, words: Words): PanelScene {
  const b = box(frame.stage, frame.scale)
  const { behind, front } = drawFx(frame.fx)
  const creature = drawSprite(frame.stage, frame.face, frame.scale, b.x, b.y, { cheer: frame.cheer, flip: frame.flip, upsideDown: frame.upsideDown, color: frame.flash ?? undefined })
  const where = mouth(frame.stage, frame.scale)
  const food = frame.food ? drawFood(frame.food.item, 3, where.x, where.y) : `<rect width="1" height="1" fill="#000000" fill-opacity="0"/>`

  return {
    version: 1,
    width: SCENE_WIDTH,
    height: SCENE_HEIGHT,
    // `pat` is drawn from by nothing: it is what a pat's answer names (see index.ts).
    values: { cx: frame.dx, cy: frame.dy, fy: frame.food?.y ?? 0, fo: frame.food?.opacity ?? 0, pat: 0 },
    strings: { header: words.header, status: words.status },
    layers: [
      layer("park", drawBackground(frame.dark ? "night" : weather)),
      layer("fireworks", behind),
      layer("creature", creature, { translateX: through("cx", 120), translateY: through("cy", 120), transitionMs: GLIDE_MS }),
      layer("food", food, { translateY: through("fy", 120), opacity: { value: "fo", input: [0, 1], output: [0, 1] }, transitionMs: GLIDE_MS }),
      layer("effects", front),
      layer("meter", drawMeter(count)),
    ],
    controls: [
      { id: "header", kind: "nativeText", label: "Your friend and the park", value: "header", style: "title" },
      { id: "status", kind: "nativeText", label: "How it is doing", value: "status" },
      { id: "pet", kind: "nativeButton", label: "Pet", icon: "heart", variant: "tonal", event: "pet" },
    ],
    layout: {
      column: [{ control: "header" }, { scene: true, flex: 1 }, { control: "status" }, { row: [{ control: "pet" }, { spacer: 1 }], spacing: 8 }],
      padding: 12,
      spacing: 8,
      crossAxisAlignment: "stretch",
    },
  }
}

