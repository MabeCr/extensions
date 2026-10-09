// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// Pixel art, made in code. A picture is a grid of one-character color keys; shapes are
// stamped onto it (ellipses, rectangles, single pixels), an outline is grown around
// them, and the grid is written out as SVG rectangles, a row at a time and a run of
// one color at a time, which keeps a creature to a few dozen elements.

export type Palette = Record<string, string>

/// A grid of color keys; `.` is clear.
export class Canvas {
  readonly width: number
  readonly height: number
  readonly cells: string[][]

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.cells = Array.from({ length: height }, () => Array.from({ length: width }, () => "."))
  }

  get(x: number, y: number): string {
    return this.cells[y]?.[x] ?? "."
  }

  set(x: number, y: number, key: string): this {
    if (x >= 0 && y >= 0 && x < this.width && y < this.height) this.cells[y][x] = key
    return this
  }

  /// Several pixels of one key.
  dots(key: string, ...points: [number, number][]): this {
    for (const [x, y] of points) this.set(x, y, key)
    return this
  }

  rect(x: number, y: number, w: number, h: number, key: string): this {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, key)
    return this
  }

  /// A filled ellipse centered on (cx, cy), which may sit on a pixel's edge (a half step).
  ellipse(cx: number, cy: number, rx: number, ry: number, key: string): this {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const dx = (x + 0.5 - cx) / rx
        const dy = (y + 0.5 - cy) / ry
        if (dx * dx + dy * dy <= 1) this.set(x, y, key)
      }
    }
    return this
  }

  /// A one-pixel edge of `key` around everything drawn, outside it and not over it.
  outline(key: string): this {
    const edge: [number, number][] = []
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.get(x, y) !== ".") continue
        if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => this.get(x + dx, y + dy) !== "." && this.get(x + dx, y + dy) !== key)) edge.push([x, y])
      }
    }
    return this.dots(key, ...edge)
  }

  /// The same picture with every pixel turned one color, for a flash.
  silhouette(key: string): Canvas {
    const copy = new Canvas(this.width, this.height)
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) if (this.get(x, y) !== ".") copy.set(x, y, key)
    return copy
  }

  /// The same picture turned over, left to right.
  mirrored(): Canvas {
    const copy = new Canvas(this.width, this.height)
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) copy.set(this.width - 1 - x, y, this.get(x, y))
    return copy
  }

  clone(): Canvas {
    const copy = new Canvas(this.width, this.height)
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) copy.set(x, y, this.get(x, y))
    return copy
  }
}

/// A canvas as SVG rects with its top left at (`x`, `y`), each pixel `scale` units square. Runs of one
/// color along a row are one rect. No SVG wrapper: this is for putting inside one.
export function rects(canvas: Canvas, palette: Palette, scale: number, x = 0, y = 0): string {
  const out: string[] = []
  for (let row = 0; row < canvas.height; row++) {
    let col = 0
    while (col < canvas.width) {
      const key = canvas.get(col, row)
      if (key === "." || !palette[key]) {
        col += 1
        continue
      }
      let run = 1
      while (canvas.get(col + run, row) === key) run += 1
      out.push(`<rect x="${+(x + col * scale).toFixed(2)}" y="${+(y + row * scale).toFixed(2)}" width="${+(run * scale).toFixed(2)}" height="${+scale.toFixed(2)}" fill="${palette[key]}"/>`)
      col += run
    }
  }
  return out.join("")
}

/// A canvas from rows of text, for the small hand-drawn things.
export function fromRows(rows: string[]): Canvas {
  const canvas = new Canvas(Math.max(...rows.map((r) => r.length)), rows.length)
  rows.forEach((row, y) => [...row].forEach((key, x) => canvas.set(x, y, key === " " ? "." : key)))
  return canvas
}
