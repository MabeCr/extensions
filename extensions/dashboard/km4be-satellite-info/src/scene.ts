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

import type { DetailModel } from "./detail.ts"

export const PAGE_SIZE = 5

export type Mode = "favorites" | "all"

export interface Row {
  /// The satellite, as the catalog names it.
  name: string
  favorite: boolean
  text: string
  /// When the pass ends, which with the name says which pass the row is (a pass's end is
  /// steady from one working-out to the next; its start, when under way, is not).
  los: number
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
  /// The titles over the rows' columns, set to line up with them; "" when there are no rows.
  columns: string
  /// What the marks at the end of the rows mean, under the list; "" when there are no rows.
  legend: string
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

export const OPEN_PREFIX = "open:"

/// Row `i`'s open-details control id: the pass it opens is named in it, as the star's satellite is.
export const openId = (name: string, los: number, i: number): string => `${OPEN_PREFIX}${name}:${los}:${i}`

/// The pass an open control belongs to, or null when `id` is not one.
export function passOfOpen(id: string): { name: string; los: number } | null {
  if (!id.startsWith(OPEN_PREFIX)) return null
  const parts = id.slice(OPEN_PREFIX.length).split(":")
  const los = Number(parts[parts.length - 2])
  const name = parts.slice(0, -2).join(":")
  return name && Number.isFinite(los) ? { name, los } : null
}

export const rowKey = (i: number): string => `row${i}`

/// What the scene's text controls and choices hold.
export function stringsOf(m: Model): Record<string, string> {
  const strings: Record<string, string> = { mode: m.mode, header: m.header, hint: m.hint, range: m.range, columns: m.columns, legend: m.legend }
  slots(m).forEach((row, i) => {
    strings[rowKey(i)] = row.text
  })
  return strings
}

const BLANK: Row = { name: "", favorite: false, text: "", los: 0 }

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
    { id: "columns", kind: "nativeText", label: "Column titles", value: "columns", style: "mono" },
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
      {
        id: openId(row.name, row.los, i),
        kind: "nativeButton",
        label: blank ? "No pass" : `Details of the ${row.name} pass`,
        icon: "chevron-right",
        variant: "text",
        event: "open",
        ...(blank ? { opacity: 0, disabled: true } : {}),
      },
    )
  })

  controls.push(
    { id: "prev", kind: "nativeButton", label: "Previous page", icon: "chevron-left", variant: "tonal", event: "prev", disabled: m.page <= 0 },
    { id: "range", kind: "nativeText", label: "Showing", value: "range", align: "center" },
    { id: "next", kind: "nativeButton", label: "Next page", icon: "chevron-right", variant: "tonal", event: "next", disabled: m.page >= m.pageCount - 1 },
    { id: "legend", kind: "nativeText", label: "What the marks mean", value: "legend", style: "label" },
  )

  const column: PanelSceneLayoutNode[] = [
    { row: [{ control: "mode", flex: 1 }, { control: "utc" }], spacing: 8, crossAxisAlignment: "center" },
    { control: "header" },
    { control: "hint" },
    // Indented past the star button and its gap, to stand over the text of the rows.
    { control: "columns", padding: [60, 0, 60, 0] },
    ...rows.map((row, i): PanelSceneLayoutNode => ({
      row: [{ control: starId(row.name, i), width: 56 }, { control: rowKey(i), flex: 1 }, { control: openId(row.name, row.los, i), width: 56 }],
      spacing: 4,
      crossAxisAlignment: "center",
    })),
    { spacer: 1 },
    { row: [{ control: "prev" }, { control: "range", flex: 1 }, { control: "next" }], spacing: 8, crossAxisAlignment: "center" },
    { control: "legend" },
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

// --- One pass in detail -----------------------------------------------------

/// Names of the text lines under the plot (Sky tab), and on the radio page (Radio tab), which also
/// holds what AMSAT's reports say. The Sky tab keeps only the times: the plot is the point of it, and
/// it takes whatever room the lines under it leave.
export const timeKey = (i: number): string => `time${i}`
export const radioKey = (i: number): string => `radio${i}`
export const statusKey = (i: number): string => `status${i}`

/// What the detail scene's text controls and choices hold: the Sky tab and the Radio
/// tab have different lines, so only the shown tab's are named.
export function detailStrings(d: DetailModel): Record<string, string> {
  const strings: Record<string, string> = { title: d.title, tab: d.tab }
  if (d.tab === "sky") d.times.forEach((line, i) => (strings[timeKey(i)] = line))
  else {
    d.status.forEach((line, i) => (strings[statusKey(i)] = line))
    d.radio.forEach((line, i) => (strings[radioKey(i)] = line))
  }
  return strings
}

export const detailValues = (d: DetailModel): Record<string, number> => ({ utc: d.utc ? 1 : 0 })

export function buildDetailScene(d: DetailModel): PanelScene {
  const controls: PanelSceneControl[] = [
    { id: "back", kind: "nativeButton", label: "Back to the passes", icon: "arrow-left", variant: "text", event: "back" },
    { id: "title", kind: "nativeText", label: "Pass", value: "title", style: "title" },
    {
      id: "tab",
      kind: "nativeSegmented",
      label: "Page",
      value: "tab",
      event: "tab",
      options: [
        { label: "Sky", value: "sky" },
        { label: "Radio", value: "radio" },
      ],
    },
    { id: "utc", kind: "nativeSwitch", label: "UTC", value: "utc", event: "utc" },
  ]
  const head: PanelSceneLayoutNode[] = [
    { row: [{ control: "back", width: 56 }, { control: "title", flex: 1 }], spacing: 4, crossAxisAlignment: "center" },
    { row: [{ control: "tab", flex: 1 }, { control: "utc" }], spacing: 8, crossAxisAlignment: "center" },
  ]

  if (d.tab === "sky") {
    d.times.forEach((_, i) => controls.push({ id: timeKey(i), kind: "nativeText", label: ["Rise", "Peak", "Set"][i] ?? "Time", value: timeKey(i), style: "mono" }))
    return {
      version: 1,
      width: 360,
      height: 360,
      values: detailValues(d),
      strings: detailStrings(d),
      layers: [{ id: "sky", x: 0, y: 0, width: 360, height: 360, svg: d.sky.svg }, ...d.sky.compass, ...d.sky.labels, ...d.sky.readout],
      controls,
      layout: {
        column: [...head, { scene: true, flex: 1 }, ...d.times.map((_, i): PanelSceneLayoutNode => ({ control: timeKey(i) }))],
        padding: 12,
        spacing: 8,
        crossAxisAlignment: "stretch",
      },
    }
  }

  d.status.forEach((_, i) => controls.push({ id: statusKey(i), kind: "nativeText", label: i ? "Latest AMSAT report" : "AMSAT status reports", value: statusKey(i) }))
  d.radio.forEach((_, i) => controls.push({ id: radioKey(i), kind: "nativeText", label: `Radio line ${i + 1}`, value: radioKey(i), style: "mono" }))
  controls.push({ id: "links", kind: "nativeButton", label: "Links", icon: "open-in-new", variant: "tonal", event: "links" })
  return {
    version: 1,
    width: 360,
    height: 480,
    values: detailValues(d),
    strings: detailStrings(d),
    layers: [],
    controls,
    layout: {
      column: [
        ...head,
        ...d.status.map((_, i): PanelSceneLayoutNode => ({ control: statusKey(i) })),
        ...d.radio.map((_, i): PanelSceneLayoutNode => ({ control: radioKey(i) })),
        { spacer: 1 },
        { control: "links" },
      ],
      padding: 12,
      spacing: 4,
      crossAxisAlignment: "stretch",
    },
  }
}
