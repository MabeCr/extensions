// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// A world map of who is spotted right now, a dot to a station colored by band, with a band filter, and a button that puts the
// station you tapped in the log.
//
// The spots are the host's own, the board the Spots panel shows, from every source the operator has: this asks for them with
// `ctx.getSpots` and is told when they change (the `spots` trigger), so it fetches nothing itself. A spot is placed by looking up
// the reference it is at (board.ts), so only the stations at a park, a summit or the like have a dot.
//
// A scene that scrolls (extension API 12): the host scrolls the world along the pane natively, and a drag along the strip at the
// bottom of the map zooms. See scene.ts for how it is drawn and geo.ts for what limits the zoom.

import { defineExtension, host } from "@ham2k/extension-sdk"
import type { HookContext, JSONValue, PanelContent, PanelDescriptor, PanelHook, PanelRenderArgs, PanelSceneEventResult } from "@ham2k/extension-sdk"

import manifest from "../manifest.json" with { type: "json" }
import { loadBoard } from "./board.ts"
import { geometryOf, openingView, regionView, REGIONS, scrollIn, zoomedBy, ZOOM_STEP } from "./geo.ts"
import type { Pane, View } from "./geo.ts"
import { PREVIEW_SVG } from "./preview.ts"
import { buildScene, chromeOf, DOT_PREFIX, linesOf } from "./scene.ts"
import type { MapModel } from "./scene.ts"
import { detailsLine, filterBand, summary } from "./spots.ts"

/// The pane's tab, short enough to read whole on a phone.
const TAB_TITLE = "Spot Map"

export type BoardSource = "all" | "user"
const DEFAULT_MAX_AGE = 30

/// Which spots the board is asked for: everything it has, or what the Spots panel is set to show.
export function boardSource(config: Record<string, JSONValue> | undefined): BoardSource {
  return config?.source === "user" ? "user" : "all"
}

/// How old a spot may be, in minutes, from the pane's settings: 5 to 240, and 30 for anything else.
export function maxAgeMinutes(config: Record<string, JSONValue> | undefined): number {
  const v = config?.maxAgeMinutes
  return typeof v === "number" && Number.isFinite(v) && v >= 1 ? Math.min(240, Math.max(5, Math.floor(v))) : DEFAULT_MAX_AGE
}

/// What each pane is showing: its band filter, the station picked and the view of the map. Per placement, and lost on a restart,
/// which only puts them back to All, none and the whole world.
interface PaneState {
  band: string
  selected: string
  view?: View
}
const stateByPane = new Map<string, PaneState>()
const paneState = (args: PanelRenderArgs): PaneState => {
  const id = args.instanceId ?? args.panelKey
  let state = stateByPane.get(id)
  if (!state) stateByPane.set(id, (state = { band: "all", selected: "" }))
  return state
}

const nowMillis = (args: PanelRenderArgs) => args.clock?.realNowMillis ?? Date.now()

/// The pane's size, or what a phone is when the host does not say.
const paneOf = (args: PanelRenderArgs): Pane => {
  const e = args.environment
  return e && e.width > 0 && e.height > 0 ? { width: e.width, height: e.height } : { width: 360, height: 560 }
}

const operationUuid = (args: PanelRenderArgs): string | undefined => (typeof args.operation?.uuid === "string" ? args.operation.uuid : undefined)

/// Everything the scene reads, so that a render and an event's answer come from the same place.
async function snapshot(args: PanelRenderArgs, ctx: HookContext): Promise<MapModel> {
  const pane = paneOf(args)
  const lines = linesOf(args.environment)
  const chrome = chromeOf(lines)
  const state = paneState(args)
  const now = nowMillis(args)

  const board = await loadBoard(ctx, { filter: boardSource(args.config), maxAgeMinutes: maxAgeMinutes(args.config), operationUuid: operationUuid(args) }, now)
  const shown = filterBand(board.spots, state.band)
  // A station that has gone (QRT, or filtered out) is let go of rather than left picked.
  if (!shown.some((s) => s.call === state.selected)) state.selected = ""
  const chosen = shown.find((s) => s.call === state.selected)

  const view = state.view ?? openingView(pane, chrome, args.operation?.grid)
  const g = geometryOf(pane, chrome, view.zoom)
  const scroll = scrollIn(g, view.scroll)
  const region = REGIONS.find((r) => {
    const v = regionView(pane, chrome, r.value)
    return v && Math.abs(v.zoom - g.zoom) < 0.001 && Math.abs(v.scroll - scroll) < 1
  })

  const said = board.available
    ? summary(shown.length, board.spots.length, board.total - board.spots.length, state.band)
    : "This app does not share its spots with the map."
  return {
    pane,
    lines,
    g,
    spots: shown,
    selected: state.selected,
    band: state.band,
    region: region?.value ?? "",
    scroll,
    summary: said,
    details: detailsLine(chosen, now),
    logLabel: chosen ? `Use ${chosen.call} in the log` : "Use in the log",
    canLog: !!chosen,
  }
}

export const SpotMapPanel: PanelHook = {
  async getPanels(_args: Record<string, never>, _ctx: HookContext): Promise<PanelDescriptor[]> {
    return [
      {
        key: "map",
        title: "KM4BE Spot Map",
        description: "A map of the stations on the spot board, colored by band, with a button to put one in the log",
        icon: "map-marker-radius",
        preview: PREVIEW_SVG,
        // The host says when its board changes, and when the operation does, which is what the board is judged against.
        on: ["spots", "operation"],
        form: [
          {
            type: "field",
            key: "source",
            fieldType: "select",
            label: "Spots to show",
            description: "Everything on the spot board, or only what the Spots panel is set to show.",
            options: [
              { label: "Everything on the board", value: "all" },
              { label: "What the Spots panel shows", value: "user" },
            ],
          },
          {
            type: "field",
            key: "maxAgeMinutes",
            fieldType: "number",
            label: "Newest spots (minutes)",
            description: "Spots older than this are left off the map. 5 to 240; default 30.",
          },
        ],
      },
    ]
  },

  async render(args: PanelRenderArgs, ctx: HookContext): Promise<PanelContent> {
    return { kind: "scene", scene: buildScene(await snapshot(args, ctx)), triggers: [], title: TAB_TITLE }
  },

  async onEvent(args, ctx): Promise<PanelSceneEventResult> {
    const { event } = args
    const state = paneState(args)
    const pane = paneOf(args)
    const chrome = chromeOf(linesOf(args.environment))
    const current = (): View => {
      const view = state.view ?? openingView(pane, chrome, args.operation?.grid)
      return { zoom: view.zoom, scroll: scrollIn(geometryOf(pane, chrome, view.zoom), view.scroll) }
    }
    let moved = false

    if (event.action === "filter" && event.text !== undefined) state.band = event.text === "" ? "all" : event.text
    if (event.action === "pick" && event.controlId.startsWith(DOT_PREFIX)) state.selected = event.controlId.slice(DOT_PREFIX.length)
    // Where the operator has scrolled to, once it has come to rest: kept, and not sent back as a change.
    if (event.action === "scrolled" && typeof event.value === "number" && Number.isFinite(event.value)) {
      const view = current()
      state.view = { zoom: view.zoom, scroll: scrollIn(geometryOf(pane, chrome, view.zoom), event.value) }
      return { values: {} }
    }
    // A drag along the strip, come to rest: the zoom changes by the factor it says, about the middle of the pane.
    if (event.action === "stretch" && typeof event.value === "number") {
      state.view = zoomedBy(pane, chrome, current(), event.value)
      moved = true
    }
    if (event.action === "zoomIn") (state.view = zoomedBy(pane, chrome, current(), ZOOM_STEP)), (moved = true)
    if (event.action === "zoomOut") (state.view = zoomedBy(pane, chrome, current(), 1 / ZOOM_STEP)), (moved = true)
    if (event.action === "region" && event.text !== undefined) {
      const view = regionView(pane, chrome, event.text)
      if (view) (state.view = view), (moved = true)
    }
    if (event.action === "log") await logStation(args, ctx)

    const m = await snapshot(args, ctx)
    return { values: moved ? { scroll: m.scroll } : {}, strings: { band: m.band, region: m.region, summary: m.summary, details: m.details } }
  },
}

/// Puts the picked station in the logging fields of the operation in front, which tunes the radio as a tap on a spot in the Spots panel
/// does: call, frequency, band, mode and the reference it is at. The host says whether it took it.
async function logStation(args: PanelRenderArgs, ctx: HookContext): Promise<void> {
  const state = paneState(args)
  const model = await snapshot(args, ctx)
  const spot = model.spots.find((s) => s.call === state.selected)
  if (!spot) return
  try {
    const result = await host.suggestQso({
      qso: {
        their: { call: spot.call },
        ...(spot.freq ? { freq: spot.freq } : {}),
        ...(spot.band !== "other" ? { band: spot.band } : {}),
        ...(spot.mode ? { mode: spot.mode } : {}),
        ...(spot.ref ? { refs: [{ type: spot.refType, ref: spot.ref }] } : {}),
      },
      ...(operationUuid(args) ? { operationUuid: operationUuid(args) } : {}),
    })
    await host.showMessage({
      presentation: "status",
      icon: result.accepted ? "check" : "alert-circle-outline",
      text: result.accepted ? `${spot.call} is in the log's fields.` : "Open the operation you want to log it in, and try again.",
    })
  } catch (error) {
    host.log(`km4be-spot-maps: logging ${spot.call}: ${error instanceof Error ? error.message : String(error)}`)
    await host.showMessage({ presentation: "status", icon: "alert-circle-outline", text: `Could not put ${spot.call} in the log.` })
  }
}

defineExtension({
  ...manifest,
  onActivation({ registerHook }) {
    registerHook("panel", { key: manifest.key, hook: SpotMapPanel })
  },
})
