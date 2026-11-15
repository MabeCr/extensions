// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Partial Calls: as the operator types a call, the calls it could be are
// offered under the call info (`host.draftSuggestions`) and listed in a panel,
// from the logs and from Super Check Partial's SCP.DB, kept on the device as
// a `sqlite` data file (extension API 25).

import { createCachedTranslator, defineExtension, host } from "@ham2k/extension-sdk"
import type {
  AssistantDescriptor,
  AssistantHook,
  DataFileDefinition,
  DynamicSettingsPanel,
  FormDefinition,
  HookContext,
  JSONValue,
  ObserveArgs,
  SettingsPanelDescriptor,
} from "@ham2k/extension-sdk"

import manifest from "../manifest.json" with { type: "json" }
import { partialCallsPanel } from "./panel.ts"
import { bindHostCall, draftSuggestions } from "./sdkGap.ts"
import type { HookContext25, SqliteDataFileDefinition } from "./sdkGap.ts"
import type { Candidate } from "./rank.ts"
import { contestRefTypes, searchCalls, searchError, typedCall } from "./search.ts"

import en from "./i18n/en.json" with { type: "json" }
import es from "./i18n/es.json" with { type: "json" }

const tFor = createCachedTranslator({ en: { translation: en }, es: { translation: es } })

/// The data file's key and the lookup category its rows fill.
const SCP = manifest.key

/// Scored, of the ranked calls: `scoreCandidates` takes at most 20, and each
/// costs the scorers a look.
const SCORED = 12

/// Offered: the line under the call info shows what fits of them.
const OFFERED = 6

const scpDataFile: SqliteDataFileDefinition = {
  key: SCP,
  name: (_args: Record<string, never>, ctx: HookContext) => tFor(ctx)("scpName"),
  description: (_args: Record<string, never>, ctx: HookContext) => tFor(ctx)("scpDescription"),
  url: "https://www.supercheckpartial.com/SCP.DB",
  // SCP publishes a new file at most daily, and asks clients to check no
  // more often.
  maxAgeInDays: 1,
  fetchType: "sqlite",
  category: SCP,
  sqliteQuery: "SELECT callsign, annual_rate AS rate, modes, contests FROM callsigns",
  fields: { key: "callsign" },
}

interface Settings {
  /// Offer calls only in an operation with a contest ref.
  onlyContests: boolean
  /// Every other operation's log.
  searchLogs: boolean
  /// This operation's own log.
  searchActivity: boolean
  useScp: boolean
}

async function loadSettings(): Promise<Settings> {
  const extensions = (await host.getSettings()).extensions as Record<string, JSONValue> | undefined
  const mine = extensions?.[`extension_${manifest.key}`] as Record<string, JSONValue> | undefined
  return { onlyContests: mine?.onlyContests !== false, searchLogs: mine?.searchLogs !== false, searchActivity: mine?.searchActivity !== false, useScp: mine?.useScp !== false }
}

/// Read at activation, which is the only place the data file can be
/// registered or left out: `useScp` restarts the runtime when it changes. The
/// others take effect at the next call typed.
let settings: Settings = { onlyContests: true, searchLogs: true, searchActivity: true, useScp: true }

const SettingsPanel: DynamicSettingsPanel = {
  kind: "dynamic",

  async getPanels(_args: Record<string, never>, ctx: HookContext): Promise<SettingsPanelDescriptor[]> {
    return [{ key: manifest.key, title: tFor(ctx)("settingsTitle"), sidebar: false, dataFilesSection: true, section: "lookups" }]
  },

  async getDefinition(_args: { panelKey: string }, ctx: HookContext): Promise<FormDefinition> {
    const t = tFor(ctx)
    return {
      elements: [
        { type: "field", fieldType: "checkbox", key: "onlyContests", label: t("onlyContests"), value: settings.onlyContests },
        { type: "field", fieldType: "checkbox", key: "searchLogs", label: t("searchLogs"), value: settings.searchLogs },
        { type: "field", fieldType: "checkbox", key: "searchActivity", label: t("searchActivity"), value: settings.searchActivity },
        { type: "field", fieldType: "checkbox", key: "useScp", label: t("useScp"), value: settings.useScp, restartOnChange: true },
        { type: "markdown", text: t("scpHelp") },
      ],
    }
  },

  async onChangeField({ fieldKey, value }) {
    if (fieldKey !== "onlyContests" && fieldKey !== "searchLogs" && fieldKey !== "searchActivity" && fieldKey !== "useScp") return
    await host.setSettings({ [fieldKey]: value === true })
    if (fieldKey !== "useScp") settings = { ...settings, [fieldKey]: value === true }
  },
}

/// The operations a list is up in. A call picked from one is asked about as
/// any call typed: the app keeps the list being walked while the pick stands,
/// and a call typed out in full needs its own list to keep its verdicts shown.
const offered = new Set<string>()

async function withdraw(operationUuid: string): Promise<void> {
  if (!offered.delete(operationUuid)) return
  await draftSuggestions.clear({ operationUuid })
}

/// Posts the likeliest of [all] under the call info for [typed], with what
/// the scorers say of each; takes the list down when there are none.
async function offer(
  all: Candidate[],
  operationUuid: string,
  typed: string,
  qso: Record<string, JSONValue> | undefined,
  mode: string | undefined,
  ctx: HookContext25,
): Promise<void> {
  const ranked = all.slice(0, SCORED)
  if (ranked.length === 0) return withdraw(operationUuid)

  const candidates: Record<string, Record<string, JSONValue>> = {}
  for (const { call } of ranked) {
    candidates[call] = { their: { call }, ...(qso?.band ? { band: qso.band } : {}), ...(mode ? { mode } : {}) }
  }
  // Null is the scorers having nothing to say — no scorer for this
  // operation, or another in front — and the calls are offered unmarked,
  // as the app's own stand-in offers them.
  const verdicts = (await ctx.scoreCandidates?.(candidates, { operationUuid })) ?? null
  const drafts = ranked.slice(0, OFFERED).map(({ call }) => ({
    qso: { their: { call } },
    notices: verdicts?.[call]?.notices ?? [],
    alerts: verdicts?.[call]?.alerts ?? [],
  }))
  const { accepted } = await draftSuggestions.post({ forCall: typed, drafts, operationUuid })
  if (accepted) offered.add(operationUuid)
}

const PartialCallsAssistant: AssistantHook = {
  async getAssistants(_args: Record<string, never>, ctx: HookContext): Promise<AssistantDescriptor[]> {
    const t = tFor(ctx)
    return [
      {
        key: "suggest",
        title: t("assistantTitle"),
        description: t("assistantDescription"),
        icon: "account-search",
        on: ["qso"],
      },
    ]
  },

  async observe({ operation, qso, clock }: ObserveArgs, hookCtx: HookContext): Promise<void> {
    const ctx = hookCtx as HookContext25
    const operationUuid = operation.uuid as string
    if (settings.onlyContests && contestRefTypes(operation).length === 0) return withdraw(operationUuid)

    const typed = typedCall(qso)
    if (!typed) return withdraw(operationUuid)
    const mode = typeof qso?.mode === "string" ? qso.mode : undefined
    const search = searchCalls(ctx, settings, { operation, typed, mode, clock })
    if (!search) return
    const { ranked: all, failures } = await search
    // The sources that answered are offered; a failed one is reported once
    // they are, for the app to count, beside any failure of the offer itself.
    let offerError: unknown = null
    try {
      await offer(all, operationUuid, typed, qso, mode, ctx)
    } catch (error) {
      offerError = error
    }
    const sourceError = failures.length > 0 ? searchError(failures) : null
    if (offerError && sourceError) throw new AggregateError([offerError, sourceError], "Partial Calls: offering calls failed, and so did a search")
    if (offerError ?? sourceError) throw offerError ?? sourceError
  },
}

defineExtension({
  ...manifest,
  async onActivation(api) {
    bindHostCall((api as { hostCall?: unknown }).hostCall)
    api.registerHook("settingsPanel", { hook: SettingsPanel, key: manifest.key })
    api.registerHook("assistant", { hook: PartialCallsAssistant, key: manifest.key })
    api.registerHook("panel", { hook: partialCallsPanel({ t: (ctx) => tFor(ctx as HookContext), sources: () => settings }), key: manifest.key })
    // After everything else: registering the data file waits on the setting.
    settings = await loadSettings()
    if (settings.useScp) api.registerHook("dataFile", { hook: scpDataFile as unknown as DataFileDefinition, key: SCP })
  },
})
