// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The extension through its HOOKS, against a stand-in HamAlert whose answers
// each test sets and whose requests it records: what reaches the board, how
// often HamAlert is asked, what a refused login stops, and which worked
// station is muted.

import { mock, test } from "node:test"
import assert from "node:assert/strict"

import type { HookContext, JSONValue } from "@ham2k/extension-sdk"

import { loadExtension } from "./sdkGapTesting.ts"

type Request = { url: string; method?: string; headers?: Record<string, string>; body?: string }

const requests: Request[] = []
let answer: (request: Request) => { status: number; body: string } = () => ({ status: 200, body: '{"spots":[]}' })
let settings: Record<string, JSONValue> = {}
const kv = new Map<string, unknown>()

const ext = await loadExtension(() => import("./index.ts"), {
  hostCalls: {
    fetch: (params) => {
      const request = params as Request
      requests.push(request)
      return answer(request)
    },
    getSettings: () => ({ extensions: { 'extension_ki2d-hamalert': settings } }),
    kvGet: (params) => kv.get(String(params.key)) ?? null,
    kvSet: (params) => {
      kv.set(String(params.key), params.value)
      return null
    },
  },
})

const NOW = Date.UTC(2026, 9, 25, 14, 30)
mock.timers.enable({ apis: ['Date'], now: NOW })

/// Past the poll interval, so each test starts with a read of its own.
function nextTest() {
  mock.timers.tick(5 * 60 * 1000)
  requests.length = 0
  settings = {}
  kv.clear()
}

const alert = (overrides: Record<string, JSONValue> = {}) => ({
  _id: 'a1',
  fullCallsign: 'KI2D/P',
  callsign: 'KI2D',
  frequency: 14.0615,
  band: '20m',
  mode: 'cw',
  modeDetail: 'cw',
  source: 'pota',
  wwffRef: 'US-1234',
  wwffName: 'Bear Mountain State Park',
  wwffProgram: 'pota',
  receivedDate: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  triggerComment: ['Friends'],
  ...overrides,
})

function serving(spots: unknown[], status = 200) {
  answer = (request) => request.url.includes('/addMute')
    ? { status: 200, body: 'true' }
    : { status, body: JSON.stringify({ spots }) }
}

const account = (username = 'ki2d', password = 'secret') => ({
  online: true,
  account: { credentials: { username, password } },
}) as Partial<HookContext>

const fetchSpots = (ctx: Partial<HookContext>) =>
  ext.runHook('spots', 'fetchSpots', {}, { ctx }) as Promise<{ their: { call: string }; spot: { label?: string } }[]>

test("it registers the spots source, its bell, its account and its settings", () => {
  assert.deepEqual(ext.categories(), ['account', 'scoring', 'settingsPanel', 'spots'])
})

test("with no HamAlert account there is nothing to ask for", async () => {
  nextTest()
  assert.deepEqual(await fetchSpots({ online: true }), [])
  assert.deepEqual(await fetchSpots({ ...account(), online: false }), [])
  assert.equal(requests.length, 0)
})

test("the last hour's alerts are read as the operator, and become spots", async () => {
  nextTest()
  serving([alert(), alert({ _id: 'a2', fullCallsign: 'K1ABC', callsign: 'K1ABC', triggerComment: [] })])
  const spots = await fetchSpots(account('ki2d', 'pässword'))
  assert.deepEqual(spots.map((spot) => [spot.their.call, spot.spot.label]), [
    ['KI2D/P', 'Friends — Bear Mountain State Park'],
    ['K1ABC', 'Bear Mountain State Park'],
  ])
  assert.equal(requests[0].url, 'https://hamalert.org/api/spots2?limit=100&maxAge=3600')
  // Upper-cased as HamAlert stores it, and the password as UTF-8.
  assert.equal(requests[0].headers?.Authorization, `Basic ${Buffer.from('KI2D:pässword', 'utf8').toString('base64')}`)
})

test("HamAlert is asked at most once a minute, unless the login changes", async () => {
  nextTest()
  serving([alert()])
  await fetchSpots(account())
  mock.timers.tick(30 * 1000)
  assert.equal((await fetchSpots(account())).length, 1)
  assert.equal(requests.length, 1)
  await fetchSpots(account('k1abc'))
  assert.equal(requests.length, 2)
  mock.timers.tick(31 * 1000)
  await fetchSpots(account())
  assert.equal(requests.length, 3)
})

test("a refused login is said once and never sent again, until the account is checked", async () => {
  nextTest()
  serving([], 401)
  await assert.rejects(fetchSpots(account('n0call', 'wrong')), /did not accept/)
  mock.timers.tick(5 * 60 * 1000)
  assert.deepEqual(await fetchSpots(account('n0call', 'wrong')), [])
  assert.equal(requests.length, 1)

  serving([alert()])
  const checked = await ext.runHook('account', 'testCredentials', { username: 'n0call', password: 'wrong' }, { ctx: { online: true } })
  assert.match(String(checked), /Connected as \*\*N0CALL\*\*/)
  assert.equal((await fetchSpots(account('n0call', 'wrong'))).length, 1)
})

test("after too many failed logins, HamAlert is left alone for fifteen minutes", async () => {
  nextTest()
  serving([], 429)
  assert.deepEqual(await fetchSpots(account('w1aw')), [])
  mock.timers.tick(10 * 60 * 1000)
  await fetchSpots(account('w1aw'))
  assert.equal(requests.length, 1)
  mock.timers.tick(6 * 60 * 1000)
  serving([alert()])
  assert.equal((await fetchSpots(account('w1aw'))).length, 1)
})

test("checking the account says when no trigger sends alerts here", async () => {
  nextTest()
  answer = () => ({ status: 200, body: '{"spots":[],"hasAnyAppTrigger":false}' })
  const said = await ext.runHook('account', 'testCredentials', { username: 'ki2d', password: 'x' }, { ctx: { online: true } })
  assert.match(String(said), /none of your triggers has the \*\*App\*\* action/)
  answer = () => ({ status: 401, body: '' })
  assert.match(String(await ext.runHook('account', 'testCredentials', { username: 'ki2d', password: 'x' })), /did not accept/)
  assert.match(String(await ext.runHook('account', 'testCredentials', { username: '', password: '' })), /Enter your HamAlert/)
})

const candidate = (call: string, band: string) => ({ key: `${call}|${band}`, qso: { their: { call }, band, mode: 'CW' } })

const scoreCandidates = (candidates: ReturnType<typeof candidate>[]) =>
  ext.runHook('scoring', 'scoreCandidates', { operation: { uuid: 'op-1' }, candidates, qsos: [] }) as Promise<
    Record<string, { icon?: string; color?: string }>
  >

test("a spot of an alerted station on its band rings the bell, from any source", async () => {
  nextTest()
  serving([alert(), alert({ _id: 'a2', fullCallsign: 'K1ABC', callsign: 'K1ABC', band: '', frequency: 7.0315 })])
  await fetchSpots(account())
  const scores = await scoreCandidates([candidate('KI2D/P', '20m'), candidate('ki2d/p', '40m'), candidate('W1AW', '20m'), candidate('K1ABC', '40m')])
  assert.deepEqual(scores['KI2D/P|20m'], { notices: [], alerts: [], icon: 'bell-ring', color: '#C62828' })
  assert.equal(scores['ki2d/p|40m']?.icon, undefined)
  assert.equal(scores['W1AW|20m']?.icon, undefined)
  // Its band is the band plan's, as the spot's is.
  assert.equal(scores['K1ABC|40m']?.icon, 'bell-ring')
})

test("with the account gone, no spot rings the bell", async () => {
  nextTest()
  serving([alert()])
  await fetchSpots(account())
  await fetchSpots({ online: true })
  const scores = await scoreCandidates([candidate('KI2D/P', '20m')])
  assert.equal(scores['KI2D/P|20m']?.icon, undefined)
})

test("a logged contact's verdict carries no bell", async () => {
  nextTest()
  serving([alert()])
  await fetchSpots(account())
  const result = (await ext.runHook('scoring', 'scoreQsos', {
    operation: { uuid: 'op-1' },
    qsos: [{ uuid: 'q1', their: { call: 'KI2D/P' }, band: '20m', mode: 'CW', startAtMillis: Date.now() }],
  })) as { qsoScores: Record<string, unknown>; operationSummary: Record<string, unknown> }
  assert.deepEqual(result.qsoScores, { q1: { value: 0 } })
  assert.deepEqual(result.operationSummary, {})
})

/// A log holding [qsos] for every call asked about.
const logged = (qsos: Record<string, JSONValue>[]) => ({
  getHistoryForCall: async () => qsos,
}) as Partial<HookContext>

const mutes = () => requests.filter((request) => request.url.endsWith('/addMute'))

test("a station worked on the alert's band and mode is muted there, once", async () => {
  nextTest()
  serving([alert()])
  const ctx = { ...account(), ...logged([{ startAtMillis: Date.now() - 60 * 1000, band: '20m', mode: 'CW' }]) }
  await fetchSpots(ctx)
  assert.equal(mutes().length, 1)
  assert.equal(mutes()[0].method, 'POST')
  assert.equal(mutes()[0].body, 'callsign=KI2D&ttl=3600&band=20m&mode=cw')
  assert.equal(mutes()[0].headers?.['Content-Type'], 'application/x-www-form-urlencoded')

  // The alert is still in the last hour's, and asking again would only push
  // the mute's expiry out.
  mock.timers.tick(2 * 60 * 1000)
  await fetchSpots(ctx)
  assert.equal(requests.length, 3)
  assert.equal(mutes().length, 1)
})

test("a station worked on another band, or before the alert, is not muted", async () => {
  nextTest()
  serving([alert()])
  await fetchSpots({ ...account(), ...logged([{ startAtMillis: Date.now() - 60 * 1000, band: '40m', mode: 'CW' }]) })
  mock.timers.tick(2 * 60 * 1000)
  await fetchSpots({ ...account(), ...logged([{ startAtMillis: Date.now() - 3 * 60 * 60 * 1000, band: '20m', mode: 'CW' }]) })
  assert.equal(mutes().length, 0)
})

test("the operator's mute length is the one sent, and Never sends none", async () => {
  nextTest()
  serving([alert()])
  settings = { muteSeconds: 7200 }
  const ctx = { ...account(), ...logged([{ startAtMillis: Date.now(), band: '20m', mode: 'CW' }]) }
  await fetchSpots(ctx)
  assert.match(mutes()[0].body ?? '', /ttl=7200/)

  nextTest()
  serving([alert()])
  settings = { muteSeconds: 0 }
  await fetchSpots(ctx)
  assert.equal(mutes().length, 0)
})

test("a mute HamAlert refuses leaves the board as it was", async () => {
  nextTest()
  answer = (request) => request.url.includes('/addMute')
    ? { status: 500, body: '' }
    : { status: 200, body: JSON.stringify({ spots: [alert()] }) }
  const spots = await fetchSpots({ ...account(), ...logged([{ startAtMillis: Date.now(), band: '20m', mode: 'CW' }]) })
  assert.equal(spots.length, 1)
  assert.equal(kv.size, 0)
})
