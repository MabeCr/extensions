// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// The satellites the operator follows, kept on the device so they outlast a
// restart. Names are the catalog's own (`AO-7`), shared by every pane.

import { host } from "@ham2k/extension-sdk"

const KEY = "favorites"

export async function loadFavorites(): Promise<string[]> {
  const stored = await host.kvGet(KEY)
  return Array.isArray(stored) ? stored.filter((n): n is string => typeof n === "string") : []
}

/// Adds or removes `name`, and answers with the list as it now stands.
export async function setFavorite(name: string, on: boolean): Promise<string[]> {
  const current = await loadFavorites()
  const next = on ? (current.includes(name) ? current : [...current, name]) : current.filter((n) => n !== name)
  if (next.length !== current.length) await host.kvSet(KEY, next)
  return next
}
