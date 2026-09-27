// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The extension through its HOOKS — what the app calls — against a stand-in
// host whose `fetch` records what was asked of it. The parsers are proved in
// `feeds.test.ts`; this is the wiring: which feeds are read on which weekend,
// and what a self-spot puts on the wire.

import { test, mock } from "node:test"
import assert from "node:assert/strict"

import { fixtureOperation, loadExtension } from "./sdkGapTesting.ts"

/// Every request the stand-in host was asked for, in order.
const requests: { url: string; method?: string; headers?: Record<string, string>; body?: string }[] = []

/// What each URL answers; anything unlisted is a 404 with no body.
const answers: Record<string, { status: number; body: string }> = {}

const ext = await loadExtension(() => import("./index.ts"), {
  hostCalls: {
    fetch: (params) => {
      const { url, method, headers, body } = params as typeof requests[number]
      requests.push({ url, method, headers, body })
      return answers[url] ?? { status: 404, body: '' }
    },
    getSettings: () => ({ operatorCall: 'N0DEV' }),
  },
})

// The New England weekend: 7QP, Indiana, Delaware and New England all run,
// and all four share one hub page.
const NEQP_SATURDAY = Date.UTC(2026, 4, 2, 21)

const HUB_ROW = (call: string, freq: string, county: string) =>
  `<tr><td>2026-05-02 20:15:03</td><td>${call}</td><td>${freq}</td><td>${county}</td><td></td><td>${call}</td></tr>`
const HUB_PAGE = `<table id=spots><tr><th>T</th></tr>${HUB_ROW('K1ABC', '14.250', 'MAWOR')}${HUB_ROW('W7DEF', '7.235', 'ORDES')}${HUB_ROW('W3JKL', '7.040', 'KDE')}</table>`
const TRACKER = (call: string, county: string) =>
  JSON.stringify({ features: [{ properties: { call, frequencies: ['3.845'], text: 'x', countyCode: county } }] })

test("offline, nothing is fetched", async () => {
  requests.length = 0
  assert.deepEqual(await ext.runHook('spots', 'fetchSpots', {}, { ctx: { online: false } }), [])
  assert.equal(requests.length, 0)
})

test("on a party weekend every running party's feeds are read, a shared hub page once", async () => {
  const now = mock.method(Date, 'now', () => NEQP_SATURDAY)
  try {
    requests.length = 0
    answers['http://qsopartyhub.com/in7qpne_de-table.php'] = { status: 200, body: HUB_PAGE }
    answers['https://mobiletracker.stateqso.com/NEWE/stations.geojson'] = { status: 200, body: TRACKER('N1GHI-9', 'NHHIL') }
    answers['https://mobiletracker.stateqso.com/7QP/stations.geojson'] = { status: 200, body: TRACKER('W7JKL-9', 'ORDES') }

    const spots = (await ext.runHook('spots', 'fetchSpots', {}, { ctx: { online: true } })) as any[]

    const urls = requests.map((r) => r.url).sort()
    assert.deepEqual(urls, [
      'http://qsopartyhub.com/in7qpne_de-table.php',
      'https://mobiletracker.stateqso.com/7QP/stations.geojson',
      'https://mobiletracker.stateqso.com/DE/stations.geojson',
      'https://mobiletracker.stateqso.com/IN/stations.geojson',
      'https://mobiletracker.stateqso.com/NEWE/stations.geojson',
    ])
    // The shared hub page's rows are filed under the party each county is
    // in, so a spot picked from it carries the ref the operation's own
    // exchange field reads.
    assert.deepEqual(spots.map((s) => s.their.call).sort(), ['K1ABC', 'N1GHI-9', 'W3JKL', 'W7DEF', 'W7JKL-9'])
    const refTypeOf = (call: string) => spots.find((s) => s.their.call === call).refs[0].type
    assert.equal(refTypeOf('K1ABC'), 'neqp')
    assert.equal(refTypeOf('W7DEF'), '7qp')
    assert.equal(refTypeOf('W3JKL'), 'de-qso-party')
    const tracked = spots.find((s) => s.their.call === 'N1GHI-9')
    assert.deepEqual(tracked.refs, [{ type: 'neqp', ref: 'NHHIL', location: 'NHHIL' }])
    assert.equal(tracked.spot.timeInMillis, NEQP_SATURDAY)
    // Two of the four tracker feeds answered 404 (the stand-in's default),
    // and that cost nothing: the feeds that answered are what came back.
  } finally {
    now.mock.restore()
  }
})

test("a weekday in June reads nothing at all", async () => {
  const now = mock.method(Date, 'now', () => Date.UTC(2026, 5, 10, 12))
  try {
    requests.length = 0
    assert.deepEqual(await ext.runHook('spots', 'fetchSpots', {}, { ctx: { online: true } }), [])
    assert.equal(requests.length, 0)
  } finally {
    now.mock.restore()
  }
})

test("every feed failing is an error; one feed failing is not", async () => {
  const now = mock.method(Date, 'now', () => NEQP_SATURDAY)
  try {
    for (const url of Object.keys(answers)) delete answers[url]
    // A hub page that is not there is a party with no hub (404 → no spots);
    // a hub that is down is an error, and with every tracker down too there
    // is nothing to soften it.
    answers['http://qsopartyhub.com/in7qpne_de-table.php'] = { status: 503, body: '' }
    await assert.rejects(ext.runHook('spots', 'fetchSpots', {}, { ctx: { online: true } }), /HTTP 503/)
    answers['https://mobiletracker.stateqso.com/NEWE/stations.geojson'] = { status: 200, body: TRACKER('N1GHI-9', 'NHHIL') }
    const spots = (await ext.runHook('spots', 'fetchSpots', {}, { ctx: { online: true } })) as any[]
    assert.equal(spots.length, 1)
  } finally {
    now.mock.restore()
  }
})

test("self-spotting is offered to an operation in a party, by either ref spelling", async () => {
  const enabled = async (refs: unknown[]) =>
    ((await ext.runHook('spots', 'isSelfSpotEnabled', { operation: fixtureOperation({ refs: refs as any }) })) as any).enabled
  assert.equal(await enabled([{ type: 'neqp', location: 'MAWOR' }]), true)
  assert.equal(await enabled([{ type: 'qp', ref: 'NEQP', location: 'MAWOR' }]), true)
  assert.equal(await enabled([{ type: 'pota', ref: 'US-0001' }]), false)
  assert.equal(await enabled([]), false)
})

test("a self-spot is posted to the party's hub page as its form", async () => {
  requests.length = 0
  answers['http://qsopartyhub.com/in7qpne_de-spots.php'] = { status: 200, body: 'ok' }
  const operation = fixtureOperation({
    stationCall: 'KI2D/OP1',
    refs: [{ type: 'neqp', location: 'MAWOR/MID' }],
    operatorCall: 'KI2D',
  })
  const result = (await ext.runHook('spots', 'postSelfSpot', { operation, freq: 14250, comment: 'QRV' })) as any
  assert.deepEqual(result, { ok: true })
  assert.equal(requests.length, 1)
  assert.equal(requests[0].method, 'POST')
  assert.equal(requests[0].url, 'http://qsopartyhub.com/in7qpne_de-spots.php')
  assert.deepEqual(Object.fromEntries(new URLSearchParams(requests[0].body)), {
    station: 'KI2D/OP1',
    frequency: '14.250',
    county: 'MAWOR',
    comment: 'MAWOR/MAMID QRV [via Ham2K]',
    poster: 'KI2D',
  })
})

test("a self-spot with no county is refused before anything is sent", async () => {
  requests.length = 0
  const operation = fixtureOperation({ refs: [{ type: 'txqp' }] })
  const result = (await ext.runHook('spots', 'postSelfSpot', { operation, freq: 14250 })) as any
  assert.equal(result.ok, false)
  assert.match(result.message, /county.*TXQP/)
  assert.equal(requests.length, 0)
})

test("the poster falls back to the profile's call when the operation names no operator", async () => {
  requests.length = 0
  answers['http://qsopartyhub.com/txqp-spots.php'] = { status: 500, body: '' }
  const operation = fixtureOperation({ refs: [{ type: 'txqp', location: 'TRAV' }] })
  const result = (await ext.runHook('spots', 'postSelfSpot', { operation, freq: 7235 })) as any
  assert.equal(Object.fromEntries(new URLSearchParams(requests[0].body)).poster, 'N0DEV')
  // And a hub that answers anything but 200 is a spot that did not land.
  assert.equal(result.ok, false)
  assert.match(result.message, /HTTP 500/)
})
