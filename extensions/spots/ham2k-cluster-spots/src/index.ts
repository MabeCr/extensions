// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// DX cluster spots: every `DX de` line the node sends, as a spot on the
// operator's board. The app holds the one connection to the node picked in
// Settings (its docs/design/cluster.md), logged in as the operator; this
// extension only reads it, and posting is `ki2d-cluster-spotter`'s job.
//
// The node pushes spots as they happen, and the board asks for them every two
// minutes, so the lines are kept here in between: the newest spot of each
// station on each band, for as long as a spot is worth showing.
//
// Reading needs the session held open, which a subscription does. The session
// is the operator's own login, which their other cluster client (N1MM, a band
// map) may be fighting for, so it is held only while the board is asking:
// once nothing has fetched for a while, the subscription is let go and the
// app closes the session when idle.

import { defineExtension, host } from "@ham2k/extension-sdk"
import type { ClusterHook, ClusterLine, Spot, SpotsHook } from "@ham2k/extension-sdk"

import manifest from "../manifest.json" with { type: "json" }
import { parseSpotLine } from "./parse.ts"

/// How long a spot stays on the board after the node announced it. A cluster
/// spot is news rather than a schedule: a station spotted an hour ago has
/// usually moved on, and the next spot of it replaces this one anyway.
const MAX_AGE_MILLIS = 60 * 60 * 1000

/// The most spots handed over at once, the newest. A contest weekend with the
/// skimmers on announces thousands an hour, and every one crosses the hook
/// bridge on every refresh.
const MAX_SPOTS = 2000

/// How long after the last fetch the subscription is let go: five of the
/// board's two-minute refreshes, so a board that is merely slow keeps it.
const RELEASE_AFTER_MILLIS = 10 * 60 * 1000

/// The newest spot per station per band, keyed `CALL|band`. A station that
/// moves within a band is where it was last spotted; one on two bands at once
/// (a multi-op, a skimmer hearing both) is on both.
const held = new Map<string, Spot>()

/// The newest line read back on a fetch, by the `seq` the app numbers them
/// with. Only a fetch moves it: a pushed batch can arrive ahead of an older
/// one still being read back, or after one whose delivery failed, and moving
/// it there would skip those for good. A line taken both ways is harmless —
/// it is the same spot, and replaces itself.
let cursor = 0

let subscribed = false
let releaseTimer: number | undefined

function take(lines: ClusterLine[]) {
  for (const line of lines) {
    const spot = parseSpotLine(line.text, line.at)
    if (!spot) continue
    const key = `${spot.their.call}|${spot.band ?? ""}`
    const previous = held.get(key)
    if (!previous || spot.spot.timeInMillis >= previous.spot.timeInMillis) held.set(key, spot)
  }
}

function current(now: number): Spot[] {
  for (const [key, spot] of held) {
    if (now - spot.spot.timeInMillis > MAX_AGE_MILLIS) held.delete(key)
  }
  return [...held.values()].sort((a, b) => b.spot.timeInMillis - a.spot.timeInMillis).slice(0, MAX_SPOTS)
}

/// Subscribes if need be, and puts off letting go.
function holdSession() {
  if (!subscribed) {
    subscribed = true
    // Not awaited: connecting and logging in take up to ten seconds, which
    // is the whole of a spots hook's budget. The spots arrive on the next
    // refresh instead.
    host.clusterSubscribe().catch(() => {
      subscribed = false
    })
  }
  if (releaseTimer !== undefined) host.clearTimeout(releaseTimer)
  releaseTimer = host.setTimeout(releaseSession, RELEASE_AFTER_MILLIS)
}

function releaseSession() {
  releaseTimer = undefined
  if (!subscribed) return
  subscribed = false
  host.clusterUnsubscribe().catch(() => {})
}

const Spots: SpotsHook = {
  // Not "DX Cluster", which `ki2d-cluster-spotter` already answers as: the
  // Spots panel lists every source by this name, and two alike would leave
  // the operator guessing which one brings spots.
  sourceName: "Cluster Spots",

  async fetchSpots(): Promise<Spot[]> {
    const status = await host.clusterStatus()
    // On web, or in an app without the cluster, there is nothing to read.
    if (status.error === "unsupported") return []

    // The app numbers lines from 1 again only when its cluster service is
    // rebuilt; a cursor past its newest line would skip everything after.
    if (status.lastSeq < cursor) cursor = 0

    holdSession()
    // What the node sent since the last read — the scrollback on the first —
    // and anything a delivery to the hook below missed: a failed one is not
    // retried, but its lines stay readable here.
    const lines = await host.clusterLines({ after: cursor })
    take(lines)
    if (lines.length) cursor = lines[lines.length - 1].seq
    return current(Date.now())
  },
}

const Cluster = {
  async onLines({ lines }: { lines: ClusterLine[] }) {
    take(lines)
  },
} satisfies ClusterHook

defineExtension({
  ...manifest,
  onActivation({ registerHook }) {
    registerHook("spots", { hook: Spots, key: manifest.key })
    // Under the extension's own key: that is the key the app delivers a
    // subscription's lines to.
    registerHook("cluster", { hook: Cluster, key: manifest.key })
  },
})
