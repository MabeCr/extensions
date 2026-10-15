// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// One self-spot as Discord messages: which webhooks take it, what each one's
// template says about it, and the request body Discord's webhook API reads.

import { renderTemplate, templateContext } from "@ham2k/extension-sdk"
import type { JSONValue } from "@ham2k/extension-sdk"

/// One Discord channel, as the settings panel stores it. Every field may be
/// missing: a row the operator added and left half-filled is still a row.
export interface Webhook {
  name?: string
  url?: string
  /// Absent means enabled — a new row is on until switched off.
  enabled?: boolean
  /// Absent means [DEFAULT_TEMPLATE]; an empty string is the operator's
  /// own, and renders blank, so the channel takes no spots.
  template?: string
  /// Templates for the name and the avatar image URL the message is posted
  /// under, as app-polo's spot-discord has them. Absent or rendering blank,
  /// Discord shows the webhook's own.
  username?: string
  avatarUrl?: string
}

export interface SelfSpot {
  operation: Record<string, JSONValue>
  freq: number
  mode?: string
  comment?: string
}

/// Only a spot announcing a QRV or a QRT reaches the channel: a respot every
/// few minutes would bury the conversation, while "on the air" and "off the
/// air" are what a channel's readers want to hear.
export const DEFAULT_TEMPLATE =
  "{% if spot.qcode == 'QRV' or spot.qcode == 'QRT' %}" +
  "{{ op.station }} {{ spot.comments }}" +
  "{% if op.refs != empty %} • {{ op.refs | refLabels | sentence }}{% endif %}" +
  " • {{ spot.freq }} {{ spot.mode }}" +
  "{% endif %}"

/// Discord refuses a message or a name longer than these outright (HTTP 400),
/// so a long one is cut to fit rather than lost.
export const DISCORD_MAX_CONTENT = 2000
export const DISCORD_MAX_USERNAME = 80

/// Exactly the hosts in the manifest's `domains`: the host matches those
/// exactly, so a URL on any other — `ptb.discordapp.com`, say — would pass
/// here and then have every post refused.
const WEBHOOK_URL = /^https:\/\/(?:(?:ptb\.|canary\.)?discord\.com|discordapp\.com)\/api\/(?:v\d+\/)?webhooks\/\d+\/[\w-]+\/?$/

/// Whether [url] is a Discord webhook. Only these hosts are in the manifest's
/// `domains`, so anything else would be refused by the host anyway — with a
/// message about the allowlist instead of about the URL the operator typed.
export function isWebhookUrl(url: string): boolean {
  return WEBHOOK_URL.test(url.trim())
}

export function isEnabled(webhook: Webhook): boolean {
  return webhook.enabled !== false && (webhook.url ?? '').trim() !== ''
}

const Q_CODE = /^Q[A-Z]{2}$/i

/// The `spot` namespace this extension adds beside the SDK's `op`, `app` and
/// `now`, named as app-polo's spot-discord names it so a PoLo template's
/// variables carry over. The app's template editor does not know it, so its
/// preview shows `spot.*` blank: the values are real only when a spot is sent.
///
/// `qcode` is the comment's first word when that is a Q-code (`QRT`), and
/// `qrest` what follows it — the whole comment when there is none. Where this
/// deliberately differs from PoLo: both names are all lowercase, since names
/// are case-sensitive and a miscased one silently renders blank — PoLo's
/// `qCode` and `qRest` are kept beside them so its templates still work;
/// `qrest` is ALL of the rest (PoLo's `split(' ', 2)` keeps only the next
/// word); a lowercase `qrt` counts; and a missing Q-code is nil rather than
/// blank, since Liquid reads `""` as true and `{% if spot.qcode %}` would fire
/// on every spot.
export function spotValues(spot: SelfSpot): Record<string, JSONValue> {
  const comments = (spot.comment ?? '').trim()
  const [first = '', ...rest] = comments.split(/\s+/)
  const qcode = Q_CODE.test(first) ? first.toUpperCase() : null
  const qrest = qcode ? rest.join(' ') : comments
  return {
    freq: spot.freq,
    mode: spot.mode ?? '',
    comments,
    qcode,
    qCode: qcode,
    qrest,
    qRest: qrest,
  }
}

/// [template] rendered for [spot], trimmed. Throws `TemplateError` on a
/// broken template: a channel that silently stopped getting spots, or posted
/// under the wrong name, would look like Discord's fault.
export function renderForSpot(template: string, spot: SelfSpot, appName?: string): string {
  const context = { ...templateContext({ operation: spot.operation, appName }), spot: spotValues(spot) }
  return renderTemplate(template, context).trim()
}

/// [webhook]'s message for [spot] — empty when the template renders blank or
/// whitespace, which is the operator's way of saying "not this one".
export function messageFor(webhook: Webhook, spot: SelfSpot, appName?: string): string {
  return renderForSpot(webhook.template ?? DEFAULT_TEMPLATE, spot, appName)
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/// The webhook request body. `allowed_mentions` is empty so that an
/// `@everyone` in a comment, or a role named in a template, never pings a
/// whole server on every spot. A blank name or avatar is left out, so Discord
/// shows the webhook's own rather than refusing an empty one.
export function discordPayload(content: string, sender: { username?: string; avatarUrl?: string } = {}): string {
  return JSON.stringify({
    content: cut(content, DISCORD_MAX_CONTENT),
    ...(sender.username ? { username: cut(sender.username, DISCORD_MAX_USERNAME) } : {}),
    ...(sender.avatarUrl ? { avatar_url: sender.avatarUrl } : {}),
    allowed_mentions: { parse: [] },
  })
}
