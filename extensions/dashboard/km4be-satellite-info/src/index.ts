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
import type { HookContext, JSONValue, PanelContent, PanelDescriptor, PanelHook, PanelRenderArgs, PanelSceneEvent, PanelSceneEventResult } from "@ham2k/extension-sdk"

import manifest from "../manifest.json" with { type: "json" }
import { expireStatus, loadCatalog, loadStatus } from "./data.ts"
import { listFile, orbitsFile } from "./datasets.ts"
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
import { DopplerTracker, uplinkOptions } from "./tracking.ts"
import { RotatorTracker, rotatorOptions } from "./rotor.ts"
import { ContactFiller, refsWith } from "./contact.ts"
import { liveFrame, liveTarget, stillMoving } from "./live.ts"
import { AlertLine, alertSettingsFrom, alertsFor, loadAlertSettings, sameSettings, saveAlertSettings } from "./alerts.ts"
import type { AlertSettings } from "./alerts.ts"
import { bandLabels, BandMarks } from "./bandscope.ts"
import type { LiveTarget } from "./live.ts"
import { completePass } from "./detail.ts"
import { skyTrack } from "./sky.ts"
import { satrecFromOmm } from "./orbit.ts"
import type { TrackingView } from "./tracking.ts"
import { PREVIEW_SVG } from "./preview.ts"
import { buildNow, buildNowScene, upNow, upNowHint } from "./upnow.ts"
import type { NowModel } from "./upnow.ts"
import { statusFor, statusHours, statusLines } from "./status.ts"
import type { Kind, StatusRow } from "./status.ts"
import {
  MAX_ROWS,
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
/// How soon a list that is waiting asks again: for the satellites, which a few seconds' wait may bring, and for the operator's place, which
/// may be a long time coming, or never if the operator has not allowed it.
const WAITING_FOR_DATA = "tick:3"
const WAITING_FOR_PLACE = "tick:10"

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
  /// How far down the list is scrolled, as the pane last said, in scene units.
  scroll: number
  utc: boolean
  /// The pass the detail view shows: its satellite and when it ends.
  detail?: { name: string; los: number; tab: Tab }
}

/// Doppler tracking: one for the whole extension, since there is one logging radio. It runs on a timer of its own, once a
/// second, so the radio follows the satellite whatever the pane shows, and stops on its own after the pass.
/// The pane's clock is the app's (`clock.realNowMillis`), which a developer's time travel moves; the timer keeps to it by the
/// difference last seen.
let clockSkew = 0
const followClock = (args: PanelRenderArgs): void => {
  if (args.clock?.realNowMillis !== undefined) clockSkew = args.clock.realNowMillis - Date.now()
}
const tracker = new DopplerTracker(host, () => Date.now() + clockSkew)
let trackTimer: number | null = null
const TRACK_EVERY_MS = 1000

/// The rotator, pointed by the same timer as the radio is tuned (rotor.ts).
const rotor = new RotatorTracker(host, () => Date.now() + clockSkew)

const anyTracking = (): boolean => tracker.active || rotor.active

function runTracking(): void {
  if (trackTimer === null) {
    // An app without timers answers 0, and the pane's own redraws, every two seconds while tracking, keep it going instead.
    const id = host.setInterval(() => {
      void Promise.all([tracker.tick(), rotor.tick()]).then(() => {
        if (!anyTracking() && trackTimer !== null) {
          host.clearInterval(trackTimer)
          trackTimer = null
        }
      })
    }, TRACK_EVERY_MS)
    trackTimer = id || null
  }
  void tracker.tick()
  void rotor.tick()
}

function stopTracking(which: "doppler" | "rotor"): void {
  if (which === "doppler") tracker.stop()
  else rotor.stop()
  if (!anyTracking() && trackTimer !== null) {
    host.clearInterval(trackTimer)
    trackTimer = null
  }
}

/// Pass alerts on the FYI line (alerts.ts), and the satellites on the Band Scope (bandscope.ts): a timer from activation,
/// so they come with the panel closed.
let alertSettings: AlertSettings | null = null
let alertTimer: number | null = null
let alerting = false
const alertLine = new AlertLine(host.fyi)
const bandMarks = new BandMarks(host.bandAnnotations)
const ALERT_EVERY_MS = 10_000
const anyAlerts = (s: AlertSettings | null): boolean => !!s && (s.on || s.labels)

async function postAlerts(): Promise<void> {
  const settings = alertSettings
  if (!anyAlerts(settings) || !settings || alerting) return
  alerting = true
  try {
    const now = Date.now() + clockSkew
    const place = await findPlace({ grid: settings.grid }, undefined, now)
    if (!place) return
    // The catalog's read takes no context, which a timer does not have.
    const [{ satellites, elementsAt }, favorites] = await Promise.all([loadCatalog(undefined as unknown as HookContext, now), loadFavorites()])
    if (!satellites.length) return
    const passes = upcomingPasses(satellites, place, now, settings.minEl, elementsAt)
    await alertLine.show(alertsFor(passes, favorites, settings, place, now))
    await bandMarks.show(bandLabels(passes, favorites, settings, place, now))
  } catch {
    // A failed reading is tried again at the next.
  } finally {
    alerting = false
  }
}

function followAlerts(settings: AlertSettings): void {
  alertSettings = settings
  // What is switched off comes down at once; what is still on is put by the next reading.
  if (!settings.on) void alertLine.clearAll().catch(() => undefined)
  if (!settings.labels) void bandMarks.clearAll().catch(() => undefined)
  if (anyAlerts(settings)) {
    if (alertTimer === null) alertTimer = host.setInterval(() => void postAlerts(), ALERT_EVERY_MS) || null
    void postAlerts()
  } else {
    if (alertTimer !== null) host.clearInterval(alertTimer)
    alertTimer = null
  }
}

/// The panel's settings, as they are on each draw: kept when they change, so the timer has them from the next start.
async function syncAlerts(args: PanelRenderArgs): Promise<void> {
  const settings = alertSettingsFrom(args.config, minElevation(args.config))
  if (alertSettings && sameSettings(alertSettings, settings)) {
    // An app without timers posts with each draw instead.
    if (anyAlerts(settings) && alertTimer === null) void postAlerts()
    return
  }
  followAlerts(settings)
  await saveAlertSettings(settings).catch(() => undefined)
}

/// Putting the satellite on the contacts of a pass (contact.ts).
const filler = new ContactFiller()

/// The draft contact, given the satellite when it does not have it yet. Answers whether it was changed.
async function fillDraft(args: PanelRenderArgs, now: number): Promise<boolean> {
  const ref = filler.refAt(now)
  if (!ref || !args.qso) return false
  const refs = refsWith((args.qso as { refs?: unknown }).refs, ref)
  if (!refs) return false
  try {
    const { accepted } = await host.updateDraft({ refs: refs as unknown as JSONValue }, typeof args.operation?.uuid === "string" ? { operationUuid: args.operation.uuid } : {})
    return accepted
  } catch {
    return false
  }
}

/// What a pass's Radio page shows of tracking; the radios are asked for only there, where the uplink is chosen.
async function trackingView(name: string, los: number, radios: boolean): Promise<TrackingView> {
  const status = tracker.status()
  const mine = tracker.isTracking(name, los)
  let options: TrackingView["uplinkOptions"] = []
  if (radios) {
    try {
      const [all, logging] = await Promise.all([host.listRadios(), host.readRadio()])
      options = uplinkOptions(all ?? [], logging?.id ?? null)
    } catch {
      options = []
    }
  }
  let rotators: TrackingView["rotatorOptions"] = []
  if (radios) {
    try {
      rotators = rotatorOptions((await host.listEquipment()) ?? [])
    } catch {
      rotators = []
    }
  }
  // Tracking another satellite: say so, so switching it on here is known to move it.
  const line = mine ? status.line : status.on ? `Doppler tracking is on for ${status.name}. Switch it on here to follow this pass instead.` : status.line
  const rotorMine = rotor.isTracking(name, los)
  const rotorLine = rotorMine ? rotor.status().line : rotor.active ? "The rotator is following another pass. Switch it on here to follow this one instead." : rotor.status().line
  const fillMine = filler.isFilling(name, los)
  const fillLine = fillMine
    ? `Each contact you start gets ${name} as its satellite, until a few minutes after it sets.`
    : filler.name
      ? `Contacts are getting ${filler.name} as their satellite. Switch this on to use ${name} instead.`
      : `Puts ${name} on each contact you log during this pass, as the Satellites activity does, so your exports carry SAT_NAME and PROP_MODE.`
  return { on: mine, line, uplink: tracker.uplink ?? "", uplinkOptions: options, rotorOn: rotorMine, rotorLine, rotator: rotor.rotatorId, rotatorOptions: rotators, fillOn: fillMine, fillLine }
}

/// What moves on each pane between its full draws, by placement (live.ts), and the one timer that moves it. An app that cannot
/// take a patch turns this off for good, and the pages are drawn again in full as often as they were before.
const live = new Map<string, LiveTarget>()
let liveTimer: number | null = null
let liveWorks = true
const LIVE_EVERY_MS = 1000

async function moveLive(): Promise<void> {
  const now = Date.now() + clockSkew
  for (const [id, target] of [...live]) {
    if (!stillMoving(target, now)) {
      live.delete(id)
      continue
    }
    const steps = liveFrame(target, now)
    if (target.tab === "sky" && target.layers.has("trackSky")) {
      const [name, los] = [target.satellite.name, target.pass.los]
      const lines = [tracker.isTracking(name, los) ? tracker.status().line : "", rotor.isTracking(name, los) ? rotor.status().line : ""].filter(Boolean)
      if (lines.length) steps.push({ merge: ["controls", "trackSky"], value: { label: lines.join("\n") } })
    }
    if (!steps.length) continue
    try {
      // False: the pane shows something else now, and the app draws it again, which says what moves there next.
      if (!(await host.updateScene(id, steps))) live.delete(id)
    } catch {
      liveWorks = false
      live.clear()
    }
  }
  if (!live.size && liveTimer !== null) {
    host.clearInterval(liveTimer)
    liveTimer = null
  }
}

/// After a full draw: what on this pane moves from now until the next.
function followLive(args: PanelRenderArgs, view: View, layers: string[]): boolean {
  const id = args.instanceId
  if (!id) return false
  live.delete(id)
  if (!liveWorks || view.kind !== "detail") return false
  const { model, source } = view
  const moving = (model.tab === "sky" && model.underWay) || model.tab === "map"
  if (!moving) return false
  const now = nowMillis(args)
  const pass = completePass(source.satellite, source.place, source.pass, now)
  const track = source.satellite.omm ? skyTrack(satrecFromOmm(source.satellite.omm), source.place, pass) : []
  const target = liveTarget(id, model.tab === "map" ? "map" : "sky", source.satellite, source.place, pass, track, themeOf(args.environment?.colors), layers)
  if (!target) return false
  live.set(id, target)
  if (liveTimer === null) liveTimer = host.setInterval(() => void moveLive(), LIVE_EVERY_MS) || null
  return liveTimer !== null
}

/// Per placement, keyed the way the spot map keys its own.
const panes = new Map<string, PaneState>()
const paneState = (args: PanelRenderArgs): PaneState => {
  const id = args.instanceId ?? args.panelKey
  let state = panes.get(id)
  if (!state) panes.set(id, (state = { draft: freshDraft(), view: "list", scroll: 0, utc: args.config?.utc === true }))
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
  columns: "",
  legend: false,
  rows: [],
  more: 0,
  scroll: state.scroll,
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

/// Why there is nothing to show yet, and what it waits for.
interface Waiting {
  waitingFor: "place" | "data"
  message: string
}

/// Everything the views are made from, or why there is nothing yet.
async function gather(args: PanelRenderArgs, ctx: HookContext): Promise<Ready | Waiting> {
  const now = nowMillis(args)
  const minEl = minElevation(args.config)
  const hours = statusHours(args.config)
  // All of it at once: where the operator is, the satellites and their orbits, who follows what and what AMSAT has heard. Each waits for a
  // device or a server, and one after another they add up to a first render the host runs out of patience for.
  const [place, catalog, favorites, reports] = await Promise.all([findPlace(args.config, args.operation, now), loadCatalog(ctx, now), loadFavorites(), loadStatus(ctx, now, hours)])
  if (!place) return { waitingFor: "place", message: "No location. Allow location access, or enter a grid square in this panel's settings." }
  const { satellites, elementsAt } = catalog
  if (!satellites.length) return { waitingFor: "data", message: "No satellite data yet. The app downloads it in the background; check the connection." }

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
const STALE_ORBITS_MS = 7 * 24 * 3_600_000

/// What is left out of a line, in this order, when it will not fit the pane at a size that can be read. The mark is
/// never in the line: it is an icon, in a column of its own.
const OMIT_ORDER: (keyof Cells)[][] = [["mark"], ["mark", "length"], ["mark", "length", "type"]]

function listModel(r: Ready, state: PaneState, now: number, seconds: boolean, compact: boolean, look: ListLook): Model {
  const mode = state.mode ?? "all"
  const followed = r.favorites.length > 0
  const showing = mode === "all" ? r.passes : r.passes.filter((p) => r.favorites.includes(p.satellite.name))
  // Every pass of the day, up to what a scene holds: the pane scrolls through them.
  const page = showing.slice(0, MAX_ROWS)
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

  const more = showing.length - rows.length
  return {
    header: `${r.place.grid} · min ${r.minEl}° · ${tracked} of ${r.satellites.length} satellites tracked${more > 0 ? ` · the first ${rows.length} passes` : ""}`,
    hint,
    mode,
    utc: state.utc,
    columns: showing.length ? columns : "",
    legend: showing.length > 0,
    compact,
    rows,
    more,
    look,
    size: rowSize(size),
    scroll: state.scroll,
  }
}

type View = { kind: "list"; model: Model; waiting?: "place" | "data" } | { kind: "detail"; model: DetailModel; source: { satellite: Satellite; place: Place; pass: SatellitePass } } | { kind: "report"; model: ReportModel } | { kind: "now"; model: NowModel }

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
  // Still waiting for a place or for the satellites: the list says what for, and is drawn again in a few seconds.
  if ("waitingFor" in ready) return { kind: "list", model: empty(ready.message, state, compactNow, look), waiting: ready.waitingFor }

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
      detail.tracking = await trackingView(name, los, tab === "radio")
      if (tab !== "report") return { kind: "detail", model: detail, source: { satellite: pass.satellite, place: ready.place, pass } }
      return { kind: "report", model: await reportModel(args, ctx, state, pass.satellite, ready.place, detail.title, compact, now) }
    }
    state.view = "list" // it has ended, or the settings no longer list it
  }
  // The sky: what is up this moment, on one plot.
  if (state.mode === "now") {
    const dots = upNow(ready.passes, ready.place, ready.favorites, now)
    const next = nowAndNext(ready.passes.filter((p) => p.aos > now), now)
    return { kind: "now", model: { mode: "now", utc: state.utc, hint: upNowHint(dots.length, next), compact: compactNow, dots, ...buildNow(dots, themeOf(args.environment?.colors)) } }
  }
  return { kind: "list", model: listModel(ready, state, now, args.config?.listSeconds === true, compactNow, look) }
}

/// The words of the list that every list has, which is all an answer may name: how many rows there are changes between All and
/// Favorites, and an answer cannot name a row the pane has not got. The render the pane asks for after an event has the rows.
const listPatchStrings = (m: Model): Record<string, string> => ({ mode: m.mode, header: m.header, hint: m.hint, columns: m.columns })

const patchOf = (view: View, options: { scroll?: boolean } = {}): PanelSceneEventResult =>
  view.kind === "now"
    ? { values: { utc: view.model.utc ? 1 : 0 }, strings: { mode: view.model.mode, hint: view.model.hint } }
    : view.kind === "list"
    ? { values: options.scroll ? valuesOf(view.model) : { utc: view.model.utc ? 1 : 0 }, strings: listPatchStrings(view.model) }
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
          {
            type: "field",
            key: "alerts",
            fieldType: "checkbox",
            label: "Pass alerts",
            description: "Puts a line under the call info a few minutes before a satellite rises, and while it is up, even with this panel closed.",
          },
          {
            type: "field",
            key: "bandLabels",
            fieldType: "checkbox",
            label: "Label satellites on the band scope",
            description: "Marks the downlink of each satellite that is up, or about to rise, on the Band Scope, Doppler-corrected, and its uplink.",
          },
          { type: "field", key: "alertsFavorites", fieldType: "checkbox", label: "Alerts and labels for favorites only" },
          {
            type: "field",
            key: "alertLead",
            fieldType: "number",
            label: "Alert before rise (minutes)",
            description: "How long before a satellite rises its alert and label go up: 1 to 30, default 3.",
          },
        ],
      },
    ]
  },

  async render(args: PanelRenderArgs, ctx: HookContext): Promise<PanelContent> {
    // A step of tracking with every redraw too, which is all there is where the app has no timers; two at once never run.
    followClock(args)
    if (tracker.active) void tracker.tick()
    await syncAlerts(args)
    const view = await snapshot(args, ctx)
    // The pass's Sky page is redrawn often while something on it moves: every second if the countdown is on, since
    // a countdown that is not fresh is wrong; every two seconds while the satellite is overhead, so it is seen to cross
    // the sky; and not at all otherwise, when the panel's own minute is enough.
    if (view.kind === "report") return { kind: "scene", scene: buildReportScene(view.model), triggers: [], title: TAB_TITLE }
    // The satellites cross the sky in minutes: the plot is drawn again every few seconds.
    if (view.kind === "now") return { kind: "scene", scene: buildNowScene(view.model), triggers: ["tick:3"], title: TAB_TITLE }
    const detailScene = view.kind === "detail" ? buildDetailScene(view.model) : null
    // What moves between draws, moved by patches; where that works, the full draw is needed only now and then.
    const moved = followLive(args, view, detailScene ? [...detailScene.layers.map((l) => l.id), ...(detailScene.controls ?? []).filter((c) => c.id === "trackSky").map((c) => c.id)] : [])
    const onSky = view.kind === "detail" && view.model.tab === "sky"
    // The Radio page has the Doppler-corrected frequencies for right now, which are only right for a moment: while the
    // satellite is up they are redrawn as the plot is.
    const onRadio = view.kind === "detail" && view.model.tab === "radio"
    // While the radio is being tracked, the page says where it is, and is drawn again as often as the plot.
    const tracking = view.kind === "detail" && (view.model.tracking?.on === true || view.model.tracking?.rotorOn === true)
    // The map moves the satellite along its track: every few seconds while it is up, and less often while it is not.
    const onMap = view.kind === "detail" && view.model.tab === "map"
    const tick = onSky && countdownOn(args.config)
      ? "tick:1"
      : moved
        ? onMap
          ? "tick:30"
          : "tick:10"
        : (onSky || onRadio || onMap) && view.kind === "detail" && (view.model.underWay || tracking)
          ? "tick:2"
          : onMap
            ? "tick:10"
            : undefined
    // A list that has nothing to show yet asks again in a few seconds, not at the panel's minute: it is what the operator is looking at.
    // While contacts are being given the satellite, a new one wakes the panel to give it.
    const filling = filler.refAt(nowMillis(args)) !== null ? ["qso"] : []
    const triggers = view.kind === "list" && view.waiting ? [view.waiting === "place" ? WAITING_FOR_PLACE : WAITING_FOR_DATA] : [...(tick ? [tick] : []), ...filling]
    return { kind: "scene", scene: view.kind === "list" ? buildScene(view.model) : detailScene ?? buildDetailScene(view.model), triggers, title: TAB_TITLE }
  },

  async onEvent(args, ctx): Promise<PanelSceneEventResult> {
    const { event } = args
    followClock(args)
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
    // Where the operator has scrolled the list to, once it has come to rest: kept, so that a list drawn again, or come back to
    // from a pass's page, is where they left it, and the pane is not told to move.
    if (event.action === "scrolled") {
      if (typeof event.value === "number" && Number.isFinite(event.value)) state.scroll = Math.max(0, event.value)
      return stay()
    }
    // A tab's chip names its page in its action; the text is for a control that carries one.
    const page = event.action.startsWith("tab-") ? event.action.slice(4) : event.action === "tab" ? event.text : undefined
    if (page && state.detail && (page === "sky" || page === "map" || page === "radio" || page === "report")) {
      state.detail.tab = page
      return stay()
    }
    if (state.view === "detail" && state.detail?.tab === "report" && REPORT_ACTIONS.includes(event.action)) return reportEvent(args, ctx, state)
    // Doppler tracking, switched on for the pass shown, or off; and which receiver the uplink goes to.
    if (event.action === "uplinkRadio") tracker.setUplinkRadio(typeof event.text === "string" ? event.text : null)
    if (event.action === "track" && state.detail) {
      if (event.value === 1) {
        const ready = await gather(args, ctx)
        const shown = state.detail
        const pass = "waitingFor" in ready ? undefined : ready.passes.find((p) => p.satellite.name === shown.name && Math.abs(p.los - shown.los) < 120_000)
        if (pass && !("waitingFor" in ready)) {
          tracker.start({ satellite: pass.satellite, observer: ready.place, aos: pass.aos, los: pass.los }, tracker.uplink)
          runTracking()
        }
      } else if (tracker.isTracking(state.detail.name, state.detail.los)) stopTracking("doppler")
    }
    // The satellite on the contacts of this pass, or not; the contact being typed gets it at once.
    if (event.action === "fill" && state.detail) {
      if (event.value === 1) {
        const { satellites } = await loadCatalog(ctx, nowMillis(args))
        const satellite = satellites.find((s) => s.name === state.detail?.name)
        if (satellite) {
          filler.start(satellite, state.detail.los)
          await fillDraft(args, nowMillis(args))
        }
      } else if (filler.isFilling(state.detail.name, state.detail.los)) filler.stop()
    }
    // The rotator: which one, and pointing it at the pass shown, or not. With only one set up, that is the one.
    if (event.action === "rotator") rotor.setRotator(typeof event.text === "string" ? event.text : null)
    if (event.action === "rotate" && state.detail) {
      if (event.value === 1) {
        if (!rotor.rotatorId) {
          const only = (await host.listEquipment().catch(() => [])).filter((e) => e.kind === "rotator")
          if (only.length === 1) rotor.setRotator(only[0].id)
        }
        const ready = await gather(args, ctx)
        const shown = state.detail
        const pass = "waitingFor" in ready ? undefined : ready.passes.find((p) => p.satellite.name === shown.name && Math.abs(p.los - shown.los) < 120_000)
        if (pass && !("waitingFor" in ready)) {
          rotor.start({ satellite: pass.satellite, observer: ready.place, aos: pass.aos, los: pass.los })
          runTracking()
        }
      } else if (rotor.isTracking(state.detail.name, state.detail.los)) stopTracking("rotor")
    }
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

    if (event.action === "mode" && (event.text === "favorites" || event.text === "all" || event.text === "now")) {
      state.mode = event.text
      // A different list starts from its top: the scene drawn next says so, which moves the pane.
      state.scroll = 0
      await saveMode(event.text)
      // The answer names only what the scene the pane has and the one it is about to have both hold: the switch, and the UTC value.
      return { values: { utc: state.utc ? 1 : 0 }, strings: { mode: event.text } }
    }
    if (event.action === "utc" && event.value !== undefined) state.utc = event.value === 1
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
    registerHook("dataFile", { key: listFile.key, hook: listFile })
    registerHook("dataFile", { key: orbitsFile.key, hook: orbitsFile })
    // Alerts switched on last time start now, without waiting for the panel to be drawn.
    void loadAlertSettings()
      .then((settings) => {
        if (!alertSettings) followAlerts(settings)
      })
      .catch(() => undefined)
  },
})
