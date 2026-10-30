// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// The message one channel gets for one spot, and what decides that it gets
// none. The hooks around it are proved in `hooks.test.ts`.

import { test } from "node:test"
import assert from "node:assert/strict"

import { DISCORD_MAX_CONTENT, DISCORD_MAX_USERNAME, discordPayload, isEnabled, isWebhookUrl, messageFor } from "./discord.ts"

const spot = {
  operation: { stationCall: 'KI2D', refs: [{ type: 'potaActivation', ref: 'US-1234' }] },
  freq: 14285,
  mode: 'SSB',
  comment: 'QRT at 1600',
}

test("the default message names the call, the comment, the operation's references, the frequency and the mode", () => {
  assert.match(messageFor({}, spot), /^KI2D QRT at 1600 • .*US-1234 • 14285 SSB$/)
  assert.match(messageFor({}, { ...spot, comment: 'qrv till 1600' }), /^KI2D qrv till 1600 • .*US-1234 • 14285 SSB$/)
})

test("the default message leaves out references the operation does not have, rather than an empty pair of bullets", () => {
  assert.equal(messageFor({}, { operation: { stationCall: 'KI2D', refs: [] }, freq: 7035, mode: 'CW', comment: 'QRV' }), 'KI2D QRV • 7035 CW')
})

// A channel taking every respot would be buried in them; the default posts
// only the announcements of going on and off the air.
test("by default only a QRV or a QRT spot reaches the channel — any other comment, or none, is skipped", () => {
  for (const comment of [undefined, '', 'new antenna', 'QSY 7.035', 'QRX 5', 'thanks QRT']) {
    assert.equal(messageFor({}, { ...spot, comment }), '', String(comment))
  }
})

test("a template that renders only whitespace is blank — that channel skips the spot", () => {
  const onlyPota = { template: "{% if op.refs != empty %}{{ op.station }} at {{ spot.freq }}{% endif %}\n  " }
  assert.equal(messageFor(onlyPota, { ...spot, operation: { stationCall: 'KI2D', refs: [] } }), '')
  assert.equal(messageFor(onlyPota, spot), 'KI2D at 14285')
})

// The names are app-polo's spot-discord ones, so a PoLo template's `spot`
// variables carry over. qrest keeping every word, and the Q-code being nil (not
// "") when absent, are where this deliberately differs from PoLo.
test("a PoLo template's spot values carry over: the comment, its Q-code and everything after it", () => {
  const qrt = { ...spot, comment: 'QRT thanks all, 73' }
  assert.equal(
    messageFor({ template: '{{ spot.qcode }}|{{ spot.qrest }}|{{ spot.comments }}|{{ spot.freq }} {{ spot.mode }}' }, qrt),
    'QRT|thanks all, 73|QRT thanks all, 73|14285 SSB',
  )
  assert.equal(messageFor({ template: '{{ spot.qcode }}|{{ spot.qrest }}' }, { ...spot, comment: 'qsy 7.035' }), 'QSY|7.035')
  assert.equal(messageFor({ template: '{{ spot.qCode }}|{{ spot.qRest }}' }, qrt), 'QRT|thanks all, 73', "PoLo's own names for them still work")

  const unlessQrt = { template: "{% if spot.qcode %}[{{ spot.qcode }}] {% endif %}{{ spot.qrest }}" }
  assert.equal(messageFor(unlessQrt, { ...spot, comment: 'new antenna' }), 'new antenna', 'no Q-code reads as false, not as ""')
  assert.equal(messageFor(unlessQrt, { ...spot, comment: 'QRV now' }), '[QRV] now')
  assert.equal(messageFor(unlessQrt, { ...spot, comment: 'QUESTION about park' }), 'QUESTION about park', 'only a three-letter Q word is a Q-code')
})

test("an empty template is the operator's own, not a missing one — it never falls back to the default", () => {
  assert.equal(messageFor({ template: '' }, spot), '')
})

test("a broken template throws instead of quietly sending nothing", () => {
  assert.throws(() => messageFor({ template: '{% if op.station %}unclosed' }, spot))
})

test("only Discord's own webhook URLs are taken", () => {
  assert.equal(isWebhookUrl('https://discord.com/api/webhooks/1234567890/abc-DEF_123'), true)
  assert.equal(isWebhookUrl('https://ptb.discord.com/api/v10/webhooks/1234567890/abc'), true)
  assert.equal(isWebhookUrl('https://discordapp.com/api/webhooks/1234567890/abc'), true)
  assert.equal(isWebhookUrl('  https://discord.com/api/webhooks/1234567890/abc  '), true)
  assert.equal(isWebhookUrl('http://discord.com/api/webhooks/1234567890/abc'), false)
  assert.equal(isWebhookUrl('https://discord.com.evil.example/api/webhooks/1/abc'), false)
  assert.equal(isWebhookUrl('https://discord.com/channels/1234567890/987'), false)
  // Not in the manifest's `domains`, so the host would refuse every post.
  assert.equal(isWebhookUrl('https://ptb.discordapp.com/api/webhooks/1234567890/abc'), false)
  assert.equal(isWebhookUrl('https://canary.discordapp.com/api/webhooks/1234567890/abc'), false)
  assert.equal(isWebhookUrl('https://canary.discord.com/api/webhooks/1234567890/abc'), true)
})

test("a channel is on unless switched off, and only once it has a URL", () => {
  assert.equal(isEnabled({ url: 'https://discord.com/api/webhooks/1/a' }), true)
  assert.equal(isEnabled({ url: 'https://discord.com/api/webhooks/1/a', enabled: false }), false)
  assert.equal(isEnabled({ url: '  ' }), false)
  assert.equal(isEnabled({}), false)
})

test("the payload never pings anyone, whatever the comment says", () => {
  const body = JSON.parse(discordPayload('@everyone KI2D is on 14285'))
  assert.deepEqual(body.allowed_mentions, { parse: [] })
  assert.equal(body.content, '@everyone KI2D is on 14285')
})

test("a message longer than Discord takes is cut to fit, since Discord would refuse the whole thing", () => {
  const body = JSON.parse(discordPayload('x'.repeat(DISCORD_MAX_CONTENT + 50)))
  assert.equal(body.content.length, DISCORD_MAX_CONTENT)
  assert.ok(body.content.endsWith('…'))
})

// Discord refuses an empty `username` or `avatar_url` rather than falling
// back to the webhook's own, so a blank one must be left out entirely.
test("the sender's name and avatar go out when they say something, and are left out when blank", () => {
  const named = JSON.parse(discordPayload('hi', { username: 'KI2D', avatarUrl: 'https://example.com/a.png' }))
  assert.equal(named.username, 'KI2D')
  assert.equal(named.avatar_url, 'https://example.com/a.png')

  const unnamed = JSON.parse(discordPayload('hi', { username: '', avatarUrl: '' }))
  assert.equal('username' in unnamed, false)
  assert.equal('avatar_url' in unnamed, false)

  assert.equal(JSON.parse(discordPayload('hi', { username: 'x'.repeat(100) })).username.length, DISCORD_MAX_USERNAME)
})
