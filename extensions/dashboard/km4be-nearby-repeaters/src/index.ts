// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// Repeaters near you, from a CSV the operator pastes into the panel's
// settings, sorted by distance from the device's position (or the grid typed
// into the same settings), with the national simplex calling channels under
// them. Drawn as markdown, so it is view only: setting offset and tone is
// left to the radio, as the SDK's tune call carries only frequency and mode.

import { defineExtension, host } from "@ham2k/extension-sdk"
import type { HookContext, PanelContent, PanelDescriptor, PanelHook, PanelRenderArgs } from "@ham2k/extension-sdk"
import { gridToLocation } from "@ham2k/lib-geo-tools"

import manifest from "../manifest.json" with { type: "json" }
import { repeatersMarkdown, messageMarkdown } from "./markdown.ts"
import { parseRepeaters, rankRepeaters } from "./repeaters.ts"

const DEFAULT_MAX = 10

async function whereAmI(grid: unknown): Promise<{ lat: number; lon: number } | null> {
  const device = await host.getLocation().catch(() => null)
  if (device && Number.isFinite(device.latitude) && Number.isFinite(device.longitude)) {
    return { lat: device.latitude, lon: device.longitude }
  }
  if (typeof grid === "string" && /^[A-Ra-r]{2}\d{2}([A-Xa-x]{2})?$/.test(grid.trim())) {
    try {
      const [lat, lon] = gridToLocation(grid.trim())
      if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon }
    } catch { /* fall through */ }
  }
  return null
}

export const RepeatersPanel: PanelHook = {
  async getPanels(_args: Record<string, never>, _ctx: HookContext): Promise<PanelDescriptor[]> {
    return [
      {
        key: "nearby",
        title: "KM4BE Nearby Repeaters",
        description: "Repeaters from your imported list, nearest first",
        icon: "radio-tower",
        form: [
          { type: "field", key: "csv", fieldType: "multiline", label: "Repeater list (CSV)",
            description: "Paste an export with a header row. Needs a frequency column; Lat and Lon let it sort by distance. Offset, Duplex, Tone, Call and Name or Location are used when present." },
          { type: "field", key: "grid", fieldType: "text", label: "Fallback grid square",
            description: "Used when the device cannot give a position, e.g. FM18." },
          { type: "field", key: "max", fieldType: "number", label: "Maximum repeaters",
            description: `Default ${DEFAULT_MAX}.` },
        ],
      },
    ]
  },

  async render(args: PanelRenderArgs, _ctx: HookContext): Promise<PanelContent> {
    const csv = typeof args.config?.csv === "string" ? args.config.csv : ""
    const maxCfg = args.config?.max
    const max = typeof maxCfg === "number" && Number.isFinite(maxCfg) && maxCfg >= 1 ? Math.floor(maxCfg) : DEFAULT_MAX

    const list = parseRepeaters(csv)
    const here = list.some((r) => r.lat !== undefined) ? await whereAmI(args.config?.grid) : null
    if (csv.trim() && !list.length) {
      return { kind: "markdown", content: messageMarkdown("No repeaters found: the CSV needs a header row with a Frequency column.") }
    }
    return { kind: "markdown", content: repeatersMarkdown(rankRepeaters(list, here, max), list.length, here !== null) }
  },
}

defineExtension({
  ...manifest,
  onActivation({ registerHook }) {
    registerHook("panel", { key: manifest.key, hook: RepeatersPanel })
  },
})
