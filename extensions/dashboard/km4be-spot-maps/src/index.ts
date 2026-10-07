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
import { BANDS, filterBand, markersSvg, parseSpots, summary } from "./spots.ts"
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

async function currentSpots(ctx: HookContext, nowMillis: number): Promise<MapSpot[]> {
  if (cache && nowMillis - cache.at < CACHE_MILLIS) return cache.spots
  // Offline, or the feed is down: keep drawing the last map rather than a blank one.
  if (!ctx.online) return cache?.spots ?? []
  try {
    const response = await host.fetch(SPOTS_URL)
    if (response.status !== 200) throw new Error(`POTA API returned HTTP ${response.status}`)
    cache = { at: nowMillis, spots: parseSpots(JSON.parse(response.body) as PotaApiSpot[]) }
  } catch (error) {
    host.log(`km4be-spot-maps: ${error instanceof Error ? error.message : String(error)}`)
    if (!cache) return []
  }
  return cache.spots
}

/// The band each pane is filtered to. Per placement, and lost on a restart,
/// which only puts the filter back to All.
const bandByPane = new Map<string, string>()
const paneId = (args: PanelRenderArgs) => args.instanceId ?? args.panelKey
const paneBand = (args: PanelRenderArgs) => bandByPane.get(paneId(args)) ?? "all"

const nowMillis = (args: PanelRenderArgs) => args.clock?.realNowMillis ?? Date.now()

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
    const all = await currentSpots(ctx, nowMillis(args))
    const band = paneBand(args)
    const shown = filterBand(all, band)

    return {
      kind: "scene",
      scene: {
        version: 1,
        width: MAP_WIDTH,
        height: MAP_HEIGHT,
        values: {},
        strings: { band, summary: summary(shown.length, all.length, band) },
        layers: [
          { id: "world", x: 0, y: 0, width: MAP_WIDTH, height: MAP_HEIGHT, svg: BASE_SVG },
          { id: "spots", x: 0, y: 0, width: MAP_WIDTH, height: MAP_HEIGHT, svg: markersSvg(shown) },
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
          { id: "summary", kind: "nativeText", label: "Activators shown", value: "summary", align: "end" },
        ],
        layout: {
          column: [
            { row: [{ control: "band", width: 140 }, { control: "summary", flex: 1 }], spacing: 8, crossAxisAlignment: "center" },
            { scene: true, flex: 1 },
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
    if (event.action === "filter" && event.text !== undefined) {
      bandByPane.set(paneId(args), event.text === "" ? "all" : event.text)
    }
    const all = await currentSpots(ctx, nowMillis(args))
    const band = paneBand(args)
    return { values: {}, strings: { band, summary: summary(filterBand(all, band).length, all.length, band) } }
  },
}

defineExtension({
  ...manifest,
  onActivation({ registerHook }) {
    registerHook("panel", { key: manifest.key, hook: SpotMapPanel })
  },
})
