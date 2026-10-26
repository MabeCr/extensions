// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// HamAlert (https://hamalert.org) watches the cluster, the RBN, POTA, SOTA
// and PSK Reporter for the stations an operator's own triggers name, and
// alerts them. This extension puts those alerts on the spots board, and once
// the operator works an alerted station there, mutes it in HamAlert on that
// band and mode for a while, as the mute buttons in HamAlert's own app do.
//
// The alerts come from `GET /api/spots2`, which HamAlert's own app polls:
// HTTP Basic with the HamAlert login, answering the last stored alerts of
// every trigger that has the "App" action ticked. HamAlert's Telnet feed
// needs a raw socket no extension has, and its webhook needs a public URL a
// phone does not have. Reading it clears the badge HamAlert's own app shows.
//
// Every request is a login, and HamAlert pauses a login after 20 failures in
// fifteen minutes — for its own app too. So a rejected password stops the
// polling until the credentials change, rather than spending those twenty.
//
// A spot of an alerted station rings a red bell on the board, beside the
// icons its references draw, from whichever source the board heard it.

import { contestScorer, defineExtension, host } from "@ham2k/extension-sdk"
import type {
  DynamicSettingsPanel,
  FormDefinition,
  HookContext,
  JSONValue,
  SettingsPanelDescriptor,
  Spot,
  SpotsHook,
} from "@ham2k/extension-sdk"

import { alertedStations, isAlerted, muteFor, muteKey, newestPerStation, parseAlerts, qsoWorks, receivedAtMillis, spotForAlert } from "./alerts.ts"
import type { HamAlertRecord, Mute } from "./alerts.ts"
import { tFor } from "./i18n.ts"

import manifest from "../manifest.json" with { type: "json" }

const API_BASE = 'https://hamalert.org/api'

/// How far back the board is given alerts. HamAlert keeps a day of them; an
/// hour-old alert is a station that has most likely moved on.
const MAX_AGE_SECONDS = 60 * 60
const MAX_ALERTS = 100

/// The least time between two reads. The board asks every source on its own
/// cadence, and each read here is a login on HamAlert's server.
const MIN_POLL_MS = 60 * 1000

/// A contact this long before the first alert still counts as working the
/// station: the spot that set the alert off is often of that very contact.
const WORKED_LOOKBACK_MS = 15 * 60 * 1000

/// How long a worked station stays muted, in seconds, unless the operator
/// chose otherwise. HamAlert's own app mutes for an hour by default, and
/// HamAlert takes no more than a day.
const DEFAULT_MUTE_SECONDS = 60 * 60
const MUTE_CHOICES = [0, 30 * 60, 60 * 60, 2 * 60 * 60, 6 * 60 * 60, 24 * 60 * 60]

/// KV key: every mute this extension has asked for, by `muteKey`, until when.
const MUTES_KV = 'mutes'

interface Login {
  username: string
  password: string
}

function loginOf(credentials: Record<string, string> | undefined): Login | undefined {
  const username = credentials?.username?.trim().toUpperCase()
  const password = credentials?.password ?? ''
  return username && password ? { username, password } : undefined
}

/// UTF-8, then base64: `btoa` is not in the sandbox, and takes only Latin-1
/// where it is.
function base64(text: string): string {
  const bytes: number[] = []
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x80) bytes.push(code)
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63))
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63))
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63))
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63]
    out += i + 1 < bytes.length ? alphabet[(n >> 6) & 63] : '='
    out += i + 2 < bytes.length ? alphabet[n & 63] : '='
  }
  return out
}

function authHeaders(login: Login): Record<string, string> {
  return { Authorization: `Basic ${base64(`${login.username}:${login.password}`)}`, Accept: 'application/json' }
}

function loginId(login: Login): string {
  return `${login.username}:${login.password}`
}

/// The last read, for the login it was made with.
let lastRead: { login: string; at: number; spots: Spot[] } | undefined
/// A login HamAlert refused. Never sent again: see the header.
let refusedLogin: string | undefined
/// HamAlert's `Retry-After`, as a time.
let pausedUntil = 0
/// The stations the last read's alerts name, by `alertedStations`.
let alerted = new Set<string>()

async function readAlerts(login: Login, ctx: HookContext): Promise<HamAlertRecord[] | undefined> {
  const response = await host.fetch(`${API_BASE}/spots2?limit=${MAX_ALERTS}&maxAge=${MAX_AGE_SECONDS}`, {
    headers: authHeaders(login),
  })
  if (response.status === 401) {
    refusedLogin = loginId(login)
    throw new Error(tFor(ctx)('loginRefused'))
  }
  if (response.status === 429) {
    // The header is not handed to an extension, so this waits HamAlert's
    // whole fifteen-minute window.
    pausedUntil = Date.now() + 15 * 60 * 1000
    return undefined
  }
  if (response.status !== 200) throw new Error(`HamAlert returned HTTP ${response.status}`)
  return parseAlerts(response.body)
}

const Spots: SpotsHook = {
  sourceName: 'HamAlert',

  async fetchSpots(_args: Record<string, never>, ctx: HookContext): Promise<Spot[]> {
    if (!ctx.online) return []
    const login = loginOf(ctx.account?.credentials)
    if (!login || refusedLogin === loginId(login)) {
      alerted = new Set()
      return []
    }

    const now = Date.now()
    const held = lastRead?.login === loginId(login) ? lastRead : undefined
    if (held && now - held.at < MIN_POLL_MS) return held.spots
    if (now < pausedUntil) return held?.spots ?? []

    const alerts = await readAlerts(login, ctx)
    if (!alerts) return held?.spots ?? []

    const spots = newestPerStation(alerts.flatMap((record) => spotForAlert(record) ?? []))
    lastRead = { login: loginId(login), at: now, spots }
    alerted = alertedStations(spots)

    // A mute that fails costs the operator one more alert, never the board.
    try {
      await muteWorkedStations(alerts, login, ctx)
    } catch (error) {
      host.log(`HamAlert: muting worked stations failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    return spots
  },
}

async function muteSeconds(): Promise<number> {
  const settings = await host.getSettings()
  const extensions = settings.extensions as Record<string, JSONValue> | undefined
  const mine = extensions?.[`extension_${manifest.key}`] as Record<string, JSONValue> | undefined
  const chosen = Number(mine?.muteSeconds)
  return MUTE_CHOICES.includes(chosen) ? chosen : DEFAULT_MUTE_SECONDS
}

async function loadMutes(now: number): Promise<Record<string, number>> {
  const stored = (await host.kvGet(MUTES_KV)) as Record<string, JSONValue> | null
  const mutes: Record<string, number> = {}
  for (const [key, until] of Object.entries(stored ?? {})) {
    if (typeof until === 'number' && until > now) mutes[key] = until
  }
  return mutes
}

/// Mutes, in HamAlert, every alerted station the log shows worked on the
/// alert's band and mode since it was first alerted. Each mute is asked for
/// once: asking again would push its expiry out every minute for as long as
/// the alert stays in the last hour's.
async function muteWorkedStations(alerts: HamAlertRecord[], login: Login, ctx: HookContext): Promise<void> {
  const getHistory = ctx.getHistoryForCall
  if (!getHistory) return
  const seconds = await muteSeconds()
  if (seconds <= 0) return

  const now = Date.now()
  const mutes = await loadMutes(now)
  const pending = new Map<string, { mute: Mute; calls: Set<string>; since: number }>()
  for (const record of alerts) {
    const mute = muteFor(record)
    if (!mute || !spotForAlert(record)) continue
    const key = muteKey(mute)
    if (mutes[key]) continue
    const at = receivedAtMillis(record) || now
    const entry = pending.get(key) ?? { mute, calls: new Set<string>(), since: at }
    entry.calls.add(mute.callsign)
    if (record.fullCallsign) entry.calls.add(record.fullCallsign.trim().toUpperCase())
    entry.since = Math.min(entry.since, at)
    pending.set(key, entry)
  }

  let changed = false
  for (const [key, { mute, calls, since }] of pending) {
    const fromTimeMillis = since - WORKED_LOOKBACK_MS
    let worked = false
    for (const call of calls) {
      // Narrowed here and checked again below: a host older than these
      // options answers the call's latest contacts unfiltered.
      const history = await getHistory(call, { fromTimeMillis, limit: 10 })
      if (history.some((qso) => qsoWorks(qso, mute, fromTimeMillis))) {
        worked = true
        break
      }
    }
    if (!worked) continue

    const form = [`callsign=${encodeURIComponent(mute.callsign)}`, `ttl=${seconds}`]
    if (mute.band) form.push(`band=${encodeURIComponent(mute.band)}`)
    if (mute.mode) form.push(`mode=${encodeURIComponent(mute.mode)}`)
    const response = await host.fetch(`${API_BASE}/addMute`, {
      method: 'POST',
      headers: { ...authHeaders(login), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.join('&'),
      timeout: 10 * 1000,
    })
    if (response.status !== 200) {
      host.log(`HamAlert: muting ${key} returned HTTP ${response.status}`)
      continue
    }
    mutes[key] = now + seconds * 1000
    changed = true
    host.log(`HamAlert: muted ${mute.callsign} ${mute.band ?? ''} ${mute.mode ?? ''} for ${seconds / 60} minutes`)
  }
  if (changed) await host.kvSet(MUTES_KV, mutes)
}

/// The bell, in the extension's own red.
const BELL = { icon: 'bell-ring', color: manifest.accentColor }

/// A scorer only to ring the bell: it judges nothing and tallies nothing, and
/// `contestScorer` keeps the icon off logged contacts' verdicts. Scoring
/// every operation is what lets it mark a spot whatever the operation is
/// hunting.
const Bell = contestScorer<Record<string, never>>({
  startScoresheet: () => ({}),
  scoreQso: ({ scoresheet, qso }) => ({ scoresheet, score: isAlerted(alerted, qso) ? { value: 0, ...BELL } : { value: 0 } }),
  summarizeScore: () => ({}),
})

const Account = {
  label: 'HamAlert',
  description: (_args: Record<string, never>, ctx: HookContext) => tFor(ctx)('accountDescription'),
  kvKey: manifest.key,
  // A HamAlert login is the operator's, not a device's.
  synchronizable: true,
  fields: (_args: Record<string, never>, ctx: HookContext) => {
    const t = tFor(ctx)
    return [
      { key: 'username', label: t('usernameLabel'), type: 'text' as const, postface: t('usernamePostface') },
      { key: 'password', label: t('passwordLabel'), type: 'secret' as const, postface: t('passwordPostface') },
    ]
  },
  /// A real login, and then whether any trigger sends alerts here at all:
  /// `spots2` says so when it has none to give, which a one-second window
  /// all but guarantees.
  async testCredentials(credentials: Record<string, string>, ctx: HookContext): Promise<string> {
    const t = tFor(ctx)
    const login = loginOf(credentials)
    if (!login) return t('missingCredentials')
    try {
      const response = await host.fetch(`${API_BASE}/spots2?limit=1&maxAge=1`, { headers: authHeaders(login) })
      if (response.status === 401) return t('loginRefused')
      if (response.status === 429) return t('loginPaused')
      if (response.status !== 200) return t('checkFailed', { status: String(response.status) })
      // New credentials, a new chance: whatever was refused is forgotten.
      refusedLogin = undefined
      lastRead = undefined
      let hasAppTrigger = true
      try {
        hasAppTrigger = (JSON.parse(response.body) as { hasAnyAppTrigger?: boolean }).hasAnyAppTrigger !== false
      } catch (_error) {
        // A 200 is the answer; the trigger check only decorates it.
      }
      return hasAppTrigger
        ? t('loginAccepted', { username: login.username })
        : t('loginAcceptedNoAppTrigger', { username: login.username })
    } catch (error) {
      return t('checkFailed', { status: error instanceof Error ? error.message : String(error) })
    }
  },
}

const Settings: DynamicSettingsPanel = {
  kind: 'dynamic',

  // One row in Settings' Spotting section, as the manifest's `settings`
  // declares; an app older than `section` shows it as a section of its own.
  async getPanels(_args: Record<string, never>, _ctx: HookContext): Promise<SettingsPanelDescriptor[]> {
    return [{ key: manifest.key, title: manifest.shortName, icon: manifest.icon, sidebar: false, section: 'spotting' }]
  },

  async getDefinition(_args: { panelKey: string }, ctx: HookContext): Promise<FormDefinition> {
    const t = tFor(ctx)
    return {
      elements: [
        { type: 'field', fieldType: 'account', key: 'account', label: t('accountLabel'), account: { key: manifest.key } },
        {
          type: 'field',
          fieldType: 'select',
          key: 'muteSeconds',
          label: t('muteLabel'),
          description: t('muteDescription'),
          // One string per choice rather than a plural: the sandbox's Intl is not
          // one i18next's plural rules can count on.
          options: MUTE_CHOICES.map((seconds) => ({ label: t(`mute${seconds}`), value: seconds })),
          value: await muteSeconds(),
        },
        { type: 'markdown', collapsible: true, title: t('helpTitle'), text: t('helpText') },
      ],
    }
  },

  async onChangeField({ fieldKey, value }: { fieldKey: string; value: unknown }, _ctx: HookContext): Promise<void> {
    if (fieldKey === 'muteSeconds') await host.setSettings({ muteSeconds: Number(value) })
  },
}

defineExtension({
  ...manifest,
  onActivation({ registerHook }) {
    registerHook('spots', { hook: Spots, key: manifest.key })
    registerHook('scoring', { hook: Bell, key: manifest.key })
    registerHook('account', { hook: Account, key: manifest.key })
    registerHook('settingsPanel', { hook: Settings, key: manifest.key })
  },
})
