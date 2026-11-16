// Copyright ©️ 2026 Sebastian Delmont <sd@ham2k.com>
// SPDX-License-Identifier: MIT
//
// A chaser's running score, kept the way the tracker keeps the leaderboard
// (rules.ts): each host once per band and mode group, at the best value
// worked, inside the event's hours. The tracker scores chasers from the hosts'
// logs, not from this one, so this is the chaser's own count of what they
// should see there.
//
// In a host's own operation (its station call is on the host list) the same
// rules count the other way: the points this host's log gives its listeners,
// each listener once per band and mode group at the best value, with each
// contact's power class from the power logged for it, else the host's card.
// Beside those points it counts the soldering irons its listeners have: each
// listener's count once, as last logged.
//
// Contacts outside the event's hours score nothing, as on the tracker, and
// the summary says how many there are. In the app's developer mode the hours
// are ignored, so the score can be tried before the event; that changes only
// what the logger shows, never what is sent.
//
// The scorer's functions are synchronous, so it reads the host list the
// extension already holds (index.ts keeps it, and keeps a copy in its
// settings for the next start).

import { tally } from "@ham2k/extension-sdk"
import type { ContestScorer, HookContext, JSONValue, QsoScoreVerdict, ScoreTally } from "@ham2k/extension-sdk"

import { baseCall, modeGroupFor, powerClassForWatts, qsoPoints, roundPoints, wattsOf } from "./rules.ts"
import type { ModeGroup } from "./rules.ts"
import { inEvent } from "./tracker.ts"
import type { EventHours, HostTable } from "./tracker.ts"

export interface Scoresheet {
  [key: string]: JSONValue
  /// The host whose operation this is; null for a chaser's.
  host: string | null
  /// The best value, by `<base call>|<mode group>|<band>`: the host's call
  /// for a chaser, the listener's for a host. The band is empty for the linked
  /// networks, and `?` for a contact logged without one.
  best: Record<string, number>
  total: number
  /// A host's contacts inside the event, by mode group.
  qsos: Record<string, number>
  /// Contacts that would count but fall outside the event's hours.
  outside: number
  /// Developer mode: the event's hours are ignored.
  anyTime: boolean
  /// The current day's points, and its contacts that matter here (with a
  /// host for a chaser, any for a host), for the log's day headers.
  dayPoints: number
  dayContacts: number
  /// A host's listeners' soldering irons, by base call, as last logged: for
  /// the operation, and for the current day.
  irons: Record<string, number>
  dayIrons: Record<string, number>
}

export interface ScorerDeps {
  hosts(): HostTable
  event(): EventHours | undefined
  label(ctx: HookContext): string
  /// The short score beside the label: "14 pts".
  points(total: number, ctx: HookContext): string
  /// A host's short score: "3 irons, 14 pts".
  hostPoints(args: { points: number; irons: number }, ctx: HookContext): string
  /// The soldering irons a host logged for the listener on this contact.
  irons(qso: Record<string, JSONValue>): number | undefined
  summary(args: { points: number; hosts: number }, ctx: HookContext): string
  hostSummary(args: { qsos: number; points: number; listeners: number; irons: number }, ctx: HookContext): string
  hostGroupLine(args: { group: string; qsos: number; points: number; listeners: number }, ctx: HookContext): string
  /// "3 QSOs outside the event hours"
  outsideNote(qsos: number, ctx: HookContext): string
  /// That the event's hours are ignored (developer mode).
  anyTimeNote(ctx: HookContext): string
  icon: string
  color: string
}

const GROUP_LABELS: Record<ModeGroup, string> = { cw: "CW", phone: "Phone", digital: "Digital", dmr: "DMR" }

/// The slot a contact scores in, as the tracker places it. The linked
/// networks have no band of their own: one slot per call. A contact with no
/// band may be on a band already scored, so it takes a slot of its own only
/// when there is no banded one yet, and otherwise can only raise the lowest;
/// a first banded contact takes over that band-less slot.
export function slotFor(best: Record<string, number>, call: string, group: ModeGroup, band: JSONValue | undefined): string {
  const pair = `${call}|${group}|`
  if (group === "dmr") return pair
  const banded = Object.keys(best).filter((key) => key.startsWith(pair) && key !== `${pair}?`)
  const logged = typeof band === "string" ? band.replace(/\s+/g, "").toLowerCase() : ""
  if (logged) {
    if (banded.length === 0 && `${pair}?` in best) {
      best[pair + logged] = best[`${pair}?`]
      delete best[`${pair}?`]
    }
    return pair + logged
  }
  return banded.length === 0 ? `${pair}?` : banded.reduce((a, b) => (best[b] < best[a] ? b : a))
}

const sum = (counts: Record<string, number> | undefined): number => Object.values(counts ?? {}).reduce((total, n) => total + n, 0)

const bandOf = (slot: string): string => {
  const band = slot.split("|")[2] ?? ""
  return band === "?" ? "" : band
}

export function hrwbotaScorer(deps: ScorerDeps): ContestScorer<Scoresheet> {
  /// Whether a contact at `at` counts; one outside the hours is tallied as such.
  function counts(scoresheet: Scoresheet, at: number): boolean {
    scoresheet.dayContacts = (scoresheet.dayContacts ?? 0) + 1
    if (scoresheet.anyTime || inEvent(deps.event(), at)) return true
    scoresheet.outside = (scoresheet.outside ?? 0) + 1
    return false
  }

  /// The summary, and what it leaves out.
  function withNotes(summary: string, scoresheet: Scoresheet, ctx: HookContext): string {
    const notes = [
      ...(scoresheet.outside ? [deps.outsideNote(scoresheet.outside, ctx)] : []),
      ...(scoresheet.anyTime ? [deps.anyTimeNote(ctx)] : []),
    ]
    return [summary, ...notes].join(" · ")
  }

  function scoreGiven(scoresheet: Scoresheet, qso: Record<string, JSONValue>): { scoresheet: Scoresheet; score: QsoScoreVerdict } {
    const host = deps.hosts().forCall(scoresheet.host ?? undefined)
    const their = (qso.their ?? {}) as Record<string, JSONValue>
    const listener = typeof their.call === "string" ? baseCall(their.call) : null
    const at = qso.startAtMillis
    if (!host || !listener || typeof at !== "number" || !counts(scoresheet, at)) return { scoresheet, score: { value: 0 } }
    const group = modeGroupFor(typeof qso.mode === "string" ? qso.mode : "")
    const points = qsoPoints(powerClassForWatts(wattsOf(qso.power), group) ?? host.powerClass, group, host.pointsOverride)
    const slot = slotFor(scoresheet.best, listener, group, qso.band)
    const before = scoresheet.best[slot] ?? 0
    const gain = roundPoints(Math.max(0, points - before))
    if (points > before) scoresheet.best[slot] = points
    scoresheet.total = roundPoints(scoresheet.total + gain)
    scoresheet.dayPoints = roundPoints((scoresheet.dayPoints ?? 0) + gain)
    scoresheet.qsos[group] = (scoresheet.qsos[group] ?? 0) + 1
    const irons = deps.irons(qso)
    if (irons !== undefined) {
      scoresheet.irons = { ...scoresheet.irons, [listener]: irons }
      scoresheet.dayIrons = { ...scoresheet.dayIrons, [listener]: irons }
    }
    const score: QsoScoreVerdict = { value: gain, dupe: before > 0 && gain === 0 }
    if (gain > 0) {
      score.icon = deps.icon
      score.color = deps.color
    }
    return { scoresheet, score }
  }

  function summarizeGiven(scoresheet: Scoresheet, ctx: HookContext): Record<string, ScoreTally> {
    const groups = new Map<string, { points: number; listeners: Set<string> }>()
    const listeners = new Set<string>()
    for (const [slot, points] of Object.entries(scoresheet.best)) {
      const [call, group] = slot.split("|")
      const entry = groups.get(group) ?? { points: 0, listeners: new Set<string>() }
      entry.points = roundPoints(entry.points + points)
      entry.listeners.add(call)
      groups.set(group, entry)
      listeners.add(call)
    }
    const qsos = sum(scoresheet.qsos)
    const label = deps.label(ctx)
    const irons = sum(scoresheet.irons)
    const summary = withNotes(deps.hostSummary({ qsos, points: scoresheet.total, listeners: listeners.size, irons }, ctx), scoresheet, ctx)
    const lines = (Object.keys(GROUP_LABELS) as ModeGroup[])
      .filter((group) => scoresheet.qsos[group])
      .map((group) => {
        const entry = groups.get(group)
        return `- ${deps.hostGroupLine({ group: GROUP_LABELS[group], qsos: scoresheet.qsos[group], points: entry?.points ?? 0, listeners: entry?.listeners.size ?? 0 }, ctx)}`
      })
    return {
      hrwbota: tally("hrwbota", "operation", scoresheet.total, {
        label,
        icon: deps.icon,
        summary: deps.hostPoints({ points: scoresheet.total, irons }, ctx),
        summaryWithDetail: true,
        longSummary: [summary, ...(lines.length ? ["", ...lines] : [])].join("\n"),
      }),
    }
  }

  return {
    startScoresheet({ operation }, ctx) {
      const station = deps.hosts().forCall(typeof operation.stationCall === "string" ? operation.stationCall : undefined)
      return {
        host: station?.call ?? null,
        best: {},
        total: 0,
        qsos: {},
        outside: 0,
        anyTime: ctx?.developerMode === true,
        dayPoints: 0,
        dayContacts: 0,
        irons: {},
        dayIrons: {},
      }
    },

    scoreQso({ scoresheet, qso, isNewDay }) {
      if (isNewDay) {
        scoresheet.dayPoints = 0
        scoresheet.dayContacts = 0
        scoresheet.dayIrons = {}
      }
      if (scoresheet.host !== null) return scoreGiven(scoresheet, qso)
      const their = (qso.their ?? {}) as Record<string, JSONValue>
      const host = deps.hosts().forCall(typeof their.call === "string" ? their.call : undefined)
      const at = qso.startAtMillis
      if (!host || typeof at !== "number" || !counts(scoresheet, at)) {
        return { scoresheet, score: { value: 0 } }
      }
      const group = modeGroupFor(typeof qso.mode === "string" ? qso.mode : "")
      const points = qsoPoints(host.powerClass, group, host.pointsOverride)
      const slot = slotFor(scoresheet.best, baseCall(host.call) ?? host.call, group, qso.band)
      const before = scoresheet.best[slot] ?? 0
      const gain = roundPoints(Math.max(0, points - before))
      if (points > before) scoresheet.best[slot] = points
      scoresheet.total = roundPoints(scoresheet.total + gain)
      scoresheet.dayPoints = roundPoints((scoresheet.dayPoints ?? 0) + gain)
      const score: QsoScoreVerdict = { value: gain, dupe: before > 0 && gain === 0 }
      if (gain > 0) {
        score.icon = deps.icon
        score.color = deps.color
      }
      return { scoresheet, score }
    },

    summarizeScore({ scoresheet, scope }, ctx): Record<string, ScoreTally> {
      if (scope === "day") {
        if (!scoresheet.dayContacts) return {}
        const summary =
          scoresheet.host !== null
            ? deps.hostPoints({ points: scoresheet.dayPoints, irons: sum(scoresheet.dayIrons) }, ctx)
            : deps.points(scoresheet.dayPoints, ctx)
        return { hrwbota: tally("hrwbota", "day", scoresheet.dayPoints, { label: deps.label(ctx), icon: deps.icon, summary }) }
      }
      if (scope !== "operation") return {}
      if (scoresheet.host !== null) return summarizeGiven(scoresheet, ctx)
      const slots = Object.entries(scoresheet.best)
      const byHost = new Map<string, string[]>()
      for (const [slot, points] of slots.sort(([a], [b]) => a.localeCompare(b))) {
        const [call, group] = slot.split("|")
        const what = [bandOf(slot), GROUP_LABELS[group as ModeGroup] ?? group].filter((part) => part).join(" ")
        byHost.set(call, [...(byHost.get(call) ?? []), `${what} ${points}`])
      }
      const label = deps.label(ctx)
      const summary = withNotes(deps.summary({ points: scoresheet.total, hosts: byHost.size }, ctx), scoresheet, ctx)
      const lines = [...byHost.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([call, parts]) => `- **${call}**: ${parts.join(", ")}`)
      return {
        hrwbota: tally("hrwbota", "operation", scoresheet.total, {
          label,
          icon: deps.icon,
          summary: deps.points(scoresheet.total, ctx),
          summaryWithDetail: true,
          longSummary: [summary, ...(lines.length ? ["", ...lines] : [])].join("\n"),
        }),
      }
    },
  }
}
