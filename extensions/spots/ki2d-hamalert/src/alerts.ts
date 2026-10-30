// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// HamAlert's alert records, as `GET /api/spots2` answers them, and what the
// app makes of each: a spot on the board, and the mute HamAlert keeps for it.
//
// The record is the spot HamAlert matched, stored as its server built it
// (hamalert-server's `normalizeSpot` and `saveSpot`), plus the comments of
// every trigger it matched. Field names below are that code's own, read from
// https://github.com/hamalert — the endpoint is the one HamAlert's own app
// polls, and is not documented anywhere else.

import type { JSONValue, Spot, SpotRef } from "@ham2k/extension-sdk"
import { bandForFrequency, modeForFrequency } from "@ham2k/lib-operation-data"

/// What every spot from this source is stamped with. A board, and anything
/// derived from it, carries this string, so it never follows the package key.
export const SPOT_SOURCE = 'hamalert'

export interface HamAlertRecord {
  _id?: string
  /// As spotted, prefix and suffix included (`EA8/KI2D/P`).
  fullCallsign?: string
  /// Without them (`KI2D`) — what HamAlert matches a mute against.
  callsign?: string
  /// MHz. Absent for a D-STAR spot that names only a reflector.
  frequency?: number | string
  /// HamAlert's own band names, which are the app's (`20m`, `70cm`).
  band?: string
  /// Lowercase, with every PSK, JT and MSK flavour folded into `psk`, `jt`
  /// and `msk` — the value a mute matches.
  mode?: string
  /// The mode as the source gave it, lowercased (`psk31`, `ft8`).
  modeDetail?: string
  /// ISO 8601 as PHP writes it, `2026-10-25T14:03:07+0000`.
  receivedDate?: string
  spotter?: string
  comment?: string
  /// Where HamAlert got the spot: `cluster`, `rbn`, `pota`, `sotawatch`,
  /// `pskreporter`…
  source?: string
  summitRef?: string
  summitName?: string
  /// A WWFF reference, or a POTA park's — `wwffProgram` says which.
  wwffRef?: string
  wwffName?: string
  wwffProgram?: string
  iotaGroupRef?: string
  iotaGroupName?: string
  /// One per trigger the spot matched; a string on older records.
  triggerComment?: string[] | string
}

export function parseAlerts(body: string): HamAlertRecord[] {
  const parsed = JSON.parse(body) as { spots?: unknown }
  return Array.isArray(parsed?.spots) ? (parsed.spots as HamAlertRecord[]) : []
}

/// Epoch millis, or 0 for a record without a readable date. PHP's offset has
/// no colon (`+0000`), which `Date.parse` is only required to read with one.
export function receivedAtMillis(record: HamAlertRecord): number {
  const text = (record.receivedDate ?? '').replace(/([+-]\d\d)(\d\d)$/, '$1:$2')
  const parsed = Date.parse(text)
  return Number.isNaN(parsed) ? 0 : parsed
}

export function triggerComments(record: HamAlertRecord): string[] {
  const raw = record.triggerComment
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : []
  return list.map((comment) => String(comment).trim()).filter((comment) => comment)
}

/// The mode as the board names one. HamAlert lowercases what the source
/// said; uppercased, that is the app's own name for every mode it reports
/// (`CW`, `SSB`, `FT8`, `PSK31`). A spot naming none takes the band plan's,
/// as the app's other sources do, so the board's mode filter still places it.
function boardMode(record: HamAlertRecord, freq: number): string | undefined {
  const named = (record.modeDetail || record.mode || '').trim().toUpperCase()
  if (named) return named
  return modeForFrequency(freq) || undefined
}

function refsOf(record: HamAlertRecord): SpotRef[] {
  const refs: SpotRef[] = []
  if (record.summitRef) refs.push({ type: 'sota', ref: record.summitRef })
  if (record.wwffRef) {
    // HamAlert keeps POTA parks and WWFF references in one table, told apart
    // by the program; a spot from POTA's own feed is a park whatever it says.
    const pota = record.wwffProgram === 'pota' || record.source === 'pota'
    refs.push({ type: pota ? 'pota' : 'wwff', ref: record.wwffRef })
  }
  return refs
}

/// One alert as a spot, or nothing for one the board cannot tune to.
export function spotForAlert(record: HamAlertRecord): Spot | undefined {
  const call = (record.fullCallsign || record.callsign || '').trim().toUpperCase()
  const mhz = Number(record.frequency)
  if (!call || !(mhz > 0)) return undefined
  const freq = Math.round(mhz * 1000 * 1000) / 1000

  const triggers = triggerComments(record)
  const about = record.summitName || record.wwffName || record.iotaGroupName || record.comment

  const sourceInfo: Record<string, JSONValue> = {}
  if (record._id) sourceInfo.alertId = String(record._id)
  if (record.source) sourceInfo.origin = record.source
  if (record.spotter) sourceInfo.spotter = record.spotter.trim().toUpperCase()
  if (record.comment) sourceInfo.comments = record.comment
  if (record.iotaGroupRef) sourceInfo.iota = record.iotaGroupRef
  if (triggers.length) sourceInfo.triggers = triggers

  return {
    their: { call },
    freq,
    band: bandForFrequency(freq),
    mode: boardMode(record, freq),
    refs: refsOf(record),
    spot: {
      timeInMillis: receivedAtMillis(record),
      source: SPOT_SOURCE,
      // Which trigger fired is the reason the operator is being told at all,
      // so it leads; what the spot was about follows.
      label: [triggers.join(', '), about].filter((part) => part).join(' — '),
      sourceInfo,
    },
  }
}

/// The newest spot per station per band. HamAlert stores one record per
/// spot it matched, so a station worth an alert arrives once for every
/// spotter and skimmer that heard it; the board wants where it is now.
export function newestPerStation(spots: Spot[]): Spot[] {
  const newest = new Map<string, Spot>()
  for (const spot of spots) {
    const key = stationKey(spot.their.call, spot.band)
    const held = newest.get(key)
    if (!held || spot.spot.timeInMillis > held.spot.timeInMillis) newest.set(key, spot)
  }
  return [...newest.values()]
}

function stationKey(call: string, band: string | undefined): string {
  return `${call.toUpperCase()}|${band ?? ''}`
}

/// The stations the alerts name, each on its band, for `isAlerted`.
export function alertedStations(spots: Spot[]): Set<string> {
  return new Set(spots.map((spot) => stationKey(spot.their.call, spot.band)))
}

/// Whether a contact with [qso]'s station, on its band, is one an alert
/// named — whichever source the board heard it from. An alert with no band
/// names the station on any.
export function isAlerted(alerted: Set<string>, qso: Record<string, JSONValue>): boolean {
  const their = qso.their
  const call = their && typeof their === 'object' && !Array.isArray(their) ? their.call : undefined
  if (typeof call !== 'string' || !call) return false
  const band = typeof qso.band === 'string' ? qso.band : undefined
  return alerted.has(stationKey(call, band)) || alerted.has(stationKey(call, undefined))
}

/// What HamAlert's `addMute` takes: the canonical call, and the alert's own
/// band and mode in HamAlert's spelling, each null for "any".
export interface Mute {
  callsign: string
  band: string | null
  mode: string | null
}

export function muteFor(record: HamAlertRecord): Mute | undefined {
  const callsign = (record.callsign || record.fullCallsign || '').trim().toUpperCase()
  if (!callsign) return undefined
  return { callsign, band: record.band || null, mode: record.mode || null }
}

export function muteKey(mute: Mute): string {
  return `${mute.callsign}|${mute.band ?? ''}|${mute.mode ?? ''}`
}

/// Whether a logged contact's mode is one HamAlert files under [alertMode] —
/// the folding `normalizeSpot` does, and SSB for either sideband.
export function modeMatches(qsoMode: unknown, alertMode: string | null): boolean {
  if (!alertMode) return true
  const mode = String(qsoMode ?? '').trim().toUpperCase()
  switch (alertMode) {
    case 'ssb':
      return mode === 'SSB' || mode === 'USB' || mode === 'LSB'
    case 'psk':
    case 'jt':
    case 'msk':
      return mode.startsWith(alertMode.toUpperCase())
    default:
      return mode === alertMode.toUpperCase()
  }
}

/// Whether [qso] works the station [mute] would silence, on its band and in
/// its mode, at or after [fromMillis].
export function qsoWorks(qso: Record<string, JSONValue>, mute: Mute, fromMillis: number): boolean {
  const startAt = Number(qso.startAtMillis)
  if (!(startAt >= fromMillis)) return false
  if (mute.band && qso.band !== mute.band) return false
  return modeMatches(qso.mode, mute.mode)
}
