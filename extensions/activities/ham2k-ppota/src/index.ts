// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// PPOTA (Pueblos y Parajes On The Air) — villages, hamlets and small rural
// localities of under 5,000 people, documented before 2000. Rules and API are
// ppota.app's own: https://ppota.app (Reglamento) and https://ppota.app/api.
//
// A valid activation is five contacts with five DIFFERENT callsigns, from one
// reference, inside one UTC day (rules §2.3, §2.4). Hunters upload nothing:
// their credit comes from the activator's log (§3.3), so there is no hunter
// export. ppota.app's uploader takes one ADIF per reference and per UTC day.
//
// The reference list and the spot feed are public. Posting a spot takes an
// API key PPOTA issues per INTEGRATION, not per operator, so it ships in this
// bundle (see PPOTA_API_KEY) — the same arrangement as WWFF's.

import {
  activityExportHook,
  activityScorer,
  canonicalMode,
  contestScorer,
  countryPrefixForCall,
  defineExtension,
  host,
  referenceActivity,
} from "@ham2k/extension-sdk"
import type {
  DataFileDefinition,
  HookContext,
  JSONValue,
  PostOtherSpotRequest,
  PostResult,
  PostSelfSpotRequest,
  Ref,
  RefTransform,
  Spot,
  SpotEligibility,
  SpotsHook,
} from "@ham2k/extension-sdk"
import { bandForFrequency } from "@ham2k/lib-operation-data"
import { locationToGrid6 } from "@ham2k/lib-geo-tools"

import { tFor } from "./i18n.ts"
import { perUtcDay } from "./exports.ts"
import { oneCallsignPerDay } from "./scoring.ts"

import manifest from "../manifest.json" with { type: "json" }

const HUNTING_TYPE = 'ppota'
const ACTIVATION_TYPE = 'ppotaActivation'

/// `PPAR-0004`: "PP", the ISO 3166 country, a dash, four digits.
export const REFERENCE_REGEX = /^PP[A-Z]{2}-[0-9]{4}$/i

const API_BASE = 'https://ppota.app/api/v1'

/// Issued by PPOTA's administrator for Ham2K, with the `spots:write`
/// permission. PPOTA asks that it not be shown to users, but every bundle is
/// served to anyone who asks, so treat it as published: rotating it means a
/// release. Empty, posting is not offered at all.
const PPOTA_API_KEY = 'ppota_uWqUoZdYCAI49achoXn6goBeTD_7xle-cDz06obuOaE'

/// Live-typing reformatting. A reference is "PP" plus the station's ISO
/// country, so an Argentine station typing "0004" gets "PPAR-0004"; a
/// reference typed without its punctuation ("AR0004", "PPAR0004") or in the
/// program's old form ("AR-0004") gets the rest. The separator is captured
/// and replayed, so a second reference after a comma is shaped the same way.
///
/// With no country to offer — a call nobody can place — the bare-number rule
/// is left out rather than guessed, and only the punctuation is fixed.
export function transformsForPrefix(prefix: string | undefined): RefTransform[] {
  return [
    ...(prefix ? [{ pattern: '(^|,\\s*)(\\d\\d+)', replacement: `\${1}PP${prefix}-\${2}`, flags: 'gi' }] : []),
    // A run of spaces between two references becomes ", ", so the rule above
    // sees the second one at a separator.
    { pattern: '(PP[A-Z]{2}-\\d+) +(?=[A-Z0-9])', replacement: '${1}, ', flags: 'gi' },
    // The lookahead keeps a bare "PP0004" from reading "PP" as its country.
    { pattern: '(?<![A-Z0-9])(?:PP(?=[A-Z]{2}))?(?!PP-?\\d)([A-Z]{2})-?(\\d+)', replacement: 'PP${1}-${2}', flags: 'gi' },
    { pattern: '[^A-Z0-9\\-, ]', replacement: '', flags: 'gi' },
  ]
}

/// PPOTA's country part is ISO 3166, which is what `countryPrefixForCall`
/// answers. Its fallback, a DXCC entity prefix, is not a PPOTA country, so
/// anything but two letters counts as no answer. A multi-operator station is
/// several calls separated by commas, which no lookup can place as a whole;
/// the first one stands for the team.
function isoCountryForCall(call: unknown): string | undefined {
  const first = typeof call === 'string' ? call.split(',')[0].trim() : undefined
  const prefix = countryPrefixForCall(first || undefined)
  return prefix && /^[A-Z]{2}$/.test(prefix) ? prefix : undefined
}

const { refHandler, activityHook, adifFieldsHook, adifImportHook } = referenceActivity({
  key: 'ppota',
  label: 'PPOTA',
  activationType: ACTIVATION_TYPE,
  huntingType: HUNTING_TYPE,
  referenceRegex: REFERENCE_REGEX,
  icon: manifest.icon,
  color: manifest.accentColor,
  placeholder: 'PPAR-0001',
  // The hunting control follows the OTHER station's country, the activation
  // control our own.
  refInput: ({ operation, qso, side }) => {
    const their = side === 'hunting' ? (qso?.their as Record<string, unknown> | undefined)?.call : undefined
    const prefix = isoCountryForCall(their) ?? isoCountryForCall(operation.stationCall)
    return { placeholder: `PP${prefix ?? 'AR'}-0001`, transforms: transformsForPrefix(prefix) }
  },
  tFor,
  // No `linkUrl`: ppota.app is a single-page app whose references have no
  // address of their own.
  // A contact with an activator on two references is one record per
  // reference, since each upload is filed under a single one.
  splitRecordsPerHuntedRef: true,
  // Two localities within 200 m of each other's edge can both be activated
  // from one spot (rules §2.1); each gets its own upload.
  allowsMultiple: true,
})

/// Five contacts, five different callsigns, one UTC day.
///
/// A callsign counts once per day toward the five, whatever band or mode it
/// is worked on again (rules §2.3). `activityScorer` cannot say "different
/// callsigns" on its own; `oneCallsignPerDay` caps it.
export const PPOTA_SCORING = {
  label: 'PPOTA',
  icon: manifest.icon,
  activationType: ACTIVATION_TYPE,
  huntingType: HUNTING_TYPE,
  qsosToActivate: 5,
  allowsMultipleReferences: true,
  uniquePer: ['day', 'ref'] as const,
  freshRefRescuesActivation: false,
  activates: 'daily' as const,
  refNoun: (ctx: HookContext) => tFor(ctx)('reference'),
  refNounPlural: (ctx: HookContext) => tFor(ctx)('referencesPlural'),
  p2pLabel: 'P2P',
}

function refsOfType(container: Record<string, unknown>, type: string): Ref[] {
  return (((container.refs as Ref[] | undefined) ?? [])).filter((r) => r.type === type && r.ref)
}

/// One published spot. `mode` is often an empty string: the site's own form
/// leaves it optional.
interface PPOTAApiSpot {
  id?: string
  status?: string
  callsign?: string
  reference?: string
  reference_name?: string
  frequency_khz?: number | string
  frequency_mhz?: number | string
  mode?: string
  comment?: string
  spotted_by?: string
  created_at?: string
}

const SPOT_SOURCE = 'ppota'

function frequencyOf(spot: PPOTAApiSpot): number | undefined {
  const khz = Number.parseFloat(String(spot.frequency_khz ?? ''))
  if (Number.isFinite(khz) && khz > 0) return khz
  const mhz = Number.parseFloat(String(spot.frequency_mhz ?? ''))
  if (Number.isFinite(mhz) && mhz > 0) return mhz * 1000
  return undefined
}

/// What PPOTA files a spot's mode under: free text, upper-cased, at most 20
/// characters. Sideband is SSB, as on the site's own spots.
export function ppotaMode(mode: string | undefined): string | undefined {
  const canonical = canonicalMode(mode ?? '')
  return canonical ? canonical.toUpperCase().slice(0, 20) : undefined
}

/// The spots hook, for a given integration key. The registered one carries
/// PPOTA_API_KEY; exported so the posting path can be exercised with a key
/// before one ships.
export function ppotaSpotsHook(apiKey: string): SpotsHook {
  return {
    sourceName: 'PPOTA',

    async fetchSpots(_args: Record<string, never>, ctx: HookContext): Promise<Spot[]> {
      if (!ctx.online) return []

      // Active spots only, which is the feed's default; each lasts 30 minutes.
      const response = await host.fetch(`${API_BASE}/spots`, { headers: { Accept: 'application/json' } })
      if (response.status !== 200) throw new Error(`PPOTA API returned HTTP ${response.status}`)
      const body = JSON.parse(response.body) as { spots?: unknown }
      if (!Array.isArray(body?.spots)) throw new Error('PPOTA API returned no list of spots')

      return (body.spots as PPOTAApiSpot[]).flatMap((spot) => {
        // The feed expires spots before answering; one that slips through
        // closed is an activator who has gone home.
        if (spot.status && spot.status !== 'active') return []
        const call = (spot.callsign ?? '').toUpperCase().trim()
        if (!call) return []
        const reference = (spot.reference ?? '').toUpperCase().trim()
        const freq = frequencyOf(spot)
        const parsedTime = Date.parse(spot.created_at ?? '')

        const sourceInfo: Record<string, JSONValue> = {}
        if (spot.comment) sourceInfo.comments = spot.comment
        if (spot.spotted_by) sourceInfo.spotter = spot.spotted_by.toUpperCase().trim()

        return [{
          their: { call },
          freq,
          band: freq ? bandForFrequency(freq) : undefined,
          // Free text on PPOTA's side ("usb", "Ssb"); the app logs SSB.
          mode: ppotaMode(spot.mode),
          refs: reference ? [{ ref: reference, type: HUNTING_TYPE }] : [],
          spot: {
            timeInMillis: Number.isNaN(parsedTime) ? 0 : parsedTime,
            source: SPOT_SOURCE,
            label: [reference, spot.reference_name?.trim()].filter((x) => x).join(': '),
            sourceInfo,
          },
        }]
      })
    },

    async isSelfSpotEnabled({ operation }: { operation: Record<string, JSONValue> }): Promise<SpotEligibility> {
      // Without the key every post comes back 401: no button beats a button
      // that always fails.
      return apiKey && refsOfType(operation, ACTIVATION_TYPE).length > 0
        ? { enabled: true, icon: manifest.icon }
        : { enabled: false }
    },

    async isOtherSpotEnabled({ qso }: { qso: Record<string, JSONValue> }): Promise<SpotEligibility> {
      return apiKey && refsOfType(qso, HUNTING_TYPE).length > 0
        ? { enabled: true, icon: manifest.icon }
        : { enabled: false }
    },

    async postSelfSpot({ operation, freq, mode, comment }: PostSelfSpotRequest, ctx: HookContext): Promise<PostResult> {
      const refs = refsOfType(operation, ACTIVATION_TYPE)
      if (refs.length === 0) return { ok: false, message: 'No PPOTA activation on this operation' }
      // A multi-operator station is several calls, each spotted as itself.
      const calls = String(operation.stationCall ?? '').split(',').map((c) => c.trim()).filter((c) => c)
      if (calls.length === 0) return { ok: false, message: 'This operation has no station callsign to spot' }
      const kHz = Number(freq)
      if (!kHz || !Number.isFinite(kHz)) return { ok: false, message: 'This operation has no frequency to spot' }
      const spots = calls.flatMap((call) => refs.map((r) => ({ call, ref: r.ref!, spotter: call })))
      return postSpotsToPPOTA(apiKey, spots, { freq: kHz, mode, comment }, ctx)
    },

    async postOtherSpot({ qso, comment, spotterCall }: PostOtherSpotRequest, ctx: HookContext): Promise<PostResult> {
      const refs = refsOfType(qso, HUNTING_TYPE)
      if (refs.length === 0) return { ok: false, message: 'No PPOTA reference on this QSO' }
      const freq = Number(qso.freq)
      if (!freq) return { ok: false, message: 'This QSO has no frequency to spot' }
      const their = (qso.their ?? {}) as Record<string, unknown>
      const our = (qso.our ?? {}) as Record<string, unknown>
      const call = String(their.call ?? '').trim()
      if (!call) return { ok: false, message: 'This QSO has no callsign to spot' }
      // `||`, not `??`: the core hands over an empty string as readily as it
      // omits a key.
      const spotter = String(our.call ?? '').trim() || String(spotterCall ?? '').trim() || undefined
      return postSpotsToPPOTA(
        apiKey,
        refs.map((r) => ({ call, ref: r.ref!, spotter })),
        { freq, mode: qso.mode ? String(qso.mode) : undefined, comment },
        ctx,
      )
    },
  }
}

/// The endpoint takes one activator at one reference per request, so a
/// two-reference activation is two posts. Only a 201 is success (API §8).
async function postSpotsToPPOTA(
  apiKey: string,
  spots: { call: string; ref: string; spotter?: string }[],
  { freq, mode, comment }: { freq: number; mode?: string; comment?: string },
  ctx: HookContext,
): Promise<PostResult> {
  const t = tFor(ctx)
  const sentMode = ppotaMode(mode)
  const failures = new Set<string>()
  let posted = 0
  // The activator is named only when there were several to choose from.
  const severalCalls = new Set(spots.map((s) => s.call)).size > 1
  // A spot that already went out is news too: the operator should not post
  // it again by hand.
  const withPosted = (message: string) => (posted > 0 ? `${message} ${t('alreadyPosted', { count: posted })}` : message)

  for (const { call, ref, spotter } of spots) {
    const which = severalCalls ? `${call} at ${ref}` : ref
    try {
      const response = await host.fetch(`${API_BASE}/spots`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          callsign: call,
          reference: ref,
          // The app's frequency is kHz; naming the unit leaves PPOTA nothing
          // to guess.
          frequencyKHz: freq,
          // Left out rather than guessed: a spot claiming SSB for a CW signal
          // sends hunters to the wrong place.
          ...(sentMode ? { mode: sentMode } : {}),
          comment: (comment ?? '').slice(0, 500),
          ...(spotter ? { spotterCallsign: spotter } : {}),
        }),
      })
      if (response.status === 201) {
        posted += 1
        continue
      }

      let code: string | undefined
      try {
        code = (JSON.parse(response.body ?? '') as { error?: string })?.error
      } catch (_error) {
        // Not JSON; the status says what happened.
      }
      // The key is Ham2K's, not the operator's: nothing the next post does
      // differently will fix it.
      if (response.status === 401 || response.status === 403) {
        return { ok: false, message: withPosted(t('keyRejected', { code: code ?? `HTTP ${response.status}` })) }
      }
      // An unknown reference is unknown whoever is at it: one line for all.
      failures.add(response.status === 404 ? t('unknownReferenceOnPost', { ref }) : `${which} (${code ?? `HTTP ${response.status}`})`)
    } catch (e) {
      failures.add(`${which} (${e instanceof Error ? e.message : String(e)})`)
    }
  }

  // Every failure is named, even when other posts landed: a reference the
  // operator IS activating left unspotted, with nothing saying so, is the
  // failure worth reporting.
  if (failures.size === 0) return { ok: true }
  if (spots.length === 1) return { ok: false, message: [...failures][0] }
  return { ok: false, message: withPosted(t('postRefused', { refs: [...failures].join(', ') })) }
}

/// The published grid is upper-case throughout ("GF13MO"); the app writes a
/// subsquare in lower case.
function normalizedGrid(grid: string | undefined, lat: number | undefined, lon: number | undefined): string | undefined {
  const published = (grid ?? '').trim()
  if (/^[A-R]{2}[0-9]{2}([A-X]{2})?$/i.test(published)) {
    return published.slice(0, 4).toUpperCase() + published.slice(4).toLowerCase()
  }
  return lat != null && lon != null ? locationToGrid6(lat, lon) : undefined
}

function parsedNumber(value: string | undefined): number | undefined {
  const parsed = Number.parseFloat(value ?? '')
  return Number.isFinite(parsed) ? parsed : undefined
}

/// The CSV export of every active reference — a twenty-fifth the size of the
/// JSON one, which carries each reference's photo inline.
const ppotaDataFile: DataFileDefinition = {
  key: `${manifest.key}-all-references`,
  name: (_args: Record<string, never>, ctx: HookContext) => tFor(ctx)('dataFileName'),
  description: (_args: Record<string, never>, ctx: HookContext) => tFor(ctx)('dataFileDescription'),
  url: `${API_BASE}/references.csv`,
  // A young program adding localities every week; a month-old list would
  // miss the one an operator is driving to.
  maxAgeInDays: 7,
  fetchType: 'csv',
  category: 'ppota',
  csvOptions: { hasHeaders: true, delimiter: ',' },
  csvToLookupEntry: (row: Record<string, string> | string[]) => {
    const r = row as Record<string, string>
    // The file starts with a byte-order mark, which a parser that keeps it
    // leaves on the first header.
    const ref = String(r.code ?? r['﻿code'] ?? '').trim().toUpperCase()
    if (!REFERENCE_REGEX.test(ref)) return null

    const name = String(r.name ?? '').trim() || ref
    const lat = parsedNumber(r.latitude)
    const lon = parsedNumber(r.longitude)
    const country = String(r.country_code ?? '').trim().toUpperCase() || ref.slice(2, 4)
    const location = [r.locality, r.region].map((x) => String(x ?? '').trim()).filter((x) => x).join(', ') || undefined

    return {
      // The ISO country, which is also the reference's own prefix.
      subCategory: country,
      key: ref,
      name,
      lat,
      lon,
      flags: 1,
      data: {
        ref,
        name,
        location,
        country: String(r.country ?? '').trim() || undefined,
        type: String(r.type ?? '').trim() || undefined,
        grid: normalizedGrid(r.grid, lat, lon),
        lat,
        lon,
      },
    }
  },
}

defineExtension({
  ...manifest,
  onActivation({ registerHook }) {
    registerHook(`ref:${HUNTING_TYPE}`, { hook: refHandler, key: manifest.key })
    registerHook(`ref:${ACTIVATION_TYPE}`, { hook: refHandler, key: manifest.key })
    registerHook('activity', { hook: activityHook, key: manifest.key })
    registerHook('adifFields', { hook: adifFieldsHook, key: manifest.key })
    registerHook('adifImport', { hook: adifImportHook, key: manifest.key })
    registerHook('spots', { hook: ppotaSpotsHook(PPOTA_API_KEY), key: manifest.key })
    registerHook('dataFile', { hook: ppotaDataFile, key: `${manifest.key}-all-references` })
    registerHook('scoring', {
      hook: contestScorer(oneCallsignPerDay(activityScorer(PPOTA_SCORING), ACTIVATION_TYPE), {
        scope: { refTypes: [ACTIVATION_TYPE, HUNTING_TYPE], huntingRefTypes: [HUNTING_TYPE] },
      }),
      key: manifest.key,
    })
    // One file per reference and UTC day: ppota.app's uploader files each
    // under the single reference selected for it, and refuses a file spanning
    // two UTC days.
    registerHook('export', {
      hook: perUtcDay(activityExportHook({ key: manifest.key, label: 'PPOTA', activationType: ACTIVATION_TYPE, icon: manifest.icon })),
      key: manifest.key,
    })
  },
})
