// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// The panel as a scene: no artwork, only native controls placed by a layout. A
// page of passes, each with a star to follow its satellite, a Favorites / All
// switch, a UTC switch, and previous / next. A scene cannot scroll, so a long
// list is cut into pages that fit a phone.
//
// The scene has the same controls every time, a short page filling its five
// slots with hidden blanks. An event's answer may only patch names already in
// the scene it answers, so the set of names must not change between a render and
// the event that follows it.

import type { PanelScene, PanelSceneControl, PanelSceneLayoutNode } from "@ham2k/extension-sdk"

export const PAGE_SIZE = 5

export type Mode = "favorites" | "all"

export interface Row {
  /// The satellite, as the catalog names it.
  name: string
  favorite: boolean
  text: string
}

/// Everything a render, and an event's answer, is made from.
export interface Model {
  header: string
  /// The line under the header: what to do next, or why the page is empty.
  hint: string
  mode: Mode
  utc: boolean
  page: number
  pageCount: number
  /// "1–5 of 23", or "" when there is nothing to page.
  range: string
  rows: Row[]
}

export const STAR_PREFIX = "star:"

/// Row `i`'s star control id. The satellite is in it, so a tap lands on the satellite the
/// operator saw even if the list has moved on; the index keeps ids unique when one
/// satellite has two passes on a page.
export const starId = (name: string, i: number): string => `${STAR_PREFIX}${name}:${i}`

/// The satellite a star control belongs to, or null when `id` is not a star.
export function satelliteOfStar(id: string): string | null {
  if (!id.startsWith(STAR_PREFIX)) return null
  const rest = id.slice(STAR_PREFIX.length)
  return rest.slice(0, rest.lastIndexOf(":")) || null
}

export const rowKey = (i: number): string => `row${i}`

/// What the scene's text controls and choices hold.
export function stringsOf(m: Model): Record<string, string> {
  const strings: Record<string, string> = { mode: m.mode, header: m.header, hint: m.hint, range: m.range }
  slots(m).forEach((row, i) => {
    strings[rowKey(i)] = row.text
  })
  return strings
}

const BLANK: Row = { name: "", favorite: false, text: "" }

/// The page's rows, padded to its five slots.
const slots = (m: Model): Row[] => Array.from({ length: PAGE_SIZE }, (_, i) => m.rows[i] ?? BLANK)

export const valuesOf = (m: Model): Record<string, number> => ({ utc: m.utc ? 1 : 0 })

export function buildScene(m: Model): PanelScene {
  const controls: PanelSceneControl[] = [
    {
      id: "mode",
      kind: "nativeSegmented",
      label: "Passes to show",
      value: "mode",
      event: "mode",
      options: [
        { label: "Favorites", value: "favorites" },
        { label: "All", value: "all" },
      ],
    },
    { id: "utc", kind: "nativeSwitch", label: "UTC", value: "utc", event: "utc" },
    { id: "header", kind: "nativeText", label: "Location and satellites", value: "header", style: "label" },
    { id: "hint", kind: "nativeText", label: "Note", value: "hint" },
  ]

  const rows = slots(m)
  rows.forEach((row, i) => {
    const blank = row === BLANK
    controls.push(
      {
        id: starId(row.name, i),
        kind: "nativeButton",
        label: blank ? "No pass" : row.favorite ? `Stop following ${row.name}` : `Follow ${row.name}`,
        icon: row.favorite ? "star" : "star-outline",
        variant: "text",
        event: "star",
        // A blank slot keeps its place in the layout but takes no taps and is not read out.
        ...(blank ? { opacity: 0, disabled: true } : {}),
      },
      { id: rowKey(i), kind: "nativeText", label: blank ? "No pass" : `Pass ${i + 1}`, value: rowKey(i), style: "mono" },
    )
  })

  controls.push(
    { id: "prev", kind: "nativeButton", label: "Previous page", icon: "chevron-left", variant: "tonal", event: "prev", disabled: m.page <= 0 },
    { id: "range", kind: "nativeText", label: "Showing", value: "range", align: "center" },
    { id: "next", kind: "nativeButton", label: "Next page", icon: "chevron-right", variant: "tonal", event: "next", disabled: m.page >= m.pageCount - 1 },
  )

  const column: PanelSceneLayoutNode[] = [
    { row: [{ control: "mode", flex: 1 }, { control: "utc" }], spacing: 8, crossAxisAlignment: "center" },
    { control: "header" },
    { control: "hint" },
    ...rows.map((row, i): PanelSceneLayoutNode => ({
      row: [{ control: starId(row.name, i), width: 56 }, { control: rowKey(i), flex: 1 }],
      spacing: 4,
      crossAxisAlignment: "center",
    })),
    { spacer: 1 },
    { row: [{ control: "prev" }, { control: "range", flex: 1 }, { control: "next" }], spacing: 8, crossAxisAlignment: "center" },
  ]

  return {
    version: 1,
    // Nothing is drawn: the layout has no artwork node, so it declares no layers.
    width: 360,
    height: 480,
    values: valuesOf(m),
    strings: stringsOf(m),
    layers: [],
    controls,
    layout: { column, padding: 12, spacing: 8, crossAxisAlignment: "stretch" },
  }
}
