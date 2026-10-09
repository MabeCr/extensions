// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// Text written on the sky plot beside its dots: the time of rise, of set, and the
// peak's elevation. A label wants to sit close to its dot and must never be on top of
// anything: not its own dot, nor another, nor the ring that marks where the satellite is
// now, nor the arrowhead, nor a compass letter, nor another label. Near the rim there is
// often no room on the side a label would like, so each is placed by trying positions around
// its dot, nearest first, and taking the first that is clear.

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface Disc {
  x: number
  y: number
  r: number
}

export const LABEL_HEIGHT = 16
export const LABEL_SIZE = 12

/// What a label's text needs of room, estimated from its length: the host sets the text, and
/// this errs wide so a label is never closer to a dot than it is placed.
export const labelWidth = (text: string): number => Math.ceil(text.length * LABEL_SIZE * 0.62) + 6

/// Clear space kept between a label and the edge of anything it must not touch.
export const MARGIN = 2

/// Between the edge of a dot and the near edge of its text, nearest first: enough to read as
/// beside the dot and not on it. A label takes the first tier that has a clear place, so the
/// further ones are only ever used where the plot is crowded.
const GAPS = [6, 12, 24, 40, 58]

export interface LabelSpec {
  id: string
  text: string
  /// The dot the label belongs to: where it is, and how big.
  x: number
  y: number
  r: number
  color: string
}

export interface PlacedLabel {
  id: string
  x: number
  y: number
  width: number
  height: number
  text: { literal: string; size: number; color: string; align: "start" | "center" | "end"; fontWeight: number }
}

/// The nearest a point comes to a box: 0 when it is inside.
function distanceToBox(px: number, py: number, b: Box): number {
  const dx = Math.max(b.x - px, 0, px - (b.x + b.width))
  const dy = Math.max(b.y - py, 0, py - (b.y + b.height))
  return Math.hypot(dx, dy)
}

const overlaps = (a: Box, b: Box, margin: number): boolean =>
  a.x < b.x + b.width + margin && b.x < a.x + a.width + margin && a.y < b.y + b.height + margin && b.y < a.y + a.height + margin

/// How many things the box is on or too near, or off the plot. Zero is a good place for a label.
export function clash(box: Box, discs: Disc[], boxes: Box[], size: number): number {
  let n = 0
  if (box.x < 0 || box.y < 0 || box.x + box.width > size || box.y + box.height > size) n += 1
  for (const d of discs) if (distanceToBox(d.x, d.y, box) < d.r + MARGIN) n += 1
  for (const b of boxes) if (overlaps(box, b, MARGIN)) n += 1
  return n
}

type Align = "start" | "center" | "end"

/// Positions for a label of `w` x `h` around the dot at (`x`, `y`) with radius `r`, nearest
/// and most natural first. Within each distance: beside the dot on the side toward the rim,
/// then the other side, then above and below, then the corners, and then the same sideways
/// and above and below, shifted a line up or down or half a label across, to get past
/// whatever is in the way.
function candidates(spec: LabelSpec, w: number, h: number, size: number): { box: Box; align: Align }[] {
  const { x, y, r } = spec
  const outward = (x >= size / 2 ? 1 : -1) as 1 | -1
  const list: { box: Box; align: Align }[] = []
  for (const gap of GAPS) {
    const d = r + gap
    const c = d * 0.7
    const side = (dir: 1 | -1, dy: number): { box: Box; align: Align } => ({
      box: { x: dir > 0 ? x + d : x - d - w, y: y + dy - h / 2, width: w, height: h },
      align: dir > 0 ? "start" : "end",
    })
    const corner = (dirX: 1 | -1, dirY: 1 | -1): { box: Box; align: Align } => ({
      box: { x: dirX > 0 ? x + c : x - c - w, y: dirY > 0 ? y + c : y - c - h, width: w, height: h },
      align: dirX > 0 ? "start" : "end",
    })
    const column = (dirY: 1 | -1, dx: number): { box: Box; align: Align } => ({
      box: { x: x + dx - w / 2, y: dirY > 0 ? y + d : y - d - h, width: w, height: h },
      align: "center",
    })
    list.push(
      side(outward, 0),
      side(-outward as 1 | -1, 0),
      column(-1, 0),
      column(1, 0),
      corner(outward, -1),
      corner(outward, 1),
      corner(-outward as 1 | -1, -1),
      corner(-outward as 1 | -1, 1),
      side(outward, -h),
      side(outward, h),
      side(-outward as 1 | -1, -h),
      side(-outward as 1 | -1, h),
      column(-1, -w / 2),
      column(-1, w / 2),
      column(1, -w / 2),
      column(1, w / 2),
    )
  }
  // To a tenth of a unit before they are tried, so the place that is tried is the place that is used.
  const tenth = (n: number) => Math.round(n * 10) / 10
  return list.map(({ box, align }) => ({ box: { ...box, x: tenth(box.x), y: tenth(box.y) }, align }))
}

/// The labels in the places that are clear, one at a time in the order given (so the first
/// has the most choice). `discs` and `boxes` are what must be kept clear besides the labels
/// themselves: the dots, the ring, the arrowhead, the compass letters.
export function placeLabels(specs: LabelSpec[], discs: Disc[], boxes: Box[], size: number): PlacedLabel[] {
  const taken: Box[] = []
  return specs.map((spec) => {
    const w = labelWidth(spec.text)
    const options = candidates(spec, w, LABEL_HEIGHT, size)
    // The first clear place; if there is none, the least bad, which a test would be told of.
    let best = options[0]
    let fewest = Infinity
    for (const option of options) {
      const n = clash(option.box, discs, [...boxes, ...taken], size)
      if (n < fewest) {
        fewest = n
        best = option
      }
      if (n === 0) break
    }
    taken.push(best.box)
    return {
      id: spec.id,
      x: best.box.x,
      y: best.box.y,
      width: w,
      height: LABEL_HEIGHT,
      text: { literal: spec.text, size: LABEL_SIZE, color: spec.color, align: best.align, fontWeight: 600 },
    }
  })
}
