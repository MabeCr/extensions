// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// The results as a markdown table: the host draws the columns and a line
// between the rows, themes and scales it, and scrolls it. It costs no web view,
// so it renders on every host and is re-rendered on the panel's triggers like
// any other.
//
//   | Call      | Band    | Date       | Name  |
//   | KM4**BE** | 20m SSB | 2026-09-01 | Chris |
//
// The letters that matched are bold. That is as far as markdown goes: there is
// no underline. The name is last because it is the column that can be long, and
// a long last column wraps without disturbing the others.

import type { Match } from "./index.ts"

/// Everything from the log is text, never markup. Only what can change how a
/// table cell reads is escaped, so dates and names stay as written.
export const escapeMarkdown = (text: string): string => text.replace(/[\\`*_[\]<>|~&]/g, "\\$&")

/// `text` with every occurrence of `needle` (ignoring case) in bold, escaped.
export function highlight(text: string, needle: string): string {
  const n = needle.trim().toUpperCase()
  if (!n) return escapeMarkdown(text)

  const upper = text.toUpperCase()
  let out = ""
  let from = 0
  for (let at = upper.indexOf(n); at !== -1; at = upper.indexOf(n, from)) {
    out += escapeMarkdown(text.slice(from, at)) + "**" + escapeMarkdown(text.slice(at, at + n.length)) + "**"
    from = at + n.length
  }
  return out + escapeMarkdown(text.slice(from))
}

const date = (millis: number) => (millis ? new Date(millis).toISOString().slice(0, 10) : "")

export function resultsMarkdown(matches: Match[], partial: string, hidden: number): string {
  const total = matches.length + hidden
  const head = `_${total} ${total === 1 ? "station" : "stations"}${hidden > 0 ? ` — showing ${matches.length}, keep typing to narrow it` : ""}_`

  const rows = matches.map((m) => {
    const when = date(m.millis) + (m.count > 1 ? ` ×${m.count}` : "")
    const band = [m.band, m.mode].filter(Boolean).join(" ")
    return `| ${highlight(m.call, partial)} | ${escapeMarkdown(band)} | ${escapeMarkdown(when)} | ${escapeMarkdown(m.name)} |`
  })

  return [head, "", "| Call | Band | Date | Name |", "|:--|:--|:--|:--|", ...rows].join("\n")
}

export const messageMarkdown = (message: string): string => `_${escapeMarkdown(message)}_`
