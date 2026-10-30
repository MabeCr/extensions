// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The extension through its HOOKS, against a stand-in host whose `fetch`
// records the request. The packet's pieces are proved in `aprs.test.ts`;
// this is what the Spotting control gets: when the APRS icon is offered,
// and what one press puts on the gateway.

import { test } from "node:test"
import assert from "node:assert/strict"

import { fixtureOperation, loadExtension } from "./sdkGapTesting.ts"
import { base64 } from "./aprs.ts"

const requests: { url: string; method?: string; headers?: Record<string, string>; body?: string }[] = []
let gatewayStatus = 200

const ext = await loadExtension(() => import("./index.ts"), {
  hostCalls: {
    fetch: (params) => {
      requests.push(params as (typeof requests)[number])
      return { status: gatewayStatus, body: '' }
    },
    getVersionInfo: () => ({ platform: 'macos', edition: 'dev', version: '26.9.1', versionName: 'test', buildNumber: null }),
  },
})

const enabled = async (operation: Record<string, unknown>) =>
  ((await ext.runHook('spots', 'isSelfSpotEnabled', { operation: fixtureOperation(operation as any) })) as any).enabled

test("it reads no spots — APRS has positions, not a spot list", async () => {
  assert.deepEqual(await ext.runHook('spots', 'fetchSpots', {}, { ctx: { online: true } }), [])
  assert.equal(requests.length, 0)
})

test("the APRS icon is offered wherever the operation has a position and a call", async () => {
  assert.equal(await enabled({ grid: 'FN42' }), true)
  assert.equal(await enabled({ lat: 42.3, lon: -71.8 }), true)
  assert.equal(await enabled({}), false)
  assert.equal(await enabled({ grid: 'FN42', stationCall: '' }), false)
})

test("a self-spot during a QSO party beacons what app-polo does: the party token, the frequency, the counties", async () => {
  requests.length = 0
  const operation = fixtureOperation({
    stationCall: 'KI2D/OP1',
    lat: 42.3,
    lon: -71.8,
    refs: [{ type: 'neqp', location: 'MAWOR/MID' }],
  })
  const result = await ext.runHook('spots', 'postSelfSpot', { operation, freq: 14250 })
  assert.deepEqual(result, { ok: true })
  assert.equal(requests.length, 1)
  const [request] = requests
  assert.equal(request.url, 'https://ametx.com:8888')
  assert.equal(request.method, 'POST')
  assert.equal(request.body, 'KI2D-1>APRS,TCPIP*:!4218.00N/07148.00W>NEWE 14.250 MAWOR/MAMID')
  assert.equal(request.headers?.Authorization, `APRS-IS ${base64('user KI2D-1 pass 2799 vers Ham2K-HaLo 26.9.1')}`)
  assert.equal(request.headers?.['Content-Type'], 'application/octet-stream')
})

test("outside a party the beacon names the operation's references and the operator's comment, from the grid", async () => {
  requests.length = 0
  const operation = fixtureOperation({ grid: 'FN42', refs: [{ type: 'potaActivation', ref: 'US-1234' }, { type: 'wwffActivation', ref: 'KFF-0001' }] })
  await ext.runHook('spots', 'postSelfSpot', { operation, freq: 7235, comment: 'QRV until 1600' })
  assert.equal(requests[0].body, 'KI2D>APRS,TCPIP*:!4230.00N/07100.00W>7.235 US-1234/KFF-0001 QRV until 1600')
})

test("a gateway that takes the beacon with nothing to say back (204) is a sent spot, not a refusal", async () => {
  gatewayStatus = 204
  try {
    const result = await ext.runHook('spots', 'postSelfSpot', { operation: fixtureOperation({ grid: 'FN42' }), freq: 7235 })
    assert.deepEqual(result, { ok: true })
  } finally {
    gatewayStatus = 200
  }
})

test("a station with no position is refused before anything is sent, and a gateway error is a failed spot", async () => {
  requests.length = 0
  const refused = (await ext.runHook('spots', 'postSelfSpot', { operation: fixtureOperation(), freq: 7235 })) as any
  assert.equal(refused.ok, false)
  assert.match(refused.message, /grid or location/)
  assert.equal(requests.length, 0)

  gatewayStatus = 500
  try {
    const failed = (await ext.runHook('spots', 'postSelfSpot', { operation: fixtureOperation({ grid: 'FN42' }), freq: 7235 })) as any
    assert.equal(failed.ok, false)
    assert.match(failed.message, /HTTP 500/)
  } finally {
    gatewayStatus = 200
  }
})
