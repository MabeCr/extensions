// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT

import type { Ranked } from "./repeaters.ts"
import { SIMPLEX } from "./repeaters.ts"

/// Text from the imported list is text, never markup.
export const escapeMarkdown = (text: string): string => text.replace(/[\\`*_[\]<>|~&]/g, "\\$&")

export const messageMarkdown = (message: string): string => `_${escapeMarkdown(message)}_`

const mhz = (n: number) => n.toFixed(3)
const offsetText = (r: Ranked) => (r.offset === 0 ? "simplex" : `${r.offset > 0 ? "+" : "−"}${Math.abs(r.offset)}`)
const toneText = (r: Ranked) => (r.tone ? `${r.tone}` : "")
const distText = (r: Ranked) => (r.km === undefined ? "" : r.km < 10 ? `${r.km.toFixed(1)} km` : `${Math.round(r.km)} km`)

export function repeatersMarkdown(shown: Ranked[], total: number, located: boolean): string {
  const simplex = ["", "**Simplex**", "", ...SIMPLEX.map((s) => `- ${mhz(s.freq)} — ${s.label}`)]
  if (!shown.length) return [messageMarkdown("No repeaters yet. Paste a CSV into this panel's settings."), ...simplex].join("\n")

  const head = `_${total} ${total === 1 ? "repeater" : "repeaters"}${located ? ", nearest first" : ", no position — sorted by frequency"}_`
  const rows = shown.map((r) =>
    `| ${mhz(r.freq)} | ${offsetText(r)} | ${toneText(r)} | ${escapeMarkdown(r.call)} | ${escapeMarkdown(r.place)} | ${distText(r)} |`)
  return [head, "", "| MHz | Offset | Tone | Call | Place | Dist |", "|:--|:--|:--|:--|:--|--:|", ...rows, ...simplex].join("\n")
}
