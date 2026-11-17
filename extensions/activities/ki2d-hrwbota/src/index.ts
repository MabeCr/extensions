// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// Ham Radio Workbenches On The Air (https://hrwbota.com), for both sides of
// the event, against its tracker (tracker.ts):
//
// - Everyone gets the hosts on the air as spots, with what each is worth.
// - A chaser who adds the HRWBOTA activity to an operation sees, as they type
//   a call, that it is a host and what it is worth (the `lookup` hook's
//   note), and keeps a running score (scorer.ts).
// - A host (the profile's callsign is on the tracker's host list) can enter
//   the logger key from their host card as an account. An operation under
//   their call that carries the activity then sends its contacts, and the
//   status they imply, to the tracker (uploader.ts), and a self-spot goes to
//   the tracker as their status.
// - Both log the event's exchange (exchange.ts): a host the serial they send
//   and the listener's soldering irons and brand, a listener the host's
//   serial, with their own irons, brand and state asked once in the setup.
//
// The host list and the event's hours come from the tracker, are refreshed
// every REFRESH_MS while hooks are being called, and are kept in this
// extension's settings so a start without the network still scores.

import { contestScorer, defineExtension, host } from "@ham2k/extension-sdk"
import type {
  AccountHook,
  ActivityHook,
  ActivitySuggestion,
  HookContext,
  JSONValue,
  LoggingControlDescriptor,
  LookupHook,
  LookupResult,
  PostResult,
  Ref,
  RefHandlerHook,
  Spot,
  SpotEligibility,
  SpotsHook,
  SuggestArgs,
} from "@ham2k/extension-sdk"

import { hasListenerExchange, listenerExchange, listenerIrons, ownExchange, refOf, serialText } from "./exchange.ts"
import { tFor } from "./i18n.ts"
import { baseCall, qsoPoints } from "./rules.ts"
import type { ModeGroup } from "./rules.ts"
import { hrwbotaScorer } from "./scorer.ts"
import { API_BASE, HostTable, parseEvent, parseHosts, parseJson, parseSpots, pointsLabel } from "./tracker.ts"
import type { EventHours, HostEntry } from "./tracker.ts"
import { Uploader } from "./uploader.ts"
import type { Problem } from "./uploader.ts"

import manifest from "../manifest.json" with { type: "json" }

/// The activity's ref type. Log data: never renamed.
export const TYPE = "hrwbota"

const REFRESH_MS = 15 * 60 * 1000
/// The longest a hook waits for the tracker when no host list is held yet,
/// well inside the couple of seconds the app gives a hook.
const FIRST_LIST_WAIT_MS = 800
const SEARCH_WORDS = ["HRWBOTA", "HAM", "RADIO", "WORKBENCH", "WORKBENCHES", "ON", "THE", "AIR"]
const GROUPS: ModeGroup[] = ["cw", "phone", "digital", "dmr"]

type Data = Record<string, JSONValue>

let hosts = new HostTable([])
let event: EventHours | undefined
let refreshedAt = -Infinity
let refreshing: Promise<void> | undefined

/// The locale of the last hook call, for the notices raised from a timer.
let locale = "en"

interface Cached {
  at: number
  event?: [string, number, number]
  hosts: [string, string, string, string, string, number | null][]
}

function settingsGroup(settings: Data): Data {
  const groups = (settings.extensions ?? {}) as Data
  return (groups[`extension_${manifest.key}`] ?? {}) as Data
}

/// What the last start learned, until the tracker answers.
async function restore(): Promise<void> {
  try {
    const cached = settingsGroup(await host.getSettings()).cache as unknown as Cached | undefined
    if (!cached || !Array.isArray(cached.hosts) || hosts.size > 0) return
    hosts = new HostTable(
      cached.hosts.map(([id, call, name, kind, powerClass, pointsOverride]) => ({
        id,
        call,
        name,
        kind: kind === "wildcard" ? "wildcard" : "host",
        powerClass: powerClass as HostEntry["powerClass"],
        pointsOverride,
      })),
    )
    if (cached.event) event = { name: cached.event[0], startMillis: cached.event[1], endMillis: cached.event[2] }
  } catch (error) {
    host.log(`HRWBOTA: could not read the saved host list: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function refresh(): Promise<void> {
  const [hostsAnswer, eventAnswer] = await Promise.all([
    host.fetch(`${API_BASE}/hosts`, { headers: { Accept: "application/json" }, timeout: 15 * 1000 }),
    host.fetch(`${API_BASE}/event`, { headers: { Accept: "application/json" }, timeout: 15 * 1000 }),
  ])
  if (hostsAnswer.status !== 200) throw new Error(`the host list answered HTTP ${hostsAnswer.status}`)
  hosts = new HostTable(parseHosts(hostsAnswer.body))
  if (eventAnswer.status === 200) event = parseEvent(eventAnswer.body) ?? event
  refreshedAt = Date.now()
  const cache: Cached = {
    at: refreshedAt,
    ...(event ? { event: [event.name, event.startMillis, event.endMillis] } : {}),
    hosts: hosts.hosts.map((h) => [h.id, h.call, h.name, h.kind, h.powerClass, h.pointsOverride]),
  }
  try {
    await host.setSettings({ cache: cache as unknown as JSONValue })
  } catch (error) {
    host.log(`HRWBOTA: could not keep the host list for the next start: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/// Refreshes the host list when it is stale, at most one fetch at a time. A
/// failure keeps the list held, and is tried again at the next call. A hook
/// answers from the list it holds; only without one, and when it may, does it
/// wait for the tracker, and then briefly.
async function ensureHosts(ctx: HookContext, mayWait = true): Promise<void> {
  if (!ctx.online || Date.now() - refreshedAt < REFRESH_MS) return
  refreshing ??= refresh()
    .catch((error) => host.log(`HRWBOTA: could not refresh the host list: ${error instanceof Error ? error.message : String(error)}`))
    .finally(() => {
      refreshing = undefined
    })
  if (mayWait && hosts.size === 0) await Promise.race([refreshing, new Promise<void>((resolve) => host.setTimeout(resolve, FIRST_LIST_WAIT_MS))])
}

function keyOf(ctx: HookContext): string | undefined {
  return ctx.account?.credentials?.key?.trim() || undefined
}

function hasActivity(operation: Data): boolean {
  const refs = operation.refs
  return Array.isArray(refs) && refs.some((ref) => (ref as Data)?.type === TYPE)
}

function stationHost(operation: Data): HostEntry | undefined {
  return hosts.forCall(typeof operation.stationCall === "string" ? operation.stationCall : undefined)
}

function pointsFor(entry: HostEntry): Partial<Record<ModeGroup, number>> {
  return Object.fromEntries(GROUPS.map((g) => [g, qsoPoints(entry.powerClass, g, entry.pointsOverride)]))
}

/// One notice per problem: a second rejected call gets its own, rather than
/// replacing the first.
function notice(problem: Problem | { key: "noKey" }): void {
  const t = tFor({ locale } as HookContext)
  const about = "call" in problem ? `-${problem.call}` : ""
  host.statusBar
    .showNotice({
      key: `${manifest.key}-${problem.key}${about}`,
      icon: manifest.icon,
      title: t("noticeTitle"),
      text: t(problem.key, problem as unknown as Record<string, string>),
    })
    .catch((error: unknown) => host.log(`HRWBOTA: could not show a notice (${problem.key}): ${error instanceof Error ? error.message : String(error)}`))
}

const uploader = new Uploader(
  {
    fetch: (url, options) => host.fetch(url, options),
    now: () => Date.now(),
    setTimeout: (callback, ms) => host.setTimeout(callback, ms),
    log: (message) => host.log(message),
    tell: notice,
  },
  TYPE,
)

let toldNoKey = false

const str = (value: JSONValue | undefined): string => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "")

type OwnExchange = { irons: string; brand: string; state: string }

/// A listener's irons, brand and state from the last setup, offered to the
/// next one: they rarely change between operations. The JSON last saved, so
/// an unchanged setup isn't written again.
let savedOwn: string | undefined

async function lastOwnExchange(): Promise<OwnExchange> {
  try {
    const saved = settingsGroup(await host.getSettings()).ownExchange as Data | undefined
    return { irons: str(saved?.irons), brand: str(saved?.brand), state: str(saved?.state) }
  } catch (error) {
    host.log(`HRWBOTA: could not read the last exchange: ${error instanceof Error ? error.message : String(error)}`)
    return { irons: "", brand: "", state: "" }
  }
}

async function rememberOwnExchange(operation: Data): Promise<void> {
  const opRef = refOf(operation, TYPE)
  if (!opRef) return
  const own: OwnExchange = { irons: str(opRef.irons), brand: str(opRef.brand), state: str(opRef.state) }
  const json = JSON.stringify(own)
  if (json === savedOwn || !(own.irons || own.brand || own.state)) return
  try {
    await host.setSettings({ ownExchange: own })
    savedOwn = json
  } catch (error) {
    host.log(`HRWBOTA: could not keep the exchange for the next operation: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/// The contact's exchange as the log row shows it, in the generic
/// `their.exchange`: a host's copy of the listener's irons and brand, a
/// listener's of the host's serial. Projected whenever the fields have said
/// anything, blank included, so clearing them clears the row too.
function exchangePatch(qso: Data, isHost: boolean): Data | null {
  if (isHost) return hasListenerExchange(qso, TYPE) ? { their: { exchange: listenerExchange(qso, TYPE) } } : null
  const ref = refOf(qso, TYPE)
  return ref && "theirSerial" in ref ? { their: { exchange: serialText(ref.theirSerial) } } : null
}

const Activity: ActivityHook = {
  /// What the operation setup pane draws the activity with: without a control
  /// claiming its type, the app shows the reference as one no extension
  /// handles. A host has nothing to set up, so theirs is a reference list:
  /// adding it stays one tap. A listener's is a form for what they send.
  async operationControls({ operation }, ctx: HookContext): Promise<LoggingControlDescriptor[]> {
    const t = tFor(ctx)
    const base = { key: `${TYPE}/event`, label: t("activityLabel"), icon: manifest.icon, color: manifest.accentColor, order: 10, optionType: "optional" as const }
    await ensureHosts(ctx)
    if (stationHost(operation)) return [{ ...base, input: { kind: "refList", refType: TYPE } }]
    // Seeds a new setup only; a configured one keeps its own values.
    const last = await lastOwnExchange()
    return [
      {
        ...base,
        input: {
          kind: "form",
          refType: TYPE,
          form: {
            title: t("activityDescription"),
            elements: [
              { type: "markdown", text: t("setupText") },
              { type: "field", fieldType: "text", key: "irons", label: t("ownIronsLabel"), placeholder: "3", value: last.irons },
              { type: "field", fieldType: "text", key: "brand", label: t("ownBrandLabel"), placeholder: "Hakko", uppercase: true, value: last.brand },
              { type: "field", fieldType: "text", key: "state", label: t("ownStateLabel"), placeholder: "NY", uppercase: true, value: last.state },
            ],
          },
        },
      },
    ] as LoggingControlDescriptor[]
  },

  /// The exchange, on the logging row: a host's serial and the listener's
  /// irons and brand, typed straight through with Auto-advance Fields on
  /// ("3HAKKO": a letter ends the count); a listener's copy of the host's
  /// serial, with what they send beside it. The state a host copies goes in
  /// the logger's own State field.
  async loggingControls({ operation }, ctx: HookContext): Promise<LoggingControlDescriptor[]> {
    if (!hasActivity(operation)) return []
    await ensureHosts(ctx)
    const t = tFor(ctx)
    const control = (key: string, label: string, order: number) => ({
      key: `${TYPE}/${key}`,
      label: t(label),
      shortLabel: t(`${label}Short`),
      icon: manifest.icon,
      color: manifest.accentColor,
      order,
    })
    if (stationHost(operation)) {
      return [
        {
          ...control("ourSerial", "ourSerialLabel", 10),
          skipFocus: true,
          input: { kind: "serial", refType: TYPE, field: "ourSerial", sequence: { key: "serial" }, placeholder: "#" },
        },
        {
          ...control("theirIrons", "theirIronsLabel", 20),
          group: "their",
          input: { kind: "text", refType: TYPE, field: "theirIrons", numeric: true, maxLength: 3, chars: { min: 2, ideal: 3, max: 4 }, autoadvanceBefore: "[0-9]*[A-Z]" },
        },
        {
          ...control("theirBrand", "theirBrandLabel", 30),
          group: "their",
          input: { kind: "text", refType: TYPE, field: "theirBrand", uppercase: true, maxLength: 20, chars: { min: 6, ideal: 10, max: 16 } },
        },
      ] as LoggingControlDescriptor[]
    }
    const sending = ownExchange(refOf(operation, TYPE))
    return [
      {
        ...control("theirSerial", "theirSerialLabel", 20),
        input: { kind: "text", refType: TYPE, field: "theirSerial", numeric: true, maxLength: 5, ...(sending ? { ourExchange: sending } : {}) },
      },
    ] as LoggingControlDescriptor[]
  },

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
    await ensureHosts(ctx)
    const isHost = !!stationHost(operation)
    const patch = exchangePatch(qso, isHost)
    if (!isHost) {
      await rememberOwnExchange(operation)
      return patch
    }
    const key = keyOf(ctx)
    if (!key) {
      if (!toldNoKey) notice({ key: "noKey" })
      toldNoKey = true
      return patch
    }
    toldNoKey = false
    // A null log (no uuid, or one the host does not know) is no log at all,
    // never an empty one: an empty one would read as every contact deleted.
    // Without it the contact still goes; only deletions wait for the next save.
    let log: Data[] | undefined
    const uuid = typeof operation.uuid === "string" ? operation.uuid : ""
    try {
      log = uuid ? ((await ctx.getQsos?.(uuid)) ?? undefined) : undefined
    } catch (error) {
      host.log(`HRWBOTA: could not read the operation's log: ${error instanceof Error ? error.message : String(error)}`)
    }
    uploader.saving({ key, operation, qso, log })
    return patch
  },
}

/// The exchange in ADIF's fields: the serials, and each side's exchange
/// whole, as sent and received. Read from what each side logs, so a host's
/// contact and a listener's both come out right.
const AdifFields = {
  async fieldsForOneQSO({ qso, operation }: { qso: Data; operation: Data }, _ctx: HookContext): Promise<{ name: string; value: string }[]> {
    if (!hasActivity(operation)) return []
    const ref = refOf(qso, TYPE)
    const fields: { name: string; value: string }[] = []
    const add = (name: string, value: string) => {
      if (value) fields.push({ name, value })
    }
    const ourSerial = serialText(ref?.ourSerial)
    const theirSerial = serialText(ref?.theirSerial)
    add("STX", ourSerial)
    add("SRX", theirSerial)
    add("STX_STRING", [ourSerial, ownExchange(refOf(operation, TYPE))].filter((part) => part).join(" "))
    add("SRX_STRING", [theirSerial, listenerExchange(qso, TYPE)].filter((part) => part).join(" "))
    return fields
  },
}

const RefHandler: RefHandlerHook = {
  async decorateRef({ ref }: { ref: Ref }, ctx: HookContext): Promise<Ref> {
    const t = tFor(ctx)
    await ensureHosts(ctx)
    const settings = await host.getSettings()
    const profile = hosts.forCall(typeof settings.operatorCall === "string" ? settings.operatorCall : undefined)
    const name = !profile ? t("chasing") : keyOf(ctx) ? t("sending", { call: profile.call }) : t("hostNoKey")
    return { ...ref, label: t("activityLabel"), shortLabel: t("activityShortLabel"), name }
  },
}

const Spots: SpotsHook = {
  sourceName: "HRWBOTA",

  async fetchSpots(_args, ctx: HookContext): Promise<Spot[]> {
    if (!ctx.online) return []
    const answer = await host.fetch(`${API_BASE}/v1/spots`, { headers: { Accept: "application/json" }, timeout: 15 * 1000 })
    if (answer.status !== 200) throw new Error(`the HRWBOTA spots feed answered HTTP ${answer.status}`)
    return parseSpots(answer.body, tFor(ctx)("spotLabel"))
  },

  async isSelfSpotEnabled({ operation }, ctx: HookContext): Promise<SpotEligibility> {
    await ensureHosts(ctx)
    return { enabled: hasActivity(operation) && !!keyOf(ctx) && !!stationHost(operation), icon: manifest.icon }
  },

  async postSelfSpot({ operation, freq, mode, comment }, ctx: HookContext): Promise<PostResult> {
    const t = tFor(ctx)
    const key = keyOf(ctx)
    if (!key) return { ok: false, message: t("hostNoKey"), userMessage: { presentation: "status", text: t("hostNoKey") } }
    const result = await uploader.selfSpot({ key, operation, freq, mode, comment })
    if (result.ok) return { ok: true, message: t("spotSent") }
    const text =
      result.problem === "keyRefused"
        ? t("keyRefused")
        : result.problem === "wrongKey"
          ? t("wrongKeySpot", { owner: result.owner ?? "", call: String(operation.stationCall ?? "") })
          : result.problem === "retry" && !result.message
            ? t("spotUnreachable")
            : t("spotFailed", { message: result.message ?? "" })
    return { ok: false, message: text, userMessage: { presentation: "status", text } }
  },
}

const Lookup: LookupHook = {
  async lookupCall({ callInfo, qso, operation }, ctx: HookContext): Promise<LookupResult> {
    if (!operation || !hasActivity(operation as Data)) return []
    const entry = hosts.forCall(callInfo?.call)
    if (!entry) return []
    const t = tFor(ctx)
    const mode = typeof (qso as Data | undefined)?.mode === "string" ? ((qso as Data).mode as string) : undefined
    const points = pointsLabel(pointsFor(entry), mode)
    const note = t(entry.kind === "wildcard" ? "wildcardNote" : "hostNote", { points })
    return [{ call: callInfo.call, source: "HRWBOTA", notes: [entry.name ? `${note} · ${entry.name}` : note] }]
  },
}

const Account: AccountHook = {
  label: "HRWBOTA",
  description: async (_args, ctx) => {
    const t = tFor(ctx)
    // The app asks every extension's account at once, under one short
    // deadline, at startup too: answer from what is held.
    await ensureHosts(ctx, false)
    const settings = await host.getSettings()
    const call = typeof settings.operatorCall === "string" ? settings.operatorCall.trim().toUpperCase() : ""
    // Without a host list yet, nobody can be told they are not a host.
    if (keyOf(ctx) || hosts.size === 0 || hosts.forCall(call)) return t("accountDescription")
    return call ? t("accountNotHost", { call }) : t("accountNoCall")
  },
  // The key field shows only for a host, or for whoever already entered one,
  // so an operator who changed profiles can still clear it, and for everyone
  // until the host list has loaded. Like the description, it answers from the
  // list held.
  fields: async (_args, ctx) => {
    const t = tFor(ctx)
    await ensureHosts(ctx, false)
    const settings = await host.getSettings()
    const call = typeof settings.operatorCall === "string" ? settings.operatorCall : undefined
    if (!keyOf(ctx) && hosts.size > 0 && !hosts.forCall(call)) return []
    return [{ key: "key", label: t("keyLabel"), type: "secret", postface: t("keyPostface") }]
  },
  async testCredentials(credentials: Record<string, string>, ctx: HookContext): Promise<string> {
    const t = tFor(ctx)
    const key = credentials.key?.trim()
    if (!key) throw new Error(t("keyMissing"))
    const answer = await host.fetch(`${API_BASE}/v1/me`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      timeout: 15 * 1000,
    })
    if (answer.status === 401) throw new Error(t("keyRefused"))
    if (answer.status !== 200) throw new Error(t("checkFailed", { status: String(answer.status) }))
    const me = (parseJson(answer.body)?.host ?? {}) as Data
    const call = String(me.call ?? "")
    const name = String(me.name ?? "")
    if (call) uploader.keyAccepted(key, call)
    const settings = await host.getSettings()
    const profileCall = typeof settings.operatorCall === "string" ? settings.operatorCall.trim().toUpperCase() : ""
    if (profileCall && baseCall(profileCall) !== baseCall(call)) return t("connectedAsOther", { call, name, profileCall })
    return t("connectedAs", { call, name })
  },
}

/// "3 QSOs", "1 listener": the counts in a host's score, worded.
function counted({ qsos, points, listeners }: { qsos: number; points: number; listeners: number }, ctx: HookContext): Record<string, string> {
  const t = tFor(ctx)
  return {
    qsos: t(qsos === 1 ? "qsosOne" : "qsosOther", { count: String(qsos) }),
    points: String(points),
    listeners: t(listeners === 1 ? "listenersOne" : "listenersOther", { count: String(listeners) }),
  }
}

/// "3 irons"
function ironsText(irons: number, ctx: HookContext): string {
  return tFor(ctx)(irons === 1 ? "ironsOne" : "ironsOther", { count: String(irons) })
}

defineExtension({
  ...manifest,
  onActivation({ registerHook }) {
    registerHook("account", { hook: Account, key: manifest.key })
    registerHook("activity", { hook: Activity, key: manifest.key })
    registerHook(`ref:${TYPE}`, { hook: RefHandler, key: manifest.key })
    registerHook("spots", { hook: Spots, key: manifest.key })
    registerHook("lookup", { hook: Lookup, key: manifest.key })
    registerHook("adifFields", { hook: AdifFields, key: manifest.key })
    registerHook("scoring", {
      key: manifest.key,
      hook: contestScorer(
        hrwbotaScorer({
          hosts: () => hosts,
          event: () => event,
          label: (ctx) => tFor(ctx)("activityLabel"),
          points: (total, ctx) => tFor(ctx)("pointsShort", { points: String(total) }),
          hostPoints: ({ points, irons }, ctx) => tFor(ctx)("hostPointsShort", { points: String(points), irons: ironsText(irons, ctx) }),
          irons: (qso) => listenerIrons(qso, TYPE),
          summary: ({ points, hosts: count }, ctx) => tFor(ctx)(count === 1 ? "scoreSummaryOne" : "scoreSummaryOther", { points: String(points), count: String(count) }),
          hostSummary: ({ irons, ...args }, ctx) => tFor(ctx)("hostSummary", { ...counted(args, ctx), irons: ironsText(irons, ctx) }),
          hostGroupLine: ({ group, ...args }, ctx) => tFor(ctx)("hostGroupLine", { group, ...counted(args, ctx) }),
          outsideNote: (qsos, ctx) => tFor(ctx)("outsideHours", { qsos: counted({ qsos, points: 0, listeners: 0 }, ctx).qsos }),
          anyTimeNote: (ctx) => tFor(ctx)("anyTime"),
          icon: manifest.icon,
          color: manifest.accentColor,
        }),
        { scope: { refTypes: [TYPE] } },
      ),
    })
    void restore()
  },
})
