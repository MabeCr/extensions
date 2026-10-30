// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// Amateur radio satellite passes for where the operator is. See data.ts for
// where each piece of data comes from.
//
// A panel scene (extension API 5) with two views. The list: the next passes, a
// page at a time, with a star to follow a satellite, a Favorites / All switch
// and a UTC switch. The detail, opened from a row: a pass's sky plot and times,
// and its frequencies with Doppler, and a Report page to tell AMSAT what was heard (report.ts). Favorites live on the device (favorites.ts);
// the view, the page and the switches are per pane and start over on a restart.
//
// A scene's controls cannot change between a render and the event answered
// against it, so an event that changes the view answers with only the UTC switch,
// which both views have, and the host's render after it draws the new view.

import { defineExtension, host } from "@ham2k/extension-sdk"
import type { HookContext, PanelContent, PanelDescriptor, PanelHook, PanelRenderArgs, PanelSceneEvent, PanelSceneEventResult } from "@ham2k/extension-sdk"

import manifest from "../manifest.json" with { type: "json" }
import { expireStatus, loadCatalog, loadStatus } from "./data.ts"
import type { Satellite } from "./data.ts"
import { buildDetail, themeOf } from "./detail.ts"
import type { DetailModel, Tab } from "./detail.ts"
import { loadFavorites, loadMode, saveMode, setFavorite } from "./favorites.ts"
import { findPlace } from "./location.ts"
import type { Place } from "./location.ts"
import { clock, minElevation, passCells, table, upcomingPasses } from "./passes.ts"
import { cleanCall, cleanGrid, defaultCall, labelOf, loadSatNames, namesFor, problemWith, sendReport, summaryOf } from "./report.ts"
import type { Report } from "./report.ts"
import type { Cells, SatellitePass } from "./passes.ts"
import { linksFor } from "./radio.ts"
import { SCRUB_VALUE } from "./scrub.ts"
import { PREVIEW_SVG } from "./preview.ts"
import { statusFor, statusHours, statusLines } from "./status.ts"
import type { Kind, StatusRow } from "./status.ts"
import {
  PAGE_SIZE,
  buildDetailScene,
  buildReportScene,
  buildScene,
  DEFAULT_LOOK,
  fitSize,
  listLook,
  MIN_ROW_SIZE,
  rowSize,
  detailStrings,
  detailValues,
  isCompact,
  passOfOpen,
  reportStrings,
  reportValues,
  satelliteOfStar,
  skyPercent,
  stringsOf,
  valuesOf,
} from "./scene.ts"
import type { ListLook, Mode, Model, ReportModel } from "./scene.ts"

const REFRESH_SECONDS = 60

/// The pane's tab, short enough to read whole on a phone: the descriptor's own title is longer, for the list of panels.
const TAB_TITLE = "Satellites"

/// What the operator has filled in on the Report page. The callsign and grid stay from one pass to the
/// next; the rest starts over with each.
interface Draft {
  variant: string
  kind: Kind | ""
  call?: string
  grid?: string
  confirming: boolean
  message: string
}

const freshDraft = (old?: Draft): Draft => ({ variant: "", kind: "", call: old?.call, grid: old?.grid, confirming: false, message: "" })

interface PaneState {
  draft: Draft
  view: "list" | "detail"
  /// Not known until the stored choice has been read, which the first view of the pane does.
  mode?: Mode
  page: number
  utc: boolean
  /// The pass the detail view shows: its satellite and when it ends.
  detail?: { name: string; los: number; tab: Tab }
}

/// Per placement, keyed the way the spot map keys its own.
const panes = new Map<string, PaneState>()
const paneState = (args: PanelRenderArgs): PaneState => {
  const id = args.instanceId ?? args.panelKey
  let state = panes.get(id)
  if (!state) panes.set(id, (state = { draft: freshDraft(), view: "list", page: 0, utc: args.config?.utc === true }))
  return state
}

/// The pane's size, when the host reports it.
const paneOf = (args: PanelRenderArgs): { width: number; height: number } | undefined => {
  const e = args.environment
  return e && e.width > 0 && e.height > 0 ? { width: e.width, height: e.height } : undefined
}

const nowMillis = (args: PanelRenderArgs): number => args.clock?.realNowMillis ?? Date.now()

/// Whether the pane counts down to rise, peak and set. Off unless the setting is on.
const countdownOn = (config: Record<string, unknown> | undefined): boolean => config?.countdown === true

const empty = (header: string, state: PaneState, compact = false, look: ListLook = DEFAULT_LOOK): Model => ({
  look,
  size: look.size,
  header,
  compact,
  hint: "",
  mode: state.mode ?? "all",
  utc: state.utc,
  page: 0,
  pageCount: 1,
  range: "",
  columns: "",
  legend: false,
  rows: [],
})

interface Ready {
  place: Place
  satellites: Satellite[]
  elementsAt: number
  minEl: number
  favorites: string[]
  passes: SatellitePass[]
  /// AMSAT's reports for the last `hours`; empty when the feed is unreachable.
  reports: StatusRow[]
  hours: number
}

/// Everything the views are made from, or the sentence saying why there is nothing yet.
async function gather(args: PanelRenderArgs, ctx: HookContext): Promise<Ready | string> {
  const place = await findPlace(args.config, args.operation, nowMillis(args))
  if (!place) return "No location. Allow location access, or enter a grid square in this panel's settings."

  const now = nowMillis(args)
  const { satellites, elementsAt } = await loadCatalog(ctx, now)
  if (!satellites.length) return "No satellite data yet. Check the connection."

  const minEl = minElevation(args.config)
  const hours = statusHours(args.config)
  const [favorites, reports] = await Promise.all([loadFavorites(), loadStatus(ctx, now, hours)])
  return { place, satellites, elementsAt, minEl, favorites, passes: upcomingPasses(satellites, place, now, minEl, elementsAt), reports, hours }
}

/// What AMSAT's reports say of a satellite, for the mark at the end of its row; null when they say nothing.
const markFor = (r: Ready, satellite: Satellite): Kind | null => statusFor(r.reports, satellite)?.kind ?? null

/// A span of time as a person says it: "less than a minute", "12 min", "2 h 5 min".
export function span(millis: number): string {
  const minutes = Math.max(0, Math.ceil(millis / 60_000))
  if (minutes < 1) return "less than a minute"
  if (minutes < 90) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return `${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`
}

/// The line over the list: which satellite is up now and for how long, and which is next and when. Nothing when the
/// list has nothing in it that is up or to come.
export function nowAndNext(passes: SatellitePass[], now: number): string {
  const up = passes.filter((p) => p.aos <= now && p.los > now)
  const next = passes.find((p) => p.aos > now)
  const parts: string[] = []
  if (up.length) parts.push(`${up[0].satellite.name}${up.length > 1 ? ` and ${up.length - 1} more` : ""} up now, ${span(up[0].los - now)} left`)
  if (next) parts.push(`Next: ${next.satellite.name} in ${span(next.aos - now)}`)
  return parts.join(" · ")
}

/// How old a set of orbits has to be before the pane says so: they are fetched every six hours, so a copy twice that is
/// stale, which is what an operator offline sees.
const STALE_ORBITS_MS = 12 * 3_600_000

/// What is left out of a line, in this order, when it will not fit the pane at a size that can be read. The mark is
/// never in the line: it is an icon, in a column of its own.
const OMIT_ORDER: (keyof Cells)[][] = [["mark"], ["mark", "length"], ["mark", "length", "type"]]

function listModel(r: Ready, state: PaneState, now: number, seconds: boolean, compact: boolean, look: ListLook): Model {
  const mode = state.mode ?? "all"
  const followed = r.favorites.length > 0
  const showing = mode === "all" ? r.passes : r.passes.filter((p) => r.favorites.includes(p.satellite.name))
  const pageCount = Math.max(1, Math.ceil(showing.length / PAGE_SIZE))
  state.page = Math.min(Math.max(0, state.page), pageCount - 1)
  const first = state.page * PAGE_SIZE
  const page = showing.slice(first, first + PAGE_SIZE)
  // The mark ends the line, where a mark drawn wider than one character in some font cannot push the columns out of line.
  // On a phone each line has to fit, or it wraps and the row is twice as tall: a single space between columns, and days
  // after today as +1 and not as a date.
  const cells = page.map((p) => passCells(p, now, state.utc, seconds, "", compact))
  const longest = (t: { columns: string; lines: string[] }) => Math.max(t.columns.length, ...t.lines.map((l) => l.length))
  // All the columns if they fit at a size that can be read; if not, fewer, the length and then the kind of transponder.
  let laid = table(cells, compact ? " " : "  ", OMIT_ORDER[0])
  let size = fitSize(longest(laid), look, compact)
  for (const omit of OMIT_ORDER.slice(1)) {
    if (size >= MIN_ROW_SIZE) break
    laid = table(cells, compact ? " " : "  ", omit)
    size = fitSize(longest(laid), look, compact)
  }
  const { columns, lines } = laid
  const rows = page.map((p, i) => ({
    name: p.satellite.name,
    favorite: r.favorites.includes(p.satellite.name),
    text: lines[i],
    mark: markFor(r, p.satellite),
    live: p.aos <= now,
    los: p.los,
  }))

  const tracked = r.satellites.filter((s) => s.omm).length
  // Favorites with nobody followed is an empty page, so it says how to fill it, rather than showing everything.
  let hint = `No passes of ${r.minEl}° or more in the next 24 hours.`
  if (mode === "favorites" && !followed) hint = compact ? "Add favorites on All, with a star, to see them here." : "Add some favorites to see them here: tap a star on the All page."
  else if (showing.length) {
    hint = nowAndNext(showing, now)
    // Orbits are fetched every six hours; a copy much older than that is said, since the passes are only as good as it is.
    if (r.elementsAt > 0 && now - r.elementsAt > STALE_ORBITS_MS) hint += `${hint ? " · " : ""}Orbits are ${span(now - r.elementsAt)} old.`
  }

  return {
    header: `${r.place.grid} · min ${r.minEl}° · ${tracked} of ${r.satellites.length} satellites tracked`,
    hint,
    mode,
    utc: state.utc,
    page: state.page,
    pageCount,
    range: showing.length ? `${first + 1}–${first + rows.length} of ${showing.length}` : "",
    columns: showing.length ? columns : "",
    legend: showing.length > 0,
    compact,
    rows,
    look,
    size: rowSize(size),
  }
}

type View = { kind: "list"; model: Model } | { kind: "detail"; model: DetailModel } | { kind: "report"; model: ReportModel }

/// The Report page of a pass: what AMSAT's form offers for the satellite, and what the operator has filled in,
/// starting from their own callsign and where they are.
async function reportModel(args: PanelRenderArgs, ctx: HookContext, state: PaneState, satellite: Satellite, place: Place, title: string, compact: boolean, now: number): Promise<ReportModel> {
  const names = await loadSatNames(ctx, now)
  const variants = namesFor(names, satellite).map((n) => ({ label: labelOf(n), value: n }))
  const draft = state.draft
  const variant = variants.some((v) => v.value === draft.variant) ? draft.variant : (variants[0]?.value ?? "")
  const call = draft.call ?? defaultCall(args.operation)
  const grid = draft.grid ?? place.grid
  const kind = draft.kind
  const found = problemWith({ name: variant, kind, call, grid })
  const problem = !names.length ? "Could not read AMSAT's list of satellites. Check the connection." : !variants.length ? "AMSAT's form has no entry for this satellite." : found
  const report: Report | null = problem || !kind ? null : { name: variant, kind, at: now, call, grid }
  return {
    title,
    utc: state.utc,
    compact,
    variants,
    variant,
    kind,
    call,
    grid,
    summary: report ? summaryOf(report) : problem,
    message: draft.message,
    ready: report !== null,
    confirming: draft.confirming && report !== null,
    report,
  }
}

/// What the pane shows now, given its state, the favorites and the clock.
async function snapshot(args: PanelRenderArgs, ctx: HookContext): Promise<View> {
  const state = paneState(args)
  const now = nowMillis(args)
  // A pane opens on what the operator last chose, All if they never have.
  if (state.mode === undefined) state.mode = await loadMode()
  const ready = await gather(args, ctx)
  const compactNow = isCompact(args.config, args.environment)
  const look = listLook(args.environment, compactNow)
  if (typeof ready === "string") return { kind: "list", model: empty(ready, state, compactNow, look) }

  if (state.view === "detail" && state.detail) {
    const { name, los, tab } = state.detail
    const compact = isCompact(args.config, args.environment)
    // The pass is looked for by its satellite and its end, which hold steady between workings-out.
    const pass = ready.passes.find((p) => p.satellite.name === name && Math.abs(p.los - los) < 120_000)
    if (pass) {
      const detail = buildDetail(
        pass.satellite,
        ready.place,
        pass,
        now,
        state.utc,
        tab === "report" ? "radio" : tab,
        themeOf(args.environment?.colors),
        statusLines(statusFor(ready.reports, pass.satellite), ready.hours, now, state.utc),
        { countdown: countdownOn(args.config), compact, pane: paneOf(args), skyPercent: skyPercent(args.config) },
      )
      if (tab !== "report") return { kind: "detail", model: detail }
      return { kind: "report", model: await reportModel(args, ctx, state, pass.satellite, ready.place, detail.title, compact, now) }
    }
    state.view = "list" // it has ended, or the settings no longer list it
  }
  return { kind: "list", model: listModel(ready, state, now, args.config?.listSeconds === true, compactNow, look) }
}

const patchOf = (view: View): PanelSceneEventResult =>
  view.kind === "list"
    ? { values: valuesOf(view.model), strings: stringsOf(view.model) }
    : view.kind === "report"
      ? { values: reportValues(view.model), strings: reportStrings(view.model) }
      : { values: detailValues(view.model), strings: detailStrings(view.model) }

const REPORT_ACTIONS = ["variant", "kind", "call", "grid", "send", "confirm", "cancel"]

/// What the Report page's controls do. Changing anything on it takes back a request to send; sending asks first, so a
/// stray tap does not put a report on AMSAT's public page.
async function reportEvent(args: PanelRenderArgs & { event: PanelSceneEvent }, ctx: HookContext, state: PaneState): Promise<PanelSceneEventResult> {
  const { event } = args
  const draft = state.draft
  const text = typeof event.text === "string" ? event.text : ""

  if (event.action === "variant") draft.variant = text
  if (event.action === "kind" && (text === "heard" || text === "telemetry" || text === "notHeard")) draft.kind = text
  if (event.action === "call") draft.call = cleanCall(text)
  if (event.action === "grid") draft.grid = cleanGrid(text)
  if (event.action !== "send" && event.action !== "confirm") draft.confirming = false

  const view = await snapshot(args, ctx)
  if (view.kind !== "report") return patchOf(view)

  if (event.action === "send") draft.confirming = view.model.ready
  if (event.action === "confirm") {
    const report = draft.confirming ? view.model.report : null
    draft.confirming = false
    if (report) {
      const outcome = await sendReport(report)
      draft.message = outcome.message
      if (outcome.ok) {
        draft.kind = ""
        expireStatus()
      }
    }
  }
  return patchOf(await snapshot(args, ctx))
}

export const PassesPanel: PanelHook = {
  async getPanels(_args: Record<string, never>, _ctx: HookContext): Promise<PanelDescriptor[]> {
    return [
      {
        key: "passes",
        title: "KM4BE Satellite Passes",
        description: "The next amateur satellite passes for where you are",
        preview: PREVIEW_SVG,
        icon: "satellite-variant",
        on: [`tick:${REFRESH_SECONDS}`],
        form: [
          {
            type: "field",
            key: "minElevation",
            fieldType: "number",
            label: "Minimum elevation (degrees)",
            description: "Passes that never climb this high are hidden. 0 to 60; default 10.",
          },
          {
            type: "field",
            key: "grid",
            fieldType: "text",
            label: "Grid square",
            description: "Used when the device cannot give its location, for example EL95vs.",
          },
          {
            type: "field",
            key: "statusHours",
            fieldType: "number",
            label: "AMSAT report window (hours)",
            description: "How far back operators' status reports count. 1 to 168; default 24.",
          },
          { type: "field", key: "utc", fieldType: "checkbox", label: "Start with times in UTC" },
          {
            type: "field",
            key: "density",
            fieldType: "select",
            label: "Spacing",
            description: "Automatic packs the list more tightly in a small pane, such as a phone, and leaves a larger one as it is.",
            options: [
              { label: "Automatic", value: "auto" },
              { label: "Comfortable", value: "comfortable" },
              { label: "Compact", value: "compact" },
            ],
          },
          { type: "field", key: "listSeconds", fieldType: "checkbox", label: "Show seconds in the pass list" },
          {
            type: "field",
            key: "skySize",
            fieldType: "number",
            label: "Sky chart size (percent)",
            description: "How large the sky chart is on a pass's page, as a share of the most the pane allows: 40 to 100, default 100. Make it smaller to leave room for the lines under it.",
          },
          {
            type: "field",
            key: "countdown",
            fieldType: "checkbox",
            label: "Count down to rise, peak and set",
            description: "On a pass's page, shows the time to or since each event, such as −4:12 before it and +2:05 after, and redraws every second while that page is open.",
          },
        ],
      },
    ]
  },

  async render(args: PanelRenderArgs, ctx: HookContext): Promise<PanelContent> {
    const view = await snapshot(args, ctx)
    // The pass's Sky page is redrawn often while something on it moves: every second if the countdown is on, since
    // a countdown that is not fresh is wrong; every two seconds while the satellite is overhead, so it is seen to cross
    // the sky; and not at all otherwise, when the panel's own minute is enough.
    if (view.kind === "report") return { kind: "scene", scene: buildReportScene(view.model), triggers: [], title: TAB_TITLE }
    const onSky = view.kind === "detail" && view.model.tab === "sky"
    // The Radio page has the Doppler-corrected frequencies for right now, which are only right for a moment: while the
    // satellite is up they are redrawn as the plot is.
    const onRadio = view.kind === "detail" && view.model.tab === "radio"
    const tick = onSky && countdownOn(args.config) ? "tick:1" : (onSky || onRadio) && view.kind === "detail" && view.model.underWay ? "tick:2" : undefined
    return { kind: "scene", scene: view.kind === "list" ? buildScene(view.model) : buildDetailScene(view.model), triggers: tick ? [tick] : [], title: TAB_TITLE }
  },

  async onEvent(args, ctx): Promise<PanelSceneEventResult> {
    const { event } = args
    const state = paneState(args)
    // Both views have the UTC switch and nothing else in common, so a change of view answers with that alone.
    const stay = (): PanelSceneEventResult => ({ values: { utc: state.utc ? 1 : 0 } })

    if (event.action === "open") {
      const pass = passOfOpen(event.controlId)
      if (!pass) return stay()
      state.view = "detail"
      state.detail = { ...pass, tab: "sky" }
      state.draft = freshDraft(state.draft)
      return stay()
    }
    // The slider over the plot is the pane's own, and does not tell the extension where it is. Reset answers with where it
    // rests, which puts it there and takes the marker and the readout away.
    if (event.action === "scrubReset") {
      const view = await snapshot(args, ctx)
      return view.kind === "detail" && view.model.tab === "sky" && view.model.scrub ? { values: { ...detailValues(view.model), [SCRUB_VALUE]: view.model.scrub.rest } } : stay()
    }
    if (event.action === "back") {
      state.view = "list"
      return stay()
    }
    // A tab's chip names its page in its action; the text is for a control that carries one.
    const page = event.action.startsWith("tab-") ? event.action.slice(4) : event.action === "tab" ? event.text : undefined
    if (page && state.detail && (page === "sky" || page === "radio" || page === "report")) {
      state.detail.tab = page
      return stay()
    }
    if (state.view === "detail" && state.detail?.tab === "report" && REPORT_ACTIONS.includes(event.action)) return reportEvent(args, ctx, state)
    if (event.action === "links" && state.detail) {
      const { satellites } = await loadCatalog(ctx, nowMillis(args))
      const satellite = satellites.find((s) => s.name === state.detail?.name)
      if (satellite) {
        await host.showMessage({
          presentation: "dialog",
          title: `${satellite.name} on the web`,
          text: "Open a page for more about this satellite.",
          actions: linksFor(satellite).map((l) => ({ type: "link" as const, label: l.label, url: l.url })),
        })
      }
      return stay()
    }

    if (event.action === "mode" && (event.text === "favorites" || event.text === "all")) {
      state.mode = event.text
      state.page = 0
      await saveMode(event.text)
    }
    if (event.action === "utc" && event.value !== undefined) state.utc = event.value === 1
    if (event.action === "prev") state.page -= 1
    if (event.action === "next") state.page += 1
    if (event.action === "star") {
      const name = satelliteOfStar(event.controlId)
      if (name) await setFavorite(name, !(await loadFavorites()).includes(name))
    }
    return patchOf(await snapshot(args, ctx))
  },
}

defineExtension({
  ...manifest,
  onActivation({ registerHook }) {
    registerHook("panel", { key: manifest.key, hook: PassesPanel })
  },
})
