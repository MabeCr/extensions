// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Discord Spotterbot: a self-spot also goes to every Discord server that added
// Ham2K's Spotterbot and gave the operator one of its poster roles. The server's
// admins choose the channel, the role it mentions and which spots it takes;
// the operator signs in with Discord once, and can switch any server off here.
//
// Unlike `ki2d-discord-spotting`, there is no webhook URL to pass around: who
// may post is each server's roles, checked by Spotterbot on every spot.
//
// The switches are Spotterbot's, shared with its website. The `excluded`
// setting only holds a switch Spotterbot hasn't stored yet (all of them, for
// an operator coming from 0.1.0), and every spot sends it along.
//
// A spots source that posts and never reads: `fetchSpots` answers nothing.

import { defineExtension, host } from "@ham2k/extension-sdk"
import type {
  DynamicSettingsPanel,
  FormDefinition,
  FormElement,
  HookContext,
  JSONValue,
  PostResult,
  PostSelfSpotRequest,
  SettingsPanelDescriptor,
  Spot,
  SpotEligibility,
  SpotsHook,
} from "@ham2k/extension-sdk"

import { SPOTTERBOT, oauth2Config, selfSpotCall, spotBody } from "./spotterbot.ts"
import type { Server, SpotsAnswer } from "./spotterbot.ts"
import { tFor } from "./i18n.ts"

import manifest from "../manifest.json" with { type: "json" }

function accessToken(ctx: HookContext, credentials?: Record<string, string>): string | undefined {
  return credentials?.accessToken || ctx.account?.credentials?.accessToken || undefined
}

function authorized(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Accept: 'application/json', ...extra }
}

async function loadSettings(): Promise<Record<string, JSONValue>> {
  const all = await host.getSettings()
  const extensions = all.extensions as Record<string, JSONValue> | undefined
  return (extensions?.[`extension_${manifest.key}`] as Record<string, JSONValue> | undefined) ?? {}
}

/// Servers the operator switched off that Spotterbot doesn't know about yet.
/// Stored as exclusions so that a server that starts using Spotterbot later
/// is on without the operator doing anything.
async function loadExcluded(): Promise<string[]> {
  const excluded = (await loadSettings()).excluded
  return Array.isArray(excluded) ? excluded.filter((id): id is string => typeof id === 'string') : []
}

const Hook: SpotsHook = {
  sourceName: 'Spotterbot',

  async fetchSpots(): Promise<Spot[]> {
    return []
  },

  async isSelfSpotEnabled({ operation }: { operation: Record<string, JSONValue> }, ctx: HookContext): Promise<SpotEligibility> {
    return accessToken(ctx) && selfSpotCall(operation) ? { enabled: true, icon: manifest.icon } : { enabled: false }
  },

  async postSelfSpot(request: PostSelfSpotRequest, ctx: HookContext): Promise<PostResult> {
    const t = tFor(ctx)
    const token = accessToken(ctx)
    if (!token) return { ok: false, message: t('notSignedIn') }

    const excluded = await loadExcluded()
    let answer: SpotsAnswer
    try {
      const response = await host.fetch(`${SPOTTERBOT}/spots`, {
        method: 'POST',
        headers: authorized(token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ spot: spotBody(request, ctx.appName), exclude: excluded }),
      })
      if (response.status === 401) return { ok: false, message: t('signInAgain') }
      if (response.status === 400) return { ok: false, message: t('refused', { error: errorOf(response.body) ?? response.status }) }
      if (response.status !== 200) return { ok: false, message: t('rejected', { status: response.status }) }
      const parsed = JSON.parse(response.body) as Partial<SpotsAnswer>
      if (!Array.isArray(parsed.results)) return { ok: false, message: t('rejected', { status: response.status }) }
      answer = { results: parsed.results, unchecked: Number(parsed.unchecked) || 0, switchedOff: Number(parsed.switchedOff) || 0 }
    } catch (error) {
      return { ok: false, message: t('unreachable', { error: String(error) }) }
    }

    const { results, unchecked, switchedOff } = answer
    const failures = results.flatMap((result) => (result.status === 'failed' ? [`${result.name}: ${result.error}`] : []))
    // Possibly the operator's servers, not yet posted to: failing the spot is
    // what has the app try it again.
    if (unchecked) failures.push(t('unchecked', { count: unchecked }))
    if (failures.length) return { ok: false, message: failures.join('; ') }
    if (!results.length) {
      // Skipped, not failed, either way: switching every server off is a
      // choice, and having no server yet is no fault of this spot. HaLo
      // starts auto-respotting only on a spot no source failed, so a failure
      // here would stop every other source's respots too.
      return { ok: true, skipped: true, message: t(excluded.length || switchedOff ? 'allSwitchedOff' : 'noServers') }
    }
    if (!results.some((result) => result.status === 'sent')) return { ok: true, skipped: true, message: t('allSkipped') }
    return { ok: true }
  },
}

function errorOf(body: string): string | undefined {
  try {
    const error = (JSON.parse(body) as { error?: unknown }).error
    return typeof error === 'string' ? error : undefined
  } catch {
    return undefined
  }
}

const Account = {
  label: 'Discord',
  description: (_args: Record<string, never>, ctx: HookContext) => tFor(ctx)('accountDescription'),
  kvKey: manifest.key,
  // A bearer token: device-local, never synced through iCloud Keychain.
  synchronizable: false,
  oauth2: (_args: Record<string, never>, ctx: HookContext) => oauth2Config(ctx.edition),

  async testCredentials(credentials: Record<string, string>, ctx: HookContext): Promise<string> {
    const t = tFor(ctx)
    const token = accessToken(ctx, credentials)
    if (!token) return t('notSignedIn')
    try {
      const response = await host.fetch(`${SPOTTERBOT}/me`, { headers: authorized(token) })
      if (response.status === 401) return t('signInAgain')
      if (response.status !== 200) return t('rejected', { status: response.status })
      const me = JSON.parse(response.body) as { username: string; globalName?: string | null }
      return t('signedInAs', { name: me.globalName || me.username })
    } catch (error) {
      return t('unreachable', { error: String(error) })
    }
  },
}

const SERVER_FIELD = /^server:(.+)$/

interface ServerList {
  servers: Server[]
  unchecked: number
}

/// The app builds this panel's definition far more often than the operator
/// opens it: after every change to any setting, for settings search, and to
/// list the Spotting section's rows. Each fetch costs Spotterbot one Discord
/// lookup per server, so one list serves for this long.
const SERVERS_TTL_MS = 60 * 1000

let serversCache: { token: string; at: number; list: ServerList } | undefined

/// The servers this operator may post in, or the message that says why there
/// is no list to show.
async function serversFor(ctx: HookContext): Promise<ServerList | string> {
  const t = tFor(ctx)
  const token = accessToken(ctx)
  if (!token) return t('signInFirst')
  if (serversCache?.token === token && Date.now() - serversCache.at < SERVERS_TTL_MS) return serversCache.list
  if (!ctx.online) return t('offline')
  await storeLocalSwitches(token)
  try {
    const response = await host.fetch(`${SPOTTERBOT}/servers`, { headers: authorized(token) })
    if (response.status === 401) return t('signInAgain')
    if (response.status !== 200) return t('rejected', { status: response.status })
    const parsed = JSON.parse(response.body) as Partial<ServerList>
    if (!Array.isArray(parsed.servers)) return t('rejected', { status: response.status })
    const list = { servers: parsed.servers.map((server) => ({ ...server, on: server.on !== false })), unchecked: Number(parsed.unchecked) || 0 }
    // A list Discord answered only in part would hide servers for a minute.
    if (!list.unchecked) serversCache = { token, at: Date.now(), list }
    return list.servers.length || list.unchecked ? list : t('noServers')
  } catch (error) {
    return t('unreachable', { error: String(error) })
  }
}

/// Settings writes, one after another. Each reads the exclusions, changes them
/// and writes them back, and the app does not wait for one toggle's write
/// before sending the next: run together, the second would undo the first.
let settingsWrite: Promise<void> = Promise.resolve()

function serially(write: () => Promise<void>): Promise<void> {
  settingsWrite = settingsWrite.then(write, write)
  return settingsWrite
}

/// Tells Spotterbot the operator's switch for one server; false when it didn't
/// take it.
async function storeSwitch(token: string, serverId: string, on: boolean): Promise<boolean> {
  try {
    const response = await host.fetch(`${SPOTTERBOT}/servers/${serverId}`, {
      method: 'PUT',
      headers: authorized(token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ on }),
    })
    return response.status === 200
  } catch {
    return false
  }
}

/// Hands Spotterbot the switches kept here, keeping only those it didn't take.
function storeLocalSwitches(token: string): Promise<void> {
  return serially(async () => {
    const excluded = await loadExcluded()
    if (!excluded.length) return
    const stored = await Promise.all(excluded.map((id) => storeSwitch(token, id, false)))
    await host.setSettings({ excluded: excluded.filter((_, i) => !stored[i]) })
  })
}

/// One switch, stored by Spotterbot when it answers, and kept here for the
/// spots to send when it doesn't.
async function switchServer(token: string | undefined, serverId: string, on: boolean): Promise<void> {
  const stored = token ? await storeSwitch(token, serverId, on) : false
  await serially(async () => {
    const excluded = new Set(await loadExcluded())
    if (!stored && !on) excluded.add(serverId)
    else excluded.delete(serverId)
    await host.setSettings({ excluded: [...excluded] })
  })
  const cached = serversCache?.list.servers.find((server) => server.id === serverId)
  if (cached) cached.on = on
}

const SettingsPanel: DynamicSettingsPanel = {
  kind: 'dynamic',

  // One row in Settings' Spotting section, as the manifest's `settings`
  // declares; an app older than `section` shows it as a section of its own.
  async getPanels(_args: Record<string, never>, ctx: HookContext): Promise<SettingsPanelDescriptor[]> {
    return [{ key: manifest.key, title: tFor(ctx)('settingsTitle'), icon: manifest.icon, sidebar: false, section: 'spotting' }]
  },

  async getDefinition(_args: { panelKey: string }, ctx: HookContext): Promise<FormDefinition> {
    const t = tFor(ctx)
    const list = await serversFor(ctx)
    const excluded = new Set(await loadExcluded())
    const serverElements: FormElement[] =
      typeof list === 'string'
        ? [{ type: 'markdown', text: list }]
        : [
            { type: 'header', title: t('serversLabel') },
            ...list.servers.map(
              (server): FormElement => ({
                type: 'field',
                fieldType: 'checkbox',
                key: `server:${server.id}`,
                label: server.name || server.id,
                value: server.on && !excluded.has(server.id),
              }),
            ),
            ...(list.unchecked ? [{ type: 'markdown', text: t('serversUnchecked', { count: list.unchecked }) } as FormElement] : []),
          ]
    return {
      elements: [
        { type: 'field', fieldType: 'account', key: 'account', label: t('accountLabel'), account: { key: manifest.key } },
        ...serverElements,
        { type: 'markdown', collapsible: true, title: t('helpTitle'), text: t('helpText') },
      ],
    }
  },

  async onChangeField({ fieldKey, value }: { fieldKey: string; value: unknown }, ctx: HookContext): Promise<void> {
    const match = SERVER_FIELD.exec(fieldKey)
    if (match) await switchServer(accessToken(ctx), match[1], Boolean(value))
  },
}

defineExtension({
  ...manifest,
  onActivation({ registerHook }) {
    registerHook('spots', { hook: Hook, key: manifest.key })
    registerHook('account', { hook: Account, key: manifest.key })
    registerHook('settingsPanel', { hook: SettingsPanel, key: manifest.key })
  },
})
