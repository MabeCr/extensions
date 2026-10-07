// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// A world map of who is on the air from a POTA park right now, a dot to an
// activator colored by band, with a band filter.
//
// The host does not hand a panel the spots its own list shows: `getSpotsForCall`
// answers for one call and never fetches. So this fetches POTA's activator feed
// itself, the way the POTA extension does, and shares nothing with the Spots pane.
//
// Drawn as a panel scene (extension API 5): the world as one SVG layer, the dots
// as another, a native dropdown for the band. Scene units are the map's own, and
// the host scales the artwork to fit the pane.

import { defineExtension, host } from "@ham2k/extension-sdk"
import type { HookContext, PanelContent, PanelDescriptor, PanelHook, PanelRenderArgs, PanelSceneEventResult } from "@ham2k/extension-sdk"

import manifest from "../manifest.json" with { type: "json" }
import { BANDS, MAX_CLICKABLE, clockUtc, detailsLine, dotHitArea, filterBand, markersSvg, parseSpots, spotOptions, summary } from "./spots.ts"
import type { MapSpot, PotaApiSpot } from "./spots.ts"
import { BORDER_PATH, LAND_PATH, MAP_HEIGHT, MAP_WIDTH } from "./world.ts"

const SPOTS_URL = "https://api.pota.app/spot/activator"
/// Spots change by the minute, and several triggers can land together.
const CACHE_MILLIS = 30_000
const REFRESH_SECONDS = 60

const BASE_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MAP_WIDTH} ${MAP_HEIGHT}">` +
  `<rect width="${MAP_WIDTH}" height="${MAP_HEIGHT}" fill="#10243a"/>` +
  `<path d="${LAND_PATH}" fill="#2b3f4f" stroke="none"/>` +
  `<path d="${BORDER_PATH}" fill="none" stroke="#4d6577" stroke-width="0.5"/></svg>`

let cache: { at: number; spots: MapSpot[] } | undefined

/// `force` is the Refresh button: fetch now, whatever the cache holds.
async function currentSpots(ctx: HookContext, nowMillis: number, force = false): Promise<{ at: number; spots: MapSpot[] }> {
  if (cache && !force && nowMillis - cache.at < CACHE_MILLIS) return cache
  // Offline, or the feed is down: keep drawing the last map rather than a blank one.
  if (ctx.online) {
    try {
      const response = await host.fetch(SPOTS_URL)
      if (response.status !== 200) throw new Error(`POTA API returned HTTP ${response.status}`)
      cache = { at: nowMillis, spots: parseSpots(JSON.parse(response.body) as PotaApiSpot[]) }
    } catch (error) {
      host.log(`km4be-spot-maps: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return cache ?? { at: 0, spots: [] }
}

/// What each pane is showing: its band filter and the station picked. Per
/// placement, and lost on a restart, which only puts both back to none.
const stateByPane = new Map<string, { band: string; selected: string }>()
const paneId = (args: PanelRenderArgs) => args.instanceId ?? args.panelKey
const paneState = (args: PanelRenderArgs) => {
  const id = paneId(args)
  let state = stateByPane.get(id)
  if (!state) stateByPane.set(id, (state = { band: "all", selected: "" }))
  return state
}

const DOT_PREFIX = "dot:"

const nowMillis = (args: PanelRenderArgs) => args.clock?.realNowMillis ?? Date.now()

/// Everything the scene reads from the feed and the pane's state, so a render
/// and an event answer from the same place.
async function view(args: PanelRenderArgs, ctx: HookContext, force = false) {
  const now = nowMillis(args)
  const feed = await currentSpots(ctx, now, force)
  const state = paneState(args)
  const shown = filterBand(feed.spots, state.band)
  const options = spotOptions(shown)
  // The dropdown holds "" or one of its options, so a station that has gone
  // (QRT, or filtered out) is let go of rather than left dangling.
  if (!options.some((o) => o.value === state.selected)) state.selected = ""
  const chosen = shown.find((s) => s.call === state.selected)
  const updated = feed.at ? ` · updated ${clockUtc(feed.at)}` : ""
  return {
    shown,
    options,
    state,
    strings: {
      band: state.band,
      spot: state.selected,
      summary: summary(shown.length, feed.spots.length, state.band) + updated,
      details: detailsLine(chosen, now),
    },
  }
}

export const SpotMapPanel: PanelHook = {
  async getPanels(_args: Record<string, never>, _ctx: HookContext): Promise<PanelDescriptor[]> {
    return [
      {
        key: "map",
        title: "KM4BE POTA Spot Map",
        description: "A map of the activators currently spotted on POTA, colored by band",
        icon: "map-marker-radius",
        on: [`tick:${REFRESH_SECONDS}`],
      },
    ]
  },

  async render(args: PanelRenderArgs, ctx: HookContext): Promise<PanelContent> {
    const { shown, options, state, strings } = await view(args, ctx)

    return {
      kind: "scene",
      scene: {
        version: 1,
        width: MAP_WIDTH,
        height: MAP_HEIGHT,
        values: {},
        strings,
        layers: [
          { id: "world", x: 0, y: 0, width: MAP_WIDTH, height: MAP_HEIGHT, svg: BASE_SVG },
          { id: "spots", x: 0, y: 0, width: MAP_WIDTH, height: MAP_HEIGHT, svg: markersSvg(shown, state.selected) },
        ],
        controls: [
          {
            id: "band",
            kind: "nativeDropdown",
            label: "Band",
            value: "band",
            event: "filter",
            options: [{ label: "All bands", value: "all" }, ...BANDS.map((b) => ({ label: b, value: b }))],
          },
          { id: "spot", kind: "nativeDropdown", label: "Station", value: "spot", event: "select", options },
          { id: "refresh", kind: "nativeButton", label: "Refresh", icon: "refresh", variant: "tonal", event: "refresh" },
          { id: "summary", kind: "nativeText", label: "Activators shown", value: "summary", align: "start" },
          { id: "details", kind: "nativeText", label: "Selected station", value: "details", align: "start" },
          // A click target the size of each dot, oldest first so the newest sits on top.
          ...shown
            .slice(0, MAX_CLICKABLE)
            .reverse()
            .map((s) => ({
              id: DOT_PREFIX + s.call,
              kind: "button" as const,
              label: `${s.call} ${s.band} ${s.ref}`.trim(),
              event: "pick",
              ...dotHitArea(s),
            })),
        ],
        layout: {
          column: [
            {
              row: [{ control: "band", width: 130 }, { control: "spot", flex: 1 }, { control: "refresh" }],
              spacing: 8,
              crossAxisAlignment: "center",
            },
            { control: "summary" },
            { scene: true, flex: 1 },
            { control: "details" },
          ],
          padding: 8,
          spacing: 8,
          crossAxisAlignment: "stretch",
        },
      },
    }
  },

  async onEvent(args, ctx): Promise<PanelSceneEventResult> {
    const { event } = args
    const state = paneState(args)
    if (event.action === "filter" && event.text !== undefined) state.band = event.text === "" ? "all" : event.text
    if (event.action === "select" && event.text !== undefined) state.selected = event.text
    if (event.action === "pick" && event.controlId.startsWith(DOT_PREFIX)) state.selected = event.controlId.slice(DOT_PREFIX.length)
    const { strings } = await view(args, ctx, event.action === "refresh")
    return { values: {}, strings }
  },
}

defineExtension({
  ...manifest,
  onActivation({ registerHook }) {
    registerHook("panel", { key: manifest.key, hook: SpotMapPanel })
  },
})
