// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Discord self-spotting: a self-spot also goes, as a message, to every Discord
// channel the operator has added a webhook for — a club's channel, a group of
// friends, a chaser's own server. Each webhook has its own Liquid template, so
// one channel can take every spot and another only the POTA ones; a template
// that renders blank for a spot skips that channel.
//
// A spots source that posts and never reads, as `ki2d-aprs-spotting` is:
// webhooks are write-only, so `fetchSpots` answers nothing.

import { TemplateError, defineExtension, host } from "@ham2k/extension-sdk"
import type {
  DynamicSettingsPanel,
  FormDefinition,
  FormField,
  HookContext,
  JSONValue,
  PostResult,
  PostSelfSpotRequest,
  SettingsPanelDescriptor,
  Spot,
  SpotEligibility,
  SpotsHook,
} from "@ham2k/extension-sdk"

import { DEFAULT_TEMPLATE, discordPayload, isEnabled, isWebhookUrl, messageFor, renderForSpot } from "./discord.ts"
import type { Webhook } from "./discord.ts"
import { tFor } from "./i18n.ts"

import manifest from "../manifest.json" with { type: "json" }

/// `skipped` is newer than the SDK this builds against: with `ok`, the
/// Spotting control leaves the icon gray. An app that predates it shows the
/// same answer as sent.
type SkippablePostResult = PostResult & { skipped?: boolean }

/// `section` is newer than the SDK this builds against: an app that has it
/// shows the panel as one row in its Spotting section, one that predates it
/// as a section of its own.
type PlacedPanelDescriptor = SettingsPanelDescriptor & { section?: string }

/// `itemSwitch` is newer than the SDK this builds against: an app that has it
/// puts each channel's on/off switch on its row. One that predates it shows
/// none, and every channel stays on.
type SwitchedListField = FormField & { itemSwitch?: string }

async function loadWebhooks(): Promise<Webhook[]> {
  const all = await host.getSettings()
  const extensions = all.extensions as Record<string, JSONValue> | undefined
  const mine = extensions?.[`extension_${manifest.key}`] as Record<string, JSONValue> | undefined
  return Array.isArray(mine?.webhooks) ? (mine.webhooks as Webhook[]) : []
}

type Outcome = { sent: true } | { skipped: true } | { failed: string }

/// The message each webhook URL last took, and when (`Date.now()`). A spot
/// some channels refused is a failure the app asks again about shortly, and
/// the channels that took it would post it twice; one asked the same message
/// within [REPEAT_WINDOW_MS] counts as sent without posting.
const lastSent = new Map<string, { body: string; at: number }>()

/// Under the app's shortest auto-respot interval (five minutes), so every
/// respot still reaches every channel.
const REPEAT_WINDOW_MS = 2 * 60 * 1000

async function post(webhook: Webhook, request: PostSelfSpotRequest, ctx: HookContext): Promise<Outcome> {
  const t = tFor(ctx)
  const url = (webhook.url ?? '').trim()
  if (!isWebhookUrl(url)) return { failed: t('notWebhook') }

  // The sender's templates render only once the message says this channel
  // takes the spot — a channel that skips is not involved at all.
  let field = t('templateLabel')
  let body: string
  try {
    const content = messageFor(webhook, request, ctx.appName)
    if (!content) return { skipped: true }
    field = t('usernameLabel')
    const username = renderForSpot(webhook.username ?? '', request, ctx.appName)
    field = t('avatarUrlLabel')
    const avatarUrl = renderForSpot(webhook.avatarUrl ?? '', request, ctx.appName)
    body = discordPayload(content, { username, avatarUrl })
  } catch (error) {
    return { failed: t('templateError', { field, error: error instanceof TemplateError ? error.message : String(error) }) }
  }

  const last = lastSent.get(url)
  if (last?.body === body && Date.now() - last.at < REPEAT_WINDOW_MS) return { sent: true }

  try {
    const response = await host.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
    // 204 without `?wait=true`; 200 with it.
    if (response.status < 200 || response.status >= 300) return { failed: t('rejected', { status: response.status }) }
  } catch (error) {
    return { failed: t('unreachable', { error: String(error) }) }
  }
  lastSent.set(url, { body, at: Date.now() })
  return { sent: true }
}

const Hook: SpotsHook = {
  sourceName: 'Discord',

  async fetchSpots(): Promise<Spot[]> {
    return []
  },

  async isSelfSpotEnabled(): Promise<SpotEligibility> {
    return (await loadWebhooks()).some(isEnabled) ? { enabled: true, icon: manifest.icon } : { enabled: false }
  },

  async postSelfSpot(request: PostSelfSpotRequest, ctx: HookContext): Promise<SkippablePostResult> {
    const t = tFor(ctx)
    const webhooks = (await loadWebhooks()).filter(isEnabled)
    if (!webhooks.length) return { ok: false, message: t('noWebhooks') }

    const outcomes = await Promise.all(webhooks.map((webhook) => post(webhook, request, ctx)))
    const failures = outcomes.flatMap((outcome, i) =>
      'failed' in outcome ? [`${webhooks[i].name?.trim() || t('unnamed', { n: i + 1 })}: ${outcome.failed}`] : [],
    )
    if (failures.length) return { ok: false, message: failures.join('; ') }
    if (!outcomes.some((outcome) => 'sent' in outcome)) return { ok: true, skipped: true, message: t('allSkipped') }
    return { ok: true }
  },
}

/// `defaultValue` is the template editor's Reset text — a string, though the
/// SDK types it for `multiselect`'s list.
function templateField(key: string, label: string, defaultValue?: string): FormField {
  return {
    type: 'field',
    fieldType: 'textTemplate',
    key,
    label,
    templateContext: 'text',
    ...(defaultValue === undefined ? {} : { value: defaultValue, defaultValue }),
  } as unknown as FormField
}

const URL_FIELD = /^webhooks\[\d+\]\.url$/

const SettingsPanel: DynamicSettingsPanel = {
  kind: 'dynamic',

  async getPanels(_args: Record<string, never>, ctx: HookContext): Promise<PlacedPanelDescriptor[]> {
    return [{ key: manifest.key, title: tFor(ctx)('settingsTitle'), icon: manifest.icon, section: 'spotting' }]
  },

  async getDefinition(_args: { panelKey: string }, ctx: HookContext): Promise<FormDefinition> {
    const t = tFor(ctx)
    return {
      elements: [
        ({
          type: 'field',
          fieldType: 'list',
          key: 'webhooks',
          label: t('webhooksLabel'),
          itemLabel: t('webhookItemLabel'),
          itemTitle: '${name}',
          inline: true,
          orderable: true,
          itemSwitch: 'enabled',
          itemFields: [
            { type: 'field', fieldType: 'text', key: 'name', label: t('nameLabel'), placeholder: t('namePlaceholder') },
            { type: 'field', fieldType: 'secret', key: 'url', label: t('urlLabel') },
            templateField('template', t('templateLabel'), DEFAULT_TEMPLATE),
            templateField('username', t('usernameLabel')),
            templateField('avatarUrl', t('avatarUrlLabel')),
          ],
          value: (await loadWebhooks()) as JSONValue,
        }) satisfies SwitchedListField as FormField,
        { type: 'markdown', collapsible: true, title: t('helpTitle'), text: t('helpText') },
      ],
    }
  },

  async validateField({ fieldKey, value }, ctx: HookContext): Promise<string | null> {
    if (!URL_FIELD.test(fieldKey)) return null
    const url = typeof value === 'string' ? value.trim() : ''
    if (!url) return tFor(ctx)('urlRequired')
    return isWebhookUrl(url) ? null : tFor(ctx)('notWebhook')
  },

  async onChangeField({ fieldKey, value }) {
    if (fieldKey === 'webhooks') await host.setSettings({ webhooks: value as JSONValue })
  },
}

defineExtension({
  ...manifest,
  onActivation({ registerHook }) {
    registerHook('spots', { hook: Hook, key: manifest.key })
    registerHook('settingsPanel', { hook: SettingsPanel, key: manifest.key })
  },
})
