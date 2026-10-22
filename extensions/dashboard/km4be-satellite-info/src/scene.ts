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

/// The spacing of a scene, in logical pixels. The comfortable one is what the panel has always had
/// and is what a desktop pane gets. The compact one is for a small pane, where every row of the
/// list costs a thumb's reach of screen: tighter gaps, the buttons beside a row no taller than the
/// row, and narrower, so the text between them has the width of a phone.
export interface Density {
  /// The scene's padding all round.
  padding: number
  /// The gap between the lines of the scene, and the pager's and the headings' own.
  gap: number
  /// The gap inside a row, between a button and its text.
  rowGap: number
  /// The width of the star and open buttons, which is also the back button's.
  button: number
  /// A row's height; undefined leaves it to the buttons.
  rowHeight?: number
}

export const COMFORTABLE: Density = { padding: 12, gap: 8, rowGap: 4, button: 56 }
export const COMPACT: Density = { padding: 8, gap: 3, rowGap: 2, button: 44, rowHeight: 40 }

/// Which spacing a pane gets: what the `density` setting says, and for `auto`, compact when the pane is
/// narrower than a phone held upright is wide or shorter than a phone on its side, and
/// comfortable when it is not, or when the host does not say how big it is.
export function isCompact(config: Record<string, unknown> | undefined, pane: { width: number; height: number } | undefined): boolean {
  if (config?.density === "compact") return true
  if (config?.density === "comfortable") return false
  return !!pane && pane.width > 0 && pane.height > 0 && (pane.width < 480 || pane.height < 520)
}

const densityOf = (compact: boolean): Density => (compact ? COMPACT : COMFORTABLE)

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
  /// Whether the scene is laid out tightly, for a small pane.
  compact: boolean
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

/// Row `i`'s open-details control ids: the pass it opens is named in them, as the star's satellite is.
/// The row's text and the chevron at its end both open it, so each has its own `slot`.
export const openId = (name: string, los: number, slot: number | string): string => `${OPEN_PREFIX}${name}:${los}:${slot}`
export const rowOpenId = (name: string, los: number, i: number): string => openId(name, los, `row${i}`)

/// The pass an open control belongs to, or null when `id` is not one.
export function passOfOpen(id: string): { name: string; los: number } | null {
  if (!id.startsWith(OPEN_PREFIX)) return null
  const parts = id.slice(OPEN_PREFIX.length).split(":")
  const los = Number(parts[parts.length - 2])
  const name = parts.slice(0, -2).join(":")
  return name && Number.isFinite(los) ? { name, los } : null
}

export const rowKey = (i: number): string => `row${i}`

/// What the scene's text controls and choices hold. A row's text is shown as its button's label;
/// `row0`… keep it too, as the text of the page's rows.
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
      // The row's text is a button, so a tap anywhere on it opens the pass. A button binds no
      // value, so its text is its label, which the render after every event brings up to date.
      {
        id: rowOpenId(row.name, row.los, i),
        kind: "nativeButton",
        label: blank ? "No pass" : row.text,
        variant: "text",
        event: "open",
        ...(blank ? { opacity: 0, disabled: true } : {}),
      },
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

  const d = densityOf(m.compact)
  const column: PanelSceneLayoutNode[] = [
    { row: [{ control: "mode", flex: 1 }, { control: "utc" }], spacing: d.gap, crossAxisAlignment: "center" },
    { control: "header" },
    { control: "hint" },
    // Indented past the star button and its gap, to stand over the text of the rows.
    { control: "columns", padding: [d.button + d.rowGap, 0, d.button + d.rowGap, 0] },
    ...rows.map((row, i): PanelSceneLayoutNode => ({
      row: [{ control: starId(row.name, i), width: d.button }, { control: rowOpenId(row.name, row.los, i), flex: 1 }, { control: openId(row.name, row.los, i), width: d.button }],
      spacing: d.rowGap,
      crossAxisAlignment: "center",
      ...(d.rowHeight ? { height: d.rowHeight } : {}),
    })),
    { spacer: 1 },
    { row: [{ control: "prev" }, { control: "range", flex: 1 }, { control: "next" }], spacing: d.gap, crossAxisAlignment: "center", ...(d.rowHeight ? { height: d.rowHeight } : {}) },
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
    layout: { column, padding: d.padding, spacing: d.gap, crossAxisAlignment: "stretch" },
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
  const dense = densityOf(d.compact)
  const head: PanelSceneLayoutNode[] = [
    { row: [{ control: "back", width: dense.button }, { control: "title", flex: 1 }], spacing: dense.rowGap, crossAxisAlignment: "center" },
    { row: [{ control: "tab", flex: 1 }, { control: "utc" }], spacing: dense.gap, crossAxisAlignment: "center" },
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
        padding: dense.padding,
        spacing: dense.gap,
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
      padding: dense.padding,
      spacing: d.compact ? dense.rowGap : 4,
      crossAxisAlignment: "stretch",
    },
  }
}
