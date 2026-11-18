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

import { MAP_KEY } from "./map.ts"
import type { DetailModel } from "./detail.ts"
import type { Report } from "./report.ts"
import type { Kind } from "./status.ts"
import { proseOf } from "./wrap.ts"
import type { Room } from "./wrap.ts"

/// The most passes the list holds. Each row is two controls (the star, and the hit area over the line) and three layers
/// (its text, the mark, the chevron), and a scene holds 256 controls and 512 layers: so many rows is as many as fit, with
/// the header's few besides. A day's passes do not come to so many but at a minimum elevation of 0.
export const MAX_ROWS = 110

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
  /// The rows' color, the color of a pass that is up now, and the titles'.
  text: string
  live: string
  title: string
  /// The pane's height, and its surface color: the header and the key are drawn over the rows as they scroll under them,
  /// on the surface, so that the rows do not show through.
  height: number
  surface: string
  /// What one line of the host's own label and body text takes, with the operator's text scaling.
  lineLabel: number
  lineBody: number
}

/// Panes are measured while the host is still laying them out, and can say they are a sliver for a moment. The geometry is worked out
/// for no less than this, since a width under about 125 pixels leaves a row no room for its text, and the app refuses a rect with a
/// size below zero, and the whole scene with it. The next render, with the pane's real size, replaces it.
export const MIN_PANE_WIDTH = 160
export const MIN_PANE_HEIGHT = 200

export const DEFAULT_LOOK: ListLook = {
  width: 520,
  family: "monospace",
  size: 13,
  os: 1,
  text: "#4a90d9",
  live: "#43a047",
  title: "#8a8a8a",
  height: 560,
  surface: "#1a1d21",
  lineLabel: 18,
  lineBody: 20,
}

/// The list's look from what the host reports of the pane. Without a report it is a phone-wide list in a
/// size most monospaced faces fit.
type Typeface = { fontFamily: string | null; fontSize: number; scaledFontSize: number }
export function listLook(
  environment: { width: number; height?: number; colors?: Record<string, string>; typography?: { mono?: Typeface; label?: Typeface; body?: Typeface } } | undefined,
  compact: boolean,
): ListLook {
  if (!environment) return DEFAULT_LOOK
  const mono = environment.typography?.mono
  const line = (face: Typeface | undefined, fallback: number): number => (face && face.scaledFontSize > 0 ? Math.ceil(face.scaledFontSize * 1.4) : fallback)
  const size = mono && mono.fontSize > 0 ? mono.fontSize : DEFAULT_LOOK.size
  return {
    width: environment.width > 0 ? Math.floor(Math.max(environment.width, MIN_PANE_WIDTH) - 2 * densityOf(compact).padding) : DEFAULT_LOOK.width,
    family: mono?.fontFamily || DEFAULT_LOOK.family,
    size,
    os: mono && mono.fontSize > 0 && mono.scaledFontSize > 0 ? mono.scaledFontSize / mono.fontSize : 1,
    text: environment.colors?.primary ?? DEFAULT_LOOK.text,
    live: DEFAULT_LOOK.live,
    title: environment.colors?.onSurfaceVariant ?? DEFAULT_LOOK.title,
    height: environment.height && environment.height > 0 ? Math.floor(Math.max(environment.height, MIN_PANE_HEIGHT)) : DEFAULT_LOOK.height,
    surface: environment.colors?.surface ?? DEFAULT_LOOK.surface,
    lineLabel: line(environment.typography?.label, DEFAULT_LOOK.lineLabel),
    lineBody: line(environment.typography?.body, DEFAULT_LOOK.lineBody),
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
  // The title of the marks' column reaches over the end of the text by as much as it is wider than the icons, less the gap.
  const reach = Math.max(0, Math.ceil(markTitleWidth(look.size, look.os) / 2 - markSize(compact) / 2) - 4)
  const room = look.width - densityOf(compact).button - CHEVRON - 4 - markColumn(compact) - reach
  const fits = Math.floor((room / ((chars + 1) * CHAR_RATIO * look.os)) * 2) / 2
  return Math.min(look.size, fits)
}

/// The room the chevron at the end of a row takes. It is an icon only: the whole line is the hit area.
export const CHEVRON = 32

/// The title over the column of marks. It is wider than the icons under it, and centered on them, so it reaches over the end of the
/// text on its left, which has to leave it room.
export const MARK_TITLE = "Status"
const markTitleWidth = (size: number, os: number): number => Math.ceil(MARK_TITLE.length * size * os * CHAR_RATIO) + 6

/// The report marks are drawn as icons in a column of their own, between the line and the chevron.
export const markSize = (compact: boolean): number => (compact ? 16 : 18)
export const markColumn = (compact: boolean): number => markSize(compact) + 8

/// What each kind of AMSAT report looks like: an icon, and a color that reads on a light or a dark pane.
export const MARKS: Record<Kind, { icon: string; color: string; label: string }> = {
  heard: { icon: "check-circle", color: "#43a047", label: "heard" },
  telemetry: { icon: "circle-half-full", color: "#f9a825", label: "telemetry only" },
  notHeard: { icon: "close-circle", color: "#e53935", label: "not heard" },
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
  /// What AMSAT's reports say of the satellite, drawn as an icon at the end of the line; null when they say nothing.
  mark: Kind | null
  /// Whether the pass is under way, which is drawn in its own color.
  live: boolean
  /// When the pass ends, which with the name says which pass the row is (a pass's end is
  /// steady from one working-out to the next; its start, when under way, is not).
  los: number
}

/// Everything a render, and an event's answer, is made from.
export interface Model {
  header: string
  /// The line under the header: what is up and what is next, or why the list is empty.
  hint: string
  mode: Mode
  utc: boolean
  /// The titles over the rows' columns, set to line up with them; "" when there are no rows.
  columns: string
  /// Whether there are rows, and so titles over them and a key to the marks under them.
  legend: boolean
  /// Whether the scene is laid out tightly, for a small pane.
  compact: boolean
  /// Every pass in the list, up to `MAX_ROWS`: the pane scrolls through them.
  rows: Row[]
  /// How many passes there were past the last row.
  more: number
  /// How the list is drawn, and the size its text is set in, which is what lets a line fit.
  look: ListLook
  size: number
  /// How far down the list is scrolled, in scene units.
  scroll: number
}

/// The choices of the switch over the list, in the order they are drawn: All on the left.
export const MODE_OPTIONS = [
  { label: "All", value: "all" },
  { label: "Favorites", value: "favorites" },
  { label: "Up Now", value: "now" },
]

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

/// What the scene's text controls and choices hold: the words over the list, the titles, and the text of each row.
export function stringsOf(m: Model): Record<string, string> {
  const strings: Record<string, string> = { mode: m.mode, header: m.header, hint: m.hint, columns: m.columns }
  m.rows.forEach((row, i) => {
    strings[rowKey(i)] = row.text
  })
  return strings
}

export const valuesOf = (m: Model): Record<string, number> => ({ utc: m.utc ? 1 : 0, scroll: m.scroll })

/// The key to the marks, as the marks themselves: each icon with what it says, in a line under the rows. In a pane too
/// narrow for the whole words they are shortened, and in one too narrow for those it starts at the pane's edge, under the
/// star, and keeps its gaps small.
function keyLayers(m: Model, x0: number, y: number, icon: number, lineH: number, width: number): PanelScene["layers"] {
  const charW = m.size * m.look.os * CHAR_RATIO
  const kinds: Kind[] = ["heard", "telemetry", "notHeard"]
  const short: Record<Kind, string> = { heard: "heard", telemetry: "telemetry", notHeard: "not heard" }
  const widthOf = (labels: Record<Kind, string>, gap: number) => kinds.reduce((n, k) => n + icon + 4 + Math.ceil(labels[k].length * charW) + 4 + gap, 0) - gap
  const full: Record<Kind, string> = { heard: MARKS.heard.label, telemetry: MARKS.telemetry.label, notHeard: MARKS.notHeard.label }
  const fits = (start: number, labels: Record<Kind, string>, gap: number) => start + widthOf(labels, gap) <= width - 4
  // The roomiest way that fits, and the tightest when none does.
  const way = fits(x0, full, 14)
    ? { start: x0, labels: full, gap: 14 }
    : fits(x0, short, 14)
      ? { start: x0, labels: short, gap: 14 }
      : fits(4, short, 10)
        ? { start: 4, labels: short, gap: 10 }
        : { start: 4, labels: short, gap: 6 }
  const { labels, gap } = way
  const layers: PanelScene["layers"] = []
  let x = way.start
  for (const k of kinds) {
    layers.push({ id: `key-${k}`, x, y: y + Math.floor((lineH + 4 - icon) / 2), width: icon, height: icon, fixed: true, icon: { name: MARKS[k].icon, color: MARKS[k].color } })
    const w = Math.ceil(labels[k].length * charW) + 4
    layers.push({ id: `keyText-${k}`, x: x + icon + 4, y, width: w, height: lineH + 4, fixed: true, text: { literal: labels[k], size: m.size, color: m.look.title, fontFamily: m.look.family, lineHeight: 1.3 } })
    x += icon + 4 + w + gap
  }
  return layers
}

/// The list is a scene that scrolls, every pass of the day in it. The header, which has the chips and the switch, the two
/// lines of words and the titles of the columns, is fixed at the top of the pane, and the key to the marks is fixed at the
/// bottom, each on a background of the pane's own color that takes the touches, so that the rows pass under them and are
/// neither seen nor reached through them. A row is its text, its mark and a chevron drawn as layers, and two controls: the
/// star at its start, and a hit area over the rest of the line, so that a tap anywhere on it opens the pass. A button's own
/// label is set in the proportional face, centered and padded, so rows made of buttons could not line up under titles in
/// another face, nor fit; drawn here, they do both.
const SWITCH_WIDTH = 112

export function buildScene(m: Model): PanelScene {
  const d = densityOf(m.compact)
  const L = m.look
  const pad = d.padding
  const W = L.width + 2 * pad
  const rowH = rowHeightOf(m.compact)
  const lineH = Math.ceil(m.size * L.os * 1.3)
  const titleH = titleHeightOf(m.size, L.os)
  const icon = markSize(m.compact)
  const charW = m.size * L.os * CHAR_RATIO

  // The header, from the top: the chips and the switch, the line about the place, the line about what is up and next
  // (which may take two), and the titles of the columns.
  const modeH = m.compact ? 44 : 52
  const headerY = pad + modeH + d.gap
  const hintY = headerY + L.lineLabel + 2
  // One line for it, or two when the words are long enough to wrap: an estimate from the length of the text and the size of the
  // host's body face (about half its size across to a character, a little more to be safe), since the control keeps to its box.
  const bodyPx = L.lineBody / 1.4
  const hintLines = Math.min(2, Math.max(1, Math.ceil((m.hint.length * bodyPx * 0.55) / (W - 2 * pad))))
  const hintH = L.lineBody * hintLines
  const titleY = hintY + hintH + d.gap
  const headH = titleY + titleH
  // The key, from the bottom; the scroll runs on past the last row by as much, so that the last row can be brought clear of it.
  const footH = m.legend ? lineH + 14 : 0
  const contentH = headH + m.rows.length * rowH + footH + pad
  const H = Math.max(contentH, L.height)
  const footY = L.height - footH

  const textX = pad + d.button + 2
  // The marks are a column of icons after the text, as near it as the text allows, and no further than the chevron.
  // In a wide pane they would otherwise be a hand's breadth from the rows they belong to.
  const chars = Math.max(m.columns.length, ...m.rows.map((r) => r.text.length))
  const textEnd = textX + Math.ceil((chars + 1) * charW)
  const markX = Math.min(W - pad - CHEVRON - icon - 6, textEnd + 18)
  const titleW = markTitleWidth(m.size, L.os)
  const textW = markX - textX - 4
  const chevronX = W - pad - icon - 8
  const layerText = (value: string, color: string) => ({ value, size: m.size, color, fontFamily: L.family, lineHeight: 1.3 })
  const background = (height: number) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}"><rect width="${W}" height="${height}" fill="${L.surface}"/></svg>`

  const layers: PanelScene["layers"] = []
  const controls: PanelSceneControl[] = []

  // The rows, which scroll. Each control is placed directly after its row's text, so that the header and the key, drawn
  // later, are over it.
  m.rows.forEach((row, i) => {
    const y = headH + i * rowH
    layers.push({ id: rowKey(i), x: textX, y: y + Math.floor((rowH - lineH) / 2), width: textW, height: lineH, text: layerText(rowKey(i), row.live ? L.live : L.text) })
    if (row.mark) {
      const mark = MARKS[row.mark]
      layers.push({ id: `mark${i}`, x: markX, y: y + Math.floor((rowH - icon) / 2), width: icon, height: icon, icon: { name: mark.icon, color: mark.color } })
    }
    layers.push({ id: `chevron${i}`, x: chevronX, y: y + Math.floor((rowH - icon) / 2), width: icon, height: icon, icon: { name: "chevron-right", color: L.title } })
    controls.push(
      {
        id: starId(row.name, i),
        kind: "nativeButton",
        label: row.favorite ? `Stop following ${row.name}` : `Follow ${row.name}`,
        icon: row.favorite ? "star" : "star-outline",
        variant: "text",
        event: "star",
        x: pad,
        y,
        width: d.button,
        height: rowH,
        after: rowKey(i),
      },
      // The whole line, between the star and the end of the row: a tap anywhere on it opens the pass.
      {
        id: rowOpenId(row.name, row.los, i),
        kind: "button",
        label: `Open the ${row.name} pass`,
        event: "open",
        x: pad + d.button,
        y,
        width: W - 2 * pad - d.button,
        height: rowH,
        after: rowKey(i),
      },
    )
  })

  // The header, which stays: its background first, over the rows, then what is on it.
  layers.push({ id: "headBg", x: 0, y: 0, width: W, height: headH, fixed: true, blocksPointer: true, svg: background(headH) })
  layers.push({ id: "columns", x: textX, y: titleY + 2, width: textW, height: titleH - 2, fixed: true, text: layerText("columns", L.title) })
  if (m.legend) {
    // The title of the marks' column, centered over them.
    layers.push({ id: "markTitle", x: markX + icon / 2 - titleW / 2, y: titleY + 2, width: titleW, height: titleH - 2, fixed: true, text: { literal: MARK_TITLE, size: m.size, color: L.title, fontFamily: L.family, lineHeight: 1.3, align: "center" } })
    layers.push({ id: "footBg", x: 0, y: footY, width: W, height: footH, fixed: true, blocksPointer: true, svg: background(footH) })
    layers.push(...keyLayers(m, textX, footY + 6, icon, lineH, W - pad))
  }

  controls.push(
    {
      id: "mode",
      kind: "nativeSegmented",
      label: "Passes to show",
      value: "mode",
      event: "mode",
      options: MODE_OPTIONS,
      x: pad,
      y: pad,
      width: W - 3 * pad - SWITCH_WIDTH,
      height: modeH,
      fixed: true,
    },
    { id: "utc", kind: "nativeSwitch", label: "UTC", value: "utc", event: "utc", x: W - pad - SWITCH_WIDTH, y: pad, width: SWITCH_WIDTH, height: modeH, fixed: true },
    { id: "header", kind: "nativeText", label: "Location and satellites", value: "header", style: "label", x: pad, y: headerY, width: W - 2 * pad, height: L.lineLabel, fixed: true },
    { id: "hint", kind: "nativeText", label: "Note", value: "hint", x: pad, y: hintY, width: W - 2 * pad, height: hintH, fixed: true },
  )

  return {
    version: 1,
    // As wide as the pane, so that it is drawn as it is; as long as the list, which the pane scrolls through.
    width: W,
    height: H,
    values: valuesOf(m),
    strings: stringsOf(m),
    layers,
    controls,
    scroll: { axis: "y", value: "scroll", event: "scrolled" },
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
  const put = (key: string, text: string): void => {
    strings[key] = text
  }
  if (d.tab === "sky") d.times.forEach((line, i) => (strings[timeKey(i)] = line))
  else if (d.tab === "map") put("mapKey", mapKeyText(d))
  else {
    d.status.forEach((line, i) => put(statusKey(i), line))
    d.radio.forEach((line, i) => put(radioKey(i), line))
    put("trackLine", trackLineOf(d))
    strings.uplinkRadio = d.tracking?.uplink ?? ""
    put("rotorLine", d.tracking?.rotorLine || "Points the station's rotator at the satellite: where it will rise, then along the pass.")
    strings.rotator = d.tracking?.rotator ?? ""
    put("fillLine", d.tracking?.fillLine ?? "")
  }
  return strings
}

/// The line under the map that says what is on it, or why there is no map.
const mapKeyText = (d: DetailModel): string => (d.map ? MAP_KEY : "There is no orbit for this satellite, so its track cannot be drawn.")

/// What the Radio page says of Doppler tracking: what it is doing, or, off, what the switch would do.
export const trackLineOf = (d: DetailModel): string =>
  d.tracking?.on ? d.tracking.line : d.tracking?.line || "Keeps the logging radio on the downlink as the satellite moves. Tune across the transponder and it follows you."

/// The line under the plot that says how to use the slider over it.
export const SCRUB_HINT = "Scrub across the sky chart for details, then tap Reset to clear it."

export const detailValues = (d: DetailModel): Record<string, number> => ({ utc: d.utc ? 1 : 0, track: d.tracking?.on ? 1 : 0, rotate: d.tracking?.rotorOn ? 1 : 0, fill: d.tracking?.fillOn ? 1 : 0, ...tabValues(d.tab) })

/// The pages of a pass, in the order of their tabs.
export const TABS = [
  { label: "Sky", value: "sky" },
  { label: "Map", value: "map" },
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

/// One line of a page, and the height it takes.
interface Child {
  node: PanelSceneLayoutNode
  height: number
}

const ROTOR_HINT = "Points the station's rotator at the satellite: where it will rise, then along the pass."

/// The slot a scrolling page is built of, in logical pixels tall; a line spans as many as its height takes.
const SLOT = 8
/// The most columns of slots across, which with the lines of a page keeps within what the app allows a scene's grids.
const MAX_SLOT_COLUMNS = 48
const MAX_SLOTS = 12_000

/// A page of lines as a grid whose slots are one line's width across, which the app scrolls itself when the page is longer
/// than the pane, as a column is not (a phone on its side shows the top of it and no more). Undefined where the pane's size
/// is not known, or the page would be too many slots, and then the page is a column.
function scrolling(children: Child[], d: { pane?: { width: number; height: number }; compact: boolean }, dense: Density): PanelSceneLayoutNode | undefined {
  if (!d.pane) return undefined
  const room = d.pane.width - 2 * dense.padding
  const unitW = Math.max(SLOT, Math.ceil(room / MAX_SLOT_COLUMNS))
  // A column short of the room, so that a pane's padding counted another way never refuses the scene.
  const columns = Math.floor(room / unitW) - 1
  if (columns < 4) return undefined
  const gap = d.compact ? dense.rowGap : 4
  const sized = children.map((c) => ({ node: c.node, rows: Math.max(1, Math.ceil((c.height + gap) / SLOT)) }))
  if (sized.reduce((n, c) => n + c.rows * columns, 0) > MAX_SLOTS) return undefined
  return {
    grid: sized.map((c) => ({ ...c.node, span: [columns, c.rows] })),
    unit: [unitW, SLOT],
    gap: 0,
    columns,
    padding: dense.padding,
  }
}

export function buildDetailScene(d: DetailModel): PanelScene {
  const { controls, head } = detailHead(d.compact)
  const dense = densityOf(d.compact)

  if (d.tab === "sky") {
    const side = plotSide(d, dense)
    if (d.scrub) controls.push({ id: "scrubHint", kind: "nativeText", label: SCRUB_HINT, style: "label", align: "center" })
    // While the radio is being kept on the satellite, the Sky page says where, so the plot can stay in front.
    const lines = [d.tracking?.on ? d.tracking.line : "", d.tracking?.rotorOn ? (d.tracking.rotorLine ?? "") : ""].filter(Boolean)
    const tracking = lines.length > 0
    if (tracking) controls.push({ id: "trackSky", kind: "nativeText", label: lines.join("\n"), style: "mono", align: "center" })
    d.times.forEach((_, i) => controls.push({ id: timeKey(i), kind: "nativeText", label: ["Rise", "Peak", "Set"][i] ?? "Time", value: timeKey(i), style: "mono" }))
    return {
      version: 1,
      width: 360,
      height: 360,
      // The slider rests one past the pass's last moment, where the plot shows what it always did.
      values: { ...detailValues(d), ...(d.scrub ? { scrub: d.scrub.rest } : {}) },
      strings: detailStrings(d),
      layers: [{ id: "sky", x: 0, y: 0, width: 360, height: 360, svg: d.sky.svg }, ...(d.sky.satellite ? [d.sky.satellite] : []), ...d.sky.compass, ...d.sky.labels, ...d.sky.readout, ...(d.scrub?.layers ?? [])],
      controls: d.scrub ? [...controls, d.scrub.control, d.scrub.reset] : controls,
      layout: {
        column: [...head, side ? { scene: true, height: side } : { scene: true, flex: 1 }, ...(tracking ? [{ control: "trackSky" }] : []), ...(d.scrub ? [{ control: "scrubHint" }] : []), ...d.times.map((_, i): PanelSceneLayoutNode => ({ control: timeKey(i) }))],
        padding: dense.padding,
        spacing: dense.gap,
        crossAxisAlignment: "stretch",
      },
    }
  }

  if (d.tab === "map") {
    if (d.map) controls.push(d.map)
    // The caption is a text control a line long, so a long one is a run of words the app wraps.
    const caption = proseOf("mapKey", mapKeyText(d), "What the map shows", "label", d.columns)
    controls.push(...caption.controls)
    return {
      version: 1,
      width: 360,
      height: 480,
      values: detailValues(d),
      strings: detailStrings(d),
      layers: [],
      controls,
      layout: {
        column: [...head, ...(d.map ? [{ control: "passMap", flex: 1 }] : [{ spacer: 1 }]), caption.node],
        padding: dense.padding,
        spacing: dense.gap,
        crossAxisAlignment: "stretch",
      },
    }
  }

  // The app sets a text control on one line, so a long text is a run of words in a `wrap`, which the app breaks itself.
  const texts = (key: string, text: string, label: string, style: "label" | "mono" | undefined): Child[] => {
    const p = proseOf(key, text, label, style, d.columns)
    controls.push(...p.controls)
    return [{ node: p.node, height: p.height }]
  }
  const uplinks = d.tracking?.uplinkOptions.length ? d.tracking.uplinkOptions : [{ label: "No uplink radio", value: "" }]
  const rotators = d.tracking?.rotatorOptions?.length ? d.tracking.rotatorOptions : [{ label: "No rotator", value: "" }]
  const rowH = dense.rowHeight ?? 48
  const children: Child[] = [
    ...head.map((node): Child => ({ node, height: dense.headRow })),
    ...d.status.flatMap((line, i) => texts(statusKey(i), line, i ? "Latest AMSAT report" : "AMSAT status reports", undefined)),
  ]
  controls.push(
    { id: "track", kind: "nativeSwitch", label: "Track Doppler", value: "track", event: "track" },
    { id: "uplinkRadio", kind: "nativeDropdown", label: "Uplink on", value: "uplinkRadio", event: "uplinkRadio", options: uplinks, disabled: uplinks.length < 2 },
    { id: "rotate", kind: "nativeSwitch", label: "Point rotator", value: "rotate", event: "rotate" },
    { id: "rotator", kind: "nativeDropdown", label: "Rotator", value: "rotator", event: "rotator", options: rotators, disabled: rotators.length < 2 },
    { id: "fill", kind: "nativeSwitch", label: "Log contacts via this satellite", value: "fill", event: "fill" },
    { id: "links", kind: "nativeButton", label: "Links", icon: "open-in-new", variant: "tonal", event: "links" },
  )
  children.push(
    { node: { row: [{ control: "track" }, { control: "uplinkRadio", flex: 1 }], spacing: dense.gap, crossAxisAlignment: "center" }, height: rowH },
    ...texts("trackLine", trackLineOf(d), "Doppler tracking", "label"),
    { node: { row: [{ control: "rotate" }, { control: "rotator", flex: 1 }], spacing: dense.gap, crossAxisAlignment: "center" }, height: rowH },
    ...texts("rotorLine", d.tracking?.rotorLine || ROTOR_HINT, "Rotator", "label"),
    { node: { control: "fill" }, height: rowH },
    ...texts("fillLine", d.tracking?.fillLine ?? "", "Contacts", "label"),
    ...d.radio.flatMap((line, i) => texts(radioKey(i), line, `Radio line ${i + 1}`, "mono")),
    { node: { control: "links" }, height: rowH },
  )
  return {
    version: 1,
    width: 360,
    height: 480,
    values: detailValues(d),
    strings: detailStrings(d),
    layers: [],
    controls,
    layout: scrolling(children, d, dense) ?? {
      column: children.map((c) => c.node),
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
  /// The pane's size and what fits across it, as on the pass's other pages (wrap.ts), when the host says.
  pane?: { width: number; height: number }
  columns?: Room
}

export function reportStrings(r: ReportModel): Record<string, string> {
  const strings: Record<string, string> = { title: r.title, tab: "report", variant: r.variant, kind: r.kind, call: r.call, grid: r.grid }
  // What will be sent and what came of it are text a line long, so a long one is several.
  strings.summary = r.summary
  strings.message = r.message
  return strings
}

export const reportValues = (r: ReportModel): Record<string, number> => ({ utc: r.utc ? 1 : 0, ...tabValues("report") })

export function buildReportScene(r: ReportModel): PanelScene {
  const { controls, head } = detailHead(r.compact)
  const dense = densityOf(r.compact)
  controls.push(
    // A dropdown with no options is refused by the app, and with it the whole page. With nothing to offer, because AMSAT has no
    // entry for the satellite or its list could not be read, it has the one choice that says so, and cannot be opened.
    {
      id: "variant",
      kind: "nativeDropdown",
      label: "Transponder",
      value: "variant",
      event: "variant",
      options: r.variants.length ? r.variants : [{ label: "No transponder to report on", value: "" }],
      disabled: r.variants.length === 0,
    },
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
  )
  const summary = proseOf("summary", r.summary, "What will be sent", undefined, r.columns)
  const message = proseOf("message", r.message, "Result", undefined, r.columns)
  controls.push(...summary.controls, ...message.controls)
  const buttons: PanelSceneLayoutNode[] = r.confirming
    ? (controls.push(
        { id: "confirm", kind: "nativeButton", label: "Yes, send it", icon: "send", variant: "filled", event: "confirm" },
        { id: "cancel", kind: "nativeButton", label: "Cancel", variant: "text", event: "cancel" },
      ),
      [{ row: [{ control: "cancel", flex: 1 }, { control: "confirm", flex: 1 }], spacing: dense.gap, crossAxisAlignment: "center" }])
    : (controls.push({ id: "send", kind: "nativeButton", label: "Send to AMSAT", icon: "send", variant: "filled", event: "send", disabled: !r.ready }), [{ control: "send" }])
  const children: Child[] = [
    ...head.map((node): Child => ({ node, height: dense.headRow })),
    { node: { control: "variant" }, height: 56 },
    { node: { control: "kind" }, height: 48 },
    { node: { control: "call" }, height: 56 },
    { node: { control: "grid" }, height: 56 },
    { node: summary.node, height: summary.height },
    { node: message.node, height: message.height },
    ...buttons.map((node): Child => ({ node, height: 48 })),
  ]
  return {
    version: 1,
    width: 360,
    height: 480,
    values: reportValues(r),
    strings: reportStrings(r),
    layers: [],
    controls,
    layout: scrolling(children, r, dense) ?? {
      column: [...head, { control: "variant" }, { control: "kind" }, { control: "call" }, { control: "grid" }, summary.node, message.node, { spacer: 1 }, ...buttons],
      padding: dense.padding,
      spacing: dense.gap,
      crossAxisAlignment: "stretch",
    },
  }
}
