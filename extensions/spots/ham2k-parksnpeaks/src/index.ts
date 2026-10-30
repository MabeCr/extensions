// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// ParksnPeaks — a VK/ZL spotting service that carries other awards' spots
// rather than awards of its own. It is the only source for WWFF and SiOTA
// activity in that part of the world, so this extension owns no references,
// no scoring and no ADIF: it reads that feed and posts to it.
//
// Inbound is deliberately narrowed to WWFF and SiOTA. The API answers with
// every class it knows (POTA and SOTA among them), and HaLo already has each
// of those from its own source — mapping PnP's copies too would show one
// activator twice, in two sources, with no way for the operator to tell they
// are the same person.

import { defineExtension, host } from "@ham2k/extension-sdk"
import type {
  HookContext,
  JSONValue,
  PostOtherSpotRequest,
  PostResult,
  PostSelfSpotRequest,
  Ref,
  Spot,
  SpotEligibility,
} from "@ham2k/extension-sdk"
import { bandForFrequency, modeForFrequency } from "@ham2k/lib-operation-data"

import { tFor } from "./i18n.ts"

import manifest from "../manifest.json" with { type: "json" }

const API_BASE = 'https://www.parksnpeaks.org/api'

/// What every spot from this service is stamped with. The operator's spot
/// list and anything derived from it already carry this string, so it is not
/// the package key and does not follow it.
const SPOT_SOURCE = 'parksnpeaks'

/// The ACTIVATION ref types — what an operation carries — this service takes
/// a spot for. It is told only the reference and works out the award from it.
const ACTIVATION_SPOT_TYPES = ['siotaActivation', 'wwffActivation']

/// The HUNTING ref types, which is what a QSO carries. Spotting someone else
/// reads these, never the activation types above: a logged contact with a
/// park has `wwff`, and matching `wwffActivation` there silently disables the
/// whole other-spot path.
const HUNTING_SPOT_TYPES = ['siota', 'wwff']

/// The classes read back off the feed, UPPER-CASED, mapped to the hunting ref
/// type each becomes. Anything absent here is dropped — see the header.
///
/// Matched without regard to case because the service has already changed it
/// once: the old site published 'SiOTA', the October 2026 rewrite publishes
/// 'SIOTA', and an exact match dropped every silo without a word.
const INBOUND_REF_TYPES: Record<string, string> = {
  SIOTA: 'siota',
  WWFF: 'wwff',
}

/// The published record. `actSpoter` is the API's own spelling of "spotter";
/// matching the typo is what makes the field arrive.
interface PnPApiSpot {
  actTime?: string
  actSiteID?: string
  actCallsign?: string
  actMode?: string
  actFreq?: string
  actClass?: string
  actLocation?: string
  actComments?: string
  actSpoter?: string
}

/// The references of [container] this service will take a spot for.
function spottableRefs(container: Record<string, unknown>, types: string[]): string[] {
  return (((container.refs as Ref[] | undefined) ?? [])).flatMap((r) => (types.includes(r.type) && r.ref ? [r.ref] : []))
}

async function credentials(ctx: HookContext): Promise<{ userId?: string; apiKey?: string }> {
  return {
    userId: ctx.account?.credentials?.userId,
    apiKey: ctx.account?.credentials?.apiKey,
  }
}

const SpotsHook = {
  sourceName: 'ParksnPeaks',

  async fetchSpots(_args: Record<string, never>, ctx: HookContext): Promise<Spot[]> {
    if (!ctx.online) return []

    // Reading the feed needs no account — only posting does. An operator with
    // no ParksnPeaks login still gets the VK/ZL spots, which is most of the
    // value here.
    //
    // Oceania only. Since the October 2026 rewrite the feed is worldwide —
    // hundreds of rows, mostly US POTA — and this source is here for VK and ZL.
    // `continent` is not in the published API docs, but the service honours
    // it.
    const response = await host.fetch(`${API_BASE}/ALL?continent=OC`, {
      headers: {
        Accept: 'application/json',
        // app-polo asks for no caching on every call; a spot list served from
        // a cache is a spot list that has already expired.
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
    })
    if (response.status !== 200) throw new Error(`ParksnPeaks API returned HTTP ${response.status}`)
    const apiSpots = JSON.parse(response.body) as PnPApiSpot[]

    const spots: Spot[] = []
    for (const spot of apiSpots) {
      const refType = INBOUND_REF_TYPES[(spot.actClass ?? '').toUpperCase()]
      if (!refType) continue

      // Published as MHz in a string ('7.160'); everything downstream is kHz.
      const parsed = Number.parseFloat(spot.actFreq ?? '')
      const freq = Number.isNaN(parsed) ? undefined : parsed * 1000

      // No 'Z' and no offset in `actTime` ('2026-08-05 00:07:27'), but the
      // service publishes UTC. Parsed as local time every spot would jump by
      // the operator's offset — a VK activator would appear to have been
      // spotted ten hours from now.
      //
      // An unreadable time becomes 0, never NaN: NaN fails every comparison,
      // so it would make the dedupe below depend on the order the service
      // happened to return rows in — a malformed row arriving first would
      // hold the slot and discard every good row after it.
      const parsedTime = Date.parse(`${(spot.actTime ?? '').replace(' ', 'T')}Z`)
      const timeInMillis = Number.isNaN(parsedTime) ? 0 : parsedTime

      const sourceInfo: Record<string, JSONValue> = {}
      if (spot.actComments) sourceInfo.comments = spot.actComments
      if (spot.actSpoter) sourceInfo.spotter = spot.actSpoter.toUpperCase().trim()

      spots.push({
        their: { call: (spot.actCallsign ?? '').toUpperCase().trim() },
        freq,
        band: freq ? bandForFrequency(freq) : undefined,
        // A spot with no mode is invisible under the panel's DEFAULT mode
        // filter, so an empty `actMode` — which app-polo wrote this same
        // fallback for, against this same feed — would silently hide it. The
        // band plan is read for VK: this service covers VK and ZL, both ITU
        // region 3.
        mode: spot.actMode?.toUpperCase() ||
          (freq ? modeForFrequency(freq, { ituRegion: 3, countryCode: 'AU', entityPrefix: 'VK' }) || undefined : undefined),
        refs: spot.actSiteID ? [{ ref: spot.actSiteID, type: refType }] : [],
        spot: {
          timeInMillis,
          source: SPOT_SOURCE,
          label: [spot.actSiteID, spot.actLocation].filter((x) => x).join(': '),
          sourceInfo,
        },
      })
    }

    // One row per station PER AWARD. app-polo keeps a single row per station,
    // whichever the API returned first; that both hides an operator running a
    // WWFF park and a SiOTA silo at once (a common VK pairing, published as
    // two rows) and shows a station that moved band where it no longer is.
    // Keyed per award and keeping the NEWEST fixes both — and the panel's own
    // `mergeSpotsByCallAndFreq` then combines the two into one row carrying
    // both references, which it cannot do for rows discarded here.
    const newest = new Map<string, Spot>()
    for (const spot of spots) {
      const call = spot.their.call
      if (!call) continue
      const key = `${call}|${spot.refs?.[0]?.type ?? ''}`
      const held = newest.get(key)
      // `>=` so that among rows of equal time the later one in the feed wins.
      // Total, because an unreadable time was already turned into 0 above.
      if (!held || spot.spot.timeInMillis >= held.spot.timeInMillis) {
        newest.set(key, spot)
      }
    }
    return [...newest.values()]
  },

  async isSelfSpotEnabled({ operation }: { operation: Record<string, any> }, ctx: HookContext): Promise<SpotEligibility> {
    // Both halves of the login, not just the key: posting sends each, so
    // offering the source with only one stored invites a post that can only
    // come back rejected.
    const { userId, apiKey } = await credentials(ctx)
    return userId && apiKey && spottableRefs(operation, ACTIVATION_SPOT_TYPES).length > 0
      ? { enabled: true, icon: manifest.icon }
      : { enabled: false }
  },

  async isOtherSpotEnabled({ qso }: { qso: Record<string, any> }, ctx: HookContext): Promise<SpotEligibility> {
    const { userId, apiKey } = await credentials(ctx)
    return userId && apiKey && spottableRefs(qso, HUNTING_SPOT_TYPES).length > 0
      ? { enabled: true, icon: manifest.icon }
      : { enabled: false }
  },

  async postSelfSpot({ operation, freq, mode, comment }: PostSelfSpotRequest, ctx: HookContext): Promise<PostResult> {
    const refs = spottableRefs(operation, ACTIVATION_SPOT_TYPES)
    if (refs.length === 0) return { ok: false, message: 'No WWFF or SiOTA activation on this operation' }
    const call = String(operation.stationCall ?? '').trim()
    if (!call) return { ok: false, message: 'This operation has no station callsign to spot' }
    if (!freq) return { ok: false, message: 'There is no frequency to spot' }
    return postSpotToPnP({ call, refs, freq, mode, comment, spotterCall: call }, ctx)
  },

  async postOtherSpot({ qso, comment, spotterCall }: PostOtherSpotRequest, ctx: HookContext): Promise<PostResult> {
    const refs = spottableRefs(qso, HUNTING_SPOT_TYPES)
    if (refs.length === 0) return { ok: false, message: 'No WWFF or SiOTA reference on this QSO' }
    const freq = Number(qso.freq)
    if (!freq) return { ok: false, message: 'This QSO has no frequency to spot' }
    const their = (qso.their ?? {}) as Record<string, unknown>
    const our = (qso.our ?? {}) as Record<string, unknown>
    // Guarded like the frequency: a spot naming no station reaches everybody
    // watching, which is worse than no spot.
    const call = String(their.call ?? '').trim()
    if (!call) return { ok: false, message: 'This QSO has no callsign to spot' }
    return postSpotToPnP({
      call,
      refs,
      freq,
      mode: qso.mode ? String(qso.mode) : undefined,
      comment,
      // Trimmed and `||`-chained: the core hands over an EMPTY STRING as
      // readily as it omits a key, and `'' ?? fallback` is `''`.
      spotterCall: String(our.call ?? '').trim() || String(spotterCall ?? '').trim() || undefined,
    }, ctx)
  },
}

/// The service answers 200 for a rejected spot, and says which in JSON —
/// `{"success":false,"message":"Authentication failed!"}` — so the status
/// alone never proves one landed. Undefined for any answer not of that shape —
/// a JSON array is what a redirect to the spot LIST reads as, after a spot
/// that was created.
function verdictOf(body: string | undefined): { success: boolean; message?: string } | undefined {
  try {
    const parsed = JSON.parse(body ?? '') as { success?: unknown; message?: unknown } | null
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof parsed.success !== 'boolean') return undefined
    const message = typeof parsed.message === 'string' && parsed.message.trim() ? parsed.message.trim() : undefined
    return { success: parsed.success, message }
  } catch (_error) {
    return undefined
  }
}

/// A refusal of the LOGIN rather than of the spot, as the service words it
/// ('Authentication failed!'). A login saved under a username rather than the
/// callsign the service expects gets exactly this, so it points at where the
/// login is set rather than leaving the operator to guess.
const AUTH_REFUSAL = /authenticat|authori[sz]|credential|api ?key|\bpin\b|password|login/i

/// The kHz string the API expects ('7160', '7160.5'). The October 2026 site
/// takes kHz where the old one took MHz — sent as MHz, '7.160' would spot a
/// station on 7 kHz.
function khzForSpot(freqKHz: number): string {
  return String(Math.round(freqKHz * 10) / 10)
}

/// One spot carrying every reference, comma-joined, as app-polo's ZLOTA
/// spotting posts to this same service: it files them as one activation
/// rather than as unrelated spots of the same station.
async function postSpotToPnP(
  { call, refs, freq, mode, comment, spotterCall }: {
    call: string
    refs: string[]
    freq: number
    mode?: string
    comment?: string
    spotterCall?: string
  },
  ctx: HookContext,
): Promise<PostResult> {
  const { userId, apiKey } = await credentials(ctx)
  const t = tFor(ctx)
  if (!userId || !apiKey) return { ok: false, message: t('missingCredentials') }

  const fields: Record<string, string> = {
    userID: userId,
    APIKey: apiKey,
    activator: call,
    // The login IS a callsign on this service, so it stands in when the QSO
    // names no operator.
    spotter: spotterCall || userId,
    reference: refs.join(','),
    frequency: khzForSpot(freq),
    mode: mode ?? '',
    comments: comment ?? '',
    // Without it the service adds every reference containing these — a silo
    // in a park becomes a park activation the operator never claimed.
    do_not_lookup: 'true',
  }

  const refList = refs.join(', ')
  let response: { status: number; body: string }
  try {
    response = await host.fetch(`${API_BASE}/spots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: Object.entries(fields).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&'),
    })
  } catch (error) {
    // Not proof the spot never went out: the host also gives up on a request
    // already sent, once the answer is too slow coming.
    return { ok: false, message: t('postNoAnswer', { refs: refList, error: String(error) }) }
  }

  // Each failure says what is known of it. Only the service's own JSON verdict
  // is a refusal; an HTTP error or an answer that cannot be read may follow a
  // spot that DID land, so those say so rather than inviting a duplicate.
  const verdict = verdictOf(response.body)
  const answered = response.status >= 200 && response.status < 300
  if (answered && verdict?.success) return { ok: true }
  // The login is blamed only on the service's word for it, or on a 401. A
  // bare 403 is as often the site's firewall turning the request away, and
  // sending the operator to re-enter a login that was fine hides that.
  if (response.status === 401 || (verdict?.success === false && AUTH_REFUSAL.test(verdict.message ?? ''))) {
    return { ok: false, message: t('postLoginRefused', { refs: refList, reason: verdict?.message ?? `HTTP ${response.status}` }) }
  }
  if (!answered) {
    return {
      ok: false,
      message: verdict?.message
        ? t('postHttpErrorBecause', { refs: refList, status: response.status, reason: verdict.message })
        : t('postHttpError', { refs: refList, status: response.status }),
    }
  }
  if (!verdict) return { ok: false, message: t('postUnreadable', { refs: refList }) }
  return { ok: false, message: verdict.message ? t('postFailedBecause', { refs: refList, reason: verdict.message }) : t('postFailed', { refs: refList }) }
}

defineExtension({
  ...manifest,
  onActivation({ registerHook }) {
    registerHook('spots', { hook: SpotsHook, key: manifest.key })
    registerHook('account', {
      key: manifest.key,
      hook: {
        label: 'ParksnPeaks',
        description: (_args: Record<string, never>, ctx: HookContext) => tFor(ctx)('accountDescription'),
        kvKey: manifest.key,
        // One ParksnPeaks login belongs to the operator, not to a device, so
        // it syncs across their Apple devices the way the QRZ login does.
        synchronizable: true,
        fields: (_args: Record<string, never>, ctx: HookContext) => {
          const t = tFor(ctx)
          return [
            {
              key: 'userId',
              label: t('userIdLabel'),
              type: 'text',
              postface: t('userIdPostface'),
            },
            {
              key: 'apiKey',
              label: t('apiKeyLabel'),
              type: 'secret',
              postface: t('apiKeyPostface'),
            },
          ]
        },
        async testCredentials(creds: Record<string, string>, ctx: HookContext): Promise<string> {
          const t = tFor(ctx)
          if (!creds.userId?.trim() || !creds.apiKey?.trim()) return t('missingCredentials')
          // Presence is all this can honestly check. ParksnPeaks publishes no
          // endpoint that validates a login, and the only authenticated call
          // it has is posting a spot — which would put a real station on a
          // real spot list to test a password. Said plainly rather than
          // returning a bare ✅, which would claim the credentials work.
          // An empty string is not an option: the dialog renders the result
          // verbatim, so it would leave a blank box that reads as a failure.
          return t('credentialsUnverified', { userId: creds.userId.trim() })
        },
      },
    })
  },
})
