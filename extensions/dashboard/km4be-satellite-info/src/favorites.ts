// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// The satellites the operator follows, kept on the device so they outlast a
// restart. Names are the catalog's own (`AO-7`), shared by every pane.
//
// They live in the extension's own settings group (`host.setSettings`), the one
// durable store an extension has: `host.kvSet` is in memory only, so a list kept
// there was gone every time the app was relaunched.

import { host } from "@ham2k/extension-sdk"

import manifest from "../manifest.json" with { type: "json" }
import { onForget } from "./memory.ts"

const KEY = "favorites"

/// The list as last read or written: the settings are read once, and this copy is the
/// answer after that, since nothing else writes it.
let known: string[] | undefined
onForget(() => {
  known = undefined
})

/// This extension's group of the app's settings, where `setSettings` writes.
async function ownSettings(): Promise<Record<string, unknown> | undefined> {
  const all = (await host.getSettings()) as Record<string, unknown> | null
  const extensions = all?.extensions as Record<string, unknown> | undefined
  return extensions?.[`extension_${manifest.key}`] as Record<string, unknown> | undefined
}

export async function loadFavorites(): Promise<string[]> {
  if (known) return known
  const stored = (await ownSettings())?.[KEY]
  known = Array.isArray(stored) ? stored.filter((n): n is string => typeof n === "string") : []
  return known
}

/// Adds or removes `name`, and answers with the list as it now stands.
export async function setFavorite(name: string, on: boolean): Promise<string[]> {
  const current = await loadFavorites()
  const next = on ? (current.includes(name) ? current : [...current, name]) : current.filter((n) => n !== name)
  if (next.length !== current.length) {
    known = next
    await host.setSettings({ [KEY]: next })
  }
  return next
}
