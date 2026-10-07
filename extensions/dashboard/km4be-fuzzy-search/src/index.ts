// Copyright ©️ 2026 km4be
// SPDX-License-Identifier: MIT
//
// Type part of a callsign into the call field and this pane lists every
// station in the operation's log whose call contains it: "be" finds KM4BE,
// W8ABE and VE3BEP.
//
// Drawn as markdown (see markdown.ts): one line to a station, the letters that
// matched in bold. The host scrolls and themes it, and it renders everywhere.
// An HTML panel would underline them, but the host did not re-render it as the
// call was typed.
//
// VIEW ONLY. A panel cannot write to the call field: `setCallField` is a
// `CommandAction`, and only a `command` hook can return one — a panel's
// `onEvent` answers with scene values and strings. So the pane shows what
// matched and the operator types the rest.
//
// The search is this operation only. `ctx.getQsos` is scoped to one
// operation, there is no call to list the others, and `getHistoryForCall`
// wants a whole call, not a fragment.

import { defineExtension } from "@ham2k/extension-sdk"
import type { HookContext, JSONValue, PanelContent, PanelDescriptor, PanelHook, PanelRenderArgs } from "@ham2k/extension-sdk"

import manifest from "../manifest.json" with { type: "json" }
import { messageMarkdown, resultsMarkdown } from "./markdown.ts"

const DEFAULT_MIN_LETTERS = 2
const DEFAULT_MAX_RESULTS = 50

type Qso = Record<string, JSONValue>

export interface Match {
  call: string
  name: string
  band: string
  mode: string
  millis: number
  count: number
}

const str = (v: JSONValue | undefined): string => (typeof v === "string" ? v : "")
const obj = (v: JSONValue | undefined): Record<string, JSONValue> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, JSONValue>) : {}

/// The partial the operator is typing. `callField.partial` is the segment
/// under the cursor of a stack or list; `their.call` is the whole field.
export function typedPartial(qso: Qso | undefined): string {
  if (!qso) return ""
  const field = obj(qso.callField)
  const text = str(field.partial) || str(field.call) || str(obj(qso.their).call)
  return text.trim().toUpperCase()
}

/// One row per distinct callsign, carrying its most recent QSO, newest first.
export function searchQsos(qsos: Qso[], partial: string, max: number): Match[] {
  const needle = partial.trim().toUpperCase()
  if (!needle) return []

  const byCall = new Map<string, Match>()
  for (const qso of qsos) {
    const their = obj(qso.their)
    const call = str(their.call).trim().toUpperCase()
    if (!call || !call.includes(needle)) continue
    if (str(qso.band) === "event") continue

    const millis = typeof qso.startAtMillis === "number" ? qso.startAtMillis : 0
    const seen = byCall.get(call)
    if (seen) {
      seen.count += 1
      if (millis < seen.millis) continue
    }

    byCall.set(call, {
      call,
      name: str(their.name) || str(obj(their.guess).name),
      band: str(qso.band),
      mode: str(qso.mode),
      millis,
      count: seen ? seen.count : 1,
    })
  }

  return [...byCall.values()].sort((a, b) => b.millis - a.millis || a.call.localeCompare(b.call)).slice(0, max)
}

const count = (v: JSONValue | undefined, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) && v >= 1 ? Math.floor(v) : fallback

export const FuzzySearchPanel: PanelHook = {
  async getPanels(_args: Record<string, never>, _ctx: HookContext): Promise<PanelDescriptor[]> {
    return [
      {
        key: "search",
        title: "KM4BE Callsign Search",
        description: "Previously logged callsigns containing what you are typing",
        icon: "text-search",
        // The draft is what carries the typed call, and the panel is useless
        // without it, so it is declared here rather than per render.
        on: ["qso", "qsoLogged"],
        form: [
          {
            type: "field",
            key: "minLetters",
            fieldType: "number",
            label: "Minimum letters",
            description: `How many letters to type before matching starts. Default ${DEFAULT_MIN_LETTERS}.`,
          },
          {
            type: "field",
            key: "maxResults",
            fieldType: "number",
            label: "Most results",
            description: `The longest the list gets; it scrolls. Default ${DEFAULT_MAX_RESULTS}.`,
          },
        ],
      },
    ]
  },

  async render(args: PanelRenderArgs, ctx: HookContext): Promise<PanelContent> {
    const minLetters = count(args.config?.minLetters, DEFAULT_MIN_LETTERS)
    const maxResults = count(args.config?.maxResults, DEFAULT_MAX_RESULTS)
    const partial = typedPartial(args.qso)

    if (partial.length < minLetters) {
      return { kind: "markdown", content: messageMarkdown(`Type at least ${minLetters} letters of a callsign.`) }
    }

    const uuid = str(args.operation?.uuid)
    const qsos = (uuid && (await ctx.getQsos?.(uuid))) || []
    const all = searchQsos(qsos, partial, Infinity)

    if (!all.length) return { kind: "markdown", content: messageMarkdown(`No logged callsign contains ${partial}.`) }
    const shown = all.slice(0, maxResults)
    return { kind: "markdown", content: resultsMarkdown(shown, partial, all.length - shown.length) }
  },
}

defineExtension({
  ...manifest,
  onActivation({ registerHook }) {
    registerHook("panel", { key: manifest.key, hook: FuzzySearchPanel })
  },
})
