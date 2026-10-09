// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// The satellites the operator follows, kept on the device so they outlast a
// restart. Names are the catalog's own (`AO-7`), shared by every pane.

import { host } from "@ham2k/extension-sdk"

import { onForget } from "./memory.ts"

const KEY = "favorites"

/// The list as last read or written: the device's storage is read once, and this copy is the
/// answer after that, since nothing else writes it.
let known: string[] | undefined
onForget(() => {
  known = undefined
})

export async function loadFavorites(): Promise<string[]> {
  if (known) return known
  const stored = await host.kvGet(KEY)
  known = Array.isArray(stored) ? stored.filter((n): n is string => typeof n === "string") : []
  return known
}

/// Adds or removes `name`, and answers with the list as it now stands.
export async function setFavorite(name: string, on: boolean): Promise<string[]> {
  const current = await loadFavorites()
  const next = on ? (current.includes(name) ? current : [...current, name]) : current.filter((n) => n !== name)
  if (next.length !== current.length) {
    known = next
    await host.kvSet(KEY, next)
  }
  return next
}
