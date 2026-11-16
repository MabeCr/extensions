// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Sends each contact to Club Log as it is logged, which is what a station's
// Club Log Live Stream shows (stream.ts has how, and what Club Log allows).
//
// The operator turns it on per operation by adding the "Club Log Livestream"
// activity. That is also what makes it work: the app asks activities for a
// last look at each contact before it is written (`processQsoBeforeSave`),
// and only for an operation that carries some activity. The hook changes
// nothing in the contact; it queues it and returns at once, so a slow or
// unreachable Club Log never holds up logging.
//
// The token is the operator's own, made on Club Log under Settings → API, and
// kept in the keychain by the `account` hook. Club Log issues no application
// key. A timer has no hook context to read the account from, so the stream
// holds the token the last save handed it.

import { defineExtension, hooks, host } from "@ham2k/extension-sdk"
import type { AccountHook, ActivityHook, ActivitySuggestion, HookContext, JSONValue, Ref, RefHandlerHook, SuggestArgs } from "@ham2k/extension-sdk"

import { tFor } from "./i18n.ts"
import { API_BASE, Stream, recordOf } from "./stream.ts"
import type { Problem } from "./stream.ts"

import manifest from "../manifest.json" with { type: "json" }

export const TYPE = "clublogLivestream"

const SEARCH_WORDS = ["CLUB", "LOG", "CLUBLOG", "LIVE", "STREAM", "LIVESTREAM"]

/// The locale of the last hook call, for the notices the stream raises from
/// a timer.
let locale = "en"

function tokenOf(ctx: HookContext): string | undefined {
  return ctx.account?.credentials?.token?.trim() || undefined
}

function hasActivity(operation: Record<string, JSONValue>): boolean {
  const refs = operation.refs
  return Array.isArray(refs) && refs.some((ref) => (ref as Record<string, JSONValue>)?.type === TYPE)
}

function notice(problem: Problem | { key: "noToken" }): void {
  const t = tFor({ locale } as HookContext)
  void host.statusBar.showNotice({
    key: `${manifest.key}-${problem.key}`,
    icon: manifest.icon,
    title: t("noticeTitle"),
    text: t(problem.key, problem as unknown as Record<string, string>),
  })
}

const stream = new Stream({
  fetch: (url, options) => host.fetch(url, options),
  async adif(qso, operation) {
    const entries = await hooks.invokeOne("export", "adif", "generateExport", { operation, qsos: [qso], exportType: "adif" })
    const entry = entries.find((candidate) => candidate.ok)
    const content = (entry?.value as { content?: unknown } | undefined)?.content
    if (typeof content !== "string") throw new Error(entries[0]?.error ? String(entries[0].error) : "the ADIF exporter did not answer")
    return recordOf(content)
  },
  now: () => Date.now(),
  setTimeout: (callback, ms) => host.setTimeout(callback, ms),
  log: (message) => host.log(message),
  tell: notice,
})

let toldNoToken = false

const Activity: ActivityHook = {
  async suggest({ operation, searchTerm }: SuggestArgs, ctx: HookContext): Promise<ActivitySuggestion[]> {
    if (hasActivity(operation)) return []
    const words = (searchTerm ?? "").trim().toUpperCase().split(/\s+/).filter(Boolean)
    if (words.length && !words.every((word) => SEARCH_WORDS.some((known) => known.startsWith(word)))) return []
    const t = tFor(ctx)
    return [{ type: TYPE, label: t("activityLabel"), shortLabel: t("activityShortLabel"), name: t("activityDescription") }]
  },

  async processQsoBeforeSave({ qso, operation }, ctx: HookContext) {
    if (!hasActivity(operation)) return null
    locale = ctx.locale ?? locale
    const token = tokenOf(ctx)
    if (!token) {
      if (!toldNoToken) notice({ key: "noToken" })
      toldNoToken = true
      return null
    }
    toldNoToken = false
    try {
      // A null log (no uuid, or one the host does not know) is no log at all,
      // never an empty one: see Stream.saving.
      const uuid = typeof operation.uuid === "string" ? operation.uuid : ""
      const log = uuid ? ((await ctx.getQsos?.(uuid)) ?? undefined) : undefined
      stream.saving({ token, operation, qso, log })
    } catch (error) {
      // The contact is saved either way; this one just does not stream.
      host.log(`Club Log: could not queue a contact: ${error instanceof Error ? error.message : String(error)}`)
    }
    return null
  },
}

const RefHandler: RefHandlerHook = {
  async decorateRef({ ref }: { ref: Ref }, ctx: HookContext): Promise<Ref> {
    const t = tFor(ctx)
    return {
      ...ref,
      label: t("activityLabel"),
      shortLabel: t("activityShortLabel"),
      name: tokenOf(ctx) ? t("activityDescription") : t("noTokenShort"),
    }
  },
}

const Account: AccountHook = {
  label: "Club Log",
  description: (_args, ctx) => tFor(ctx)("accountDescription"),
  fields: (_args, ctx) => {
    const t = tFor(ctx)
    return [{ key: "token", label: t("tokenLabel"), type: "secret", postface: t("tokenPostface") }]
  },
  async testCredentials(credentials: Record<string, string>, ctx: HookContext): Promise<string> {
    const t = tFor(ctx)
    const token = credentials.token?.trim()
    if (!token) throw new Error(t("tokenMissing"))
    // Club Log names no account holder, so the check asks for one contact of
    // the operator's own call: that answers both whether the token works and
    // whether its account holds the call the operations will stream under.
    const settings = await host.getSettings()
    const call = typeof settings.operatorCall === "string" ? settings.operatorCall.trim().toUpperCase() : ""
    const path = call ? `/logs/${encodeURIComponent(call)}/qsos?limit=1` : "/me/usage"
    const answer = await host.fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      timeout: 15 * 1000,
    })
    if (answer.status === 401) throw new Error(t("tokenRefused"))
    if (call && (answer.status === 403 || answer.status === 404)) return t("callNotHeld", { call })
    if (answer.status !== 200) throw new Error(t("checkFailed", { status: String(answer.status) }))
    return call ? t("connectedAs", { call }) : t("tokenAccepted")
  },
}

defineExtension({
  ...manifest,
  onActivation({ registerHook }) {
    registerHook("account", { hook: Account, key: manifest.key })
    registerHook("activity", { hook: Activity, key: manifest.key })
    registerHook(`ref:${TYPE}`, { hook: RefHandler, key: manifest.key })
  },
})
