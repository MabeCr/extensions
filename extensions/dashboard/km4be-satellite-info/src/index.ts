// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// Amateur radio satellite passes for where the operator is. See data.ts for
// where each piece of data comes from.
//
// A panel scene (extension API 5): the next passes, a page at a time, with a
// star to follow a satellite, a Favorites / All switch and a UTC switch.
// Favorites live on the device (favorites.ts); the page, the switch and the UTC
// choice are per pane and start over on a restart.

import { defineExtension } from "@ham2k/extension-sdk"
import type { HookContext, PanelContent, PanelDescriptor, PanelHook, PanelRenderArgs, PanelSceneEventResult } from "@ham2k/extension-sdk"

import manifest from "../manifest.json" with { type: "json" }
import { loadCatalog } from "./data.ts"
import { loadFavorites, setFavorite } from "./favorites.ts"
import { findPlace } from "./location.ts"
import { clock, minElevation, passLine, upcomingPasses } from "./passes.ts"
import { PAGE_SIZE, buildScene, satelliteOfStar, stringsOf, valuesOf } from "./scene.ts"
import type { Mode, Model } from "./scene.ts"

const REFRESH_SECONDS = 60

interface PaneState {
  mode: Mode
  page: number
  utc: boolean
}

/// Per placement, keyed the way the spot map keys its own.
const panes = new Map<string, PaneState>()
const paneState = (args: PanelRenderArgs): PaneState => {
  const id = args.instanceId ?? args.panelKey
  let state = panes.get(id)
  if (!state) panes.set(id, (state = { mode: "favorites", page: 0, utc: args.config?.utc === true }))
  return state
}

const nowMillis = (args: PanelRenderArgs): number => args.clock?.realNowMillis ?? Date.now()

const empty = (header: string, state: PaneState): Model => ({ header, hint: "", mode: state.mode, utc: state.utc, page: 0, pageCount: 1, range: "", rows: [] })

/// The pane as a model: what is on the page given the settings, the favorites and the clock.
async function snapshot(args: PanelRenderArgs, ctx: HookContext): Promise<Model> {
  const now = nowMillis(args)
  const state = paneState(args)

  const place = await findPlace(args.config, args.operation)
  if (!place) return empty("No location. Allow location access, or enter a grid square in this panel's settings.", state)

  const { satellites, elementsAt } = await loadCatalog(ctx, now)
  if (!satellites.length) return empty("No satellite data yet. Check the connection.", state)

  const minEl = minElevation(args.config)
  const favorites = await loadFavorites()
  const all = upcomingPasses(satellites, place, now, minEl, elementsAt)

  // With nobody followed yet, Favorites would be an empty page; show everything and say how to change that.
  const followed = favorites.length > 0
  const showing = state.mode === "all" || !followed ? all : all.filter((p) => favorites.includes(p.satellite.name))
  const pageCount = Math.max(1, Math.ceil(showing.length / PAGE_SIZE))
  state.page = Math.min(Math.max(0, state.page), pageCount - 1)
  const first = state.page * PAGE_SIZE
  const rows = showing.slice(first, first + PAGE_SIZE).map((p) => ({
    name: p.satellite.name,
    favorite: favorites.includes(p.satellite.name),
    text: passLine(p, now, state.utc),
  }))

  const tracked = satellites.filter((s) => s.omm).length
  let hint = `Orbits from CelesTrak, ${clock(elementsAt, now, state.utc)}.`
  if (!showing.length) hint = `No passes of ${minEl}° or more in the next 24 hours.`
  else if (state.mode === "favorites" && !followed) hint = "No favorites yet, so every satellite is shown. Tap a star to follow one."

  return {
    header: `${place.grid} · min ${minEl}° · ${tracked} of ${satellites.length} satellites tracked`,
    hint,
    mode: state.mode,
    utc: state.utc,
    page: state.page,
    pageCount,
    range: showing.length ? `${first + 1}–${first + rows.length} of ${showing.length}` : "",
    rows,
  }
}

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
    return { kind: "scene", scene: buildScene(await snapshot(args, ctx)) }
  },

  async onEvent(args, ctx): Promise<PanelSceneEventResult> {
    const { event } = args
    const state = paneState(args)
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
    const model = await snapshot(args, ctx)
    return { values: valuesOf(model), strings: stringsOf(model) }
  },
}

defineExtension({
  ...manifest,
  onActivation({ registerHook }) {
    registerHook("panel", { key: manifest.key, hook: PassesPanel })
  },
})
