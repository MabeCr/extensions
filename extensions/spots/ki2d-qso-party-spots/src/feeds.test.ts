// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The two feeds, read off captured markup. Neither has an API contract: the
// hub is a page and the tracker a map's data file, so what a row LOOKS like
// is the whole contract, and these fixtures are it.

import { test } from "node:test"
import assert from "node:assert/strict"

import type { QsoPartyIdentity } from "@ham2k/qso-parties/identity"

import { hubSpotBody, hubSpotUrl, hubTableUrl, parseHubTable, partyForCounty } from "./hub.ts"
import { activeParties, OPENS_BEFORE_MILLIS } from "./parties.ts"
import { parseTrackerFeed, trackerUrl } from "./tracker.ts"

const NEQP: QsoPartyIdentity = {
  refType: 'neqp',
  legacyPrefix: 'neqp',
  name: 'New England QSO Party',
  short: 'NEQP',
  states: ['CT', 'MA', 'ME', 'NH', 'RI', 'VT'],
  aprsShort: 'NEWE',
  trackerCode: 'NEWE',
  hubPage: 'in7qpne_de',
  periods: [{ startMillis: Date.UTC(2026, 4, 2, 20), endMillis: Date.UTC(2026, 4, 3, 4, 59) }],
}

const NEBRASKA: QsoPartyIdentity = {
  refType: 'nebraska-qso-party',
  legacyPrefix: 'ne',
  name: 'Nebraska QSO Party',
  short: 'NEQP',
  states: ['NE'],
  aprsShort: 'NEQP',
  trackerCode: 'NE',
  hubPage: 'neqp',
  periods: [{ startMillis: Date.UTC(2026, 3, 25, 13), endMillis: Date.UTC(2026, 3, 26, 1) }],
}

const DELAWARE: QsoPartyIdentity = {
  refType: 'deqp',
  legacyPrefix: 'de',
  name: 'Delaware QSO Party',
  short: 'DEQP',
  states: ['DE'],
  aprsShort: 'DEQP',
  trackerCode: 'DE',
  hubPage: 'in7qpne_de',
  periods: [{ startMillis: Date.UTC(2026, 4, 2, 17), endMillis: Date.UTC(2026, 4, 3, 23, 59) }],
}

const ONTARIO: QsoPartyIdentity = {
  refType: 'onqp',
  legacyPrefix: 'on',
  name: 'Ontario QSO Party',
  short: 'ONQP',
  states: ['ON'],
  aprsShort: 'ONQP',
  hubPage: 'onqp',
  periods: [{ startMillis: Date.UTC(2026, 3, 18, 18), endMillis: Date.UTC(2026, 3, 19, 18) }],
}

// ------------------------------------------------------------------ the hub

const HUB_PAGE = `<html><body><h1>IN7QPNE_DE Table</h1>
<table id=spots><tr><th>TIME (UTC)</th><th>SPOT</th><th>FREQ</th><th>QTH</th><th>COMMENT</th><th>POSTER</th></tr>
<tr><td>2026-05-02 20:15:03</td><td>k1abc/m</td><td>14.250</td><td>MAWOR</td><td>heading north</td><td>w1xyz</td></tr>
<tr><td>2026-05-02 21:40:11</td><td>K1ABC/M</td><td>7.235</td><td>MAMID</td><td></td><td>K1ABC</td></tr>
<tr><td>2026-05-02 20:30:00</td><td>N1DEF</td><td>3.845</td><td>NHHIL</td><td><b>fixed</b> station</td><td>N1DEF</td></tr>
<tr><td>2026-05-02 20:31:00</td><td></td><td>3.845</td><td>NHHIL</td><td></td><td></td></tr>
<tr><td>2026-05-02 20:32:00</td><td>W1GHI</td><td></td><td>CTHAR</td><td></td><td></td></tr>
<tr><td>2026-05-02 20:33:00</td><td>W3JKL</td><td>7.040</td><td>KDE</td><td></td><td></td></tr>
</table></body></html>`

test("the hub's table is read row by row, newest spot per station", () => {
  const spots = parseHubTable(HUB_PAGE, [NEQP, DELAWARE])
  assert.deepEqual(spots.map((s) => s.their.call).sort(), ['K1ABC/M', 'N1DEF', 'W3JKL'])

  // The mobile moved county and band; the later row is the one shown, and
  // the earlier one is not a second station.
  const mobile = spots.find((s) => s.their.call === 'K1ABC/M')!
  assert.equal(mobile.freq, 7235)
  assert.equal(mobile.band, '40m')
  assert.deepEqual(mobile.refs, [{ type: 'neqp', ref: 'MAMID', location: 'MAMID' }])
  assert.equal(mobile.spot.timeInMillis, Date.UTC(2026, 4, 2, 21, 40, 11))
  assert.equal(mobile.spot.label, 'NEQP: MAMID')

  // Markup inside a cell is not part of the comment.
  const fixed = spots.find((s) => s.their.call === 'N1DEF')!
  assert.equal(fixed.spot.sourceInfo?.comments, 'fixed station')
  assert.equal(fixed.spot.label, 'NEQP: NHHIL • fixed station')
  assert.equal(fixed.spot.sourceInfo?.source, 'QP Hub')

  // The page is shared: a Delaware county files its row under Delaware, so
  // the spot's ref is one a Delaware operation's exchange field reads.
  const delaware = spots.find((s) => s.their.call === 'W3JKL')!
  assert.deepEqual(delaware.refs, [{ type: 'deqp', ref: 'KDE', location: 'KDE' }])
  assert.equal(delaware.spot.label, 'DEQP: KDE')
})

test("a county code on a shared page is filed by its state, and an unknown one under the page's first party", () => {
  const sharing = [NEQP, DELAWARE]
  assert.equal(partyForCounty('MAWOR', sharing), NEQP)
  assert.equal(partyForCounty('SDE', sharing), DELAWARE)
  assert.equal(partyForCounty('XX', sharing), NEQP)
  // Alone on its page, a party gets every row.
  assert.equal(partyForCounty('SDE', [NEQP]), NEQP)
})

test("a page with no table, or an empty one, is no spots rather than an error", () => {
  assert.deepEqual(parseHubTable('<html><body>Not Found</body></html>', [NEQP]), [])
  assert.deepEqual(parseHubTable('<table id=spots><tr><th>TIME</th></tr></table>', [NEQP]), [])
})

test("the hub's pages are the party's, and shared where the sponsors share one", () => {
  assert.equal(hubTableUrl(NEQP), 'http://qsopartyhub.com/in7qpne_de-table.php')
  assert.equal(hubSpotUrl(NEBRASKA), 'http://qsopartyhub.com/neqp-spots.php')
})

test("a self-spot is the hub's own form, county line and Ham2K tag in the comment", () => {
  const body = hubSpotBody({ call: 'KI2D/OP1', freq: 14250, counties: ['MAWOR', 'MAMID'], comment: 'QRV', poster: 'KI2D' })
  const fields = Object.fromEntries(new URLSearchParams(body))
  assert.deepEqual(fields, {
    station: 'KI2D/OP1',
    frequency: '14.250',
    county: 'MAWOR',
    comment: 'MAWOR/MAMID QRV [via Ham2K]',
    poster: 'KI2D',
  })
  // A single county goes in its field alone; the comment does not repeat it.
  const single = Object.fromEntries(new URLSearchParams(hubSpotBody({ call: 'KI2D', freq: 7235, counties: ['MAWOR'] })))
  assert.equal(single.comment, '[via Ham2K]')
  assert.equal(single.poster, '')
})

// -------------------------------------------------------------- the tracker

const TRACKER_FEED = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-71.8, 42.3] },
      properties: { call: 'k1abc-9', frequencies: ['14.250', '7.235'], text: 'NEWE 14.250 heading north', countyCode: 'MAWOR', county: 'Worcester', grid: 'FN42' },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-72.5, 43.1] },
      properties: { call: 'N1DEF', frequency: '3.845', text: 'NEWE', countyCode: 'NHHIL' },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-72.5, 43.1] },
      properties: { call: 'N1DEF', text: 'NEWE', countyCode: 'NHHIL' },
    },
    {
      type: 'Feature',
      properties: { call: 'W1GHI', text: 'NEWE', countyCode: '' },
    },
  ],
})

test("the tracker's stations become spots in the county their beacon placed them", () => {
  const now = Date.UTC(2026, 4, 2, 22)
  const spots = parseTrackerFeed(TRACKER_FEED, NEQP, now)
  assert.deepEqual(spots.map((s) => s.their.call), ['K1ABC-9', 'N1DEF', 'W1GHI'])

  // Today's feed lists frequencies; the first is the station's. The party
  // token and the frequency are the tracker's to parse, and are not comment.
  const mobile = spots[0]
  assert.equal(mobile.freq, 14250)
  assert.equal(mobile.band, '20m')
  assert.deepEqual(mobile.refs, [{ type: 'neqp', ref: 'MAWOR', location: 'MAWOR' }])
  assert.equal(mobile.spot.label, 'NEQP: MAWOR • heading north')
  assert.equal(mobile.spot.timeInMillis, now)
  assert.equal(mobile.spot.sourceInfo?.source, 'Mobile Tracker')

  // The singular `frequency` app-polo was written against still reads, a
  // station repeated in the feed is one spot, and a station the tracker has
  // not placed in a county is a spot with no reference — not no spot.
  assert.equal(spots[1].freq, 3845)
  assert.equal(spots[1].spot.label, 'NEQP: NHHIL')
  assert.deepEqual(spots[2].refs, [])
  assert.equal(spots[2].freq, undefined)
})

test("the tracker's path is the party's code, and the Canadian parties have none", () => {
  assert.equal(trackerUrl(NEQP), 'https://mobiletracker.stateqso.com/NEWE/stations.geojson')
  assert.equal(trackerUrl(NEBRASKA), 'https://mobiletracker.stateqso.com/NE/stations.geojson')
  assert.equal(trackerUrl(ONTARIO), undefined)
})

// ------------------------------------------------------------- the parties

const ALL = [NEQP, NEBRASKA, DELAWARE, ONTARIO]

test("only the parties around now are read", () => {
  const during = Date.UTC(2026, 4, 2, 22)
  assert.deepEqual(activeParties(during, ALL).map((p) => p.refType), ['neqp', 'deqp'])
  // Setting up on the morning of: the feeds are already worth reading.
  assert.deepEqual(activeParties(NEQP.periods[0].startMillis - OPENS_BEFORE_MILLIS + 1, [NEQP, NEBRASKA, ONTARIO]).map((p) => p.refType), ['neqp'])
  // A weekday in June is nobody's.
  assert.deepEqual(activeParties(Date.UTC(2026, 5, 10, 12), ALL), [])
})
