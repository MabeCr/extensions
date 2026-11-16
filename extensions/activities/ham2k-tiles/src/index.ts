// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Tiles on the Air — activating Maidenhead grid "tiles", the 6-character
// subsquares (about 5 × 7 km at mid latitudes). Rules and API are
// tilesontheair.com's own: https://tilesontheair.com/Rules, and Resources →
// "REST API for Developers".
//
// There is no reference list: a tile IS a grid square, so the reference is
// the subsquare the activator stands in, and decorating one needs no lookup.
// An activation is one QSO, from one tile, inside one UTC day (Rules,
// Activation). Chasers upload nothing: every QSO in the activator's ADIF
// credits the station worked, one credit per activation, callsign, band and
// mode, so there is no hunter export. Two activators at once is "tile to
// tile", T3, scored double by the site from both activation records.
//
// Scoring beyond the contacts — distance, elevation, carried weight, pets,
// kids, QRP, the first-tile-in-quarter bonus — is claimed on the site's own
// activation form, and none of it is in a log, so none of it is here.
//
// The spot feed is public. Posting a self-spot takes the operator's callsign
// and the "Offline Spot Gateway PIN" they set on their Tiles profile; there
// is no spotting of others, since every Tiles spot is a self-spot.

import {
  activityAdifImport,
  activityExportHook,
  activityScorer,
  canonicalMode,
  contestScorer,
  defineExtension,
  host,
} from "@ham2k/extension-sdk"
import type {
  ActivityScoresheet,
  ActivitySuggestion,
  ContestScorer,
  HookContext,
  JSONValue,
  PostResult,
  PostSelfSpotRequest,
  Ref,
  Spot,
  SpotEligibility,
  SpotRef,
  SuggestArgs,
} from "@ham2k/extension-sdk"
import { parseCallsign } from "@ham2k/lib-callsigns"
import { bandForFrequency } from "@ham2k/lib-operation-data"
import { gridToLocation, locationToGrid6 } from "@ham2k/lib-geo-tools"

import { tFor } from "./i18n.ts"

import manifest from "../manifest.json" with { type: "json" }

const HUNTING_TYPE = 'tiles'
const ACTIVATION_TYPE = 'tilesActivation'

/// What `MY_SIG`/`SIG` name the program as. Tiles' importer reads the grid,
/// not these; they are for reading a Tiles log back into the app.
const PROGRAM = 'TILES'
const LABEL = 'Tiles'

/// A 6-character Maidenhead subsquare. Written all upper case, as the Tiles
/// feed and API write it: `FN42HN`.
export const TILE_REGEX = /^[A-R]{2}[0-9]{2}[A-X]{2}$/i

const API_BASE = 'https://icneuzxitdqtofutxbla.supabase.co/functions/v1'

export function normalizeTile(text: unknown): string {
  return (typeof text === 'string' ? text : '').trim().toUpperCase()
}

/// The tile a grid lies in: its first six characters, from a grid of six or
/// more. A 4-character grid names a hundred tiles, so it names none.
export function tileForGrid(grid: unknown): string | undefined {
  const tile = normalizeTile(grid).slice(0, 6)
  return TILE_REGEX.test(tile) ? tile : undefined
}

/// The subsquare in the conventional casing the rest of the app writes a grid
/// in, `FN42hn`, for the `grid` a decorated ref carries.
function gridCase(tile: string): string {
  return `${tile.slice(0, 4)}${tile.slice(4).toLowerCase()}`
}

function refsOfType(container: Record<string, unknown>, type: string): Ref[] {
  return (((container.refs as Ref[] | undefined) ?? [])).filter((r) => r.type === type && r.ref)
}

/// Only what can be typed into a grid: letters and digits. Case is left
/// alone; `validateRef` upper-cases.
const TRANSFORMS = [{ pattern: '[^A-Z0-9]', replacement: '', flags: 'gi' }]

function tileRef(tile: string, type: string, ctx: HookContext): Ref {
  const [lat, lon] = gridToLocation(tile)
  return {
    type,
    ref: tile,
    name: tFor(ctx)('tileName', { grid: gridCase(tile) }),
    program: PROGRAM,
    grid: gridCase(tile),
    lat,
    lon,
    label: `${LABEL} ${tile}`,
    shortLabel: `${LABEL} ${tile}`,
  }
}

const refHandler = {
  async validateRef({ ref }: { ref: Ref }, _ctx: HookContext) {
    const normalized = normalizeTile(ref.ref)
    return { valid: TILE_REGEX.test(normalized), normalized }
  },

  /// No lookup: everything a tile is follows from its six characters. The
  /// point is the tile's centre, which is what Tiles itself places a spot at
  /// when it is given only a grid.
  async decorateRef({ ref }: { ref: Ref }, ctx: HookContext): Promise<Ref> {
    const tile = normalizeTile(ref.ref)
    if (!TILE_REGEX.test(tile)) {
      return {
        ...ref,
        ref: tile,
        name: tFor(ctx)('invalidReference'),
        program: PROGRAM,
        label: undefined,
        shortLabel: undefined,
        grid: undefined,
        lat: undefined,
        lon: undefined,
      }
    }
    return { ...ref, ...tileRef(tile, ref.type, ctx) }
  },

  /// "at FN42HN" — for the activation only; a hunted tile is not where the
  /// operation is happening.
  async suggestOperationTitle({ ref }: { ref: Ref }, _ctx: HookContext) {
    if (ref.type !== ACTIVATION_TYPE || !ref.ref) return null
    return { at: normalizeTile(ref.ref) }
  },
}

const activityHook = {
  async operationControls({ operation }: { operation: Record<string, JSONValue> }, ctx: HookContext) {
    return [
      {
        key: `${manifest.key}/activation`,
        label: tFor(ctx)('activationControl'),
        icon: manifest.icon,
        color: manifest.accentColor,
        order: 10,
        optionType: 'optional' as const,
        // One tile at a time: a station that moves to the next tile starts a
        // new segment, and each tile is its own activation.
        allowsMultiple: false,
        input: {
          kind: 'refList' as const,
          refType: ACTIVATION_TYPE,
          placeholder: tileForGrid(operation.grid) ?? 'FN42HN',
          pattern: TILE_REGEX.source,
          transforms: TRANSFORMS,
        },
      },
    ]
  },

  async loggingControls(_args: { operation: Record<string, JSONValue>; qso?: Record<string, JSONValue> }, ctx: HookContext) {
    return [
      {
        key: `${manifest.key}/hunter`,
        label: tFor(ctx)('huntingControl'),
        icon: manifest.icon,
        color: manifest.accentColor,
        order: 10,
        optionType: 'optional' as const,
        // A station stands in one tile; a rover in the next one is a new
        // contact, logged again.
        allowsMultiple: false,
        input: {
          kind: 'refList' as const,
          refType: HUNTING_TYPE,
          // Not the other station's grid from a callsign lookup: that is
          // where they live, which is exactly where an activator is not.
          placeholder: 'FN42HN',
          pattern: TILE_REGEX.source,
          transforms: TRANSFORMS,
        },
      },
    ]
  },

  /// The tile the operator is standing in, and any tile typed in full. There
  /// is nothing else to offer: every point on Earth is in exactly one tile.
  async suggest({ location, searchTerm }: SuggestArgs, ctx: HookContext): Promise<ActivitySuggestion[]> {
    if (searchTerm) {
      const typed = normalizeTile(searchTerm)
      if (!TILE_REGEX.test(typed)) return []
      return [{ ...tileRef(typed, ACTIVATION_TYPE, ctx), relevance: 1, allowsMultiple: false }]
    }
    if (!location) return []
    const tile = tileForGrid(locationToGrid6(location.lat, location.lon))
    if (!tile) return []
    return [{ ...tileRef(tile, ACTIVATION_TYPE, ctx), distance: 0, relevance: 1, allowsMultiple: false }]
  },
}

function adifPair(prefix: '' | 'MY_', refs: Ref[]) {
  return refs.length > 0
    ? [{ name: `${prefix}SIG`, value: PROGRAM }, { name: `${prefix}SIG_INFO`, value: refs[0].ref! }]
    : []
}

const adifFieldsHook = {
  /// `MY_GRIDSQUARE` matters more than `MY_SIG` here: it is what Tiles reads,
  /// and it warns when the grid in the file disagrees with the tile being
  /// claimed. In Tiles' own export the file IS the activation of one tile, so
  /// a station grid that lies elsewhere — a 4-character one, or one left from
  /// before the operator moved — gives way to the tile. A finer grid inside
  /// the tile is kept. Other exports leave the station's grid as it is.
  async fieldsForOneQSO(
    { qso, operation, mainHandler }: { qso: Record<string, JSONValue>; operation: Record<string, JSONValue>; mainHandler?: boolean },
    _ctx: HookContext,
  ) {
    const activated = refsOfType(operation, ACTIVATION_TYPE)
    const hunted = refsOfType(qso, HUNTING_TYPE)
    const tile = tileForGrid(activated[0]?.ref)
    const stationGrid = typeof operation.grid === 'string' ? operation.grid : ''
    const gridGivesWay = mainHandler && tile && !normalizeTile(stationGrid).startsWith(tile)
    return [
      ...adifPair('', hunted),
      ...adifPair('MY_', activated),
      ...(gridGivesWay ? [{ name: 'MY_GRIDSQUARE', value: gridCase(tile) }] : []),
    ]
  },
}

const adifImportHook = activityAdifImport({
  sig: PROGRAM,
  huntingType: HUNTING_TYPE,
  activationType: ACTIVATION_TYPE,
  normalize: normalizeTile,
})

/// One QSO, one tile, one UTC day.
///
/// A station is worked once per band, mode and UTC day, the credit Tiles
/// gives a chaser; a station in a different tile — a rover, or a partner on
/// a boundary who moved — is a new hunted tile and no duplicate.
export const TILES_SCORING = {
  label: LABEL,
  icon: manifest.icon,
  activationType: ACTIVATION_TYPE,
  huntingType: HUNTING_TYPE,
  qsosToActivate: 1,
  uniquePer: ['band', 'mode', 'day', 'ref'] as const,
  activates: 'daily' as const,
  refNoun: (ctx: HookContext) => tFor(ctx)('tile'),
  refNounPlural: (ctx: HookContext) => tFor(ctx)('tilesPlural'),
  // Tiles' own name for it.
  p2pLabel: 'T3',
}

type TilesScoresheet = ActivityScoresheet & { workedByTile?: Record<string, ActivityScoresheet['workedByCall']> }

/// Worked-before kept per tile the ACTIVATOR is in. The activity scorer keeps
/// one history for the whole operation and judges a duplicate by the hunted
/// reference alone, so a rover who works W1AW from EM73UU and again, on the
/// same band that day, from EM73UV would see the second called a duplicate
/// and EM73UV never activated. To Tiles those are two activations, each
/// owed its own contacts.
///
/// The scorer reads `workedByCall` nowhere else, so each call is handed the
/// current tile's history in it, and the history goes back under its tile
/// afterwards rather than riding along twice in every checkpoint.
export function perTileHistory(scorer: ContestScorer<ActivityScoresheet>): ContestScorer<TilesScoresheet> {
  return {
    startScoresheet: (args, ctx) => ({ ...scorer.startScoresheet(args, ctx), workedByTile: {} }),
    scoreQso(args, ctx) {
      const tile = tileForGrid(refsOfType(args.operation, ACTIVATION_TYPE)[0]?.ref) ?? ''
      const byTile = args.scoresheet.workedByTile ?? {}
      args.scoresheet.workedByCall = byTile[tile] ?? {}
      const result = scorer.scoreQso(args, ctx)
      const sheet = result.scoresheet as TilesScoresheet
      sheet.workedByTile = { ...byTile, [tile]: sheet.workedByCall }
      sheet.workedByCall = {}
      return { ...result, scoresheet: sheet }
    },
    summarizeScore: (args, ctx) => scorer.summarizeScore(args, ctx),
  }
}

/// The published spot record. `frequency` is a string in MHz, and the grid is
/// four or six characters.
interface TilesApiSpot {
  id?: string
  call_sign?: string
  frequency?: string | number
  mode?: string
  maidenhead_grid?: string
  notes?: string | null
  pota_ref?: string | null
  sota_ref?: string | null
  state?: string | null
  country?: string | null
  created_at?: string
}

const SPOT_SOURCE = 'tiles'

/// Tiles' mode names that are not the app's. Everything else Tiles names
/// (SSB, CW, FT8, FT4, FT2, FM, DMR, M17, PSK31) is the app's word already.
const MODES_FROM_TILES: Record<string, string | undefined> = {
  'D-STAR': 'DSTAR',
  'JS8CALL': 'JS8',
  'AX.25': 'PKT',
  // VarAC runs over VARA, which has no mode of its own in the app.
  'VARAC': 'DATA',
  // Left out rather than guessed.
  'OTHER': undefined,
}

const TILES_MODES = new Set(['SSB', 'CW', 'FT8', 'FT4', 'FT2', 'FM', 'DMR', 'M17', 'PSK31'])
const MODES_TO_TILES: Record<string, string> = {
  DSTAR: 'D-STAR',
  JS8: 'JS8Call',
  PKT: 'AX.25',
  OLIVIA: 'Olivia',
}

export function appMode(mode: string | undefined): string | undefined {
  const upper = (mode ?? '').trim().toUpperCase()
  if (!upper) return undefined
  return upper in MODES_FROM_TILES ? MODES_FROM_TILES[upper] : canonicalMode(upper)
}

/// The self-spot endpoint REQUIRES a mode from its own list, so a mode it has
/// no name for is "Other" rather than left out.
export function tilesMode(mode: string | undefined): string {
  const canonical = canonicalMode(mode ?? '') ?? ''
  if (TILES_MODES.has(canonical)) return canonical
  return MODES_TO_TILES[canonical] ?? 'Other'
}

/// The endpoint reads a number of 1000 or more as kHz and anything below as
/// MHz. The app's frequencies are kHz, so below 1 MHz (630 and 2200 m) the
/// value goes as MHz to be read right.
export function tilesFrequency(freqInKHz: number): string {
  return freqInKHz >= 1000 ? String(freqInKHz) : String(freqInKHz / 1000)
}

const callOf = (spot: TilesApiSpot) => (spot.call_sign ?? '').trim().toUpperCase()
/// The site's own rule: a spot whose notes say QRT, anywhere, takes its
/// operator off the air.
const isQrt = (notes: unknown) => typeof notes === 'string' && /\bQRT\b/i.test(notes)

/// A QRT is a marker spot whose notes say "QRT", and it takes the operator's
/// earlier spots off the air with it, as the Spots page does.
export function liveSpots(spots: TilesApiSpot[]): TilesApiSpot[] {
  const qrtAt = new Map<string, number>()
  for (const spot of spots) {
    if (!isQrt(spot.notes)) continue
    const call = callOf(spot)
    const time = Date.parse(spot.created_at ?? '') || 0
    qrtAt.set(call, Math.max(qrtAt.get(call) ?? 0, time))
  }
  return spots.filter((spot) => {
    if (isQrt(spot.notes)) return false
    const qrt = qrtAt.get(callOf(spot))
    return qrt === undefined || (Date.parse(spot.created_at ?? '') || 0) > qrt
  })
}

function credentialsOf(ctx: HookContext): { call: string; pin: string } | undefined {
  const call = ctx.account?.credentials?.callsign?.trim().toUpperCase()
  const pin = ctx.account?.credentials?.pin?.trim()
  return call && pin ? { call, pin } : undefined
}

const SpotsHook = {
  sourceName: LABEL,

  async fetchSpots(_args: Record<string, never>, ctx: HookContext): Promise<Spot[]> {
    if (!ctx.online) return []

    // The feed's default window is the Spots page's own thirty minutes.
    const response = await host.fetch(`${API_BASE}/spots?limit=200`, {
      headers: { Accept: 'application/json' },
    })
    if (response.status !== 200) throw new Error(`Tiles API returned HTTP ${response.status}`)
    const body = JSON.parse(response.body) as { spots?: unknown }
    if (!Array.isArray(body?.spots)) throw new Error('Tiles API returned no list of spots')

    return liveSpots(body.spots as TilesApiSpot[]).flatMap((spot) => {
      const call = callOf(spot)
      if (!call) return []
      const grid = normalizeTile(spot.maidenhead_grid)
      const tile = tileForGrid(grid)

      const mhz = Number.parseFloat(String(spot.frequency ?? ''))
      const freq = Number.isFinite(mhz) && mhz > 0 ? Math.round(mhz * 1000 * 100) / 100 : undefined
      const parsedTime = Date.parse(spot.created_at ?? '')

      // An operator running Tiles alongside POTA or SOTA says so on the spot,
      // and a hunter working them is in both.
      const refs: SpotRef[] = [
        ...(tile ? [{ type: HUNTING_TYPE, ref: tile }] : []),
        ...String(spot.pota_ref ?? '').split(',').map((r) => r.trim().toUpperCase()).filter((r) => r)
          .map((ref) => ({ type: 'pota', ref })),
        ...(spot.sota_ref?.trim() ? [{ type: 'sota', ref: spot.sota_ref.trim().toUpperCase() }] : []),
      ]

      const sourceInfo: Record<string, JSONValue> = { spotter: call }
      if (spot.notes) sourceInfo.comments = spot.notes

      return [{
        their: { call },
        freq,
        band: freq ? bandForFrequency(freq) : undefined,
        mode: appMode(spot.mode),
        refs,
        spot: {
          timeInMillis: Number.isNaN(parsedTime) ? 0 : parsedTime,
          source: SPOT_SOURCE,
          label: [grid, spot.state || spot.country].filter((x) => x).join(': '),
          sourceInfo,
        },
      }]
    })
  },

  async isSelfSpotEnabled({ operation }: { operation: Record<string, any> }, ctx: HookContext): Promise<SpotEligibility> {
    // Posting needs the operator's PIN, so the source is not offered without
    // one: a post that can only come back rejected is worse than no button.
    return credentialsOf(ctx) && refsOfType(operation, ACTIVATION_TYPE).length > 0
      ? { enabled: true, icon: manifest.icon }
      : { enabled: false }
  },

  async postSelfSpot({ operation, freq, mode, comment }: PostSelfSpotRequest, ctx: HookContext): Promise<PostResult> {
    const t = tFor(ctx)
    const credentials = credentialsOf(ctx)
    if (!credentials) return { ok: false, message: t('missingCredentials') }
    const tile = tileForGrid(refsOfType(operation, ACTIVATION_TYPE)[0]?.ref)
    if (!tile) return { ok: false, message: t('noActivation') }

    // The PIN belongs to one operator, so a club or special-event call is
    // refused rather than posted under it. `/P` and a country prefix are the
    // same operator, and the spot carries the call as worked: a hunter logs
    // what the spot shows.
    const station = String(operation.stationCall ?? '').split(',').map((c) => c.trim().toUpperCase()).filter((c) => c)
    const accountBase = parseCallsign(credentials.call).baseCall ?? credentials.call
    const call = station.length > 0
      ? station.find((c) => (parseCallsign(c).baseCall ?? c) === accountBase)
      : credentials.call
    if (!call) return { ok: false, message: t('callMismatch', { account: credentials.call, station: station.join(', ') }) }

    // A comment the site would read as a QRT is sent as one, rather than as a
    // spot that vanishes from the feed the moment it lands.
    const qrt = isQrt(comment)
    if (!qrt && (!freq || !Number.isFinite(Number(freq)))) return { ok: false, message: t('noFrequency') }

    const body = qrt
      ? { call_sign: call, pin: credentials.pin, qrt: true }
      : {
        call_sign: call,
        pin: credentials.pin,
        grid: tile,
        freq: tilesFrequency(Number(freq)),
        mode: tilesMode(mode),
        ...(comment ? { comment } : {}),
      }

    try {
      const response = await host.fetch(`${API_BASE}/self-spot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      })

      let answer: { ok?: boolean; spot?: unknown; error?: string } = {}
      try {
        const parsed = JSON.parse(response.body ?? '') as unknown
        if (parsed && typeof parsed === 'object') answer = parsed as typeof answer
      } catch (_error) {
        // Not JSON; the status says what happened.
      }

      if (response.status === 401 || response.status === 403) return { ok: false, message: t('pinRejected') }
      if (response.status === 429) return { ok: false, message: t('rateLimited') }
      if (response.status < 200 || response.status >= 300) {
        return { ok: false, message: answer.error ?? `Tiles API returned HTTP ${response.status}` }
      }
      // A spot is posted when Tiles says so: a 2xx from a proxy or a changed
      // API, saying nothing, is not one.
      if (answer.ok !== true) {
        return { ok: false, message: answer.error ?? t('unconfirmed', { status: String(response.status) }) }
      }
      return { ok: true }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  },
}

const AccountHook = {
  label: LABEL,
  description: (_args: Record<string, never>, ctx: HookContext) => tFor(ctx)('accountDescription'),
  kvKey: manifest.key,
  // The PIN belongs to the operator's Tiles profile, not to a device.
  synchronizable: true,
  fields: (_args: Record<string, never>, ctx: HookContext) => {
    const t = tFor(ctx)
    return [
      { key: 'callsign', label: t('callsignLabel'), type: 'text' as const, postface: t('callsignPostface') },
      { key: 'pin', label: t('pinLabel'), type: 'secret' as const, postface: t('pinPostface') },
    ]
  },
  /// Tiles has no way to check a PIN short of posting a spot with it, and a
  /// test that puts the operator on the air is no test. So this says only
  /// whether there is something to try.
  async testCredentials(credentials: Record<string, string>, ctx: HookContext): Promise<string> {
    const t = tFor(ctx)
    if (!credentials.callsign?.trim() || !credentials.pin?.trim()) return t('missingCredentials')
    return t('credentialsUnchecked', { callsign: credentials.callsign.trim().toUpperCase() })
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
    registerHook('scoring', {
      hook: contestScorer(perTileHistory(activityScorer(TILES_SCORING)), {
        scope: { refTypes: [ACTIVATION_TYPE, HUNTING_TYPE], huntingRefTypes: [HUNTING_TYPE] },
      }),
      key: manifest.key,
    })
    // One file per tile and UTC day: that is one Tiles activation, and the
    // site's New Activation form takes one ADIF for it.
    registerHook('export', {
      hook: activityExportHook({
        key: manifest.key,
        label: LABEL,
        activationType: ACTIVATION_TYPE,
        icon: manifest.icon,
        splitByUtcDay: true,
      }),
      key: manifest.key,
    })
  },
})
