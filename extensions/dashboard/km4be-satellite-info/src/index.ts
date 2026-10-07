// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// Amateur radio satellite passes for where the operator is, with the birds'
// frequencies and AMSAT's status to come. See data.ts for where each piece of
// data comes from.
//
// This first panel is markdown: the next passes across every satellite that has
// orbital elements, soonest first. The interactive scene (favorites, a pass's
// sky plot and Doppler) builds on the same data.

import { defineExtension } from "@ham2k/extension-sdk"
import type { HookContext, PanelContent, PanelDescriptor, PanelHook, PanelRenderArgs } from "@ham2k/extension-sdk"

import manifest from "../manifest.json" with { type: "json" }
import { loadCatalog } from "./data.ts"
import { findPlace } from "./location.ts"
import { clock, direction, duration, minElevation, nextPasses } from "./passes.ts"

const ROWS = 12
const REFRESH_SECONDS = 60

const escapeMarkdown = (text: string): string => text.replace(/[\\`*_[\]<>|~&]/g, "\\$&")

const message = (text: string): string => `_${escapeMarkdown(text)}_`

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
          { type: "field", key: "utc", fieldType: "checkbox", label: "Show times in UTC" },
        ],
      },
    ]
  },

  async render(args: PanelRenderArgs, ctx: HookContext): Promise<PanelContent> {
    const now = args.clock?.realNowMillis ?? Date.now()
    const place = await findPlace(args.config, args.operation)
    if (!place) {
      return { kind: "markdown", content: message("No location. Allow location access, or enter a grid square in this panel's settings.") }
    }

    const { satellites, elementsAt } = await loadCatalog(ctx, now)
    if (!satellites.length) return { kind: "markdown", content: message("No satellite data yet. Check the connection.") }

    const utc = args.config?.utc === true
    const minEl = minElevation(args.config)
    const passes = nextPasses(satellites, place, now, minEl).slice(0, ROWS)
    const tracked = satellites.filter((s) => s.omm).length

    const lines = [`**Next passes** for ${place.grid} · min ${minEl}° · ${tracked} of ${satellites.length} satellites tracked`, ""]
    if (!passes.length) {
      lines.push(message(`No passes of ${minEl}° or more in the next 24 hours.`))
    } else {
      lines.push("| Start | Satellite | Max | Path | Length |", "|:--|:--|--:|:--|--:|")
      for (const p of passes) {
        const start = p.inProgress ? "now" : clock(p.aos, now, utc)
        lines.push(`| ${start} | ${escapeMarkdown(p.satellite.name)} | ${Math.round(p.maxElevation)}° | ${direction(p)} | ${duration(p)} |`)
      }
    }
    if (elementsAt) lines.push("", `_Orbits from CelesTrak, ${clock(elementsAt, now, utc)}._`)
    return { kind: "markdown", content: lines.join("\n") }
  },
}

defineExtension({
  ...manifest,
  onActivation({ registerHook }) {
    registerHook("panel", { key: manifest.key, hook: PassesPanel })
  },
})
