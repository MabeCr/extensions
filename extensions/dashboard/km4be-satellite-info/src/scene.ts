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
import type { Report } from "./report.ts"

export const PAGE_SIZE = 5

import type { Mode } from "./favorites.ts"
export type { Mode }

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
  /// The height of the back button and of the Sky / Radio / Report tabs on a pass's page, which are
  /// smaller than the buttons are drawn by default: the room is the sky plot's.
  headRow: number
}

export const COMFORTABLE: Density = { padding: 12, gap: 8, rowGap: 4, button: 56, headRow: 36 }
export const COMPACT: Density = { padding: 8, gap: 3, rowGap: 2, button: 44, rowHeight: 40, headRow: 32 }

export const DEFAULT_SKY_PERCENT = 100
export const MIN_SKY_PERCENT = 40

/// How large the sky plot is wanted, as a percent of the most the pane allows: the `skySize` setting, from
/// 40 to 100, and 100 for anything else.
export function skyPercent(config: Record<string, unknown> | undefined): number {
  const v = config?.skySize
  return typeof v === "number" && Number.isFinite(v) ? Math.min(DEFAULT_SKY_PERCENT, Math.max(MIN_SKY_PERCENT, Math.round(v))) : DEFAULT_SKY_PERCENT
}

/// Which spacing a pane gets: what the `density` setting says, and for `auto`, compact when the pane is
/// narrower than a phone held upright is wide or shorter than a phone on its side, and
/// comfortable when it is not, or when the host does not say how big it is.
export function isCompact(config: Record<string, unknown> | undefined, pane: { width: number; height: number } | undefined): boolean {
  if (config?.density === "compact") return true
  if (config?.density === "comfortable") return false
  return !!pane && pane.width > 0 && pane.height > 0 && (pane.width < 480 || pane.height < 520)
}

const densityOf = (compact: boolean): Density => (compact ? COMPACT : COMFORTABLE)

/// How the list is drawn: the room it has, and the monospaced face the host says it sets text in.
export interface ListLook {
  /// The width of the list's artwork, in logical pixels: the pane less its padding, so that the artwork is not scaled.
  width: number
  /// The monospaced font, and its size before and after the operator's text scaling.
  family: string
  size: number
  os: number
  /// The rows' color and the titles'.
  text: string
  title: string
}

export const DEFAULT_LOOK: ListLook = { width: 520, family: "monospace", size: 13, os: 1, text: "#4a90d9", title: "#8a8a8a" }

/// The list's look from what the host reports of the pane. Without a report it is a phone-wide list in a
/// size most monospaced faces fit.
export function listLook(environment: { width: number; colors?: Record<string, string>; typography?: { mono?: { fontFamily: string | null; fontSize: number; scaledFontSize: number } } } | undefined, compact: boolean): ListLook {
  if (!environment) return DEFAULT_LOOK
  const mono = environment.typography?.mono
  const size = mono && mono.fontSize > 0 ? mono.fontSize : DEFAULT_LOOK.size
  return {
    width: environment.width > 0 ? Math.floor(environment.width - 2 * densityOf(compact).padding) : DEFAULT_LOOK.width,
    family: mono?.fontFamily || DEFAULT_LOOK.family,
    size,
    os: mono && mono.fontSize > 0 && mono.scaledFontSize > 0 ? mono.scaledFontSize / mono.fontSize : 1,
    text: environment.colors?.primary ?? DEFAULT_LOOK.text,
    title: environment.colors?.onSurfaceVariant ?? DEFAULT_LOOK.title,
  }
}

/// How much of a monospaced face's size one character takes across. Faces run from 0.6 to a little over, and the check
/// mark and the arrow in a line come from other faces and can be wider, so a line is allowed a character more than it has.
const CHAR_RATIO = 0.62
export const MIN_ROW_SIZE = 10

/// The largest size, in the font's own units, that a line of `chars` characters can be set in across the room a row has,
/// and no larger than the face's own. It can come out below `MIN_ROW_SIZE`, which says the line does not fit at a size that
/// can be read; `rowSize` is what to draw in then.
export function fitSize(chars: number, look: ListLook, compact: boolean): number {
  const room = look.width - 2 * densityOf(compact).button - 4
  const fits = Math.floor((room / ((chars + 1) * CHAR_RATIO * look.os)) * 2) / 2
  return Math.min(look.size, fits)
}

/// The size to draw a line in: the fit, but not so small that it cannot be read, in which case it is cut off instead.
export const rowSize = (fit: number): number => Math.max(MIN_ROW_SIZE, fit)

/// How tall a row of the list is, and the titles over them, in logical pixels.
export const rowHeightOf = (compact: boolean): number => (compact ? 36 : 44)
export const titleHeightOf = (size: number, os: number): number => Math.ceil(size * os * 1.3) + 6

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
  /// How the list is drawn, and the size its text is set in, which is what lets a line fit.
  look: ListLook
  size: number
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

/// The list is one block of artwork: the column titles and the rows, drawn in the monospaced face at one size that fits,
/// each row with an invisible hit area over it, so that a tap anywhere on the line opens the pass, and the star and the
/// chevron beside it as buttons at its ends. A button's label is set in the proportional face, centered and padded, so
/// rows made of buttons could not line up under titles in another face, nor fit; drawn here, they do both.
export function buildScene(m: Model): PanelScene {
  const controls: PanelSceneControl[] = [
    {
      id: "mode",
      kind: "nativeSegmented",
      label: "Passes to show",
      value: "mode",
      event: "mode",
      options: [
        { label: "All", value: "all" },
        { label: "Favorites", value: "favorites" },
      ],
    },
    { id: "utc", kind: "nativeSwitch", label: "UTC", value: "utc", event: "utc" },
    { id: "header", kind: "nativeText", label: "Location and satellites", value: "header", style: "label" },
    { id: "hint", kind: "nativeText", label: "Note", value: "hint" },
  ]

  const d = densityOf(m.compact)
  const L = m.look
  const W = L.width
  const rowH = rowHeightOf(m.compact)
  const titleH = titleHeightOf(m.size, L.os)
  const H = titleH + PAGE_SIZE * rowH
  const lineH = Math.ceil(m.size * L.os * 1.3)
  const textX = d.button + 2
  const layerText = (value: string, color: string) => ({ value, size: m.size, color, fontFamily: L.family, lineHeight: 1.3 })

  const layers: PanelScene["layers"] = [{ id: "columns", x: textX, y: 2, width: W - textX - d.button, height: titleH - 2, text: layerText("columns", L.title) }]
  const rows = slots(m)
  rows.forEach((row, i) => {
    const blank = row === BLANK
    const y = titleH + i * rowH
    layers.push({ id: rowKey(i), x: textX, y: y + Math.floor((rowH - lineH) / 2), width: W - textX - d.button, height: lineH, text: layerText(rowKey(i), L.text) })
    controls.push(
      {
        id: starId(row.name, i),
        kind: "nativeButton",
        label: blank ? "No pass" : row.favorite ? `Stop following ${row.name}` : `Follow ${row.name}`,
        icon: row.favorite ? "star" : "star-outline",
        variant: "text",
        event: "star",
        x: 0,
        y,
        width: d.button,
        height: rowH,
        // A blank slot keeps its place in the layout but takes no taps and is not read out.
        ...(blank ? { opacity: 0, disabled: true } : {}),
      },
      // The whole line, between the star and the chevron: a tap anywhere on it opens the pass.
      {
        id: rowOpenId(row.name, row.los, i),
        kind: "button",
        label: blank ? "No pass" : `Open the ${row.name} pass`,
        event: "open",
        x: d.button,
        y,
        width: W - 2 * d.button,
        height: rowH,
        ...(blank ? { opacity: 0, disabled: true } : {}),
      },
      {
        id: openId(row.name, row.los, i),
        kind: "nativeButton",
        label: blank ? "No pass" : `Details of the ${row.name} pass`,
        icon: "chevron-right",
        variant: "text",
        event: "open",
        x: W - d.button,
        y,
        width: d.button,
        height: rowH,
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
    { row: [{ control: "mode", flex: 1 }, { control: "utc" }], spacing: d.gap, crossAxisAlignment: "center" },
    { control: "header" },
    { control: "hint" },
    { scene: true, height: H },
    { spacer: 1 },
    { row: [{ control: "prev" }, { control: "range", flex: 1 }, { control: "next" }], spacing: d.gap, crossAxisAlignment: "center", ...(d.rowHeight ? { height: d.rowHeight } : {}) },
    { control: "legend" },
  ]

  return {
    version: 1,
    // The artwork is as wide as the pane's room, so it is drawn as it is, not scaled.
    width: W,
    height: H,
    values: valuesOf(m),
    strings: stringsOf(m),
    layers,
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

/// The line under the plot that says how to use the slider over it.
export const SCRUB_HINT = "Scrub across the sky chart for details, then tap Reset to clear it."

export const detailValues = (d: DetailModel): Record<string, number> => ({ utc: d.utc ? 1 : 0, ...tabValues(d.tab) })

/// The pages of a pass, in the order of their tabs.
export const TABS = [
  { label: "Sky", value: "sky" },
  { label: "Radio", value: "radio" },
  { label: "Report", value: "report" },
] as const

/// The name of a tab's chip, which is also the name of the value that says whether it is the page shown.
export const tabId = (page: string): string => `tab_${page}`

/// One for the page shown and no other.
const tabValues = (shown: string): Record<string, number> => Object.fromEntries(TABS.map((t) => [tabId(t.value), t.value === shown ? 1 : 0]))

/// The top of a pass's page, the same on all of its tabs: back, the title, the tabs and the UTC switch.
function detailHead(compact: boolean): { controls: PanelSceneControl[]; head: PanelSceneLayoutNode[] } {
  const dense = densityOf(compact)
  return {
    controls: [
      { id: "back", kind: "nativeButton", label: "Back to the passes", icon: "arrow-left", variant: "text", event: "back" },
      { id: "title", kind: "nativeText", label: "Pass", value: "title", style: "title" },
      // Chips, not a segmented button: a chip is as low as these are wanted and sets its own text in the middle,
      // where a segmented button squeezed to that height has its text sit low. The chosen page's chip is lit.
      ...TABS.map(
        (t): PanelSceneControl => ({ id: tabId(t.value), kind: "nativeChip", label: t.label, value: tabId(t.value), event: `tab-${t.value}` }),
      ),
      { id: "utc", kind: "nativeSwitch", label: "UTC", value: "utc", event: "utc" },
    ],
    head: [
      { row: [{ control: "back", width: dense.button, height: dense.headRow }, { control: "title", flex: 1 }], spacing: dense.rowGap, crossAxisAlignment: "center", height: dense.headRow },
      { row: [...TABS.map((t) => ({ control: tabId(t.value) })), { spacer: 1 }, { control: "utc" }], spacing: dense.gap, crossAxisAlignment: "center", height: dense.headRow },
    ],
  }
}

/// The side of the sky plot, in logical pixels: all the width there is, or, in a pane too short for that, all the
/// height left under the back button and the tabs, and then the share of that the `skySize` setting asks for: at
/// 100 the plot never gives up room to the lines of text under it, which are cut off instead, and a smaller plot
/// leaves them room. Undefined when the host does not say how big the pane is, and then the plot takes what is left.
export function plotSide(d: DetailModel, dense: Density): number | undefined {
  if (!d.pane) return undefined
  const head = 2 * dense.headRow + 2 * dense.gap
  const most = Math.max(120, Math.floor(Math.min(d.pane.width - 2 * dense.padding, d.pane.height - 2 * dense.padding - head)))
  return Math.floor((most * (d.skyPercent ?? DEFAULT_SKY_PERCENT)) / 100)
}

export function buildDetailScene(d: DetailModel): PanelScene {
  const { controls, head } = detailHead(d.compact)
  const dense = densityOf(d.compact)

  if (d.tab === "sky") {
    const side = plotSide(d, dense)
    if (d.scrub) controls.push({ id: "scrubHint", kind: "nativeText", label: SCRUB_HINT, style: "label", align: "center" })
    d.times.forEach((_, i) => controls.push({ id: timeKey(i), kind: "nativeText", label: ["Rise", "Peak", "Set"][i] ?? "Time", value: timeKey(i), style: "mono" }))
    return {
      version: 1,
      width: 360,
      height: 360,
      // The slider rests one past the pass's last moment, where the plot shows what it always did.
      values: { ...detailValues(d), ...(d.scrub ? { scrub: d.scrub.rest } : {}) },
      strings: detailStrings(d),
      layers: [{ id: "sky", x: 0, y: 0, width: 360, height: 360, svg: d.sky.svg }, ...d.sky.compass, ...d.sky.labels, ...d.sky.readout, ...(d.scrub?.layers ?? [])],
      controls: d.scrub ? [...controls, d.scrub.control, d.scrub.reset] : controls,
      layout: {
        column: [...head, side ? { scene: true, height: side } : { scene: true, flex: 1 }, ...(d.scrub ? [{ control: "scrubHint" }] : []), ...d.times.map((_, i): PanelSceneLayoutNode => ({ control: timeKey(i) }))],
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

// --- Telling AMSAT what was heard ----------------------------------------------

export interface ReportModel {
  title: string
  utc: boolean
  compact: boolean
  /// The transponders AMSAT's form offers for this satellite, as the form names them.
  variants: { label: string; value: string }[]
  variant: string
  /// The kind of report chosen, or empty.
  kind: string
  call: string
  grid: string
  /// What is about to be sent, or why it cannot be.
  summary: string
  /// What happened to the last report, or empty.
  message: string
  /// Whether the report can be sent now.
  ready: boolean
  /// Whether the operator has asked to send and been asked to be sure.
  confirming: boolean
  /// What would be sent, when it can be.
  report: Report | null
}

export const reportStrings = (r: ReportModel): Record<string, string> => ({
  title: r.title,
  tab: "report",
  variant: r.variant,
  kind: r.kind,
  call: r.call,
  grid: r.grid,
  summary: r.summary,
  message: r.message,
})

export const reportValues = (r: ReportModel): Record<string, number> => ({ utc: r.utc ? 1 : 0, ...tabValues("report") })

export function buildReportScene(r: ReportModel): PanelScene {
  const { controls, head } = detailHead(r.compact)
  const dense = densityOf(r.compact)
  controls.push(
    { id: "variant", kind: "nativeDropdown", label: "Transponder", value: "variant", event: "variant", options: r.variants },
    {
      id: "kind",
      kind: "nativeSegmented",
      label: "What you heard",
      value: "kind",
      event: "kind",
      options: [
        { label: "Heard", value: "heard" },
        { label: "Telemetry", value: "telemetry" },
        { label: "Not heard", value: "notHeard" },
      ],
    },
    { id: "call", kind: "nativeTextField", label: "Your callsign", value: "call", event: "call", placeholder: "Callsign" },
    { id: "grid", kind: "nativeTextField", label: "Your grid square (optional)", value: "grid", event: "grid", placeholder: "Grid square, optional" },
    { id: "summary", kind: "nativeText", label: "What will be sent", value: "summary" },
    { id: "message", kind: "nativeText", label: "Result", value: "message" },
  )
  const buttons: PanelSceneLayoutNode[] = r.confirming
    ? (controls.push(
        { id: "confirm", kind: "nativeButton", label: "Yes, send it", icon: "send", variant: "filled", event: "confirm" },
        { id: "cancel", kind: "nativeButton", label: "Cancel", variant: "text", event: "cancel" },
      ),
      [{ row: [{ control: "cancel", flex: 1 }, { control: "confirm", flex: 1 }], spacing: dense.gap, crossAxisAlignment: "center" }])
    : (controls.push({ id: "send", kind: "nativeButton", label: "Send to AMSAT", icon: "send", variant: "filled", event: "send", disabled: !r.ready }), [{ control: "send" }])
  return {
    version: 1,
    width: 360,
    height: 480,
    values: reportValues(r),
    strings: reportStrings(r),
    layers: [],
    controls,
    layout: {
      column: [...head, { control: "variant" }, { control: "kind" }, { control: "call" }, { control: "grid" }, { control: "summary" }, { control: "message" }, { spacer: 1 }, ...buttons],
      padding: dense.padding,
      spacing: dense.gap,
      crossAxisAlignment: "stretch",
    },
  }
}
