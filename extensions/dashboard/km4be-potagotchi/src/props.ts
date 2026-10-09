// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// Everything in the picture that is not the creature: the food it is given, the hearts and
// sparkles of a happy moment, fireworks and confetti, the park behind it, and the meter of
// how many contacts it has had. Pixel art again, in the same SVG rects.

import { fromRows, rects } from "./pixels.ts"
import type { Palette } from "./pixels.ts"

export const SCENE_WIDTH = 320
export const SCENE_HEIGHT = 240
/// The line the creature stands on.
export const GROUND_Y = 200

// --- food ----------------------------------------------------------------------------------------------

export type Food = "apple" | "cookie" | "strawberry" | "cherries"
export const FOODS: Food[] = ["apple", "cookie", "strawberry", "cherries"]

const FOOD_ART: Record<Food, { rows: string[]; palette: Palette }> = {
  apple: {
    rows: ["...S...", "..SGG..", ".RRRRR.", "RRWRRRR", "RRRRRRR", ".RRRRR.", "..R.R.."],
    palette: { R: "#e04848", W: "#ff9a9a", G: "#4cc26a", S: "#6b3a14" },
  },
  cookie: {
    rows: [".TTTTT.", "TTcTTTT", "TTTTcTT", "TcTTTTT", "TTTcTTT", ".TTTTT.", "......."],
    palette: { T: "#e3b36b", c: "#5a3418" },
  },
  strawberry: {
    rows: ["..GGG..", ".RRRRR.", "RRyRRyR", "RRRRRRR", ".RyRRyR", "..RRRR.", "...R..."],
    palette: { R: "#e8456b", y: "#ffe27a", G: "#4cc26a" },
  },
  cherries: {
    rows: ["....SS.", "...S..S", "..S...S", ".RR..RR", "RRRR.RRR", "RRRR.RRR", ".RR..RR"],
    palette: { R: "#c9264a", S: "#4a8f3a" },
  },
}

/// A food as SVG rects, `scale` units a pixel, its middle at (`cx`, `cy`).
export function drawFood(food: Food, scale: number, cx: number, cy: number): string {
  const { rows, palette } = FOOD_ART[food]
  const art = fromRows(rows)
  return rects(art, palette, scale, cx - (art.width * scale) / 2, cy - (art.height * scale) / 2)
}

// --- small things ----------------------------------------------------------------------------------------

const HEART = fromRows([".R.R.", "RRRRR", "RRRRR", ".RRR.", "..R.."])
const SPARKLE = fromRows(["..Y..", "..Y..", "YYWYY", "..Y..", "..Y.."])
const NOTE = fromRows(["..NN", "..N.N", "..N", "NNN", "NNN"])
const STAR = fromRows(["...Y...", "...Y...", "..YYY..", "YYYYYYY", ".YYYYY.", "..YYY..", ".YY.YY."])

const SMALL: Palette = { R: "#ff5d7a", Y: "#ffd84a", W: "#ffffff", N: "#7a5cd6" }

export function drawHeart(scale: number, cx: number, cy: number): string {
  return rects(HEART, SMALL, scale, cx - (HEART.width * scale) / 2, cy - (HEART.height * scale) / 2)
}
export function drawSparkle(scale: number, cx: number, cy: number): string {
  return rects(SPARKLE, SMALL, scale, cx - (SPARKLE.width * scale) / 2, cy - (SPARKLE.height * scale) / 2)
}
export function drawNote(scale: number, cx: number, cy: number): string {
  return rects(NOTE, SMALL, scale, cx - (NOTE.width * scale) / 2, cy - (NOTE.height * scale) / 2)
}
export function drawStar(scale: number, cx: number, cy: number, filled = true): string {
  return rects(STAR, filled ? SMALL : { Y: "#00000033" }, scale, cx - (STAR.width * scale) / 2, cy - (STAR.height * scale) / 2)
}

// --- fireworks and confetti -------------------------------------------------------------------------------

const BURST_COLORS = ["#ff5d7a", "#ffd84a", "#6ee7a8", "#6ec6ff", "#c69bff"]

/// One burst of fireworks at (`cx`, `cy`), `age` steps after it went off: a ring of sparks flying out, a
/// second ring inside it from the third step, and all of them falling and fading at the end.
export function drawBurst(cx: number, cy: number, age: number, colorIndex: number): string {
  if (age < 0 || age > 4) return ""
  const color = BURST_COLORS[colorIndex % BURST_COLORS.length]
  const radius = 10 + age * 14
  const fall = age >= 3 ? (age - 2) * 9 : 0
  const size = age >= 4 ? 4 : 7
  const out: string[] = []
  const ring = (count: number, r: number, s: number, tint: string) => {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (colorIndex % 2) * 0.26
      const x = cx + Math.cos(angle) * r
      const y = cy + Math.sin(angle) * r + fall
      out.push(`<rect x="${+(x - s / 2).toFixed(1)}" y="${+(y - s / 2).toFixed(1)}" width="${s}" height="${s}" fill="${tint}"/>`)
    }
  }
  if (age === 0) out.push(`<rect x="${cx - 5}" y="${cy - 5}" width="10" height="10" fill="#ffffff"/>`)
  else ring(16, radius, size, color)
  if (age >= 2) ring(10, radius * 0.55, 4, "#ffffff")
  if (age >= 1 && age <= 3) ring(16, radius * 0.8, 3, color)
  return out.join("")
}

const CONFETTI_COLORS = ["#ff5d7a", "#ffd84a", "#6ee7a8", "#6ec6ff", "#c69bff", "#ff9f43"]

/// Falling confetti, `step` seconds in: the same pieces in the same places every time, since a piece's place is
/// a function of its number and the step.
export function drawConfetti(step: number): string {
  const out: string[] = []
  for (let i = 0; i < 52; i++) {
    const x = (i * 97 + 31) % SCENE_WIDTH
    const speed = 22 + ((i * 13) % 18)
    const y = ((i * 41) % 60) - 40 + step * speed
    if (y < -6 || y > GROUND_Y + 6) continue
    const wide = i % 2 === 0
    out.push(`<rect x="${x}" y="${+y.toFixed(1)}" width="${wide ? 9 : 4}" height="${wide ? 4 : 9}" fill="${CONFETTI_COLORS[i % CONFETTI_COLORS.length]}"/>`)
  }
  return out.join("")
}

// --- the park --------------------------------------------------------------------------------------------

export type Weather = "day" | "night"

const SKY: Record<Weather, { top: string; low: string; hill: string; grass: string; edge: string; tree: string; trunk: string; sun: string; cloud: string }> = {
  day: { top: "#8fcdf5", low: "#c6e8fb", hill: "#7cc47f", grass: "#5fae60", edge: "#3f8f4a", tree: "#2f7d46", trunk: "#7a4a22", sun: "#ffe27a", cloud: "#ffffff" },
  night: { top: "#1c2b57", low: "#34457a", hill: "#2f6a55", grass: "#285a46", edge: "#1d4636", tree: "#1b4a36", trunk: "#4a3017", sun: "#e8ecff", cloud: "#566091" },
}

function pine(x: number, base: number, size: number, color: string, trunk: string): string {
  const tiers = [0, 1, 2].map((i) => {
    const w = (3 - i) * size + size
    const y = base - 16 * size * 0.5 - i * size * 4.5
    return `<rect x="${x - w / 2}" y="${y}" width="${w}" height="${size * 4.5}" fill="${color}"/>`
  })
  return `<rect x="${x - size / 2}" y="${base - size * 3}" width="${size}" height="${size * 3}" fill="${trunk}"/>${tiers.join("")}`
}

/// The park behind everything, in a day or a night.
export function drawBackground(weather: Weather): string {
  const c = SKY[weather]
  const stars =
    weather === "night"
      ? [[30, 30], [90, 18], [140, 42], [200, 24], [250, 50], [290, 20], [60, 70], [230, 84]].map(([x, y]) => `<rect x="${x}" y="${y}" width="3" height="3" fill="#ffffff"/>`).join("")
      : ""
  return (
    `<rect width="${SCENE_WIDTH}" height="${GROUND_Y - 70}" fill="${c.top}"/>` +
    `<rect y="${GROUND_Y - 70}" width="${SCENE_WIDTH}" height="70" fill="${c.low}"/>` +
    stars +
    `<rect x="284" y="58" width="22" height="22" fill="${c.sun}"/><rect x="280" y="62" width="30" height="14" fill="${c.sun}"/><rect x="288" y="54" width="14" height="30" fill="${c.sun}"/>` +
    `<g fill="${c.cloud}"><rect x="40" y="52" width="46" height="10"/><rect x="50" y="44" width="26" height="10"/><rect x="190" y="70" width="54" height="10"/><rect x="202" y="62" width="30" height="10"/></g>` +
    `<rect y="${GROUND_Y - 38}" width="${SCENE_WIDTH}" height="40" fill="${c.hill}"/>` +
    pine(34, GROUND_Y - 14, 5, c.tree, c.trunk) +
    pine(288, GROUND_Y - 10, 6, c.tree, c.trunk) +
    `<rect y="${GROUND_Y}" width="${SCENE_WIDTH}" height="${SCENE_HEIGHT - GROUND_Y}" fill="${c.grass}"/>` +
    `<rect y="${GROUND_Y}" width="${SCENE_WIDTH}" height="4" fill="${c.edge}"/>` +
    [[20, 214], [74, 226], [128, 210], [196, 222], [244, 212], [300, 228]].map(([x, y]) => `<rect x="${x}" y="${y}" width="3" height="6" fill="${c.edge}"/><rect x="${x + 5}" y="${y + 2}" width="3" height="4" fill="${c.edge}"/>`).join("")
  )
}

// --- the meter ----------------------------------------------------------------------------------------------

/// Ten apples, as many bright as contacts into this ten (a full ten shows all ten), and above them a row of
/// stars, one for each ten completed. Empty places are a dim outline.
export function drawMeter(count: number): string {
  const inTen = count === 0 ? 0 : ((count - 1) % 10) + 1
  const tens = Math.floor(count / 10)
  const apples = Array.from({ length: 10 }, (_, i) => {
    const cx = 160 - 4.5 * 20 + i * 20
    return i < inTen ? drawFood("apple", 2.2, cx, 40) : `<rect x="${cx - 6}" y="${40 - 6}" width="12" height="12" fill="#ffffff" fill-opacity="0.25"/><rect x="${cx - 4}" y="${40 - 4}" width="8" height="8" fill="#000000" fill-opacity="0.12"/>`
  }).join("")
  const shown = Math.min(tens, 10)
  const stars = Array.from({ length: shown }, (_, i) => drawStar(1.8, 160 - ((shown - 1) * 20) / 2 + i * 20, 16)).join("")
  return stars + apples
}

