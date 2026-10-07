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
import { loadCatalog } from "./data.ts"
import type { Satellite } from "./data.ts"
import { buildDetail, themeOf } from "./detail.ts"
import type { DetailModel, Tab } from "./detail.ts"
import { loadFavorites, setFavorite } from "./favorites.ts"
import { findPlace } from "./location.ts"
import type { Place } from "./location.ts"
import { clock, minElevation, passLine, upcomingPasses } from "./passes.ts"
import type { SatellitePass } from "./passes.ts"
import { linksFor } from "./radio.ts"
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

const empty = (header: string, state: PaneState): Model => ({ header, hint: "", mode: state.mode, utc: state.utc, page: 0, pageCount: 1, range: "", rows: [] })

interface Ready {
  place: Place
  satellites: Satellite[]
  elementsAt: number
  minEl: number
  favorites: string[]
  passes: SatellitePass[]
}

/// Everything the views are made from, or the sentence saying why there is nothing yet.
async function gather(args: PanelRenderArgs, ctx: HookContext): Promise<Ready | string> {
  const place = await findPlace(args.config, args.operation)
  if (!place) return "No location. Allow location access, or enter a grid square in this panel's settings."

  const now = nowMillis(args)
  const { satellites, elementsAt } = await loadCatalog(ctx, now)
  if (!satellites.length) return "No satellite data yet. Check the connection."

  const minEl = minElevation(args.config)
  const favorites = await loadFavorites()
  return { place, satellites, elementsAt, minEl, favorites, passes: upcomingPasses(satellites, place, now, minEl, elementsAt) }
}

function listModel(r: Ready, state: PaneState, now: number): Model {
  // With nobody followed, Favorites would be an empty page; show everything and say how to change that.
  const followed = r.favorites.length > 0
  const showing = state.mode === "all" || !followed ? r.passes : r.passes.filter((p) => r.favorites.includes(p.satellite.name))
  const pageCount = Math.max(1, Math.ceil(showing.length / PAGE_SIZE))
  state.page = Math.min(Math.max(0, state.page), pageCount - 1)
  const first = state.page * PAGE_SIZE
  const rows = showing.slice(first, first + PAGE_SIZE).map((p) => ({
    name: p.satellite.name,
    favorite: r.favorites.includes(p.satellite.name),
    text: passLine(p, now, state.utc),
    los: p.los,
  }))

  const tracked = r.satellites.filter((s) => s.omm).length
  let hint = `Orbits from CelesTrak, ${clock(r.elementsAt, now, state.utc)}.`
  if (!showing.length) hint = `No passes of ${r.minEl}° or more in the next 24 hours.`
  else if (state.mode === "favorites" && !followed) hint = "No favorites yet, so every satellite is shown. Tap a star to follow one."

  return {
    header: `${r.place.grid} · min ${r.minEl}° · ${tracked} of ${r.satellites.length} satellites tracked`,
    hint,
    mode: state.mode,
    utc: state.utc,
    page: state.page,
    pageCount,
    range: showing.length ? `${first + 1}–${first + rows.length} of ${showing.length}` : "",
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
    if (pass) return { kind: "detail", model: buildDetail(pass.satellite, ready.place, pass, now, state.utc, tab, themeOf(args.environment?.colors)) }
    state.view = "list" // it has ended, or the settings no longer list it
  }
  return { kind: "list", model: listModel(ready, state, now) }
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
          { type: "field", key: "utc", fieldType: "checkbox", label: "Start with times in UTC" },
        ],
      },
    ]
  },

  async render(args: PanelRenderArgs, ctx: HookContext): Promise<PanelContent> {
    const view = await snapshot(args, ctx)
    return { kind: "scene", scene: view.kind === "list" ? buildScene(view.model) : buildDetailScene(view.model) }
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
