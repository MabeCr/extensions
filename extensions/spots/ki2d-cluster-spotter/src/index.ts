// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// DX cluster spotting: a self-spot, or a spot of a station just worked, goes
// to the DX cluster network through the one connection the app holds to the
// node picked in Settings. Posting once, to one node, is the whole job — the
// nodes forward it to each other.
//
// A spots source that posts and never reads: reading the cluster is a
// different extension's job, so `fetchSpots` answers nothing.

import { defineExtension, host } from "@ham2k/extension-sdk"
import type { ClusterReply, HookContext, PostOtherSpotRequest, PostResult, PostSelfSpotRequest, Spot, SpotEligibility, SpotsHook } from "@ham2k/extension-sdk"

import manifest from "../manifest.json" with { type: "json" }
import { tFor } from "./i18n.ts"
import { firstCall, isTestCall, spotComment, type Json } from "./spotText.ts"

/// The host's error codes that have words of their own; anything else falls
/// back to what the node said, then to the code itself.
const known = new Set(["unsupported", "noCall", "connectFailed", "needsPassword", "loginFailed", "disconnected", "timeout", "tooSoon", "invalidCall", "invalidFrequency"])

function resultOf(reply: ClusterReply, ctx: HookContext): PostResult {
  if (reply.ok) return { ok: true }
  const t = tFor(ctx), error = reply.error ?? ""
  const message = error === "refused" && reply.message ? t("refused", { message: reply.message }) : known.has(error) ? t(error) : (reply.message ?? (error || t("notPosted")))
  return { ok: false, message }
}

async function clusterAvailable(): Promise<boolean> {
  const status = await host.clusterStatus()
  return status.error !== "unsupported"
}

const Hook: SpotsHook = {
  sourceName: "DX Cluster",

  async fetchSpots(): Promise<Spot[]> {
    return []
  },

  async isSelfSpotEnabled({ operation }): Promise<SpotEligibility> {
    if (!firstCall(operation.stationCall)) return { enabled: false }
    return (await clusterAvailable()) ? { enabled: true, icon: manifest.icon } : { enabled: false }
  },

  async isOtherSpotEnabled({ qso }): Promise<SpotEligibility> {
    const their = (qso.their ?? {}) as Json
    if (!their.call || !qso.freq) return { enabled: false }
    return (await clusterAvailable()) ? { enabled: true, icon: manifest.icon } : { enabled: false }
  },

  async postSelfSpot({ operation, freq, comment }: PostSelfSpotRequest, ctx): Promise<PostResult> {
    const call = firstCall(operation.stationCall)
    return resultOf(await host.clusterPostSpot({ freq, call, comment: spotComment(operation, comment, isTestCall(call)) }), ctx)
  },

  async postOtherSpot({ qso, comment }: PostOtherSpotRequest, ctx): Promise<PostResult> {
    const their = (qso.their ?? {}) as Json
    return resultOf(await host.clusterPostSpot({ freq: Number(qso.freq), call: firstCall(their.call), comment: spotComment(qso, comment) }), ctx)
  },
}

defineExtension({
  ...manifest,
  onActivation({ registerHook }) {
    registerHook("spots", { hook: Hook, key: manifest.key })
  },
})
