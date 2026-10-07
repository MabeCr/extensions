// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// Amateur radio satellite passes for where the operator is. See data.ts for
// where each piece of data comes from.
//
// A panel scene (extension API 5) with two views. The list: the next passes, a
// page at a time, with a star to follow a satellite, a Favorites / All switch
// and a UTC switch. The detail, opened from a row: a pass's sky plot and times,
// and its frequencies with Doppler. Favorites live on the device (favorites.ts);
// the view, the page and the switches are per pane and start over on a restart.
//
// A scene's controls cannot change between a render and the event answered
// against it, so an event that changes the view answers with only the UTC switch,
// which both views have, and the host's render after it draws the new view.

import { defineExtension, host } from "@ham2k/extension-sdk"
import type { HookContext, PanelContent, PanelDescriptor, PanelHook, PanelRenderArgs, PanelSceneEventResult } from "@ham2k/extension-sdk"

import manifest from "../manifest.json" with { type: "json" }
import { loadCatalog, loadStatus } from "./data.ts"
import type { Satellite } from "./data.ts"
import { buildDetail, themeOf } from "./detail.ts"
import type { DetailModel, Tab } from "./detail.ts"
import { loadFavorites, setFavorite } from "./favorites.ts"
import { findPlace } from "./location.ts"
import type { Place } from "./location.ts"
import { clock, minElevation, passCells, table, upcomingPasses } from "./passes.ts"
import type { SatellitePass } from "./passes.ts"
import { linksFor } from "./radio.ts"
import { GLYPH, LEGEND, NO_GLYPH, statusFor, statusHours, statusLines } from "./status.ts"
import type { StatusRow } from "./status.ts"
import { PAGE_SIZE, buildDetailScene, buildScene, detailStrings, detailValues, passOfOpen, satelliteOfStar, stringsOf, valuesOf } from "./scene.ts"
import type { Mode, Model } from "./scene.ts"

const REFRESH_SECONDS = 60

interface PaneState {
  view: "list" | "detail"
  mode: Mode
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
  if (!state) panes.set(id, (state = { view: "list", mode: "favorites", page: 0, utc: args.config?.utc === true }))
  return state
}

const nowMillis = (args: PanelRenderArgs): number => args.clock?.realNowMillis ?? Date.now()

/// Whether the pane counts down to rise, peak and set. Off unless the setting is on.
const countdownOn = (config: Record<string, unknown> | undefined): boolean => config?.countdown === true

const empty = (header: string, state: PaneState): Model => ({
  header,
  hint: "",
  mode: state.mode,
  utc: state.utc,
  page: 0,
  pageCount: 1,
  range: "",
  columns: "",
  legend: "",
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

const glyphFor = (r: Ready, satellite: Satellite): string => {
  const status = statusFor(r.reports, satellite)
  return status ? GLYPH[status.kind] : NO_GLYPH
}

function listModel(r: Ready, state: PaneState, now: number, seconds: boolean): Model {
  // With nobody followed, Favorites would be an empty page; show everything and say how to change that.
  const followed = r.favorites.length > 0
  const showing = state.mode === "all" || !followed ? r.passes : r.passes.filter((p) => r.favorites.includes(p.satellite.name))
  const pageCount = Math.max(1, Math.ceil(showing.length / PAGE_SIZE))
  state.page = Math.min(Math.max(0, state.page), pageCount - 1)
  const first = state.page * PAGE_SIZE
  const page = showing.slice(first, first + PAGE_SIZE)
  // The mark ends the line, where a mark drawn wider than one character in some font cannot push the columns out of line.
  const { columns, lines } = table(page.map((p) => passCells(p, now, state.utc, seconds, glyphFor(r, p.satellite))))
  const rows = page.map((p, i) => ({
    name: p.satellite.name,
    favorite: r.favorites.includes(p.satellite.name),
    text: lines[i],
    los: p.los,
  }))

  const tracked = r.satellites.filter((s) => s.omm).length
  let hint = `No passes of ${r.minEl}° or more in the next 24 hours.`
  if (showing.length) {
    hint =
      state.mode === "favorites" && !followed
        ? "No favorites yet, so every satellite is shown. Tap a star to follow one."
        : `Orbits from CelesTrak, ${clock(r.elementsAt, now, state.utc)}.`
  }

  return {
    header: `${r.place.grid} · min ${r.minEl}° · ${tracked} of ${r.satellites.length} satellites tracked`,
    hint,
    mode: state.mode,
    utc: state.utc,
    page: state.page,
    pageCount,
    range: showing.length ? `${first + 1}–${first + rows.length} of ${showing.length}` : "",
    // Under the list, where it explains the marks without being read before the passes are.
    columns: showing.length ? columns : "",
    legend: showing.length ? LEGEND : "",
    rows,
  }
}

type View = { kind: "list"; model: Model } | { kind: "detail"; model: DetailModel }

/// What the pane shows now, given its state, the favorites and the clock.
async function snapshot(args: PanelRenderArgs, ctx: HookContext): Promise<View> {
  const state = paneState(args)
  const now = nowMillis(args)
  const ready = await gather(args, ctx)
  if (typeof ready === "string") return { kind: "list", model: empty(ready, state) }

  if (state.view === "detail" && state.detail) {
    const { name, los, tab } = state.detail
    // The pass is looked for by its satellite and its end, which hold steady between workings-out.
    const pass = ready.passes.find((p) => p.satellite.name === name && Math.abs(p.los - los) < 120_000)
    if (pass) return { kind: "detail", model: buildDetail(
          pass.satellite,
          ready.place,
          pass,
          now,
          state.utc,
          tab,
          themeOf(args.environment?.colors),
          statusLines(statusFor(ready.reports, pass.satellite), ready.hours, now, state.utc),
          { countdown: countdownOn(args.config) },
        ) }
    state.view = "list" // it has ended, or the settings no longer list it
  }
  return { kind: "list", model: listModel(ready, state, now, args.config?.listSeconds === true) }
}

const patchOf = (view: View): PanelSceneEventResult =>
  view.kind === "list" ? { values: valuesOf(view.model), strings: stringsOf(view.model) } : { values: detailValues(view.model), strings: detailStrings(view.model) }

export const PassesPanel: PanelHook = {
  async getPanels(_args: Record<string, never>, _ctx: HookContext): Promise<PanelDescriptor[]> {
    return [
      {
        key: "passes",
        title: "KM4BE Satellite Passes",
        description: "The next amateur satellite passes for where you are",
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
          { type: "field", key: "listSeconds", fieldType: "checkbox", label: "Show seconds in the pass list" },
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
    const onSky = view.kind === "detail" && view.model.tab === "sky"
    const tick = onSky && countdownOn(args.config) ? "tick:1" : onSky && view.model.underWay ? "tick:2" : undefined
    return { kind: "scene", scene: view.kind === "list" ? buildScene(view.model) : buildDetailScene(view.model), triggers: tick ? [tick] : [] }
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
      return stay()
    }
    if (event.action === "back") {
      state.view = "list"
      return stay()
    }
    if (event.action === "tab" && state.detail && (event.text === "sky" || event.text === "radio")) {
      state.detail.tab = event.text
      return stay()
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

    if (event.action === "mode" && (event.text === "favorites" || event.text === "all")) {
      state.mode = event.text
      state.page = 0
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
