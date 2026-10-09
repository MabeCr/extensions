// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// How the creature knows a contact has been logged: the panel is drawn with the operation's contact count,
// and when the count is higher than the last time it was drawn, something new has happened. What happened
// is a treat for each contact, or, when the count has crossed a ten, the evolution (the first ten) or a
// celebration (each ten after).
//
// "The last time" has to survive a restart, or opening the app on an operation with forty contacts would
// replay forty contacts' worth of cheering, so the count last seen is kept on the device for each operation.

import { host } from "@ham2k/extension-sdk"
import type { HookContext, JSONValue } from "@ham2k/extension-sdk"

import { celebrationFor } from "./behavior.ts"
import type { Reaction } from "./behavior.ts"
import { FOODS } from "./props.ts"

const KEY = "progress"
/// Operations remembered; the oldest are forgotten first.
const REMEMBERED = 30

interface Seen {
  /// The count the panel last drew for this operation.
  count: number
  /// What it is doing about the latest contact, or was.
  reaction?: Reaction
}

const seen = new Map<string, Seen>()
let stored: Record<string, number> | undefined

/// For tests: forget everything in memory (the device's storage is the test's own to empty).
export function forgetProgress(): void {
  seen.clear()
  stored = undefined
}

async function load(): Promise<Record<string, number>> {
  if (stored) return stored
  const value = (await host.kvGet(KEY)) as JSONValue | null
  const map: Record<string, number> = {}
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [uuid, count] of Object.entries(value)) if (typeof count === "number" && Number.isFinite(count)) map[uuid] = count
  }
  stored = map
  return map
}

async function remember(uuid: string, count: number): Promise<void> {
  const map = await load()
  // Re-inserted, so the most recently seen are last and the oldest are the ones dropped.
  delete map[uuid]
  map[uuid] = count
  for (const old of Object.keys(map).slice(0, Math.max(0, Object.keys(map).length - REMEMBERED))) delete map[old]
  await host.kvSet(KEY, map)
}

/// The reaction to going from `before` contacts to `after`, which is more.
export function reactionTo(before: number, after: number, now: number): Reaction {
  const tens = Math.floor(after / 10)
  // Crossing a ten, even among several contacts logged at once (an import), is the event worth showing.
  if (tens > Math.floor(before / 10)) return { kind: celebrationFor(tens), at: now }
  return { kind: "treat", at: now, food: FOODS[after % FOODS.length] }
}

/// Notes that the panel is being drawn for `uuid` with `count` contacts, and answers with what the creature is
/// reacting to: a new reaction if there are new contacts, the one in progress if not.
export async function observe(uuid: string, count: number, now: number): Promise<Reaction | undefined> {
  let state = seen.get(uuid)
  if (!state) {
    // First sight since the app started. If the device remembers the operation, whatever happened since is news;
    // if not, it is a creature meeting an operation already under way, and it simply grows up to size.
    const before = (await load())[uuid]
    state = { count: before ?? count }
    seen.set(uuid, state)
    if (before === undefined) await remember(uuid, count)
  }

  if (count > state.count) {
    state.reaction = reactionTo(state.count, count, now)
    state.count = count
    await remember(uuid, count)
  } else if (count < state.count) {
    // Contacts deleted: it is smaller, and nothing to cheer about.
    state.count = count
    state.reaction = undefined
    await remember(uuid, count)
  }
  return state.reaction
}

/// Starts a pat, unless something bigger is still going on.
export function pet(uuid: string, now: number, busy: (reaction: Reaction) => boolean): void {
  const state = seen.get(uuid)
  if (!state) return
  if (state.reaction && busy(state.reaction)) return
  state.reaction = { kind: "pet", at: now }
}

/// Counts the contacts in a log: everything but the markers of events (a band of `event`), which are not contacts.
export function contactsIn(qsos: Record<string, JSONValue>[]): number {
  return qsos.filter((q) => q.band !== "event").length
}

const counted = new Map<string, { reported: number; real: number }>()

/// The operation's contact count. The host reports one, but what it counts is not written down, so the log itself
/// is read, and only when the reported count has changed: a read of the whole log is not for every second.
export async function countContacts(ctx: HookContext, uuid: string, reported: number): Promise<number> {
  const known = counted.get(uuid)
  if (known && known.reported === reported) return known.real
  const log = uuid ? await ctx.getQsos?.(uuid) : null
  const real = log ? contactsIn(log) : reported
  counted.set(uuid, { reported, real })
  return real
}

export function forgetCounts(): void {
  counted.clear()
}
