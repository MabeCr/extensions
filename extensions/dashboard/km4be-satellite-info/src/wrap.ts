// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// Text that fits the pane (Map, Radio and Report pages). The app draws a text control on one line and cuts what does not
// fit with an ellipsis, so a text that might be too long is laid out as words in a `wrap`, which the app breaks itself.

import type { PanelSceneControl, PanelSceneLayoutNode } from "@ham2k/extension-sdk"

/// What the pane is, as far as wrapping goes: the room across, a monospaced face's character, a proportional face's size,
/// and how tall a line of each is.
export interface Room {
  width: number
  /// One character of the monospaced face, in logical pixels.
  monoChar: number
  /// The sizes of the label and body faces, in logical pixels.
  labelSize: number
  bodySize: number
  monoLine: number
  textLine: number
}

/// Estimated advance widths, in ems, of a common sans-serif: the host's own face is not known, and these are near enough for
/// Roboto, the one the apps use, to break a line within a character of where it would fill. Measured against a phone's
/// screenshot, a line of 46 letters came out within 6% of its drawn width.
export function advance(c: string): number {
  if (c === " ") return 0.25
  if ("il.,';:!|".includes(c)) return 0.24
  if ("jtfr()[]/I-".includes(c)) return 0.31
  if ("mM".includes(c)) return 0.87
  if ("wW".includes(c)) return 0.75
  if (/[A-Z]/.test(c)) return 0.64
  if (/[0-9]/.test(c)) return 0.56
  return 0.54
}

/// A margin on the estimate, so that a line is broken a little early rather than cut.
export const SAFETY = 1.06
/// A monospaced face's character, which runs a little over 0.6 of its size once letter spacing is counted.
export const MONO_EM = 0.62

export const textWidth = (text: string, size: number): number => [...text].reduce((n, c) => n + advance(c), 0) * size * SAFETY

/// A pane's room from what the host says: the width across, and the faces' sizes. Wider than the faces' own, or unknown,
/// is nothing wrapped.
export function roomOf(width: number, mono: { size: number; os: number }, label: number, body: number, lines: { label: number; body: number }): Room | undefined {
  if (!(width > 0)) return undefined
  return {
    width,
    monoChar: mono.size * mono.os * MONO_EM,
    labelSize: label,
    bodySize: body,
    monoLine: Math.ceil(mono.size * mono.os * 1.4),
    textLine: Math.max(lines.label, lines.body),
  }
}

/// How much wider than the estimate a face may really draw a line before a line is left whole: wrapping is for a text that
/// might not fit, and a short line, which no estimate puts near the edge, stays one control.
export const CAUTION = 1.3

/// A text as the page lays it out: the controls that show it, the layout node that places them, and the height it takes.
export interface Prose {
  controls: PanelSceneControl[]
  node: PanelSceneLayoutNode
  height: number
}

/// What a text control is for: a text that fits across the pane is one control bound to the string `key`, as ever. One that
/// might not is a run of controls, a word each, in a `wrap` node: the app, which knows the font it draws in, breaks the lines
/// where the words reach the edge, and none is cut off with an ellipsis. (Guessing letters' widths from here broke lines a
/// third short, and then a tenth over.) The height is for the pane that lays the page out on a grid, and runs high.
export function proseOf(key: string, text: string, label: string, style: "label" | "mono" | undefined, room: Room | undefined): Prose {
  const mono = style === "mono"
  const line = room ? (mono ? room.monoLine : room.textLine) : 20
  const single = (): Prose => ({
    controls: [{ id: key, kind: "nativeText", label, value: key, ...(style ? { style } : {}) }],
    node: { control: key },
    height: line,
  })
  const words = text.split(/\s+/).filter(Boolean)
  // The widest the text might be, with the most any face we know draws a character at.
  const widest = room ? (mono ? text.length * room.monoChar : textWidth(text, Math.max(room.labelSize, room.bodySize))) * CAUTION : 0
  if (!room || words.length < 2 || widest <= room.width) return single()
  const lines = Math.ceil(widest / room.width)
  const gap = mono ? room.monoChar : Math.max(room.labelSize, room.bodySize) * 0.3
  return {
    controls: words.map((word, i): PanelSceneControl => ({ id: `${key}_${i}`, kind: "nativeText", label: word, ...(style ? { style } : {}) })),
    node: { wrap: words.map((_, i): PanelSceneLayoutNode => ({ control: `${key}_${i}` })), spacing: Math.round(gap), runSpacing: 2 },
    height: lines * line + (lines - 1) * 2,
  }
}
