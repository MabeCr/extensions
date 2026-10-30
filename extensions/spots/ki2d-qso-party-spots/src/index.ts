// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// QSO-party spotting: the two services the state QSO parties are spotted on,
// read as one source and posted to as one.
//
//   * The QSO Party Hub — spots posted by hand, one page per party. Read and
//     written.
//   * The QSO Party APRS Tracker — mobiles placed by their APRS beacons. Read
//     only; the beacon itself is `ki2d-aprs-spotting`'s to send.
//
// The party extensions own the rules and score the log; this one knows every
// party by name and nothing more, because `fetchSpots` is called with no
// operation in hand and the calendar is what says which parties to read.
// app-polo carries the same two feeds inside its `qp` extension
// (`QSOPartiesSpotting.js`); a per-party extension cannot, because it would
// poll the feeds once per installed party.

import { defineExtension, host } from "@ham2k/extension-sdk"
import type {
  HookContext,
  PostResult,
  PostSelfSpotRequest,
  Spot,
  SpotEligibility,
  SpotsHook,
} from "@ham2k/extension-sdk"
import { PARTY_IDENTITIES } from "@ham2k/qso-parties/identities"
import { locationsOf, partyOf, type QsoPartyIdentity } from "@ham2k/qso-parties/identity"

import { hubSpotBody, hubSpotUrl, hubTableUrl, parseHubTable } from "./hub.ts"
import { activeParties } from "./parties.ts"
import { parseTrackerFeed, trackerUrl } from "./tracker.ts"
import { tFor } from "./i18n.ts"

import manifest from "../manifest.json" with { type: "json" }

/// A page the hub does not have — a party it has never listed — answers
/// 404, and that is a party with no hub rather than a hub that is down.
/// Everything else that is not a 200 is thrown, so a hub outage is reported
/// as one instead of reading as a quiet weekend.
async function fetchHubSpots(parties: QsoPartyIdentity[]): Promise<Spot[]> {
  const response = await host.fetch(hubTableUrl(parties[0]), { headers: { 'Cache-Control': 'no-cache' } })
  if (response.status === 404) return []
  if (response.status !== 200) throw new Error(`QSO Party Hub returned HTTP ${response.status}`)
  return parseHubTable(response.body, parties)
}

async function fetchTrackerSpots(party: QsoPartyIdentity, now: number): Promise<Spot[]> {
  const url = trackerUrl(party)
  if (!url) return []
  const response = await host.fetch(url, { headers: { 'Cache-Control': 'no-cache' } })
  if (response.status !== 200) throw new Error(`QSO Party APRS Tracker returned HTTP ${response.status}`)
  return parseTrackerFeed(response.body, party, now)
}

const Hook: SpotsHook = {
  sourceName: 'QSO Parties',

  async fetchSpots(_args, ctx: HookContext): Promise<Spot[]> {
    if (!ctx.online) return []
    const now = Date.now()
    const parties = activeParties(now)
    if (parties.length === 0) return []

    // Two feeds per party, and several parties share a weekend: every fetch
    // runs, and what the live feeds answered is returned even when another
    // failed — a thrown hook loses ALL its spots, so one dead feed would
    // otherwise cost the operator the others too. Only every feed failing
    // is an error, which is what a hub outage during a party looks like.
    // Hub pages are fetched once each — four May parties share `in7qpne_de`.
    const hubPages = new Map<string, QsoPartyIdentity[]>()
    for (const party of parties) hubPages.set(party.hubTablePage, [...(hubPages.get(party.hubTablePage) ?? []), party])
    const results = await Promise.allSettled([
      ...[...hubPages.values()].map((sharing) => fetchHubSpots(sharing)),
      ...parties.map((party) => fetchTrackerSpots(party, now)),
    ])
    const failed = results.find((r) => r.status === 'rejected')
    if (failed && results.every((r) => r.status === 'rejected')) throw failed.reason
    return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
  },

  async isSelfSpotEnabled({ operation }, _ctx): Promise<SpotEligibility> {
    return partyOf(operation, PARTY_IDENTITIES) ? { enabled: true, icon: manifest.icon } : { enabled: false }
  },

  async postSelfSpot({ operation, freq, comment }: PostSelfSpotRequest, ctx: HookContext): Promise<PostResult> {
    const t = tFor(ctx)
    const found = partyOf(operation, PARTY_IDENTITIES)
    if (!found) return { ok: false, message: t('noParty') }
    const call = String(operation.stationCall ?? '').trim()
    if (!call) return { ok: false, message: t('noCall') }
    const counties = locationsOf(found.ref)
    if (counties.length === 0) return { ok: false, message: t('noCounty', { party: found.party.short }) }

    // Whoever is at this seat, then the profile: a multi-station operation
    // resolves the operator per device before the operation reaches a hook.
    const local = (operation.local ?? {}) as Record<string, unknown>
    const poster = String(
      operation.operatorCall || local.operatorCall || (await host.getSettings()).operatorCall || '',
    ).trim()

    try {
      const response = await host.fetch(hubSpotUrl(found.party), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: hubSpotBody({ call, freq, counties, comment, poster }),
      })
      if (response.status !== 200) return { ok: false, message: t('hubRejected', { status: response.status }) }
    } catch (error) {
      return { ok: false, message: t('hubUnreachable', { error: String(error) }) }
    }
    return { ok: true }
  },
}

defineExtension({
  ...manifest,
  onActivation({ registerHook }) {
    registerHook('spots', { hook: Hook, key: manifest.key })
  },
})
