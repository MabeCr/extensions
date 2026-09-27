// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The QSO Party Hub (qsopartyhub.com): one HTML page of spots per party, and
// one form per party that takes a new one. No API — the table is scraped
// off the page and the spot is the same form the site's own button submits.
//
// Plain http, because the Hub serves nothing else. The app fetches it over
// https through its own proxy from extension API 4 on — which is why the
// manifest declares 4: an older app refuses any http URL.

import { bandForFrequency, modeForFrequency } from "@ham2k/lib-operation-data"
import { fmtFreq, parseFreq } from "@ham2k/lib-format-tools"
import type { QsoPartyIdentity } from "@ham2k/qso-parties/identity"
import type { Spot } from "@ham2k/extension-sdk"

export const HUB_BASE = 'http://qsopartyhub.com'

/// What every spot from either feed is stamped with — app-polo's `qp`
/// extension's key, which is what it stamps its own. The feed a spot came
/// from is in `sourceInfo.source`.
export const SPOT_SOURCE = 'qp'

export function hubTableUrl(party: QsoPartyIdentity): string {
  return `${HUB_BASE}/${party.hubPage}-table.php`
}

export function hubSpotUrl(party: QsoPartyIdentity): string {
  return `${HUB_BASE}/${party.hubPage}-spots.php`
}

/// Which of the parties sharing a hub page a county code belongs to. A row
/// on the page says the county and not the party, and the May page carries
/// four: a state-prefixed code (`MAWOR`, `ORDES`, `INADA`) names its state,
/// and Delaware's three (`NDE`, `KDE`, `SDE`) end in theirs. A code that
/// names none of them is filed under the first party — the page was read on
/// its behalf, and a spot with a party is worth more than one dropped.
export function partyForCounty(code: string, parties: QsoPartyIdentity[]): QsoPartyIdentity {
  const upper = code.toUpperCase()
  if (upper.length >= 5) {
    const byPrefix = parties.find((party) => party.states.includes(upper.slice(0, 2)))
    if (byPrefix) return byPrefix
  }
  const bySuffix = parties.find((party) => party.states.includes(upper.slice(-2)))
  return bySuffix ?? parties[0]
}

/// The page carries `<table id=spots>` with a header row and then one row per
/// spot: TIME (UTC), SPOT (the call), FREQ, QTH (the county code), COMMENT,
/// POSTER. Cells may hold markup; only their text is read. [parties] are the
/// ones whose page this is — one, or the several that share it.
///
/// One row per station, the NEWEST: the hub keeps every spot ever posted for
/// the weekend, and a mobile that has moved five times is five rows there
/// and one station here.
export function parseHubTable(html: string, parties: QsoPartyIdentity[]): Spot[] {
  const table = html.match(/<table id=spots>(.*?)<\/table>/ms)?.[1] ?? ''
  const rows = table.match(/<tr[^>]*>.*?<\/tr>/gs) ?? []
  rows.shift()

  const newest = new Map<string, Spot>()
  for (const row of rows) {
    const cells = (row.match(/<td[^>]*>(.*?)<\/td>/gs) ?? []).map((cell) => cell.replace(/<[^>]*>/g, '').trim())
    const [time, call, freqText, county, comment, poster] = cells
    if (!call) continue
    const freq = parseFreq(freqText ?? '')
    if (!freq) continue
    // The time is UTC with no marker ('2026-05-02 14:03:11'); parsed as local
    // time every spot would move by the operator's offset. An unreadable
    // time is 0, never NaN, so the newest-wins comparison below stays total.
    const parsedTime = Date.parse(`${(time ?? '').replace(' ', 'T')}Z`)
    const timeInMillis = Number.isNaN(parsedTime) ? 0 : parsedTime

    const party = county ? partyForCounty(county, parties) : parties[0]
    const spot: Spot = {
      their: { call: call.toUpperCase() },
      freq,
      band: bandForFrequency(freq),
      mode: modeForFrequency(freq, { ituRegion: 2 }) || undefined,
      refs: county ? [partyRef(party, county)] : [],
      spot: {
        timeInMillis,
        source: SPOT_SOURCE,
        label: `${party.short}: ${[county, comment].filter((x) => x).join(' • ')}`,
        sourceInfo: {
          source: 'QP Hub',
          ...(comment ? { comments: comment } : {}),
          ...(poster ? { spotter: poster.toUpperCase() } : {}),
        },
      },
    }
    const held = newest.get(spot.their.call)
    if (!held || timeInMillis >= held.spot.timeInMillis) newest.set(spot.their.call, spot)
  }
  return [...newest.values()]
}

/// The ref a spot carries for the party, with the county in `location` —
/// which is what the party's exchange field reads once the spot becomes a
/// QSO — and in `ref`, which is what the spots panel tells two stations apart
/// by. The engine reads no `ref` on its own type, so the copy costs nothing.
export function partyRef(party: QsoPartyIdentity, county: string): { type: string; ref: string; location: string } {
  const code = county.toUpperCase()
  return { type: party.refType, ref: code, location: code }
}

export interface HubSpotFields {
  call: string
  freq: number
  /// Every county the operation is in; the first is the QTH field and the
  /// rest go into the comment, which is where the hub's own county-line
  /// posts put them.
  counties: string[]
  comment?: string
  poster?: string
}

/// The form the hub's own page submits, urlencoded. `[via Ham2K]` is what
/// app-polo appends, so a spot from either app reads the same on the hub.
export function hubSpotBody({ call, freq, counties, comment, poster }: HubSpotFields): string {
  const fields: Record<string, string> = {
    station: call,
    frequency: fmtFreq(freq) || '00',
    county: counties[0] ?? '',
    comment: [counties.length > 1 ? counties.join('/') : '', comment ?? '', '[via Ham2K]'].filter((x) => x).join(' '),
    poster: poster ?? '',
  }
  return Object.entries(fields)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')
}
