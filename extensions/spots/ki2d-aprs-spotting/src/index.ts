// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// APRS self-spotting: a self-spot becomes a position beacon on APRS-IS,
// naming the frequency and what is being activated. Anyone watching the map
// — aprs.fi, a QSO party's mobile tracker — sees where the station is and
// where to find it on the dial.
//
// A spots source that posts and never reads: there is no spot LIST on APRS,
// only positions, and the one feed that turns them into spots (the QSO Party
// APRS Tracker) is `ki2d-qso-party-spots`'s to read. So `fetchSpots` answers
// nothing, and the extension is the Spotting control's APRS icon.
//
// app-polo beacons only from its QSO-party extension, with the party's token
// in the comment. This beacons from any operation that has a position, and
// the token is there whenever the operation is in a party — the comment
// reads `NEWE 14.250 MAWOR` during New England and `14.250 US-1234` from a
// park — so the tracker sees the same beacon it sees from app-polo.

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
import { locationsOf, partyOf } from "@ham2k/qso-parties/identity"

import { aprsComment, aprsLogin, aprsPacket, aprsPosition, aprsSource, base64, positionOf } from "./aprs.ts"
import { tFor } from "./i18n.ts"

import manifest from "../manifest.json" with { type: "json" }

/// An HTTP door onto APRS-IS: the login goes in a header and the packet is
/// the body. The same gateway app-polo posts through, spoken the way it
/// speaks to it.
const APRS_GATEWAY = 'https://ametx.com:8888'

/// What the beacon says the operation is doing: the county line for a QSO
/// party, and otherwise every reference the operation carries, in the order
/// it carries them.
function activationWords(operation: Record<string, unknown>): { partyToken?: string; refs: string[] } {
  const party = partyOf(operation, PARTY_IDENTITIES)
  if (party) return { partyToken: party.party.aprsShort, refs: locationsOf(party.ref) }
  const refs = Array.isArray(operation.refs) ? (operation.refs as Record<string, unknown>[]) : []
  return { refs: refs.map((ref) => (typeof ref?.ref === 'string' ? ref.ref.trim() : '')).filter((ref) => ref) }
}

const Hook: SpotsHook = {
  sourceName: 'APRS',

  async fetchSpots(): Promise<Spot[]> {
    return []
  },

  async isSelfSpotEnabled({ operation }, _ctx): Promise<SpotEligibility> {
    // A beacon with no position is not a beacon. Offered only where there is
    // one, so the icon never lights for an operation the post would refuse.
    return positionOf(operation) && aprsSource(String(operation.stationCall ?? ''))
      ? { enabled: true, icon: manifest.icon }
      : { enabled: false }
  },

  async postSelfSpot({ operation, freq, comment }: PostSelfSpotRequest, ctx: HookContext): Promise<PostResult> {
    const t = tFor(ctx)
    const source = aprsSource(String(operation.stationCall ?? ''))
    if (!source) return { ok: false, message: t('noCall') }
    const position = positionOf(operation)
    if (!position) return { ok: false, message: t('noPosition') }

    const { partyToken, refs } = activationWords(operation)
    const packet = aprsPacket(source, aprsPosition(...position), aprsComment({ partyToken, freq, refs, comment }))
    const { version } = await host.getVersionInfo()

    try {
      const response = await host.fetch(APRS_GATEWAY, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          Accept: 'text/plain',
          Authorization: `APRS-IS ${base64(aprsLogin(source, version))}`,
        },
        body: packet,
      })
      // Any 2xx, as app-polo's `response.ok`: the gateway answers 204 when it
      // takes a beacon and has nothing to say back.
      if (response.status < 200 || response.status >= 300) return { ok: false, message: t('rejected', { status: response.status }) }
    } catch (error) {
      return { ok: false, message: t('unreachable', { error: String(error) }) }
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
