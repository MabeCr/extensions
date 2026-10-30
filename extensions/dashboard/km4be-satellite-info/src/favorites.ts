// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// The satellites the operator follows, and whether the list shows All or only
// Favorites, kept on the device so they outlast a restart. Names are the catalog's
// own (`AO-7`), shared by every pane.
//
// They live in the extension's own settings group (`host.setSettings`), the one
// durable store an extension has: `host.kvSet` is in memory only, so a list kept
// there was gone every time the app was relaunched.

import { host } from "@ham2k/extension-sdk"

import manifest from "../manifest.json" with { type: "json" }
import { onForget } from "./memory.ts"

const KEY = "favorites"
const MODE_KEY = "mode"

/// Which view the pane shows: the list of every pass, the list of those of the satellites followed, or the sky with what is up now.
export type Mode = "favorites" | "all" | "now"

/// What is kept, as last read or written: the settings are read once, and this copy is the
/// answer after that, since nothing else writes them.
let known: { favorites: string[]; mode: Mode } | undefined
onForget(() => {
  known = undefined
})

/// This extension's group of the app's settings, where `setSettings` writes.
async function ownSettings(): Promise<Record<string, unknown> | undefined> {
  const all = (await host.getSettings()) as Record<string, unknown> | null
  const extensions = all?.extensions as Record<string, unknown> | undefined
  return extensions?.[`extension_${manifest.key}`] as Record<string, unknown> | undefined
}

async function load(): Promise<{ favorites: string[]; mode: Mode }> {
  if (known) return known
  const own = await ownSettings()
  const stored = own?.[KEY]
  known = {
    favorites: Array.isArray(stored) ? stored.filter((n): n is string => typeof n === "string") : [],
    // All unless the operator has chosen another: that is what a new install starts on.
    mode: own?.[MODE_KEY] === "favorites" || own?.[MODE_KEY] === "now" ? (own[MODE_KEY] as Mode) : "all",
  }
  return known
}

export async function loadFavorites(): Promise<string[]> {
  return (await load()).favorites
}

/// Which view the operator last chose, `all` when they never have.
export async function loadMode(): Promise<Mode> {
  return (await load()).mode
}

/// Remembers the view, for the next time the app is opened.
export async function saveMode(mode: Mode): Promise<void> {
  const current = await load()
  if (current.mode === mode) return
  known = { ...current, mode }
  await host.setSettings({ [MODE_KEY]: mode })
}

/// Adds or removes `name`, and answers with the list as it now stands.
export async function setFavorite(name: string, on: boolean): Promise<string[]> {
  const { favorites: current, mode } = await load()
  const next = on ? (current.includes(name) ? current : [...current, name]) : current.filter((n) => n !== name)
  if (next.length !== current.length) {
    known = { favorites: next, mode }
    await host.setSettings({ [KEY]: next })
  }
  return next
}
