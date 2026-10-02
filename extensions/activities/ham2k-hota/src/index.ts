// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// HOTA (History on the Air) — historic sites over 200 years old: castles,
// churches, ruins, bridges, monuments. Rules and API are cqhota.app's own:
// https://cqhota.app/rules and https://cqhota.app/api-docs.
//
// A valid activation is five contacts with five DIFFERENT callsigns, from one
// reference, inside one UTC day (rules §1, §3). Hunters upload nothing: their
// credit comes from the activator's log (§4), so there is no hunter export.
// Two activators at once is "HOTA to HOTA", and a partner on two references
// is logged once per reference (§5) — hence one ADIF record per hunted
// reference.
//
// The reference list and the spot feed are public. Posting a spot takes the
// operator's own "integration API key", generated on cqhota.app under My
// account; it is scoped to posting spots and reading one's own summary, and
// nothing else.

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
} from "@ham2k/extension-sdk"
import { bandForFrequency, superModeForMode } from "@ham2k/lib-operation-data"
import { locationToGrid6 } from "@ham2k/lib-geo-tools"

import { tFor } from "./i18n.ts"
import { oneCallsignPerDay } from "./scoring.ts"

import manifest from "../manifest.json" with { type: "json" }

const HUNTING_TYPE = 'hota'
const ACTIVATION_TYPE = 'hotaActivation'

/// `RO-H0001`: the ISO 3166 country, `-H`, four digits — the same pattern
/// cqhota.app's own ADIF importer accepts.
export const REFERENCE_REGEX = /^[A-Z]{2}-H[0-9]{4}$/i

const API_BASE = 'https://cqhota.app/api/v1'

/// Live-typing reformatting. A reference is the station's ISO country, so a
/// Romanian station typing "0142" or "H0142" gets "RO-H0142"; a reference
/// typed without its punctuation ("RO0142", "roh0142", "RO-0142") gets its
/// "-H". The separator is captured and replayed, so a second reference after
/// a comma is shaped the same way.
///
/// With no country to offer — a call nobody can place — the bare-number rules
/// are left out rather than guessed, and only the punctuation is fixed.
export function transformsForPrefix(prefix: string | undefined): RefTransform[] {
  return [
    ...(prefix
      ? [
        { pattern: '(^|,\\s*)(\\d\\d+)', replacement: `\${1}${prefix}-H\${2}`, flags: 'gi' },
        { pattern: '(^|,\\s*)H(\\d+)', replacement: `\${1}${prefix}-H\${2}`, flags: 'gi' },
      ]
      : []),
    // A run of spaces between two references becomes ", ", so the rules
    // above see the second one at a separator.
    { pattern: '([A-Z]{2}-H\\d+) +(?=[A-Z0-9])', replacement: '${1}, ', flags: 'gi' },
    { pattern: '(?<![A-Z0-9])([A-Z]{2})-?H?(\\d+)', replacement: '${1}-H${2}', flags: 'gi' },
    { pattern: '[^A-Z0-9\\-, ]', replacement: '', flags: 'gi' },
  ]
}

/// HOTA's country part is ISO 3166 — `GB` for every home nation, `US` for
/// Hawaii and Alaska — which is exactly what `countryPrefixForCall` answers.
/// Its fallback, a DXCC entity prefix, is not a HOTA country, so anything but
/// two letters counts as no answer.
function isoCountryForCall(call: unknown): string | undefined {
  const prefix = countryPrefixForCall(typeof call === 'string' ? call : undefined)
  return prefix && /^[A-Z]{2}$/.test(prefix) ? prefix : undefined
}

const { refHandler, activityHook, adifFieldsHook, adifImportHook } = referenceActivity({
  key: 'hota',
  label: 'HOTA',
  activationType: ACTIVATION_TYPE,
  huntingType: HUNTING_TYPE,
  referenceRegex: REFERENCE_REGEX,
  icon: manifest.icon,
  color: manifest.accentColor,
  placeholder: 'RO-H0001',
  // The hunting control follows the OTHER station's country, the activation
  // control our own.
  refInput: ({ operation, qso, side }) => {
    const their = side === 'hunting' ? (qso?.their as Record<string, unknown> | undefined)?.call : undefined
    const prefix = isoCountryForCall(their) ?? isoCountryForCall(operation.stationCall)
    return { placeholder: `${prefix ?? 'RO'}-H0001`, transforms: transformsForPrefix(prefix) }
  },
  tFor,
  linkUrl: (reference: string) => `https://cqhota.app/ref/${encodeURIComponent(reference)}`,
  // A contact with an activator on two references is logged once per
  // reference, and both are credited (rules §5).
  splitRecordsPerHuntedRef: true,
  // Several references at once is allowed: a station within 500 m of two
  // sites activates both, and uploads a log for each.
  allowsMultiple: true,
})

/// Five contacts, five different callsigns, one UTC day.
///
/// A callsign counts once per day toward the five: working it again is a
/// duplicate, and working it at a DIFFERENT reference credits that reference
/// to the hunter side without counting a second callsign toward the
/// activation. Band and mode are irrelevant to HOTA. `activityScorer` cannot
/// say "different callsigns" on its own; `oneCallsignPerDay` caps it.
export const HOTA_SCORING = {
  label: 'HOTA',
  icon: manifest.icon,
  activationType: ACTIVATION_TYPE,
  huntingType: HUNTING_TYPE,
  qsosToActivate: 5,
  allowsMultipleReferences: true,
  uniquePer: ['day', 'ref'] as const,
  freshRefRescuesActivation: false,
  activates: 'daily' as const,
  refNoun: (ctx: HookContext) => tFor(ctx)('site'),
  refNounPlural: (ctx: HookContext) => tFor(ctx)('sitesPlural'),
  // HOTA's own name for it (rules §1).
  p2pLabel: 'H&H',
}

function refsOfType(container: Record<string, unknown>, type: string): Ref[] {
  return (((container.refs as Ref[] | undefined) ?? [])).filter((r) => r.type === type && r.ref)
}

/// The published spot record. `id` and `freq_khz` arrive as STRINGS, whatever
/// the documentation's sample shows.
interface HOTAApiSpot {
  id?: string | number
  callsign?: string
  activator?: string
  reference?: string
  reference_name?: string
  freq_khz?: string | number
  mode?: string
  comment?: string
  spotter?: string
  created_at?: string
  ended?: boolean
}

const SPOT_SOURCE = 'hota'

/// The modes HOTA's feed names, which is the vocabulary a posted spot is
/// filed under. Any other data mode is "Digi"; a voice mode HOTA has no name
/// for (DV, DMR, C4FM) is left out rather than called something it isn't.
const HOTA_MODES = new Set(['SSB', 'CW', 'FT8', 'FT4', 'RTTY', 'FM', 'AM'])

export function hotaMode(mode: string | undefined): string | undefined {
  const canonical = canonicalMode(mode ?? '')
  if (!canonical) return undefined
  if (HOTA_MODES.has(canonical)) return canonical
  return superModeForMode(canonical) === 'DATA' ? 'Digi' : undefined
}

/// The feed's own "Digi" is not a mode anywhere else; DATA is the generic one
/// the app files a data signal under.
function appMode(mode: string | undefined): string | undefined {
  const upper = (mode ?? '').trim().toUpperCase()
  if (!upper) return undefined
  return upper === 'DIGI' ? 'DATA' : upper
}

function apiKeyOf(ctx: HookContext): string | undefined {
  return ctx.account?.credentials?.apiKey?.trim() || undefined
}

const SpotsHook = {
  sourceName: 'HOTA',

  async fetchSpots(_args: Record<string, never>, ctx: HookContext): Promise<Spot[]> {
    if (!ctx.online) return []

    // Live spots only (QRT'd ones are left out by default), as many as the
    // feed allows in one page.
    const response = await host.fetch(`${API_BASE}/spots?limit=200`, {
      headers: { Accept: 'application/json' },
    })
    if (response.status !== 200) throw new Error(`HOTA API returned HTTP ${response.status}`)
    const apiSpots = JSON.parse(response.body) as unknown
    if (!Array.isArray(apiSpots)) throw new Error('HOTA API returned something other than a list of spots')

    return (apiSpots as HOTAApiSpot[]).flatMap((spot) => {
      if (spot.ended) return []
      const call = (spot.activator ?? spot.callsign ?? '').toUpperCase().trim()
      if (!call) return []
      const reference = (spot.reference ?? '').toUpperCase().trim()

      const parsedFreq = Number.parseFloat(String(spot.freq_khz ?? ''))
      const freq = Number.isNaN(parsedFreq) ? undefined : parsedFreq
      const parsedTime = Date.parse(spot.created_at ?? '')

      const sourceInfo: Record<string, JSONValue> = {}
      if (spot.comment) sourceInfo.comments = spot.comment
      if (spot.spotter) sourceInfo.spotter = spot.spotter.toUpperCase().trim()

      return [{
        their: { call },
        freq,
        band: freq ? bandForFrequency(freq) : undefined,
        mode: appMode(spot.mode),
        refs: reference ? [{ ref: reference, type: HUNTING_TYPE }] : [],
        spot: {
          timeInMillis: Number.isNaN(parsedTime) ? 0 : parsedTime,
          source: SPOT_SOURCE,
          label: [reference, spot.reference_name].filter((x) => x).join(': '),
          sourceInfo,
        },
      }]
    })
  },

  async isSelfSpotEnabled({ operation }: { operation: Record<string, any> }, ctx: HookContext): Promise<SpotEligibility> {
    // Posting needs the operator's key, so the source is not offered without
    // one: a post that can only come back rejected is worse than no button.
    return apiKeyOf(ctx) && refsOfType(operation, ACTIVATION_TYPE).length > 0
      ? { enabled: true, icon: manifest.icon }
      : { enabled: false }
  },

  async isOtherSpotEnabled({ qso }: { qso: Record<string, any> }, ctx: HookContext): Promise<SpotEligibility> {
    return apiKeyOf(ctx) && refsOfType(qso, HUNTING_TYPE).length > 0
      ? { enabled: true, icon: manifest.icon }
      : { enabled: false }
  },

  async postSelfSpot({ operation, freq, mode, comment }: PostSelfSpotRequest, ctx: HookContext): Promise<PostResult> {
    const refs = refsOfType(operation, ACTIVATION_TYPE)
    if (refs.length === 0) return { ok: false, message: 'No HOTA activation on this operation' }
    // A multi-operator station is several calls; HOTA takes them all at once.
    const calls = String(operation.stationCall ?? '').split(',').map((c) => c.trim()).filter((c) => c)
    if (calls.length === 0) return { ok: false, message: 'This operation has no station callsign to spot' }
    if (!freq || !Number.isFinite(Number(freq))) return { ok: false, message: 'This operation has no frequency to spot' }
    return postSpotToHOTA({ calls, refs: refs.map((r) => r.ref!), freq, mode, comment }, ctx)
  },

  async postOtherSpot({ qso, comment }: PostOtherSpotRequest, ctx: HookContext): Promise<PostResult> {
    const refs = refsOfType(qso, HUNTING_TYPE)
    if (refs.length === 0) return { ok: false, message: 'No HOTA reference on this QSO' }
    const freq = Number(qso.freq)
    if (!freq) return { ok: false, message: 'This QSO has no frequency to spot' }
    // A spot naming no station reaches everybody watching the feed.
    const call = String(((qso.their ?? {}) as Record<string, unknown>).call ?? '').trim()
    if (!call) return { ok: false, message: 'This QSO has no callsign to spot' }
    return postSpotToHOTA(
      { calls: [call], refs: refs.map((r) => r.ref!), freq, mode: qso.mode ? String(qso.mode) : undefined, comment },
      ctx,
    )
  },
}

interface HOTAPostResponse {
  created?: unknown[]
  refused?: { activator?: string; reference?: string; reason?: string }[]
  error?: string
}

/// One request for every activator and reference: the endpoint takes both as
/// lists and answers which pairs it created and which it refused, and why.
async function postSpotToHOTA(
  { calls, refs, freq, mode, comment }: { calls: string[]; refs: string[]; freq: number; mode?: string; comment?: string },
  ctx: HookContext,
): Promise<PostResult> {
  const t = tFor(ctx)
  const apiKey = apiKeyOf(ctx)
  if (!apiKey) return { ok: false, message: t('missingCredentials') }

  const sentMode = hotaMode(mode)
  try {
    const response = await host.fetch(`${API_BASE}/spots`, {
      method: 'POST',
      headers: {
        // A header keeps the key out of every URL a log or proxy records.
        'X-Integration-Key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        activators: calls,
        references: refs,
        freq_khz: freq,
        // Left out rather than guessed: a spot claiming SSB for a CW signal
        // sends hunters to the wrong place.
        ...(sentMode ? { mode: sentMode } : {}),
        comment: comment ?? '',
      }),
    })

    let body: HOTAPostResponse = {}
    try {
      body = JSON.parse(response.body ?? '') as HOTAPostResponse
    } catch (_error) {
      // Not JSON; the status says what happened.
    }

    if (response.status === 401 || response.status === 403) return { ok: false, message: t('keyRejected') }
    if (response.status < 200 || response.status >= 300) {
      return { ok: false, message: body.error ?? `HOTA API returned HTTP ${response.status}` }
    }

    // Every refusal is named, even when other pairs landed: a reference the
    // operator IS activating left unspotted, with nothing saying so, is the
    // failure worth reporting.
    const refused = body.refused ?? []
    if (refused.length > 0) {
      // The activator is named only when there were several to choose from.
      const which = refused
        .map((r) => `${calls.length > 1 && r.activator ? `${r.activator} at ` : ''}${r.reference ?? '?'}${r.reason ? ` (${r.reason})` : ''}`)
        .join(', ')
      return { ok: false, message: t('postRefused', { refs: which }) }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

/// The export of every active reference. A JSON object whose `references`
/// carry the code, an English name (sometimes empty), the official local name,
/// the region and the coordinates.
const hotaDataFile: DataFileDefinition = {
  key: `${manifest.key}-all-references`,
  name: (_args: Record<string, never>, ctx: HookContext) => tFor(ctx)('dataFileName'),
  description: (_args: Record<string, never>, ctx: HookContext) => tFor(ctx)('dataFileDescription'),
  url: `${API_BASE}/references/export`,
  // A young program adding sites every week; a month-old list would miss the
  // ones an operator just read about.
  maxAgeInDays: 7,
  fetchType: 'json',
  category: 'hota',
  jsonOptions: { rootPath: 'references' },
  jsonToLookupEntry: (entry: Record<string, any>) => {
    // The export carries active references only today, but each row says so,
    // and the sync feed sends retired ones in the same shape.
    if (entry?.status && entry.status !== 'active') return null

    const ref = String(entry?.code ?? '').trim().toUpperCase()
    if (!REFERENCE_REGEX.test(ref)) return null

    // The official local name is the one the rules require and the spot feed
    // shows; the English name is optional and often blank.
    const nameLocal = String(entry?.name_local ?? '').trim()
    const nameEnglish = String(entry?.name ?? '').trim()
    const name = nameLocal || nameEnglish || ref

    const lat = typeof entry?.lat === 'number' ? entry.lat : undefined
    const lon = typeof entry?.lon === 'number' ? entry.lon : undefined
    const region = String(entry?.county ?? '').trim() || undefined

    return {
      // The ISO country, which is also the reference's own prefix.
      subCategory: ref.slice(0, 2),
      key: ref,
      name,
      lat,
      lon,
      flags: 1,
      data: {
        ref,
        name,
        ...(nameEnglish && nameEnglish !== name ? { nameEnglish } : {}),
        era: entry?.era,
        location: region,
        grid: lat != null && lon != null ? locationToGrid6(lat, lon) : undefined,
        lat,
        lon,
      },
    }
  },
}

const AccountHook = {
  label: 'HOTA',
  description: (_args: Record<string, never>, ctx: HookContext) => tFor(ctx)('accountDescription'),
  kvKey: manifest.key,
  // The key belongs to the operator's HOTA account, not to a device.
  synchronizable: true,
  fields: (_args: Record<string, never>, ctx: HookContext) => {
    const t = tFor(ctx)
    return [
      {
        key: 'apiKey',
        label: t('apiKeyLabel'),
        type: 'secret' as const,
        postface: t('apiKeyPostface'),
      },
    ]
  },
  /// The key's other scope, reading one's own summary, is a real check that
  /// puts nothing on the air — unlike posting a spot to see if it lands.
  async testCredentials(credentials: Record<string, string>, ctx: HookContext): Promise<string> {
    const t = tFor(ctx)
    const apiKey = credentials.apiKey?.trim()
    if (!apiKey) return t('missingCredentials')
    try {
      const response = await host.fetch(`${API_BASE}/me/summary`, {
        headers: { 'X-Integration-Key': apiKey, Accept: 'application/json' },
      })
      if (response.status === 401 || response.status === 403) return t('keyRejected')
      if (response.status !== 200) return t('checkFailed', { status: String(response.status) })
      let callsign: string | undefined
      try {
        const body = JSON.parse(response.body) as Record<string, any>
        callsign = body?.callsign ?? body?.user?.callsign
      } catch (_error) {
        // A 200 is the answer; the callsign only decorates it.
      }
      return callsign ? t('keyAcceptedFor', { callsign }) : t('keyAccepted')
    } catch (e) {
      return t('checkFailed', { status: e instanceof Error ? e.message : String(e) })
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
    registerHook('spots', { hook: SpotsHook, key: manifest.key })
    registerHook('account', { hook: AccountHook, key: manifest.key })
    registerHook('dataFile', { hook: hotaDataFile, key: `${manifest.key}-all-references` })
    registerHook('scoring', {
      hook: contestScorer(oneCallsignPerDay(activityScorer(HOTA_SCORING), ACTIVATION_TYPE), {
        scope: { refTypes: [ACTIVATION_TYPE, HUNTING_TYPE], huntingRefTypes: [HUNTING_TYPE] },
      }),
      key: manifest.key,
    })
    // One file per reference: cqhota.app files an upload under the single
    // reference its MY_SIG_INFO names.
    registerHook('export', {
      hook: activityExportHook({ key: manifest.key, label: 'HOTA', activationType: ACTIVATION_TYPE, icon: manifest.icon }),
      key: manifest.key,
    })
  },
})
