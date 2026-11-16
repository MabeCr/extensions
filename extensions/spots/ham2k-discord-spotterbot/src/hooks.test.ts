// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The extension through its HOOKS, against a stand-in host whose `fetch`
// answers as spotterbot.ham2k.net does: when the icon is offered, what one press
// sends, how Spotterbot's per-server answer colours the icon, and which servers
// the settings panel lets the operator switch off.

import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"

import { fixtureOperation, loadExtension } from "./sdkGapTesting.ts"
import type { ServerResult } from "./spotterbot.ts"

const TOKEN = 'spotterbot-token'
const signedIn = { ctx: { online: true, account: { credentials: { accessToken: TOKEN } } } }
/// The settings panel caches the server list per token, so each panel test
/// signs in with a token of its own.
let tokens = 0
const freshSignIn = () => ({ ctx: { online: true, account: { credentials: { accessToken: `panel-token-${++tokens}` } } } })

let settings: Record<string, unknown> = {}
const requests: { url: string; method?: string; headers?: Record<string, string>; body?: string }[] = []
let answer: { status: number; body: unknown } = { status: 200, body: {} }
/// Answers by request instead of [answer], for a test that makes more than one.
let route: ((request: (typeof requests)[number]) => { status: number; body: unknown }) | undefined

const ext = await loadExtension(() => import("./index.ts"), {
  hostCalls: {
    getSettings: () => ({ extensions: { 'extension_ham2k-discord-spotterbot': settings } }),
    setSettings: (params) => {
      settings = { ...settings, ...(params.values as Record<string, unknown>) }
      return null
    },
    fetch: (params) => {
      const request = params as (typeof requests)[number]
      requests.push(request)
      const { status, body } = route?.(request) ?? answer
      return { status, body: JSON.stringify(body) }
    },
  },
})

beforeEach(() => {
  settings = {}
  requests.length = 0
  answer = { status: 200, body: {} }
  route = undefined
})

const operation = fixtureOperation({
  stationCall: 'KI2D',
  refs: [{ type: 'potaActivation', ref: 'US-1234', shortLabel: 'POTA US-1234' }, { type: 'sotaActivation', ref: 'W2/GC-001' }],
})
const selfSpot = (args: Record<string, unknown> = {}, options = signedIn) =>
  ext.runHook('spots', 'postSelfSpot', { operation, freq: 14285, mode: 'SSB', comment: 'QRV', ...args }, options) as Promise<
    Record<string, unknown>
  >
const respond = (results: ServerResult[]) => {
  answer = { status: 200, body: { results } }
}

test("the icon is offered only once the operator has signed in with Discord, and only with a call to spot", async () => {
  const offered = async (options = {}, op = operation) => ((await ext.runHook('spots', 'isSelfSpotEnabled', { operation: op }, options)) as { enabled: boolean }).enabled
  assert.equal(await offered(), false)
  assert.equal(await offered(signedIn), true)
  assert.equal(await offered(signedIn, { ...operation, stationCall: '' }), false)
})

test("one press sends Spotterbot the spot, the operator's token, and the servers switched off", async () => {
  settings = { excluded: ['22'] }
  respond([{ id: '11', name: 'Club', status: 'sent' }])
  assert.deepEqual(await selfSpot(), { ok: true })

  assert.equal(requests.length, 1)
  const [request] = requests
  assert.equal(request.url, 'https://spotterbot.ham2k.net/spots')
  assert.equal(request.method, 'POST')
  assert.equal(request.headers?.Authorization, `Bearer ${TOKEN}`)
  assert.deepEqual(JSON.parse(request.body ?? '{}'), {
    // An unknown ref still names itself, as the SDK's refLabels filter does.
    spot: { call: 'KI2D', freq: 14285, mode: 'SSB', comment: 'QRV', refs: ['POTA US-1234', 'W2/GC-001'], app: 'Ham2K Logger' },
    exclude: ['22'],
  })
})

test("an operation with several calls spots its first", async () => {
  respond([{ id: '11', name: 'Club', status: 'sent' }])
  await ext.runHook('spots', 'postSelfSpot', { operation: { ...operation, stationCall: 'KI2D, N0DEV' }, freq: 7030 }, signedIn)
  assert.equal(JSON.parse(requests[0].body ?? '{}').spot.call, 'KI2D')
})

// The app appends this device's seat to a multi-station operation's call;
// nobody can work KI2D/OP1.
test("a multi-station seat spots the station's call, not the seat", async () => {
  respond([{ id: '11', name: 'Club', status: 'sent' }])
  const seat = { ...operation, stationCall: 'KI2D/OP1', local: { multiIdentifier: 1 } }
  await ext.runHook('spots', 'postSelfSpot', { operation: seat, freq: 7030 }, signedIn)
  assert.equal(JSON.parse(requests[0].body ?? '{}').spot.call, 'KI2D')
})

// A Test Operation spots like any other, under the call it carries: the /T
// is what tells a server's channel the station isn't really on the air.
test("a Test Operation's spot is posted, its /T call intact", async () => {
  respond([{ id: '11', name: 'Club', status: 'sent' }])
  const result = await ext.runHook('spots', 'postSelfSpot', { operation: { ...operation, stationCall: 'KI2D/T' }, freq: 7030, comment: 'QRV' }, signedIn)
  assert.deepEqual(result, { ok: true })
  assert.equal(JSON.parse(requests[0].body ?? '{}').spot.call, 'KI2D/T')
})

test("posts nothing, and says why, when the operator hasn't signed in", async () => {
  const result = await selfSpot({}, { ctx: {} } as typeof signedIn)
  assert.equal(result.ok, false)
  assert.match(String(result.message), /Sign in to Discord/)
  assert.equal(requests.length, 0)
})

// The app retries a failed spot; naming each server that failed tells the
// operator whom to ask, since the fix is a server admin's, not theirs.
test("a server that failed fails the spot, naming the server and why", async () => {
  respond([
    { id: '11', name: 'Club', status: 'sent' },
    { id: '22', name: 'Friends', status: 'failed', error: "Spotterbot isn't allowed to post in the server's spots channel" },
  ])
  assert.deepEqual(await selfSpot(), { ok: false, message: "Friends: Spotterbot isn't allowed to post in the server's spots channel" })
})

test("a spot every server skipped leaves the icon gray rather than lit or failed", async () => {
  respond([{ id: '11', name: 'Club', status: 'skipped' }])
  const result = await selfSpot({ comment: 'CQ POTA' })
  assert.equal(result.ok, true)
  assert.equal(result.skipped, true)
})

// HaLo starts auto-respotting only on a spot no source failed: an operator
// signed in before any server allowed them would lose POTA's respots too.
test("a spot no server takes yet is skipped, not failed", async () => {
  respond([])
  const result = await selfSpot()
  assert.deepEqual(result, { ok: true, skipped: true, message: "None of your Discord servers take spots from you yet. Ask a server's admins to add Spotterbot and give you a role that may post" })
})

test("a spot with every server switched off is skipped, not failed", async () => {
  answer = { status: 200, body: { results: [], switchedOff: 2 } }
  assert.deepEqual(await selfSpot(), { ok: true, skipped: true, message: 'Every Discord server you can post in is switched off' })
})

// Servers Discord didn't answer for may be the operator's, not yet posted
// to: only a failure makes the app try again.
test("servers whose roles Discord didn't give fail the spot, so it is retried", async () => {
  answer = { status: 200, body: { results: [{ id: '11', name: 'Club', status: 'sent' }], unchecked: 2 } }
  const result = await selfSpot()
  assert.equal(result.ok, false)
  assert.match(String(result.message), /2 server/)
})

test("Spotterbot's reason for refusing a spot reaches the operator", async () => {
  answer = { status: 400, body: { error: 'call is missing or not a callsign' } }
  assert.match(String((await selfSpot()).message), /call is missing or not a callsign/)
})

test("an answer without results is a failure, not a crash", async () => {
  answer = { status: 200, body: {} }
  assert.equal((await selfSpot()).ok, false)
})

test("a token Spotterbot no longer accepts asks the operator to sign in again", async () => {
  answer = { status: 401, body: { error: 'Not signed in' } }
  assert.match(String((await selfSpot()).message), /Sign in to Discord again/)
})

test("signs in against Spotterbot as issuer, with each edition's own redirect", async () => {
  const account = ext.hooks.find((h) => h.category === 'account')!.hook as { oauth2: (a: unknown, c: unknown) => Record<string, unknown> }
  assert.deepEqual(account.oauth2({}, { edition: 'next' }), {
    issuer: 'https://spotterbot.ham2k.net',
    clientId: 'halo',
    redirectUrl: 'com.ham2k.logger.next.auth://spotterbot',
    webhookRedirectUrl: 'https://lofi.ham2k.net/v1/webhooks/client/oauth',
    scopes: ['spots'],
  })
  assert.equal(account.oauth2({}, {}).redirectUrl, 'com.ham2k.logger.dev.auth://spotterbot')
})

test("Test names the Discord user the token belongs to", async () => {
  answer = { status: 200, body: { id: '7', username: 'ki2d', globalName: 'Sebastián' } }
  const result = await ext.runHook('account', 'testCredentials', { accessToken: 'fresh-token' }, { ctx: {} })
  assert.match(String(result), /Sebastián/)
  assert.equal(requests[0].headers?.Authorization, 'Bearer fresh-token')
})

type Element = { type: string; key?: string; label?: string; value?: unknown; text?: string }
const panel = async (options: { ctx: Record<string, unknown> } = freshSignIn()) =>
  ((await ext.runHook('settingsPanel', 'getDefinition', { panelKey: 'ham2k-discord-spotterbot' }, options)) as { elements: Element[] }).elements

test("settings show each server's switch as Spotterbot stores it", async () => {
  answer = {
    status: 200,
    body: {
      servers: [
        { id: '11', name: 'Club', on: true },
        { id: '22', name: 'Friends', on: false },
      ],
    },
  }
  const servers = (await panel()).filter((e) => e.key?.startsWith('server:'))
  assert.deepEqual(
    servers.map((e) => [e.key, e.label, e.value]),
    [
      ['server:11', 'Club', true],
      ['server:22', 'Friends', false],
    ],
  )
})

// Spotterbot holds the switch so its website, and every other install of the
// app, see the same one.
test("switching a server off tells Spotterbot, and keeps nothing here", async () => {
  await ext.runHook('settingsPanel', 'onChangeField', { fieldKey: 'server:11', value: false }, signedIn)
  assert.equal(requests[0].url, 'https://spotterbot.ham2k.net/servers/11')
  assert.equal(requests[0].method, 'PUT')
  assert.equal(requests[0].headers?.Authorization, `Bearer ${TOKEN}`)
  assert.deepEqual(JSON.parse(requests[0].body ?? '{}'), { on: false })
  assert.deepEqual(settings.excluded, [])
})

// Offline, or Spotterbot down: the switch must still hold for the next spot.
test("a switch Spotterbot doesn't take is kept here, and every spot sends it", async () => {
  answer = { status: 503, body: {} }
  await ext.runHook('settingsPanel', 'onChangeField', { fieldKey: 'server:11', value: false }, signedIn)
  assert.deepEqual(settings.excluded, ['11'])

  requests.length = 0
  respond([])
  await selfSpot()
  assert.deepEqual(JSON.parse(requests[0].body ?? '{}').exclude, ['11'])
})

// An operator coming from 0.1.0 kept every switch here; opening the panel
// hands them to Spotterbot, so the website shows them too.
test("switches kept here move to Spotterbot when the panel opens", async () => {
  settings = { excluded: ['22', '33'] }
  route = (request) => {
    if (request.method === 'PUT') return request.url.endsWith('/33') ? { status: 503, body: {} } : { status: 200, body: {} }
    return { status: 200, body: { servers: [{ id: '22', name: 'Friends', on: false }] } }
  }
  await panel()
  assert.deepEqual(
    requests.filter((r) => r.method === 'PUT').map((r) => [r.url, JSON.parse(r.body ?? '{}')]),
    [
      ['https://spotterbot.ham2k.net/servers/22', { on: false }],
      ['https://spotterbot.ham2k.net/servers/33', { on: false }],
    ],
  )
  // The one Spotterbot didn't take stays, to be sent with spots and tried again.
  assert.deepEqual(settings.excluded, ['33'])
})

// The app rebuilds this panel after every settings change, for settings
// search, and to list the Spotting section: each fetch would cost Spotterbot a
// Discord lookup per server.
test("rebuilding the panel within a minute asks Spotterbot once", async () => {
  answer = { status: 200, body: { servers: [{ id: '11', name: 'Club' }] } }
  const options = freshSignIn()
  await panel(options)
  await panel(options)
  assert.equal(requests.length, 1)
})

test("offline, the panel asks nothing and says why", async () => {
  const elements = await panel({ ctx: { online: false, account: { credentials: { accessToken: 'offline-token' } } } })
  assert.equal(requests.length, 0)
  assert.ok(elements.some((e) => e.type === 'markdown' && /Connect to the internet/.test(e.text ?? '')))
})

// The app doesn't wait for one toggle's write before sending the next.
test("two servers switched off together while Spotterbot is down both stay off", async () => {
  answer = { status: 503, body: {} }
  await Promise.all([
    ext.runHook('settingsPanel', 'onChangeField', { fieldKey: 'server:11', value: false }, signedIn),
    ext.runHook('settingsPanel', 'onChangeField', { fieldKey: 'server:22', value: false }, signedIn),
  ])
  assert.deepEqual([...(settings.excluded as string[])].sort(), ['11', '22'])
})

test("settings ask the operator to sign in before listing servers", async () => {
  const elements = await panel({ ctx: { online: true } })
  assert.ok(elements.some((e) => e.type === 'field' && e.key === 'account'))
  assert.ok(elements.some((e) => e.type === 'markdown' && /Sign in with Discord/.test(e.text ?? '')))
  assert.equal(requests.length, 0)
})
