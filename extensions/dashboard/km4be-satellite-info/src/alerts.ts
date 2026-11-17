// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// Pass alerts on the FYI line under the call info (extension API 14), so a pass is not missed with the
// panel closed: "AO-7 rises in 2 min in the NNE, up to 62°", then "AO-7 is up, 45° WSW, sets in 6 min",
// gone when it sets. Switched on in the panel's settings, for every satellite or the favorites only.
//
// The choice is kept in the extension's own settings, since the timer that posts the alerts runs from
// activation, before any panel is drawn, and with none shown at all.

import { host } from "@ham2k/extension-sdk"

import type { Satellite } from "./data.ts"
import { keptSetting } from "./favorites.ts"
import { compass, lookAt, satrecFromOmm } from "./orbit.ts"
import type { Observer } from "./orbit.ts"
import type { SatellitePass } from "./passes.ts"

export interface AlertSettings {
  on: boolean
  /// The satellites marked on the Band Scope too (bandscope.ts), which shares the timer and the favorites choice.
  labels: boolean
  favoritesOnly: boolean
  /// How long before rise the alert goes up, in minutes.
  leadMin: number
  minEl: number
  /// The panel's grid square, for when the device cannot say where it is.
  grid: string
}

export const DEFAULT_LEAD_MIN = 3
/// The FYI line holds four messages of an extension's at most; one is left for anything else.
export const MAX_ALERTS = 3
const SETTINGS_KEY = "alerts"

const numberIn = (v: unknown, low: number, high: number, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(high, Math.max(low, v)) : fallback

/// The alert settings from the panel's form.
export function alertSettingsFrom(config: Record<string, unknown> | undefined, minEl: number): AlertSettings {
  return {
    on: config?.alerts === true,
    labels: config?.bandLabels === true,
    favoritesOnly: config?.alertsFavorites === true,
    leadMin: numberIn(config?.alertLead, 1, 30, DEFAULT_LEAD_MIN),
    minEl,
    grid: typeof config?.grid === "string" ? config.grid : "",
  }
}

export interface Alert {
  key: string
  text: string
  category: "info" | "operational"
  expiresInSeconds: number
}

const minutes = (ms: number): string => {
  const m = Math.max(0, Math.ceil(ms / 60_000))
  return m < 1 ? "less than a minute" : `${m} min`
}

/// The alerts to show at `now`: each pass of a satellite alerted for that rises within the lead time or is up, soonest first, a few at most.
export function alertsFor(passes: SatellitePass[], favorites: string[], settings: AlertSettings, observer: Observer, now: number): Alert[] {
  if (!settings.on) return []
  const lead = settings.leadMin * 60_000
  const wanted = passes.filter((p) => (!settings.favoritesOnly || favorites.includes(p.satellite.name)) && p.los > now && p.aos - now <= lead)
  return wanted.slice(0, MAX_ALERTS).map((p) => alertFor(p, observer, now))
}

function alertFor(p: SatellitePass, observer: Observer, now: number): Alert {
  const name = p.satellite.name
  const expiresInSeconds = Math.max(1, Math.min(86_400, Math.ceil((p.los - now) / 1000)))
  if (p.aos > now) {
    return {
      key: `pass-${name}`,
      text: `**${name}** rises in ${minutes(p.aos - now)} in the ${compass(p.aosAzimuth)}, up to ${Math.round(p.maxElevation)}°`,
      category: "info",
      expiresInSeconds,
    }
  }
  const here = up(p.satellite, observer, now)
  return {
    key: `pass-${name}`,
    text: `**${name}** is up${here ? `, ${Math.round(here.elevation)}° ${compass(here.azimuth)}` : ""}, sets in ${minutes(p.los - now)}`,
    category: "operational",
    expiresInSeconds,
  }
}

const up = (satellite: Satellite, observer: Observer, now: number) => (satellite.omm ? lookAt(satrecFromOmm(satellite.omm), observer, now) : null)

/// The FYI calls, handed in so a test can stand in for the line.
export interface FyiHost {
  post(params: { key: string; category: Alert["category"]; text: string; icon: string; expiresInSeconds: number }): Promise<void>
  clear(key: string): Promise<void>
}

/// What is on the line, so that a message is posted only when its words change, and taken down when its pass is over.
export class AlertLine {
  private shown = new Map<string, string>()
  private readonly fyi: FyiHost

  constructor(fyi: FyiHost) {
    this.fyi = fyi
  }

  async show(alerts: Alert[]): Promise<void> {
    const keys = new Set(alerts.map((a) => a.key))
    for (const key of [...this.shown.keys()]) {
      if (!keys.has(key)) {
        this.shown.delete(key)
        await this.fyi.clear(key)
      }
    }
    for (const a of alerts) {
      if (this.shown.get(a.key) === a.text) continue
      this.shown.set(a.key, a.text)
      await this.fyi.post({ key: a.key, category: a.category, text: a.text, icon: "satellite-variant", expiresInSeconds: a.expiresInSeconds })
    }
  }

  async clearAll(): Promise<void> {
    await this.show([])
  }
}

/// The alert settings as last kept, or off.
export async function loadAlertSettings(): Promise<AlertSettings> {
  // Read with the favorites, which are wanted at launch anyway.
  const kept = (await keptSetting(SETTINGS_KEY)) as Partial<AlertSettings> | undefined
  return {
    on: kept?.on === true,
    labels: kept?.labels === true,
    favoritesOnly: kept?.favoritesOnly === true,
    leadMin: numberIn(kept?.leadMin, 1, 30, DEFAULT_LEAD_MIN),
    minEl: numberIn(kept?.minEl, 0, 60, 10),
    grid: typeof kept?.grid === "string" ? kept.grid : "",
  }
}

export async function saveAlertSettings(settings: AlertSettings): Promise<void> {
  await host.setSettings({ [SETTINGS_KEY]: { ...settings } })
}

export const sameSettings = (a: AlertSettings, b: AlertSettings): boolean => JSON.stringify(a) === JSON.stringify(b)
