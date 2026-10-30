// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The extension through its HOOKS, against a stand-in host whose settings
// hold the webhooks and whose `fetch` records each request: when the Discord
// icon is offered, which channels one press reaches, and how the answer
// colours the icon.

import { mock, test } from "node:test"
import assert from "node:assert/strict"

import { fixtureOperation, loadExtension } from "./sdkGapTesting.ts"
import type { Webhook } from "./discord.ts"

const CLUB = 'https://discord.com/api/webhooks/111/club'
const FRIENDS = 'https://discord.com/api/webhooks/222/friends'

let webhooks: Webhook[] = []
let saved: Record<string, unknown> | undefined
const requests: { url: string; method?: string; headers?: Record<string, string>; body?: string }[] = []
const statusFor: Record<string, number> = {}

const ext = await loadExtension(() => import("./index.ts"), {
  hostCalls: {
    getSettings: () => ({ extensions: { 'extension_ki2d-discord-spotting': { webhooks } } }),
    setSettings: (params) => {
      saved = params.values as Record<string, unknown>
      return null
    },
    fetch: (params) => {
      const request = params as (typeof requests)[number]
      requests.push(request)
      return { status: statusFor[request.url] ?? 204, body: '' }
    },
  },
})

// A channel asked again for a message it took moments ago does not post it
// twice; each test starts well past that window.
mock.timers.enable({ apis: ['Date'], now: 0 })

function reset(next: Webhook[]) {
  mock.timers.tick(60 * 60 * 1000)
  webhooks = next
  requests.length = 0
  for (const url of Object.keys(statusFor)) delete statusFor[url]
}

const operation = fixtureOperation({ refs: [{ type: 'potaActivation', ref: 'US-1234' }] })
const selfSpot = (args: Record<string, unknown> = {}) =>
  ext.runHook('spots', 'postSelfSpot', { operation, freq: 14285, mode: 'SSB', ...args }) as Promise<Record<string, unknown>>
const offered = async () => ((await ext.runHook('spots', 'isSelfSpotEnabled', { operation })) as { enabled: boolean }).enabled

test("it reads no spots — a webhook only takes messages", async () => {
  assert.deepEqual(await ext.runHook('spots', 'fetchSpots', {}), [])
})

test("the Discord icon is offered only while some channel is switched on and has a URL", async () => {
  reset([])
  assert.equal(await offered(), false)
  reset([{ name: 'Club', url: CLUB, enabled: false }, { name: 'Draft' }])
  assert.equal(await offered(), false)
  reset([{ name: 'Club', url: CLUB, enabled: false }, { name: 'Friends', url: FRIENDS }])
  assert.equal(await offered(), true)
})

test("one press posts each switched-on channel its own message, and none to a switched-off one", async () => {
  reset([
    { name: 'Club', url: CLUB, template: 'Club: {{ op.station }} {{ spot.freq }}' },
    { name: 'Off', url: 'https://discord.com/api/webhooks/333/off', enabled: false },
    { name: 'Friends', url: FRIENDS, template: '{{ op.station }} — {{ spot.comments }}' },
  ])
  assert.deepEqual(await selfSpot({ comment: 'new antenna' }), { ok: true })
  assert.deepEqual(
    requests.map((request) => [request.url, request.method, JSON.parse(request.body ?? '{}').content]),
    [
      [CLUB, 'POST', 'Club: KI2D 14285'],
      [FRIENDS, 'POST', 'KI2D — new antenna'],
    ],
  )
  assert.equal(requests[0].headers?.['Content-Type'], 'application/json')
})

test("a channel whose message renders blank is skipped, and the others still get theirs", async () => {
  reset([
    { name: 'CW only', url: CLUB, template: "{% if spot.mode == 'CW' %}{{ op.station }}{% endif %}" },
    { name: 'Friends', url: FRIENDS, template: '{{ op.station }}' },
  ])
  assert.deepEqual(await selfSpot(), { ok: true })
  assert.deepEqual(requests.map((request) => request.url), [FRIENDS])
})

// The Spotting control reads `skipped` to leave the icon gray: lit would say
// a spot went out when nothing did, red would call the operator's own rule a
// failure.
test("when every channel's message renders blank, nothing is sent and the answer is a skip, not a success or a failure", async () => {
  reset([
    { name: 'CW only', url: CLUB, template: "{% if spot.mode == 'CW' %}{{ op.station }}{% endif %}" },
    { name: 'Silent', url: FRIENDS, template: '   ' },
  ])
  const result = await selfSpot()
  assert.equal(result.ok, true)
  assert.equal(result.skipped, true)
  assert.equal(requests.length, 0)
})

test("a failing channel fails the spot by name, even when another channel took it", async () => {
  reset([
    { name: 'Club', url: CLUB },
    { name: 'Friends', url: FRIENDS },
  ])
  statusFor[FRIENDS] = 404
  const result = await selfSpot({ comment: 'QRV' })
  assert.equal(result.ok, false)
  assert.match(String(result.message), /^Friends: .*HTTP 404$/)
  assert.equal(requests.length, 2, 'the club still got its message')
})

// The app asks a source that failed a spot again shortly. Posted again, the
// channels that took it the first time would show it twice.
test("asked again for a spot one channel refused, only that channel posts it", async () => {
  reset([
    { name: 'Club', url: CLUB },
    { name: 'Friends', url: FRIENDS },
  ])
  statusFor[FRIENDS] = 429
  assert.equal((await selfSpot({ comment: 'QRV' })).ok, false)

  delete statusFor[FRIENDS]
  requests.length = 0
  mock.timers.tick(30 * 1000)
  assert.deepEqual(await selfSpot({ comment: 'QRV' }), { ok: true })
  assert.deepEqual(requests.map((request) => request.url), [FRIENDS])
})

test("a channel posts a different message at once, and the same one again once the moment has passed", async () => {
  reset([{ name: 'Club', url: CLUB }])
  await selfSpot({ comment: 'QRV' })
  await selfSpot({ comment: 'QRV' })
  await selfSpot({ comment: 'QRT' })
  assert.equal(requests.length, 2, 'the repeat was held back, the new message was not')

  // Five minutes: the shortest auto-respot interval, every one of which
  // reaches every channel.
  mock.timers.tick(5 * 60 * 1000)
  await selfSpot({ comment: 'QRT' })
  assert.equal(requests.length, 3)
})

test("a broken template or a URL that is not a webhook fails that channel without posting to it", async () => {
  reset([
    { name: 'Typo', url: CLUB, template: '{% if op.station %}unclosed' },
    { url: 'https://example.com/hook' },
  ])
  const result = await selfSpot()
  assert.equal(result.ok, false)
  assert.match(String(result.message), /Typo: The “Message” template has an error/)
  assert.match(String(result.message), /Channel 2: .*not a Discord webhook/)
  assert.equal(requests.length, 0)
})

test("a channel posts under the name and avatar its own templates render, and under the webhook's when they render blank", async () => {
  reset([
    { name: 'Club', url: CLUB, template: '{{ spot.comments }}', username: '{{ op.station }} via HaLo', avatarUrl: 'https://example.com/{{ op.station }}.png' },
    { name: 'Friends', url: FRIENDS, template: '{{ spot.comments }}', username: "{% if spot.qcode %}{{ op.station }}{% endif %}" },
  ])
  await selfSpot({ comment: 'new antenna' })
  const [club, friends] = requests.map((request) => JSON.parse(request.body ?? '{}'))
  assert.equal(club.username, 'KI2D via HaLo')
  assert.equal(club.avatar_url, 'https://example.com/KI2D.png')
  assert.equal('username' in friends, false)
  assert.equal('avatar_url' in friends, false)
})

test("a broken name template fails that channel, naming the template — the message is not sent under the wrong name", async () => {
  reset([{ name: 'Club', url: CLUB, template: '{{ spot.comments }}', username: '{% if op.station %}unclosed' }])
  const result = await selfSpot({ comment: 'QRV' })
  assert.equal(result.ok, false)
  assert.match(String(result.message), /^Club: The “Posted as” template has an error/)
  assert.equal(requests.length, 0)
})

test("the settings panel asks to sit in the app's Spotting section, as one row beside the app's own spotting settings", async () => {
  const [panel] = (await ext.runHook('settingsPanel', 'getPanels', {})) as { key: string; section?: string }[]
  assert.equal(panel.key, 'ki2d-discord-spotting')
  assert.equal(panel.section, 'spotting')
})

test("the settings panel lists the saved channels, saves the list as edited, and refuses a URL that is not a webhook", async () => {
  reset([{ name: 'Club', url: CLUB }])
  const definition = (await ext.runHook('settingsPanel', 'getDefinition', { panelKey: 'ki2d-discord-spotting' })) as {
    elements: { key?: string }[]
  }
  const list = definition.elements.find((element) => element.key === 'webhooks') as { value?: unknown; itemSwitch?: string; itemFields?: { key: string }[] }
  assert.deepEqual(list.value, [{ name: 'Club', url: CLUB }])
  // The row's switch is what turns a channel on and off; a checkbox in the
  // editor as well would be a second control for one value.
  assert.equal(list.itemSwitch, 'enabled')
  assert.equal(list.itemFields?.some((field) => field.key === 'enabled'), false)

  const edited = [{ name: 'Club', url: CLUB, enabled: false }]
  await ext.runHook('settingsPanel', 'onChangeField', { panelKey: 'ki2d-discord-spotting', fieldKey: 'webhooks', value: edited, state: {} })
  assert.deepEqual(saved, { webhooks: edited })

  const validate = (fieldKey: string, value: string | undefined) =>
    ext.runHook('settingsPanel', 'validateField', { panelKey: 'ki2d-discord-spotting', fieldKey, value, state: {} })
  assert.match(String(await validate('webhooks[0].url', 'https://discord.com/channels/1/2')), /not a Discord webhook/)
  assert.equal(await validate('webhooks[0].url', CLUB), null)
  // A channel without one would never post, and say nothing about it.
  assert.match(String(await validate('webhooks[0].url', '  ')), /Enter the webhook URL/)
  assert.match(String(await validate('webhooks[1].url', undefined)), /Enter the webhook URL/, 'a new channel whose URL was never touched')
  assert.equal(await validate('webhooks[0].name', 'https://discord.com/channels/1/2'), null)
})
